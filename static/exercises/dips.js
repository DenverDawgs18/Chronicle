// ========== Dips Exercise Module ==========
// Tracks shoulder Y position for body movement in the vertical plane.
// Calibrates at lockout (top of dip, arms fully extended).
// State machine: lockout → descending (body lowers) → ascending (pressing back up) → rep counted.
// Camera should be positioned from the side so shoulder, elbow, and wrist are visible.
// Unlike bench/OHP which track wrist movement, dips track shoulder movement since the
// hands stay fixed on the bars and the body moves up and down.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  // Dips-specific hyperparameters
  const DIPS = {
    MIN_DEPTH_INCHES: 3,           // Minimum shoulder drop for valid rep
    DESCENT_THRESHOLD_INCHES: 2,   // Shoulder drop to trigger descent state
    RECOVERY_PERCENT: 80,          // % recovery to count rep
    DESCENT_VELOCITY_MIN: 0.0010,  // Minimum downward velocity for descent
    DEPTH_TRIGGER_MULTIPLIER: 1.5, // Multiplier for well-past-threshold check
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth quality thresholds (shoulder drop in inches from lockout)
    DEPTH_MARKER_PARTIAL: 3,       // Partial dip
    DEPTH_MARKER_PARALLEL: 5,      // Elbow at ~90 degrees
    DEPTH_MARKER_DEEP: 7,          // Below parallel

    // Calibration - uses shoulder-to-elbow distance (upper arm length)
    SHOULDER_ELBOW_RATIO: 0.19,    // Approximate upper arm length as fraction of height
    CALIBRATION_TOLERANCE: 0.15,
    LOCKOUT_ELBOW_ANGLE: 155,      // Degrees - near full extension at top
  };

  // ========== DIPS-SPECIFIC UTILITIES ==========

  /**
   * Get the active shoulder, elbow, and wrist landmarks for the tracked side
   */
  function getDipsLandmarks(landmarks, side) {
    const useLeft = (side === 'left');
    return {
      shoulder: useLeft ? landmarks[11] : landmarks[12],
      elbow: useLeft ? landmarks[13] : landmarks[14],
      wrist: useLeft ? landmarks[15] : landmarks[16],
      otherShoulder: useLeft ? landmarks[12] : landmarks[11],
      otherElbow: useLeft ? landmarks[14] : landmarks[13],
      otherWrist: useLeft ? landmarks[16] : landmarks[15],
    };
  }

  /**
   * Detect which side has better shoulder/elbow visibility.
   * Wrist visibility is optional since hands are on bars and may be occluded.
   */
  function detectDipsSide(landmarks, state) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];

    const vis = (lm) => (lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD);

    // For dips, require shoulder + elbow; wrist is a bonus
    const leftValid = vis(leftShoulder) && vis(leftElbow);
    const rightValid = vis(rightShoulder) && vis(rightElbow);

    if (!leftValid && !rightValid) {
      state.trackingLossFrames++;
      return { valid: false };
    }

    state.trackingLossFrames = 0;

    if (state.lockedSide === null) {
      if (leftValid && rightValid) {
        // Pick side with better elbow visibility
        const leftElbowVis = leftElbow.visibility || 0;
        const rightElbowVis = rightElbow.visibility || 0;
        state.lockedSide = leftElbowVis > rightElbowVis ? 'left' : 'right';
      } else {
        state.lockedSide = leftValid ? 'left' : 'right';
      }
    } else {
      const currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
      const otherValid = state.lockedSide === 'left' ? rightValid : leftValid;
      const currentElbowVis = state.lockedSide === 'left' ? (leftElbow.visibility || 0) : (rightElbow.visibility || 0);
      const otherElbowVis = state.lockedSide === 'left' ? (rightElbow.visibility || 0) : (leftElbow.visibility || 0);

      if (!currentValid && otherValid &&
          (otherElbowVis - currentElbowVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
          state.state === 'standing') {
        state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
      }
    }

    state.currentSide = state.lockedSide;
    return { valid: true, side: state.lockedSide };
  }

  /**
   * Calibrate shoulder lockout position (top of dip).
   * Uses shoulder-to-elbow distance for inches-per-unit scaling.
   */
  function calibrateDipsBaseline(shoulderY, shoulderX, elbowY, state, feedbackEl) {
    const shoulderElbowDist = Math.abs(elbowY - shoulderY);

    // Sanity check: shoulder-elbow distance should be reasonable
    if (shoulderElbowDist < 0.02 || shoulderElbowDist > 0.3) {
      if (feedbackEl) feedbackEl.textContent = "Position camera to see your shoulder and elbow from the side";
      return true; // still calibrating
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(shoulderY);
      state.hipKneeDistance = shoulderElbowDist; // reuse field for shoulder-elbow dist
      state.standingHipX = shoulderX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      if (feedbackEl) feedbackEl.textContent = "Hold lockout at top... 1/" + C.CALIBRATION_SAMPLES;
      return true;
    }

    const recentAvg = state.calibrationHipYValues.slice(-3).reduce((a, b) => a + b, 0) /
                      Math.min(state.calibrationHipYValues.length, 3);
    const variation = Math.abs(shoulderY - recentAvg);
    const tolerance = shoulderElbowDist * DIPS.CALIBRATION_TOLERANCE;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(shoulderY);
      state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderElbowDist * 0.2;
      if (feedbackEl) feedbackEl.textContent = `Hold lockout... ${state.calibrationHipYValues.length}/${C.CALIBRATION_SAMPLES}`;

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce((a, b) => a + b, 0) / state.calibrationHipYValues.length;
        state.standingHipX = shoulderX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        // Scale: use shoulder-elbow distance and height ratio
        const expectedShoulderElbowInches = state.userHeightInches * DIPS.SHOULDER_ELBOW_RATIO;
        state.inchesPerUnit = expectedShoulderElbowInches / state.hipKneeDistance;
        state.isCalibrated = true;

        const estimatedArmInches = utils.normToInches(state.hipKneeDistance, state);
        const feet = Math.floor(state.userHeightInches / 12);
        const inches = state.userHeightInches % 12;

        if (feedbackEl) feedbackEl.textContent = `Calibrated! H:${feet}'${inches}" Arm:${estimatedArmInches.toFixed(1)}"`;

        setTimeout(() => {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = 'Ready for dips!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = "Hold still at lockout - restarting calibration";
    }

    return true;
  }

  // ========== EXERCISE MODULE ==========

  Chronicle.exercises['dips'] = {
    key: 'dips',
    name: 'Dips',
    sessionName: 'Dips Session',
    readyMsg: 'Ready for dips!',
    category: 'press',
    isSingleLeg: false,
    needsShoulder: false,
    needsWrist: true,      // Flag for upper body drawing (shoulder-elbow-wrist chain)
    referenceDepth: 6,     // Typical shoulder travel in inches for dips

    hyperparams: DIPS,

    depthMarkers: [
      { inches: DIPS.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: DIPS.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: DIPS.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder + Elbow (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= DIPS.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Deep', color: '#00FF00' };
      if (depthInches >= DIPS.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
      if (depthInches >= DIPS.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      // Side detection using upper body landmarks
      const sideResult = detectDipsSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      const dip = getDipsLandmarks(landmarks, state.lockedSide);
      const rawShoulderY = dip.shoulder.y;
      const rawShoulderX = dip.shoulder.x;
      const elbowY = dip.elbow.y;

      // Process shoulder position (reuse hip processing for smoothing/outlier filtering)
      const processed = utils.processHipPosition(rawShoulderY, rawShoulderX, state);
      if (processed.rejected && processed.hipY === null) return;
      const shoulderY = processed.hipY;  // smoothed shoulder Y
      const shoulderX = processed.hipX;  // smoothed shoulder X

      // Auto-recalibration check
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // Calibration at lockout position (top of dip)
      if (!state.isCalibrated && state.state === 'standing') {
        if (calibrateDipsBaseline(shoulderY, shoulderX, elbowY, state, ui.feedback)) return;
      }

      // Velocity tracking (shoulder Y)
      utils.trackVelocity(shoulderY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // State timeouts
      if (state.state === 'descending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Descent too slow - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }
      if (state.state === 'ascending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Push stalled - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      // Standing (lockout) stability
      if (state.state === 'standing') {
        utils.handleStandingStability(shoulderY, shoulderX, state, ui.feedback, this.name);
      }

      // Track deepest shoulder position (highest Y = lowest point on screen = bottom of dip)
      if (state.state === 'descending' || state.state === 'ascending') {
        if (state.deepestHipY === null || shoulderY > state.deepestHipY) {
          state.deepestHipY = shoulderY;
        }
      }

      // Depth calculations (shoulder travel from lockout)
      const currentDepthNorm = shoulderY - state.standingHipY;
      const currentDepthInches = utils.normToInches(currentDepthNorm, state);
      const maxDepthNorm = state.deepestHipY ? state.deepestHipY - state.standingHipY : 0;
      const maxDepthInches = utils.normToInches(maxDepthNorm, state);
      const descentThresholdNorm = utils.inchesToNorm(DIPS.DESCENT_THRESHOLD_INCHES, state);
      const minDepthNorm = utils.inchesToNorm(DIPS.MIN_DEPTH_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Calculate elbow angle for debug display
      const elbowAngle = utils.calculateKneeAngle(
        dip.shoulder.x, dip.shoulder.y,
        dip.elbow.x, dip.elbow.y,
        dip.wrist.x, dip.wrist.y
      );

      // Debug info
      state.debugInfo.elbowAngle = elbowAngle.toFixed(0);
      state.debugInfo.shoulderDepthInches = currentDepthInches.toFixed(1);
      state.debugInfo.dipsState = state.state;

      // State machine
      switch (state.state) {
        case 'standing': {
          // "standing" = lockout position at top of dip
          const hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          const isMovingDown = avgVelocity > DIPS.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * DIPS.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = shoulderY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            state.stableStandingStartTime = null;
            state.rebaselineStabilityCount = 0;
            state.potentialNewBaseline = null;
            state.lastSquatStartTime = performance.now();

            if (ui.feedback) ui.feedback.textContent = 'Lowering...';
          }
          break;
        }

        case 'descending': {
          const descendQuality = this.getQuality(currentDepthInches);
          if (ui.feedback) ui.feedback.textContent = `Down ${currentDepthInches.toFixed(1)}" ${descendQuality.emoji} ${descendQuality.label}`;

          // Transition to ascending when shoulder starts moving back up
          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= DIPS.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              const quality = this.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = `Push! ${quality.emoji} ${quality.label}`;
            } else {
              if (ui.feedback) ui.feedback.textContent = `Too shallow! Need at least ${DIPS.MIN_DEPTH_INCHES}"`;
              utils.resetToStanding(state, ui.status);
            }
          }
          break;
        }

        case 'ascending': {
          if (state.deepestHipY === null || state.standingHipY === null) {
            utils.resetToStanding(state, ui.status);
            break;
          }

          const recovered = Math.max(0, state.deepestHipY - shoulderY);
          const totalDepth = maxDepthNorm;
          const recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;

          if (recoveryPercent < DIPS.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `Push! ${recoveryPercent.toFixed(0)}% lockout`;
          } else if (recoveryPercent < DIPS.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `Almost locked out! ${recoveryPercent.toFixed(0)}%`;
          }

          const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          const hasMinDepth = maxDepthInches >= DIPS.MIN_DEPTH_INCHES;

          if (recoveryPercent >= DIPS.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
            const ascentTime = (performance.now() - state.ascentStartTime) / 1000;
            const speedScore = utils.calculateSpeedScore(ascentTime, maxDepthInches, this.referenceDepth);
            const quality = this.getQuality(maxDepthInches);

            state.repTimes.push(ascentTime);
            state.repDepths.push(maxDepthInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(ascentTime, maxDepthInches, speedScore, quality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount}`;
            if (ui.feedback) ui.feedback.textContent = `Rep ${state.repCount}: Speed ${speedScore} ${quality.emoji} ${quality.label}`;

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

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Dips Speed Analysis</div>';

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
      // Reset dips-specific state (reuses shared fields)
    },
  };

  console.log('Dips exercise module loaded');
})();
