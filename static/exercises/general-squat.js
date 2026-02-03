// ========== General Squat Exercise Module ==========
// Generic squat-pattern tracker for exercises without a specific module.
// Uses hip Y position tracking (same as back squat) with slightly wider tolerances.
// Good for: front squat, goblet squat, zercher squat, overhead squat, box squat,
//           leg press, safety bar squat, tempo squats, pause squats, etc.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const GEN_SQ = {
    MIN_DEPTH_INCHES: 5,            // Slightly lower than back squat (varied ROM)
    DESCENT_THRESHOLD_INCHES: 3.0,
    RECOVERY_PERCENT: 78,           // A bit more forgiving
    DESCENT_VELOCITY_MIN: 0.001,
    MIN_STANDING_TIME_MS: 800,
    DEPTH_MARKER_HALF: 6,
    DEPTH_MARKER_PARALLEL: 14,
    DEPTH_MARKER_DEEP: 17,
  };

  Chronicle.exercises['general-squat'] = {
    key: 'general-squat',
    name: 'General Squat',
    sessionName: 'Squat Session',
    readyMsg: 'Ready to squat!',
    category: 'squat',
    isSingleLeg: false,
    needsShoulder: false,
    referenceDepth: 15,  // Normalized to back squat baseline
    hyperparams: GEN_SQ,

    depthMarkers: [
      { inches: GEN_SQ.DEPTH_MARKER_HALF, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: GEN_SQ.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: GEN_SQ.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' }
    ],

    getQuality: function(depthInches) {
      return Chronicle.quality.squat(depthInches);
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

      const active = utils.getActiveLandmarks(landmarks, state.currentSide);
      const hipY = active.hip.y;
      const kneeY = active.knee.y;

      // Calibration
      if (!state.isCalibrated) {
        const calibrating = utils.calibrateHipBaseline(
          hipY, active.hip.x, kneeY, null, state, ui.feedback, this.readyMsg
        );
        if (calibrating && state.isCalibrated) {
          state.lastSquatStartTime = null;
          state.calibrationCompletedTime = performance.now();
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
      const descentThresholdNorm = utils.inchesToNorm(GEN_SQ.DESCENT_THRESHOLD_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Track velocity
      utils.trackVelocity(currentHipY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // Drift check
      if (state.standingHipX) {
        const horizontalDrift = Math.abs(processed.hipX - state.standingHipX);
        const driftInches = utils.normToInches(horizontalDrift, state);
        if (driftInches > C.DRIFT_CRITICAL_THRESHOLD && state.state === 'standing') {
          state.debugInfo.drift = driftInches.toFixed(1);
        }
      }

      // State machine
      switch (state.state) {
        case 'standing': {
          const timeSinceCalibration = state.calibrationCompletedTime ?
            performance.now() - state.calibrationCompletedTime : Infinity;

          if (timeSinceCalibration < GEN_SQ.MIN_STANDING_TIME_MS) return;

          const currentDepthNorm = currentHipY - state.standingHipY;
          const isMovingDown = avgVelocity > GEN_SQ.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * C.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = currentHipY;
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = 'Going down...';
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
            if (maxDepthInches >= GEN_SQ.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              if (ui.feedback) ui.feedback.textContent = 'Coming up!';
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
          const hasMinDepth = maxDepthInches >= GEN_SQ.MIN_DEPTH_INCHES;

          if (recoveryPercent >= GEN_SQ.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
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

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Speed Analysis</div>';

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
      // No exercise-specific state beyond shared state
    },
  };
})();
