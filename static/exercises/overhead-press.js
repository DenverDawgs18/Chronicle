// ========== Overhead Press Exercise Module ==========
// Tracks wrist Y position for bar path overhead.
// Calibrates at overhead lockout position (arms fully extended overhead).
// State machine: lockout → descending (lowering to shoulders) → ascending (pressing back up) → rep counted.
// Camera should be positioned from the side so shoulder, elbow, and wrist are visible.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  // OHP-specific hyperparameters
  const OHP = {
    MIN_DEPTH_INCHES: 6,           // Minimum wrist travel for valid rep
    DESCENT_THRESHOLD_INCHES: 3,   // Wrist drop to trigger descent state
    RECOVERY_PERCENT: 80,          // % recovery to count rep
    DESCENT_VELOCITY_MIN: 0.0010,  // Minimum downward velocity for descent
    DEPTH_TRIGGER_MULTIPLIER: 1.5, // Multiplier for well-past-threshold check
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth quality thresholds (wrist travel in inches from overhead lockout)
    DEPTH_MARKER_PARTIAL: 6,       // Partial rep (above head)
    DEPTH_MARKER_PARALLEL: 10,     // Head level / chin height
    DEPTH_MARKER_DEEP: 14,        // Full ROM to shoulders

    // Calibration - uses shoulder-to-wrist distance at lockout overhead
    SHOULDER_WRIST_RATIO: 0.37,    // Approximate shoulder-wrist distance as fraction of height
    CALIBRATION_TOLERANCE: 0.15,
    LOCKOUT_ELBOW_ANGLE: 155,      // Degrees - near full extension
  };

  // ========== OHP-SPECIFIC UTILITIES ==========

  /**
   * Get the active wrist, elbow, and shoulder landmarks for the tracked side
   */
  function getOHPLandmarks(landmarks, side) {
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
   * Detect which side has better wrist/elbow/shoulder visibility.
   */
  function detectOHPSide(landmarks, state) {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];

    const vis = (lm) => (lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD);

    const leftValid = vis(leftShoulder) && vis(leftElbow) && vis(leftWrist);
    const rightValid = vis(rightShoulder) && vis(rightElbow) && vis(rightWrist);

    if (!leftValid && !rightValid) {
      state.trackingLossFrames++;
      return { valid: false };
    }

    state.trackingLossFrames = 0;

    if (state.lockedSide === null) {
      if (leftValid && rightValid) {
        const leftWristVis = leftWrist.visibility || 0;
        const rightWristVis = rightWrist.visibility || 0;
        state.lockedSide = leftWristVis > rightWristVis ? 'left' : 'right';
      } else {
        state.lockedSide = leftValid ? 'left' : 'right';
      }
    } else {
      const currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
      const otherValid = state.lockedSide === 'left' ? rightValid : leftValid;
      const currentWristVis = state.lockedSide === 'left' ? (leftWrist.visibility || 0) : (rightWrist.visibility || 0);
      const otherWristVis = state.lockedSide === 'left' ? (rightWrist.visibility || 0) : (leftWrist.visibility || 0);

      if (!currentValid && otherValid &&
          (otherWristVis - currentWristVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
          state.state === 'standing') {
        state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
      }
    }

    state.currentSide = state.lockedSide;
    return { valid: true, side: state.lockedSide };
  }

  /**
   * Calibrate wrist overhead lockout position.
   * Uses shoulder-to-wrist distance for inches-per-unit scaling.
   * For OHP, the wrist is overhead (lower Y than shoulder).
   */
  function calibrateOHPBaseline(wristY, wristX, shoulderY, elbowY, state, feedbackEl) {
    const shoulderWristDist = Math.abs(wristY - shoulderY);

    // Sanity check: shoulder-wrist distance should be reasonable at overhead lockout
    if (shoulderWristDist < 0.03 || shoulderWristDist > 0.45) {
      if (feedbackEl) feedbackEl.textContent = "Hold bar overhead - camera needs to see your full arm from the side";
      return true; // still calibrating
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = shoulderWristDist; // reuse field for shoulder-wrist dist
      state.standingHipX = wristX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      if (feedbackEl) feedbackEl.textContent = "Hold overhead lockout... 1/" + C.CALIBRATION_SAMPLES;
      return true;
    }

    const recentAvg = state.calibrationHipYValues.slice(-3).reduce((a, b) => a + b, 0) /
                      Math.min(state.calibrationHipYValues.length, 3);
    const variation = Math.abs(wristY - recentAvg);
    const tolerance = shoulderWristDist * OHP.CALIBRATION_TOLERANCE;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderWristDist * 0.2;
      if (feedbackEl) feedbackEl.textContent = `Hold overhead lockout... ${state.calibrationHipYValues.length}/${C.CALIBRATION_SAMPLES}`;

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce((a, b) => a + b, 0) / state.calibrationHipYValues.length;
        state.standingHipX = wristX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        // Scale: use shoulder-wrist distance and height ratio
        const expectedShoulderWristInches = state.userHeightInches * OHP.SHOULDER_WRIST_RATIO;
        state.inchesPerUnit = expectedShoulderWristInches / state.hipKneeDistance;
        state.isCalibrated = true;

        const estimatedArmInches = utils.normToInches(state.hipKneeDistance, state);
        const feet = Math.floor(state.userHeightInches / 12);
        const inches = state.userHeightInches % 12;

        if (feedbackEl) feedbackEl.textContent = `Calibrated! H:${feet}'${inches}" Arm:${estimatedArmInches.toFixed(1)}"`;

        setTimeout(() => {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = 'Ready to press!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = "Hold still at overhead lockout - restarting calibration";
    }

    return true;
  }

  // ========== EXERCISE MODULE ==========

  Chronicle.exercises['overhead-press'] = {
    key: 'overhead-press',
    name: 'Overhead Press',
    sessionName: 'Overhead Press Session',
    readyMsg: 'Ready to press!',
    category: 'press',
    isSingleLeg: false,
    needsShoulder: false,
    needsWrist: true,      // Flag for upper body exercise
    referenceDepth: 12,    // Typical wrist travel in inches for OHP

    hyperparams: OHP,

    depthMarkers: [
      { inches: OHP.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: OHP.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: OHP.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= OHP.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Shoulders', color: '#00FF00' };
      if (depthInches >= OHP.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Head Clear', color: '#90EE90' };
      if (depthInches >= OHP.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      // Side detection using upper body landmarks
      const sideResult = detectOHPSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      const ohp = getOHPLandmarks(landmarks, state.lockedSide);
      const rawWristY = ohp.wrist.y;
      const rawWristX = ohp.wrist.x;
      const shoulderY = ohp.shoulder.y;
      const elbowY = ohp.elbow.y;

      // Process wrist position (reuse hip processing for smoothing/outlier filtering)
      const processed = utils.processHipPosition(rawWristY, rawWristX, state);
      if (processed.rejected && processed.hipY === null) return;
      const wristY = processed.hipY;  // smoothed wrist Y
      const wristX = processed.hipX;  // smoothed wrist X

      // Auto-recalibration check
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // Calibration at overhead lockout position
      if (!state.isCalibrated && state.state === 'standing') {
        if (calibrateOHPBaseline(wristY, wristX, shoulderY, elbowY, state, ui.feedback)) return;
      }

      // Velocity tracking (wrist Y)
      utils.trackVelocity(wristY, state);
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
          if (ui.feedback) ui.feedback.textContent = "Press stalled - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      // Standing (overhead lockout) stability
      if (state.state === 'standing') {
        utils.handleStandingStability(wristY, wristX, state, ui.feedback, this.name);
      }

      // Track deepest wrist position (highest Y = lowest point on screen = bar at shoulders)
      if (state.state === 'descending' || state.state === 'ascending') {
        if (state.deepestHipY === null || wristY > state.deepestHipY) {
          state.deepestHipY = wristY;
        }
      }

      // Depth calculations (wrist travel from overhead lockout downward to shoulders)
      const currentDepthNorm = wristY - state.standingHipY;
      const currentDepthInches = utils.normToInches(currentDepthNorm, state);
      const maxDepthNorm = state.deepestHipY ? state.deepestHipY - state.standingHipY : 0;
      const maxDepthInches = utils.normToInches(maxDepthNorm, state);
      const descentThresholdNorm = utils.inchesToNorm(OHP.DESCENT_THRESHOLD_INCHES, state);
      const minDepthNorm = utils.inchesToNorm(OHP.MIN_DEPTH_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Calculate elbow angle for debug display
      const elbowAngle = utils.calculateKneeAngle(
        ohp.shoulder.x, ohp.shoulder.y,
        ohp.elbow.x, ohp.elbow.y,
        ohp.wrist.x, ohp.wrist.y
      );

      // Debug info
      state.debugInfo.elbowAngle = elbowAngle.toFixed(0);
      state.debugInfo.wristDepthInches = currentDepthInches.toFixed(1);
      state.debugInfo.benchState = state.state;

      // State machine
      switch (state.state) {
        case 'standing': {
          // "standing" = overhead lockout position for OHP
          const hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          const isMovingDown = avgVelocity > OHP.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * OHP.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = wristY;
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

          // Transition to ascending when wrist starts moving back up (pressing overhead)
          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= OHP.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              const quality = this.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = `Press! ${quality.emoji} ${quality.label}`;
            } else {
              if (ui.feedback) ui.feedback.textContent = `Too shallow! Need at least ${OHP.MIN_DEPTH_INCHES}"`;
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

          const recovered = Math.max(0, state.deepestHipY - wristY);
          const totalDepth = maxDepthNorm;
          const recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;

          if (recoveryPercent < OHP.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `Press! ${recoveryPercent.toFixed(0)}% lockout`;
          } else if (recoveryPercent < OHP.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `Almost locked out! ${recoveryPercent.toFixed(0)}%`;
          }

          const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          const hasMinDepth = maxDepthInches >= OHP.MIN_DEPTH_INCHES;

          if (recoveryPercent >= OHP.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
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

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Overhead Press Speed Analysis</div>';

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
      // Reset OHP-specific state (reuses shared fields)
    },
  };

  console.log('Overhead Press exercise module loaded');
})();
