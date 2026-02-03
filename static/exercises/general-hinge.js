// ========== General Hinge Exercise Module ==========
// Generic hip hinge tracker for exercises without a specific module.
// Uses torso angle tracking (same as RDL) with wider tolerances.
// Good for: good mornings, cable pull-throughs, kettlebell swings,
//           hip thrusts, barbell rows, hyperextensions, etc.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const GEN_HN = {
    HINGE_START_THRESHOLD: 18,       // Degrees from standing to start detecting
    MIN_HINGE_ANGLE: 25,             // Minimum ROM (degrees) to count as a rep
    RETURN_ANGLE_THRESHOLD: 12,      // How close to standing to count rep complete
    RETURN_RECOVERY_PERCENT: 70,     // Forgiving for varied movement patterns
    MIN_REP_TIME_MS: 300,
    MAX_REP_TIME_MS: 10000,
    ANGLE_SMOOTHING_ALPHA: 0.3,
  };

  Chronicle.exercises['general-hinge'] = {
    key: 'general-hinge',
    name: 'General Hinge',
    sessionName: 'Hinge Session',
    readyMsg: 'Ready - hinge at hips to begin',
    category: 'deadlift',
    isSingleLeg: false,
    needsShoulder: true,
    referenceDepth: 8,   // Normalized to RDL baseline
    hyperparams: GEN_HN,
    depthMarkers: null,

    getQuality: function(hingeAngle) {
      return Chronicle.quality.hingeDepth(hingeAngle);
    },

    detect: function(landmarks, state, ui) {
      const sideResult = utils.detectSide(landmarks, state);
      if (!sideResult.valid) {
        state.trackingLossFrames = (state.trackingLossFrames || 0) + 1;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetHingeState(state, ui.status);
        }
        return;
      }
      state.trackingLossFrames = 0;

      const active = utils.getActiveLandmarks(landmarks, state.currentSide);
      if (!active.shoulder || (active.shoulder.visibility || 0) < C.LANDMARK_VISIBILITY_THRESHOLD) {
        return;
      }

      const hipY = active.hip.y;
      const hipX = active.hip.x;
      const kneeY = active.knee.y;
      const shoulderX = active.shoulder.x;
      const shoulderY = active.shoulder.y;
      const torsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY);

      // Smooth the angle
      if (state.dlSmoothedAngle === null) {
        state.dlSmoothedAngle = torsoAngle;
      } else {
        state.dlSmoothedAngle = state.dlSmoothedAngle * (1 - GEN_HN.ANGLE_SMOOTHING_ALPHA) +
          torsoAngle * GEN_HN.ANGLE_SMOOTHING_ALPHA;
      }
      const smoothedAngle = state.dlSmoothedAngle;

      // Calculate angle velocity
      if (state.prevTorsoAngle !== null) {
        state.dlAngleVelocity = smoothedAngle - state.prevTorsoAngle;
      }
      state.prevTorsoAngle = smoothedAngle;

      // Debug info
      state.debugInfo.torsoAngle = smoothedAngle.toFixed(1);
      state.debugInfo.standingTorsoAngle = state.standingTorsoAngle ? state.standingTorsoAngle.toFixed(1) : 'N/A';
      state.debugInfo.angleVelocity = state.dlAngleVelocity.toFixed(3);
      if (state.standingTorsoAngle !== null) {
        state.debugInfo.angleFromStanding = (smoothedAngle - state.standingTorsoAngle).toFixed(1);
      }

      // Calibration
      if (!state.isCalibrated) {
        const calibrating = utils.calibrateHipBaseline(
          hipY, hipX, kneeY, torsoAngle, state, ui.feedback, this.readyMsg
        );
        if (calibrating && state.isCalibrated) {
          state.lastSquatStartTime = null;
          state.calibrationCompletedTime = performance.now();
        }
        return;
      }

      // Auto-recalibrate if idle
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      const angleFromStanding = smoothedAngle - (state.standingTorsoAngle || 0);
      const hipRise = state.deepestHipY ? state.deepestHipY - hipY : 0;
      const hipRiseInches = utils.normToInches(hipRise, state);

      // State machine
      switch (state.state) {
        case 'standing': {
          if (angleFromStanding >= GEN_HN.HINGE_START_THRESHOLD && state.dlAngleVelocity > 0.1) {
            utils.updateState('descending', state, ui.status);
            state.deepestTorsoAngle = smoothedAngle;
            state.setupTorsoAngle = smoothedAngle;
            state.deepestHipY = hipY;
            state.liftStartTime = null;
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = 'Hinging...';
          }
          break;
        }

        case 'descending': {
          if (performance.now() - state.stateStartTime > C.MAX_STATE_TIME) {
            utils.resetHingeState(state, ui.status);
            if (ui.feedback) ui.feedback.textContent = 'Timeout - resetting';
            return;
          }

          if (smoothedAngle > state.deepestTorsoAngle) {
            state.deepestTorsoAngle = smoothedAngle;
          }
          if (hipY > (state.deepestHipY || 0)) {
            state.deepestHipY = hipY;
          }

          const totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);

          if (state.dlAngleVelocity < -0.1 && totalROM >= GEN_HN.MIN_HINGE_ANGLE) {
            utils.updateState('ascending', state, ui.status);
            state.liftStartTime = performance.now();
            state.ascentStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = 'Coming up!';
          }
          break;
        }

        case 'ascending': {
          if (performance.now() - state.stateStartTime > C.MAX_STATE_TIME) {
            utils.resetHingeState(state, ui.status);
            if (ui.feedback) ui.feedback.textContent = 'Timeout - resetting';
            return;
          }

          const totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);
          const currentROM = smoothedAngle - (state.standingTorsoAngle || 0);
          const angleRecovery = totalROM > 0 ? ((totalROM - currentROM) / totalROM) * 100 : 0;
          const returnAngleDiff = smoothedAngle - (state.standingTorsoAngle || 0);

          if (angleRecovery > 50 && angleRecovery < GEN_HN.RETURN_RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = `Almost! ${angleRecovery.toFixed(0)}%`;
          }

          if (returnAngleDiff <= GEN_HN.RETURN_ANGLE_THRESHOLD && angleRecovery >= GEN_HN.RETURN_RECOVERY_PERCENT) {
            const repTime = (performance.now() - state.ascentStartTime) / 1000;
            const romDegrees = totalROM;
            const distanceForSpeed = Math.max(hipRiseInches, 1);
            const speedScore = utils.calculateSpeedScore(repTime, distanceForSpeed, this.referenceDepth);
            const repQuality = this.getQuality(romDegrees);

            state.repCount++;
            state.repTimes.push(repTime);
            state.repDepths.push(romDegrees);

            if (ui.onRepComplete) {
              ui.onRepComplete(repTime, distanceForSpeed, speedScore, repQuality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount}`;
            if (ui.feedback) ui.feedback.textContent = `Rep ${state.repCount}: Speed ${speedScore} ${repQuality.emoji} ${repQuality.label} (${romDegrees.toFixed(0)}deg)`;

            this.displayRepTimes(state, ui.msg);
            utils.resetHingeState(state, ui.status);

            setTimeout(() => {
              if (state.state === 'standing' && ui.feedback) {
                ui.feedback.textContent = 'Ready for next rep';
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
      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Hinge Speed Analysis</div>';

      const recentReps = state.repTimes.slice(-5);
      const recentROMs = state.repDepths.slice(-5);

      recentReps.forEach((time, idx) => {
        const actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        const romDeg = recentROMs[idx];
        const timeDrop = ((time - firstRepTime) / firstRepTime * 100).toFixed(1);
        const dropNum = parseFloat(timeDrop);

        let color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += `<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
          <div style="font-size: 16px; margin-bottom: 4px;">
            Rep ${actualRepNum}: ${time.toFixed(2)}s | ${romDeg.toFixed(0)}deg ROM
            <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '+' : '-'}${Math.abs(dropNum).toFixed(1)}%</span>
          </div>
        </div>`;
      });

      msgEl.innerHTML = html;
    },

    reset: function(state) {
      state.standingTorsoAngle = null;
      state.setupTorsoAngle = null;
      state.deepestTorsoAngle = null;
      state.liftStartTime = null;
      state.setupEnteredTime = null;
      state.dlSmoothedAngle = null;
      state.dlAngleVelocity = 0;
      state.prevTorsoAngle = null;
    },
  };
})();
