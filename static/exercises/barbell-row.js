// ========== Barbell Row Exercise Module ==========
// Hybrid exercise: tracks torso angle (hip hinge) + wrist/elbow position (pull).
// Calibrates in hinged-over position with bar hanging down.
// Quality based on how far the tracking point rises toward torso during the pull.
// Monitors torso angle change during pull for cheat detection.
// Camera should be positioned from the side so shoulder, hip, and arm are visible.
//
// ELBOW FALLBACK: When plates occlude the wrist from a side view, the module
// automatically falls back to tracking the elbow (which sits above the plates).
// Calibration with elbow uses the same SHOULDER_WRIST_RATIO but with the shorter
// shoulder-to-elbow distance, producing an inflated inchesPerUnit that converts
// elbow movement into wrist-equivalent inches. All quality thresholds and speed
// scores remain unchanged regardless of which landmark is tracked.
//
// State machine: standing (hinged) -> ascending (pulling up) -> descending (lowering) -> rep counted.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  // Row-specific hyperparameters
  const ROW = {
    MIN_PULL_INCHES: 4,            // Minimum wrist travel upward for valid rep
    PULL_THRESHOLD_INCHES: 2.5,    // Wrist rise to trigger pulling state
    RECOVERY_PERCENT: 80,          // % recovery (bar lowered back) to count rep
    PULL_VELOCITY_MIN: 0.0010,     // Minimum upward velocity for pull detection
    DEPTH_TRIGGER_MULTIPLIER: 1.5, // Multiplier for well-past-threshold check
    RECOVERY_WARNING_THRESHOLD: 50,

    // Pull quality thresholds (wrist-equivalent travel upward in inches)
    DEPTH_MARKER_PARTIAL: 4,       // Partial pull
    DEPTH_MARKER_BELLY: 7,         // Mid-torso / belly button area
    DEPTH_MARKER_CHEST: 10,        // Full pull to chest/ribcage

    // Calibration - uses shoulder-to-tracking-point distance at hinged position
    SHOULDER_WRIST_RATIO: 0.37,    // Shoulder-wrist distance as fraction of height
    CALIBRATION_TOLERANCE: 0.15,
    SETUP_MIN_ANGLE: 25,           // Minimum torso hinge angle for calibration (degrees)

    // Elbow fallback - sanity bounds for shoulder-to-elbow distance
    ELBOW_CAL_DIST_MIN: 0.01,     // Min normalized shoulder-elbow distance
    ELBOW_CAL_DIST_MAX: 0.28,     // Max normalized shoulder-elbow distance

    // Torso angle monitoring (cheat detection)
    CHEAT_ANGLE_THRESHOLD: 15,     // Degrees of torso angle change = cheating
  };

  // ========== ROW-SPECIFIC UTILITIES ==========

  /**
   * Get the active wrist, elbow, shoulder, and hip landmarks for the tracked side
   */
  function getRowLandmarks(landmarks, side) {
    const useLeft = (side === 'left');
    return {
      shoulder: useLeft ? landmarks[11] : landmarks[12],
      elbow: useLeft ? landmarks[13] : landmarks[14],
      wrist: useLeft ? landmarks[15] : landmarks[16],
      hip: useLeft ? landmarks[23] : landmarks[24],
      otherShoulder: useLeft ? landmarks[12] : landmarks[11],
      otherElbow: useLeft ? landmarks[14] : landmarks[13],
      otherWrist: useLeft ? landmarks[16] : landmarks[15],
      otherHip: useLeft ? landmarks[24] : landmarks[23],
    };
  }

  /**
   * Check if a landmark is visible above threshold
   */
  function isVisible(lm) {
    return lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
  }

  /**
   * Detect which side has better shoulder + hip + (wrist OR elbow) visibility.
   * Accepts elbow as a fallback when wrist is occluded by plates.
   */
  function detectRowSide(landmarks, state) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    // A side is valid if shoulder + hip + (wrist OR elbow) are visible
    const leftTrackOk = isVisible(leftWrist) || isVisible(leftElbow);
    const rightTrackOk = isVisible(rightWrist) || isVisible(rightElbow);
    const leftValid = isVisible(leftShoulder) && leftTrackOk && isVisible(leftHip);
    const rightValid = isVisible(rightShoulder) && rightTrackOk && isVisible(rightHip);

    if (!leftValid && !rightValid) {
      state.trackingLossFrames++;
      return { valid: false };
    }

    state.trackingLossFrames = 0;

    if (state.lockedSide === null) {
      if (leftValid && rightValid) {
        // Prefer the side with best wrist visibility; fall back to elbow
        const leftBestVis = Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0);
        const rightBestVis = Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0);
        state.lockedSide = leftBestVis > rightBestVis ? 'left' : 'right';
      } else {
        state.lockedSide = leftValid ? 'left' : 'right';
      }
    } else {
      const currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
      const otherValid = state.lockedSide === 'left' ? rightValid : leftValid;
      const currentBestVis = state.lockedSide === 'left'
        ? Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0)
        : Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0);
      const otherBestVis = state.lockedSide === 'left'
        ? Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0)
        : Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0);

      if (!currentValid && otherValid &&
          (otherBestVis - currentBestVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
          state.state === 'standing') {
        state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
      }
    }

    state.currentSide = state.lockedSide;
    return { valid: true, side: state.lockedSide };
  }

  /**
   * Select the best available tracking point (wrist preferred, elbow fallback).
   * Returns { y, x, point: 'wrist'|'elbow' } or null if neither is visible.
   */
  function selectTrackingPoint(row) {
    if (isVisible(row.wrist)) {
      return { y: row.wrist.y, x: row.wrist.x, point: 'wrist' };
    }
    if (isVisible(row.elbow)) {
      return { y: row.elbow.y, x: row.elbow.x, point: 'elbow' };
    }
    return null;
  }

  /**
   * Convert a raw tracking Y to the calibrated coordinate space.
   * If the current tracking point differs from the calibration point,
   * applies the stored offset to produce consistent values.
   */
  function adjustTrackingY(rawY, currentPoint, state) {
    if (!state.rowCalibPoint || currentPoint === state.rowCalibPoint) {
      return rawY; // Same point as calibration, no adjustment needed
    }
    // Different point: apply offset to convert to calibration point's space
    if (state.rowWristElbowOffset !== null) {
      if (state.rowCalibPoint === 'wrist' && currentPoint === 'elbow') {
        // Calibrated with wrist, now using elbow: elbow is higher (lower Y)
        return rawY + state.rowWristElbowOffset;
      } else if (state.rowCalibPoint === 'elbow' && currentPoint === 'wrist') {
        // Calibrated with elbow, now using wrist: wrist is lower (higher Y)
        return rawY - state.rowWristElbowOffset;
      }
    }
    // No offset available - use raw value (may cause brief inaccuracy)
    return rawY;
  }

  /**
   * Calibrate tracking point position at hinged-over position (bar hanging down).
   * Requires sufficient torso hinge angle before accepting calibration.
   * Uses shoulder-to-tracking-point distance for inches-per-unit scaling.
   * When calibrating with elbow (wrist occluded), uses the same SHOULDER_WRIST_RATIO
   * which produces an inflated inchesPerUnit that auto-converts elbow movement
   * into wrist-equivalent inches.
   */
  function calibrateRowBaseline(trackY, trackX, trackPoint, row, state, feedbackEl) {
    const shoulderY = row.shoulder.y;
    const shoulderX = row.shoulder.x;
    const hipY = row.hip.y;
    const hipX = row.hip.x;

    // Calculate torso angle to verify athlete is hinged over
    const torsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY);

    // Must be hinged over sufficiently
    if (torsoAngle < ROW.SETUP_MIN_ANGLE) {
      if (feedbackEl) feedbackEl.textContent = `Bend over more - ${torsoAngle.toFixed(0)}\u00B0 (need ${ROW.SETUP_MIN_ANGLE}\u00B0)`;
      return true; // still calibrating
    }

    const shoulderTrackDist = Math.abs(trackY - shoulderY);

    // Sanity check: distance should be reasonable for the tracking point
    const distMin = trackPoint === 'elbow' ? ROW.ELBOW_CAL_DIST_MIN : 0.02;
    const distMax = trackPoint === 'elbow' ? ROW.ELBOW_CAL_DIST_MAX : 0.4;
    if (shoulderTrackDist < distMin || shoulderTrackDist > distMax) {
      const hint = trackPoint === 'elbow'
        ? "Position camera to see shoulder, hip, and elbow from the side"
        : "Position camera to see shoulder, hip, and wrist from the side";
      if (feedbackEl) feedbackEl.textContent = hint;
      return true;
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(trackY);
      state.hipKneeDistance = shoulderTrackDist;
      state.standingHipX = trackX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      state.standingTorsoAngle = torsoAngle;
      state.rowCalibPoint = trackPoint;
      if (feedbackEl) {
        const label = trackPoint === 'elbow' ? 'Hold hinged position (elbow tracking)... ' : 'Hold hinged position... ';
        feedbackEl.textContent = label + '1/' + C.CALIBRATION_SAMPLES;
      }
      return true;
    }

    const recentAvg = state.calibrationHipYValues.slice(-3).reduce((a, b) => a + b, 0) /
                      Math.min(state.calibrationHipYValues.length, 3);
    const variation = Math.abs(trackY - recentAvg);
    const tolerance = shoulderTrackDist * ROW.CALIBRATION_TOLERANCE;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(trackY);
      state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderTrackDist * 0.2;
      state.standingTorsoAngle = state.standingTorsoAngle * 0.8 + torsoAngle * 0.2;
      if (feedbackEl) {
        const label = trackPoint === 'elbow' ? 'Hold hinged position (elbow tracking)... ' : 'Hold hinged position... ';
        feedbackEl.textContent = label + state.calibrationHipYValues.length + '/' + C.CALIBRATION_SAMPLES;
      }

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce((a, b) => a + b, 0) / state.calibrationHipYValues.length;
        state.standingHipX = trackX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        // Scale: use SHOULDER_WRIST_RATIO regardless of tracking point.
        // For elbow: the shorter distance produces a larger inchesPerUnit,
        // which auto-converts elbow movement into wrist-equivalent inches.
        const expectedInches = state.userHeightInches * ROW.SHOULDER_WRIST_RATIO;
        state.inchesPerUnit = expectedInches / state.hipKneeDistance;
        state.isCalibrated = true;
        state.rowCalibPoint = trackPoint;

        // Record offset between wrist and elbow if both are visible
        if (isVisible(row.wrist) && isVisible(row.elbow)) {
          state.rowWristElbowOffset = row.wrist.y - row.elbow.y;
        }

        const estimatedInches = utils.normToInches(state.hipKneeDistance, state);
        const feet = Math.floor(state.userHeightInches / 12);
        const inches = state.userHeightInches % 12;
        const trackLabel = trackPoint === 'elbow' ? ' (elbow)' : '';

        if (feedbackEl) feedbackEl.textContent = `Calibrated${trackLabel}! H:${feet}'${inches}" Arm:${estimatedInches.toFixed(1)}" Hinge:${torsoAngle.toFixed(0)}\u00B0`;

        setTimeout(() => {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = 'Ready to row!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = "Hold still in hinged position - restarting calibration";
    }

    return true;
  }

  // ========== EXERCISE MODULE ==========

  Chronicle.exercises['barbell-row'] = {
    key: 'barbell-row',
    name: 'Barbell Row',
    sessionName: 'Barbell Row Session',
    readyMsg: 'Ready to row!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,   // Need shoulder + hip for torso angle
    needsWrist: true,      // Flag for upper body exercise drawing
    needsHip: true,        // Signal to drawing code: also show hip
    invertDepthMarkers: true, // Depth markers go upward from baseline
    referenceDepth: 10,    // Typical wrist travel in inches for barbell row

    hyperparams: ROW,

    depthMarkers: [
      { inches: ROW.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: ROW.DEPTH_MARKER_BELLY, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: ROW.DEPTH_MARKER_CHEST, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist or Elbow (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= ROW.DEPTH_MARKER_CHEST) return { emoji: '+++', label: 'Chest', color: '#00FF00' };
      if (pullInches >= ROW.DEPTH_MARKER_BELLY) return { emoji: '++', label: 'Belly', color: '#90EE90' };
      if (pullInches >= ROW.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      // Side detection using shoulder + hip + (wrist OR elbow)
      const sideResult = detectRowSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      const row = getRowLandmarks(landmarks, state.lockedSide);
      const shoulderY = row.shoulder.y;
      const shoulderX = row.shoulder.x;
      const hipY = row.hip.y;
      const hipX = row.hip.x;

      // Select best tracking point (wrist preferred, elbow fallback)
      const tracking = selectTrackingPoint(row);
      if (!tracking) {
        // Neither wrist nor elbow visible on the locked side
        state.trackingLossFrames++;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost arm tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      state.rowTrackingPoint = tracking.point;

      // Adjust tracking Y to calibrated coordinate space if switching points
      const rawTrackY = adjustTrackingY(tracking.y, tracking.point, state);
      const rawTrackX = tracking.x;

      // Process position (reuse hip processing for smoothing/outlier filtering)
      const processed = utils.processHipPosition(rawTrackY, rawTrackX, state);
      if (processed.rejected && processed.hipY === null) return;
      const trackY = processed.hipY;  // smoothed tracking Y
      const trackX = processed.hipX;  // smoothed tracking X

      // Auto-recalibration check
      if (utils.checkAutoRecalibration(state, ui.feedback)) {
        state.rowCalibPoint = null;
        state.rowWristElbowOffset = null;
        return;
      }

      // Calibration at hinged position
      if (!state.isCalibrated && state.state === 'standing') {
        if (calibrateRowBaseline(trackY, trackX, tracking.point, row, state, ui.feedback)) return;
      }

      // After calibration, record offset if both points become visible
      if (state.isCalibrated && state.rowWristElbowOffset === null &&
          isVisible(row.wrist) && isVisible(row.elbow)) {
        state.rowWristElbowOffset = row.wrist.y - row.elbow.y;
      }

      // Velocity tracking
      utils.trackVelocity(trackY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // Track torso angle for cheat detection
      const currentTorsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY);
      if (state.dlSmoothedAngle === null) {
        state.dlSmoothedAngle = currentTorsoAngle;
      } else {
        state.dlSmoothedAngle = state.dlSmoothedAngle * 0.6 + currentTorsoAngle * 0.4;
      }
      const smoothedTorsoAngle = state.dlSmoothedAngle;

      // State timeouts
      if (state.state === 'ascending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Pull timed out - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }
      if (state.state === 'descending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Lowering timed out - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      // Standing (hinged, bar hanging) stability
      if (state.state === 'standing') {
        utils.handleStandingStability(trackY, trackX, state, ui.feedback, this.name);
      }

      // Track peak pull height (lowest Y = highest physical pull)
      if (state.state === 'ascending' || state.state === 'descending') {
        if (state.deepestHipY === null || trackY < state.deepestHipY) {
          state.deepestHipY = trackY;
        }
      }

      // Pull height calculations (inverted from bench: baselineY - currentY)
      const currentPullNorm = state.standingHipY - trackY;  // positive when tracking point rises
      const currentPullInches = utils.normToInches(currentPullNorm, state);
      const maxPullNorm = state.deepestHipY !== null ? state.standingHipY - state.deepestHipY : 0;
      const maxPullInches = utils.normToInches(maxPullNorm, state);
      const pullThresholdNorm = utils.inchesToNorm(ROW.PULL_THRESHOLD_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Cheat detection: torso angle change from calibrated angle
      const torsoAngleChange = state.standingTorsoAngle !== null ?
        Math.abs(smoothedTorsoAngle - state.standingTorsoAngle) : 0;
      const isCheating = torsoAngleChange > ROW.CHEAT_ANGLE_THRESHOLD;

      // Debug info
      state.debugInfo.pullInches = currentPullInches.toFixed(1);
      state.debugInfo.torsoAngle = smoothedTorsoAngle.toFixed(1);
      state.debugInfo.torsoChange = torsoAngleChange.toFixed(1);
      state.debugInfo.rowState = state.state;
      state.debugInfo.cheating = isCheating ? 'YES' : 'no';
      state.debugInfo.rowTrackPt = tracking.point;

      // State machine (inverted from bench: ascending first, then descending)
      switch (state.state) {
        case 'standing': {
          // "standing" = hinged position, bar hanging at baseline (high tracking Y)
          const hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          // Detect tracking point moving upward (negative velocity = Y decreasing)
          const isMovingUp = avgVelocity < -ROW.PULL_VELOCITY_MIN;
          const wellPastThreshold = currentPullNorm > pullThresholdNorm * ROW.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentPullNorm > pullThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingUp || wellPastThreshold)) {
            utils.updateState('ascending', state, ui.status);
            state.deepestHipY = trackY; // track peak pull
            state.ascentStartTime = performance.now();
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            state.stableStandingStartTime = null;
            state.rebaselineStabilityCount = 0;
            state.potentialNewBaseline = null;
            state.lastSquatStartTime = performance.now();

            if (ui.feedback) ui.feedback.textContent = 'Pulling...';
          }
          break;
        }

        case 'ascending': {
          // Bar being pulled upward (concentric phase - this is timed for speed)
          const pullQuality = this.getQuality(currentPullInches);
          const cheatMsg = isCheating ? ' \u26A0 body english!' : '';
          if (ui.feedback) ui.feedback.textContent = `Pull ${currentPullInches.toFixed(1)}" ${pullQuality.emoji} ${pullQuality.label}${cheatMsg}`;

          // Transition to descending when tracking point starts moving back down
          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity > C.VELOCITY_THRESHOLD) {
            if (maxPullInches >= ROW.MIN_PULL_INCHES) {
              utils.updateState('descending', state, ui.status);
              state.pullEndTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              const quality = this.getQuality(maxPullInches);
              const cheatLabel = isCheating ? ' \u26A0 Cheat' : '';
              if (ui.feedback) ui.feedback.textContent = `Lowering... ${quality.emoji} ${quality.label}${cheatLabel}`;
            } else {
              if (ui.feedback) ui.feedback.textContent = `Too shallow! Need at least ${ROW.MIN_PULL_INCHES}"`;
              utils.resetToStanding(state, ui.status);
            }
          }
          break;
        }

        case 'descending': {
          // Bar being lowered back to starting position (eccentric phase)
          if (state.deepestHipY === null || state.standingHipY === null) {
            utils.resetToStanding(state, ui.status);
            break;
          }

          // Recovery: how much the tracking point has lowered from peak back toward baseline
          const recovered = Math.max(0, trackY - state.deepestHipY);
          const totalPull = maxPullNorm;
          const recoveryPercent = totalPull > 0 ? (recovered / totalPull) * 100 : 0;

          if (recoveryPercent < ROW.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `Lowering... ${recoveryPercent.toFixed(0)}% return`;
          } else if (recoveryPercent < ROW.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `Almost there! ${recoveryPercent.toFixed(0)}% return`;
          }

          const isNearBaseline = currentPullNorm < pullThresholdNorm - hysteresisNorm;
          const hasMinPull = maxPullInches >= ROW.MIN_PULL_INCHES;

          if (recoveryPercent >= ROW.RECOVERY_PERCENT && isNearBaseline && hasMinPull) {
            // Calculate speed from the concentric (pull) phase
            const pullTime = (state.pullEndTime - state.ascentStartTime) / 1000;
            const speedScore = utils.calculateSpeedScore(pullTime, maxPullInches, this.referenceDepth);
            const quality = this.getQuality(maxPullInches);

            state.repTimes.push(pullTime);
            state.repDepths.push(maxPullInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(pullTime, maxPullInches, speedScore, quality.label.toLowerCase());
            }

            const cheatLabel = isCheating ? ' \u26A0 Cheat' : '';
            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount}`;
            if (ui.feedback) ui.feedback.textContent = `Rep ${state.repCount}: Speed ${speedScore} ${quality.emoji} ${quality.label}${cheatLabel}`;

            this.displayRepTimes(state, ui.msg);
            utils.resetToStanding(state, ui.status);

            setTimeout(() => {
              if (state.state === 'standing' && ui.feedback) {
                ui.feedback.textContent = "Ready for next rep";
              }
            }, 1500);
          }
          break;
        }
      }
    },

    displayRepTimes: function(state, msgEl) {
      if (!msgEl || state.repTimes.length === 0) return;

      const firstRepTime = state.repTimes[0];
      const firstRepDepth = state.repDepths[0];
      const refDepth = this.referenceDepth;
      const firstSpeedScore = utils.calculateSpeedScore(firstRepTime, firstRepDepth, refDepth);

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Barbell Row Speed Analysis</div>';

      const recentReps = state.repTimes.slice(-5);
      const recentDepths = state.repDepths.slice(-5);

      recentReps.forEach((time, idx) => {
        const actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        const depthInches = recentDepths[idx];
        const quality = this.getQuality(depthInches);
        const speedScore = utils.calculateSpeedScore(time, depthInches, refDepth);
        const scoreDrop = ((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1);
        const dropNum = parseFloat(scoreDrop);

        let color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += `<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
          <div style="font-size: 16px; margin-bottom: 4px;">
            Rep ${actualRepNum}: Speed ${speedScore} ${quality.emoji} ${quality.label}
            <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '-' : '+'}${Math.abs(dropNum).toFixed(1)}%</span>
          </div>
        </div>`;
      });

      msgEl.innerHTML = html;
    },

    reset: function(state) {
      state.standingTorsoAngle = null;
      state.dlSmoothedAngle = null;
      state.pullEndTime = null;
      state.rowTrackingPoint = null;
      state.rowCalibPoint = null;
      state.rowWristElbowOffset = null;
    },
  };

  console.log('Barbell Row exercise module loaded');
})();
