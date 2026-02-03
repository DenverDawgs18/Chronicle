// ========== Hack Squat Exercise Module ==========
// Similar to back squat but with a more upright torso angle.
// Typically performed on a machine or with heels elevated.
// Tracks hip Y position for depth like squat, but expects near-vertical torso.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const HACK = {
    MIN_DEPTH_INCHES: 5,             // Slightly lower minimum - machine-guided
    DESCENT_THRESHOLD_INCHES: 3.0,   // Lower threshold - smoother machine movement
    RECOVERY_PERCENT: 80,
    DESCENT_VELOCITY_MIN: 0.001,     // Lower velocity threshold for machine movement
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth markers (hack squat allows deeper range)
    DEPTH_MARKER_QUARTER: 5,
    DEPTH_MARKER_HALF: 8,
    DEPTH_MARKER_PARALLEL: 14,
    DEPTH_MARKER_DEEP: 18,
  };

  Chronicle.exercises['hack-squat'] = {
    key: 'hack-squat',
    name: 'Hack Squat',
    sessionName: 'Hack Squat Session',
    readyMsg: 'Ready to hack squat!',
    category: 'squat',
    isSingleLeg: false,
    needsShoulder: false,
    hyperparams: HACK,

    depthMarkers: [
      { inches: HACK.DEPTH_MARKER_HALF, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: HACK.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: HACK.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' }
    ],

    getQuality: function(depthInches) {
      if (depthInches >= HACK.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Deep', color: '#00FF00' };
      if (depthInches >= HACK.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
      if (depthInches >= HACK.DEPTH_MARKER_HALF) return { emoji: '+', label: 'Half', color: '#FFD700' };
      if (depthInches >= HACK.DEPTH_MARKER_QUARTER) return { emoji: '~', label: 'Quarter', color: '#FFA500' };
      return { emoji: '!', label: 'Shallow', color: '#FF6B6B' };
    },

    detect: function(landmarks, state, ui) {
      const sideResult = utils.detectSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      const active = utils.getActiveLandmarks(landmarks, state.lockedSide);
      const rawHipY = active.hip.y;
      const rawHipX = active.hip.x;
      const kneeY = active.knee.y;

      const processed = utils.processHipPosition(rawHipY, rawHipX, state);
      if (processed.rejected && processed.hipY === null) return;
      const hipY = processed.hipY;
      const hipX = processed.hipX;

      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      if (!state.isCalibrated && state.state === 'standing') {
        if (utils.calibrateHipBaseline(hipY, hipX, kneeY, null, state, ui.feedback, this.readyMsg)) return;
      }

      utils.trackVelocity(hipY, state);
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
          if (ui.feedback) ui.feedback.textContent = "Ascent stalled - resetting";
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      if (state.state === 'standing') {
        utils.handleStandingStability(hipY, hipX, state, ui.feedback, this.name);
      }

      if (state.state === 'descending' || state.state === 'ascending') {
        if (state.deepestHipY === null || hipY > state.deepestHipY) {
          state.deepestHipY = hipY;
        }
      }

      const currentDepthNorm = hipY - state.standingHipY;
      const currentDepthInches = utils.normToInches(currentDepthNorm, state);
      const maxDepthNorm = state.deepestHipY ? state.deepestHipY - state.standingHipY : 0;
      const maxDepthInches = utils.normToInches(maxDepthNorm, state);
      const descentThresholdNorm = utils.inchesToNorm(HACK.DESCENT_THRESHOLD_INCHES, state);
      const minDepthNorm = utils.inchesToNorm(HACK.MIN_DEPTH_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      switch (state.state) {
        case 'standing': {
          const hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          const isMovingDown = avgVelocity > HACK.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * HACK.DEPTH_TRIGGER_MULTIPLIER;
          const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = hipY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            state.stableStandingStartTime = null;
            state.rebaselineStabilityCount = 0;
            state.potentialNewBaseline = null;
            state.lastSquatStartTime = performance.now();

            const quality = this.getQuality(currentDepthInches);
            if (ui.feedback) ui.feedback.textContent = `Hack Down... ${quality.emoji}`;
          }
          break;
        }

        case 'descending': {
          const descendQuality = this.getQuality(currentDepthInches);
          if (ui.feedback) ui.feedback.textContent = `Hack ${currentDepthInches.toFixed(1)}" ${descendQuality.emoji} ${descendQuality.label}`;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= HACK.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              const quality = this.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = `Drive up! ${quality.emoji} ${quality.label}`;
            } else {
              if (ui.feedback) ui.feedback.textContent = `Too shallow! Need at least ${HACK.MIN_DEPTH_INCHES}"`;
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

          const recovered = Math.max(0, state.deepestHipY - hipY);
          const totalDepth = maxDepthNorm;
          const recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;

          if (recoveryPercent < HACK.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `Drive up! ${recoveryPercent.toFixed(0)}%`;
          } else if (recoveryPercent < HACK.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `Almost! ${recoveryPercent.toFixed(0)}%`;
          }

          const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          const hasMinDepth = maxDepthInches >= HACK.MIN_DEPTH_INCHES;

          if (recoveryPercent >= HACK.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
            const ascentTime = (performance.now() - state.ascentStartTime) / 1000;
            const speedScore = utils.calculateSpeedScore(ascentTime, maxDepthInches);
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
      const firstSpeedScore = utils.calculateSpeedScore(firstRepTime, firstRepDepth);

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Hack Squat Speed Analysis</div>';

      const recentReps = state.repTimes.slice(-5);
      const recentDepths = state.repDepths.slice(-5);

      recentReps.forEach((time, idx) => {
        const actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        const depthInches = recentDepths[idx];
        const quality = this.getQuality(depthInches);
        const speedScore = utils.calculateSpeedScore(time, depthInches);
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
      // No hack-squat specific state beyond shared
    },
  };

  console.log('Hack Squat exercise module loaded');
})();
