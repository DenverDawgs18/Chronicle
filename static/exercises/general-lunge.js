// ========== General Lunge Exercise Module ==========
// Generic single-leg squat-pattern tracker for exercises without a specific module.
// Uses hip Y position tracking with single-leg detection.
// Good for: walking lunges, reverse lunges, forward lunges, curtsy lunges,
//           step-ups, lateral lunges, deficit lunges, etc.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const GEN_LN = {
    MIN_DEPTH_INCHES: 4,
    DESCENT_THRESHOLD_INCHES: 2.5,
    RECOVERY_PERCENT: 75,           // Forgiving for balance-dependent exercises
    DESCENT_VELOCITY_MIN: 0.001,
    MIN_STANDING_TIME_MS: 1000,     // Extra stabilization time
    DEPTH_MARKER_HALF: 6,
    DEPTH_MARKER_PARALLEL: 11,
    DEPTH_MARKER_DEEP: 15,
    // Side change detection
    SIDE_CHANGE_COOLDOWN_MS: 2000,
    SIDE_CONFIRMATION_FRAMES: 5,
    ANKLE_FORWARD_THRESHOLD: 0.04,
  };

  let sideConfirmationCount = 0;
  let pendingSide = null;

  Chronicle.exercises['general-lunge'] = {
    key: 'general-lunge',
    name: 'General Lunge',
    sessionName: 'Lunge Session',
    readyMsg: 'Get in lunge position and stay still',
    category: 'squat',
    isSingleLeg: true,
    needsShoulder: false,
    referenceDepth: 11,  // Normalized to split squat baseline
    hyperparams: GEN_LN,

    depthMarkers: [
      { inches: GEN_LN.DEPTH_MARKER_HALF, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: GEN_LN.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: GEN_LN.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' }
    ],

    getQuality: function(depthInches) {
      if (depthInches >= GEN_LN.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Deep', color: '#00FF00' };
      if (depthInches >= GEN_LN.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
      if (depthInches >= GEN_LN.DEPTH_MARKER_HALF) return { emoji: '+', label: 'Half', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FF6B6B' };
    },

    detect: function(landmarks, state, ui) {
      const sideResult = utils.detectSide(landmarks, state);
      if (!sideResult.valid) {
        state.trackingLossFrames = (state.trackingLossFrames || 0) + 1;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }
      state.trackingLossFrames = 0;

      // Detect working leg
      const legResult = utils.detectWorkingLeg(landmarks, state);

      // Side change detection with confirmation
      if (legResult.valid && legResult.sideChanged && state.state === 'standing') {
        const now = performance.now();
        const cooldownPassed = !state.lastSideChangeTime ||
          (now - state.lastSideChangeTime) > GEN_LN.SIDE_CHANGE_COOLDOWN_MS;

        if (cooldownPassed) {
          if (pendingSide === state.workingSide) {
            sideConfirmationCount++;
          } else {
            pendingSide = state.workingSide;
            sideConfirmationCount = 1;
          }

          if (sideConfirmationCount >= GEN_LN.SIDE_CONFIRMATION_FRAMES) {
            state.sideChangeDetected = true;
            state.lastSideChangeTime = now;
            sideConfirmationCount = 0;
            pendingSide = null;

            // Force recalibration for new side
            state.isCalibrated = false;
            state.calibrationHipYValues = [];
            state.standingHipY = null;
            if (ui.feedback) ui.feedback.textContent = `Switched to ${state.workingSide} leg - recalibrating...`;
          }
        }
      }

      const active = utils.getActiveLandmarks(landmarks, state.currentSide);
      const hipY = active.hip.y;
      const kneeY = active.knee.y;
      const sideLabel = state.workingSide ? state.workingSide.charAt(0).toUpperCase() : '?';

      // Calibration
      if (!state.isCalibrated) {
        const calibrating = utils.calibrateHipBaseline(
          hipY, active.hip.x, kneeY, null, state, ui.feedback, this.readyMsg
        );
        if (calibrating && state.isCalibrated) {
          state.lastSquatStartTime = null;
          state.calibrationCompletedTime = performance.now();
          if (state.workingSide) {
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Calibrated - ready!`;
          }
        }
        return;
      }

      // Auto-recalibrate if idle
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // Process position
      const processed = utils.processHipPosition(hipY, active.hip.x, state);
      if (processed.rejected) return;

      const currentHipY = processed.hipY;
      const currentDepth = currentHipY - state.standingHipY;
      const currentDepthInches = utils.normToInches(currentDepth, state);
      const descentThresholdNorm = utils.inchesToNorm(GEN_LN.DESCENT_THRESHOLD_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Track velocity
      utils.trackVelocity(currentHipY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // State machine
      switch (state.state) {
        case 'standing': {
          const timeSinceCalibration = state.calibrationCompletedTime ?
            performance.now() - state.calibrationCompletedTime : Infinity;
          if (timeSinceCalibration < GEN_LN.MIN_STANDING_TIME_MS) return;

          const currentDepthNorm = currentHipY - state.standingHipY;
          const isMovingDown = avgVelocity > GEN_LN.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * C.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = currentHipY;
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Going down...`;
          }
          break;
        }

        case 'descending': {
          if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
            utils.resetToStanding(state, ui.status);
            if (ui.feedback) ui.feedback.textContent = 'Descent timeout - resetting';
            return;
          }

          if (currentHipY > state.deepestHipY) {
            state.deepestHipY = currentHipY;
          }

          if (avgVelocity < -C.VELOCITY_THRESHOLD) {
            const maxDepthInches = utils.normToInches(state.deepestHipY - state.standingHipY, state);
            if (maxDepthInches >= GEN_LN.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Coming up!`;
            }
          }
          break;
        }

        case 'ascending': {
          if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
            utils.resetToStanding(state, ui.status);
            if (ui.feedback) ui.feedback.textContent = 'Ascent timeout - resetting';
            return;
          }

          if (currentHipY > state.deepestHipY) {
            state.deepestHipY = currentHipY;
          }

          const totalDescent = state.deepestHipY - state.standingHipY;
          const recovered = state.deepestHipY - currentHipY;
          const recoveryPercent = totalDescent > 0 ? (recovered / totalDescent) * 100 : 0;

          const currentDepthNorm = currentHipY - state.standingHipY;
          const maxDepthInches = utils.normToInches(state.deepestHipY - state.standingHipY, state);
          const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          const hasMinDepth = maxDepthInches >= GEN_LN.MIN_DEPTH_INCHES;

          if (recoveryPercent >= GEN_LN.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
            const ascentTime = (performance.now() - state.ascentStartTime) / 1000;
            const speedScore = utils.calculateSpeedScore(ascentTime, maxDepthInches, this.referenceDepth);
            const quality = this.getQuality(maxDepthInches);

            state.repTimes.push(ascentTime);
            state.repDepths.push(maxDepthInches);
            state.repCount++;
            if (state.workingSide) {
              state.sideReps[state.workingSide]++;
            }

            if (ui.onRepComplete) {
              ui.onRepComplete(ascentTime, maxDepthInches, speedScore, quality.label.toLowerCase());
            }

            const leftCount = state.sideReps.left;
            const rightCount = state.sideReps.right;
            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount} (L:${leftCount} R:${rightCount})`;
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Rep ${state.repCount}: Speed ${speedScore} ${quality.emoji}`;

            this.displayRepTimes(state, ui.msg);
            utils.resetToStanding(state, ui.status);

            setTimeout(() => {
              if (state.state === 'standing' && ui.feedback) {
                ui.feedback.textContent = `[${sideLabel}] Ready for next rep`;
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

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Lunge Speed Analysis';
      html += ` (L:${state.sideReps.left} R:${state.sideReps.right})</div>`;

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
            Rep ${actualRepNum}: Speed ${speedScore} ${quality.emoji}
            <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '-' : '+'}${Math.abs(dropNum).toFixed(1)}%</span>
          </div>
        </div>`;
      });

      msgEl.innerHTML = html;
    },

    reset: function(state) {
      state.workingSide = null;
      state.sideReps = { left: 0, right: 0 };
      state.sideChangeDetected = false;
      state.lastSideChangeTime = null;
      sideConfirmationCount = 0;
      pendingSide = null;
    },
  };
})();
