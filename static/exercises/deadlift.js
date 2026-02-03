// ========== Deadlift Exercise Module ==========
// Supports both conventional and sumo stance with auto-detection.
// Tracks torso angle (hip hinge) as primary metric.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const DL = {
    SETUP_ANGLE_THRESHOLD: 25,
    LOCKOUT_ANGLE_THRESHOLD: 12,
    MIN_ROM_DEGREES: 15,
    LIFT_VELOCITY_THRESHOLD: 0.003,
    MIN_STANDING_TIME_MS: 400,
    MAX_LIFT_TIME_MS: 8000,
    MIN_SETUP_TIME_MS: 300,
    // Sumo-specific adjustments
    SUMO_SETUP_ANGLE_THRESHOLD: 20,   // Sumo has more upright torso
    SUMO_LOCKOUT_ANGLE_THRESHOLD: 10,
    SUMO_MIN_ROM_DEGREES: 12,
  };

  function getThresholds(stance) {
    if (stance === 'sumo') {
      return {
        setupAngle: DL.SUMO_SETUP_ANGLE_THRESHOLD,
        lockoutAngle: DL.SUMO_LOCKOUT_ANGLE_THRESHOLD,
        minROM: DL.SUMO_MIN_ROM_DEGREES,
      };
    }
    return {
      setupAngle: DL.SETUP_ANGLE_THRESHOLD,
      lockoutAngle: DL.LOCKOUT_ANGLE_THRESHOLD,
      minROM: DL.MIN_ROM_DEGREES,
    };
  }

  Chronicle.exercises.deadlift = {
    key: 'deadlift',
    name: 'Deadlift',
    sessionName: 'Deadlift Session',
    readyMsg: 'Bend to the bar to begin',
    category: 'deadlift',
    isSingleLeg: false,
    needsShoulder: true,
    hyperparams: DL,
    depthMarkers: null,

    getQuality: function(angleDiffFromStanding) {
      return Chronicle.quality.lockout(angleDiffFromStanding);
    },

    detect: function(landmarks, state, ui) {
      const sideResult = utils.detectSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetHingeState(state, ui.status);
        }
        return;
      }

      // Validate shoulder visibility
      const active = utils.getActiveLandmarks(landmarks, state.lockedSide);
      const shoulderValid = active.shoulder && (active.shoulder.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
      if (!shoulderValid) {
        state.trackingLossFrames++;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetHingeState(state, ui.status);
        }
        return;
      }
      state.trackingLossFrames = 0;

      const rawHipY = active.hip.y;
      const rawHipX = active.hip.x;
      const kneeY = active.knee.y;

      const processed = utils.processHipPosition(rawHipY, rawHipX, state);
      if (processed.rejected && processed.hipY === null) return;
      const hipY = processed.hipY;
      const hipX = processed.hipX;

      // Torso angle
      const rawAngle = utils.calculateTorsoAngle(active.shoulder.x, active.shoulder.y, active.hip.x, active.hip.y);
      if (state.dlSmoothedAngle === null) {
        state.dlSmoothedAngle = rawAngle;
      } else {
        state.dlSmoothedAngle = state.dlSmoothedAngle * 0.6 + rawAngle * 0.4;
      }
      const torsoAngle = state.dlSmoothedAngle;

      // Angle velocity
      if (state.prevTorsoAngle !== null) {
        state.dlAngleVelocity = state.dlAngleVelocity * 0.6 + (torsoAngle - state.prevTorsoAngle) * 0.4;
      }
      state.prevTorsoAngle = torsoAngle;

      // Hip velocity
      utils.trackVelocity(hipY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // Auto-detect stance (conventional vs sumo) during calibration
      if (!state.isCalibrated && state.state === 'standing') {
        const detectedStance = utils.detectStance(landmarks);
        if (detectedStance) {
          state.detectedStance = detectedStance;
        }
      }

      // Calibration
      if (!state.isCalibrated && state.state === 'standing') {
        if (utils.calibrateHipBaseline(hipY, hipX, kneeY, torsoAngle, state, ui.feedback, this.readyMsg)) return;
      }

      // Auto-recalibration
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // State timeout
      if (state.state === 'ascending' && state.liftStartTime) {
        if (performance.now() - state.liftStartTime > DL.MAX_LIFT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Pull timed out - resetting";
          utils.resetHingeState(state, ui.status);
          return;
        }
      }

      // Get stance-specific thresholds
      const stance = state.detectedStance || 'conventional';
      const thresholds = getThresholds(stance);

      const angleFromStanding = state.standingTorsoAngle !== null ? torsoAngle - state.standingTorsoAngle : 0;

      // Debug info
      state.debugInfo.torsoAngle = torsoAngle.toFixed(1);
      state.debugInfo.standingTorsoAngle = state.standingTorsoAngle ? state.standingTorsoAngle.toFixed(1) : '-';
      state.debugInfo.angleFromStanding = angleFromStanding.toFixed(1);
      state.debugInfo.dlState = state.state;
      state.debugInfo.angleVelocity = state.dlAngleVelocity.toFixed(3);
      state.debugInfo.stance = stance;

      // State machine
      switch (state.state) {
        case 'standing':
          if (angleFromStanding > thresholds.setupAngle) {
            utils.updateState('descending', state, ui.status);
            state.deepestTorsoAngle = torsoAngle;
            state.setupTorsoAngle = torsoAngle;
            state.setupEnteredTime = performance.now();
            state.lastSquatStartTime = performance.now();
            const stanceLabel = stance === 'sumo' ? ' (Sumo)' : '';
            if (ui.feedback) ui.feedback.textContent = `Setup... ${angleFromStanding.toFixed(0)}deg hinge${stanceLabel}`;
          } else if (angleFromStanding > 10) {
            if (ui.feedback) ui.feedback.textContent = `Hinging... ${angleFromStanding.toFixed(0)}deg (need ${thresholds.setupAngle}deg)`;
          }
          break;

        case 'descending':
          if (torsoAngle > state.deepestTorsoAngle) {
            state.deepestTorsoAngle = torsoAngle;
            state.setupTorsoAngle = torsoAngle;
          }

          if (ui.feedback) ui.feedback.textContent = `Setup ${angleFromStanding.toFixed(0)}deg hinge`;

          const hasBeenInSetup = state.setupEnteredTime && (performance.now() - state.setupEnteredTime) > DL.MIN_SETUP_TIME_MS;
          const isAngleDecreasing = state.dlAngleVelocity < -DL.LIFT_VELOCITY_THRESHOLD;
          const isHipRising = avgVelocity < -C.VELOCITY_THRESHOLD;
          const romSoFar = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);

          if (hasBeenInSetup && (isAngleDecreasing || isHipRising) && romSoFar >= thresholds.minROM) {
            utils.updateState('ascending', state, ui.status);
            state.liftStartTime = performance.now();
            state.deepestHipY = hipY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            if (ui.feedback) ui.feedback.textContent = "PULL!";
          }
          break;

        case 'ascending': {
          const hipRise = state.deepestHipY ? state.deepestHipY - hipY : 0;
          const hipRiseInches = utils.normToInches(hipRise, state);

          const lockoutAngleDiff = Math.abs(torsoAngle - (state.standingTorsoAngle || 0));
          const totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);
          const angleRecovery = totalROM > 0 ? ((state.deepestTorsoAngle - torsoAngle) / totalROM) * 100 : 0;

          if (angleRecovery < 50) {
            if (ui.feedback) ui.feedback.textContent = `Pull! ${angleRecovery.toFixed(0)}% lockout`;
          } else if (lockoutAngleDiff > thresholds.lockoutAngle) {
            if (ui.feedback) ui.feedback.textContent = `Lock it out! ${angleRecovery.toFixed(0)}%`;
          }

          if (lockoutAngleDiff <= thresholds.lockoutAngle && angleRecovery >= 80) {
            const liftTime = (performance.now() - state.liftStartTime) / 1000;
            const romDegrees = totalROM;
            const distanceForSpeed = Math.max(hipRiseInches, 1);
            const speedScore = utils.calculateSpeedScore(liftTime, distanceForSpeed);
            const quality = this.getQuality(lockoutAngleDiff);

            state.repCount++;
            state.repTimes.push(liftTime);
            state.repDepths.push(romDegrees);

            if (ui.onRepComplete) {
              ui.onRepComplete(liftTime, hipRiseInches, speedScore, quality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount}`;
            if (ui.feedback) ui.feedback.textContent = `Rep ${state.repCount}: Speed ${speedScore} ${quality.emoji} ${quality.label} | ${romDegrees.toFixed(0)}deg ROM`;

            this.displayRepTimes(state, ui.msg);

            utils.updateState('standing', state, ui.status);
            state.deepestTorsoAngle = null;
            state.setupTorsoAngle = null;
            state.liftStartTime = null;
            state.setupEnteredTime = null;
            state.deepestHipY = null;
            state.stableStandingStartTime = performance.now();

            setTimeout(() => {
              if (state.state === 'standing' && ui.feedback) {
                ui.feedback.textContent = "Ready for next rep";
              }
            }, 1000);
          }
          break;
        }
      }
    },

    displayRepTimes: function(state, msgEl) {
      if (!msgEl || state.repTimes.length === 0) return;

      const firstRepTime = state.repTimes[0];
      const stance = state.detectedStance || 'conventional';
      const stanceLabel = stance.charAt(0).toUpperCase() + stance.slice(1);
      let html = `<div style="margin-bottom: 10px; font-weight: bold;">${stanceLabel} Deadlift Speed Analysis</div>`;

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
            <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '+' : ''}${dropNum.toFixed(1)}%</span>
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
      state.detectedStance = null;
    },
  };

  console.log('Deadlift exercise module loaded');
})();
