// ========== Bulgarian Split Squat Exercise Module ==========
// Single-leg squat with rear foot elevated on bench.
// Tracks front leg hip/knee depth. Auto-detects side changes.
// The rear foot will be at a higher Y position (elevated on bench).

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const BULG = {
    MIN_DEPTH_INCHES: 4,             // Lower minimum - split stance reduces range
    DESCENT_THRESHOLD_INCHES: 2.5,   // Lower threshold for split stance
    RECOVERY_PERCENT: 75,            // Slightly more forgiving - balance factor
    DESCENT_VELOCITY_MIN: 0.001,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 45,

    // Depth markers
    DEPTH_MARKER_QUARTER: 4,
    DEPTH_MARKER_HALF: 7,
    DEPTH_MARKER_PARALLEL: 12,
    DEPTH_MARKER_DEEP: 16,

    // Side detection
    ANKLE_ELEVATION_THRESHOLD: 0.08, // Rear ankle must be this much higher (lower Y) than front
    SIDE_CHANGE_COOLDOWN_MS: 3000,
    SIDE_CONFIRMATION_FRAMES: 8,
    MIN_STANDING_TIME_MS: 1000,      // More time to stabilize in split stance
  };

  let sideConfirmationCount = 0;
  let pendingSide = null;

  Chronicle.exercises['bulgarian-squat'] = {
    key: 'bulgarian-squat',
    name: 'Bulgarian Split Squat',
    sessionName: 'Bulgarian Squat Session',
    readyMsg: 'Get in split stance with rear foot on bench',
    category: 'squat',
    isSingleLeg: true,
    needsShoulder: false,
    referenceDepth: 12,  // Typical parallel depth (inches) for bulgarian
    hyperparams: BULG,

    depthMarkers: [
      { inches: BULG.DEPTH_MARKER_HALF, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: BULG.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: BULG.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' }
    ],

    getQuality: function(depthInches) {
      if (depthInches >= BULG.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Deep', color: '#00FF00' };
      if (depthInches >= BULG.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
      if (depthInches >= BULG.DEPTH_MARKER_HALF) return { emoji: '+', label: 'Half', color: '#FFD700' };
      if (depthInches >= BULG.DEPTH_MARKER_QUARTER) return { emoji: '~', label: 'Quarter', color: '#FFA500' };
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

      // Detect which leg is the working (front) leg
      const legResult = utils.detectWorkingLeg(landmarks, state);

      // Side change detection with confirmation
      if (legResult.valid && legResult.sideChanged && state.state === 'standing') {
        const now = performance.now();
        const cooldownPassed = !state.lastSideChangeTime ||
          (now - state.lastSideChangeTime) > BULG.SIDE_CHANGE_COOLDOWN_MS;

        if (cooldownPassed) {
          if (pendingSide === state.workingSide) {
            sideConfirmationCount++;
          } else {
            pendingSide = state.workingSide;
            sideConfirmationCount = 1;
          }

          if (sideConfirmationCount >= BULG.SIDE_CONFIRMATION_FRAMES) {
            state.sideChangeDetected = false;
            state.lastSideChangeTime = now;
            sideConfirmationCount = 0;
            pendingSide = null;

            // Force recalibration for the new side - different depth baseline
            state.isCalibrated = false;
            state.calibrationHipYValues = [];
            state.standingHipY = null;
            state.standingHipX = null;
            state.stableFrameCount = 0;
            state.calibrationCompletedTime = null;

            const sideLabel = state.workingSide === 'left' ? 'Left' : 'Right';
            if (ui.feedback) ui.feedback.textContent = `Switched to ${sideLabel} leg - recalibrating`;
          }
        } else {
          state.sideChangeDetected = false;
        }
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
      const descentThresholdNorm = utils.inchesToNorm(BULG.DESCENT_THRESHOLD_INCHES, state);
      const hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      const sideLabel = state.workingSide ? (state.workingSide === 'left' ? 'L' : 'R') : '';

      switch (state.state) {
        case 'standing': {
          const hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= BULG.MIN_STANDING_TIME_MS;

          const isMovingDown = avgVelocity > BULG.DESCENT_VELOCITY_MIN;
          const wellPastThreshold = currentDepthNorm > descentThresholdNorm * BULG.DEPTH_TRIGGER_MULTIPLIER;
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
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Down... ${quality.emoji}`;
          }
          break;
        }

        case 'descending': {
          const descendQuality = this.getQuality(currentDepthInches);
          if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] ${currentDepthInches.toFixed(1)}" ${descendQuality.emoji} ${descendQuality.label}`;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= BULG.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              const quality = this.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Drive up! ${quality.emoji}`;
            } else {
              if (ui.feedback) ui.feedback.textContent = `Too shallow! Need at least ${BULG.MIN_DEPTH_INCHES}"`;
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

          if (recoveryPercent < BULG.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Drive up! ${recoveryPercent.toFixed(0)}%`;
          } else if (recoveryPercent < BULG.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Almost! ${recoveryPercent.toFixed(0)}%`;
          }

          const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          const hasMinDepth = maxDepthInches >= BULG.MIN_DEPTH_INCHES;

          if (recoveryPercent >= BULG.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
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

      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Bulgarian Squat Analysis';
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

  console.log('Bulgarian Split Squat exercise module loaded');
})();
