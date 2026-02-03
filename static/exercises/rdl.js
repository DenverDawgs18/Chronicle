// ========== Romanian Deadlift (RDL) Exercise Module ==========
// Hip hinge pattern starting from standing position.
// Key difference from deadlift: starts standing, controlled eccentric,
// minimal knee bend, bar doesn't touch floor between reps.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const RDL = {
    // Torso angle thresholds - RDL has more controlled ROM
    HINGE_START_THRESHOLD: 20,       // Torso angle to detect start of hinge
    MIN_HINGE_ANGLE: 30,            // Minimum hinge depth for valid rep
    RETURN_ANGLE_THRESHOLD: 10,     // Must return within this of standing
    MIN_ROM_DEGREES: 20,            // Minimum range of motion
    MIN_HINGE_TIME_MS: 400,         // Minimum time in hinged position
    MAX_REP_TIME_MS: 8000,          // Max time for a single rep
    RETURN_RECOVERY_PERCENT: 80,    // Must recover 80% of angle to count

    // Knee bend detection - RDL should have minimal knee bend
    MAX_KNEE_BEND_WARNING: 30,      // Warn if knee bends more than this from straight (degrees)
  };

  Chronicle.exercises.rdl = {
    key: 'rdl',
    name: 'Romanian Deadlift',
    sessionName: 'RDL Session',
    readyMsg: 'Ready - hinge at hips to begin',
    category: 'deadlift',
    isSingleLeg: false,
    needsShoulder: true,
    referenceDepth: 8,   // Typical hip rise in inches for RDL
    hyperparams: RDL,
    depthMarkers: null,

    getQuality: function(hingeAngle) {
      return Chronicle.quality.hingeDepth(hingeAngle);
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

      const active = utils.getActiveLandmarks(landmarks, state.lockedSide);
      const shoulderValid = active.shoulder && (active.shoulder.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
      if (!shoulderValid) {
        state.trackingLossFrames++;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
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

      // Calibration
      if (!state.isCalibrated && state.state === 'standing') {
        if (utils.calibrateHipBaseline(hipY, hipX, kneeY, torsoAngle, state, ui.feedback, this.readyMsg)) return;
      }

      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // Knee angle monitoring (optional feedback)
      const ankleValid = active.ankle && (active.ankle.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
      let kneeAngle = 180;
      if (ankleValid) {
        kneeAngle = utils.calculateKneeAngle(
          active.hip.x, active.hip.y,
          active.knee.x, active.knee.y,
          active.ankle.x, active.ankle.y
        );
      }

      const angleFromStanding = state.standingTorsoAngle !== null ? torsoAngle - state.standingTorsoAngle : 0;

      // State timeout
      if ((state.state === 'descending' || state.state === 'ascending') && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > RDL.MAX_REP_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Rep timed out - resetting";
          utils.resetHingeState(state, ui.status);
          return;
        }
      }

      // State machine - RDL: standing -> descending (hinge down) -> ascending (return up) -> rep counted
      switch (state.state) {
        case 'standing':
          if (angleFromStanding > RDL.HINGE_START_THRESHOLD) {
            utils.updateState('descending', state, ui.status);
            state.deepestTorsoAngle = torsoAngle;
            state.setupEnteredTime = performance.now();
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = `Hinging... ${angleFromStanding.toFixed(0)}deg`;
          } else if (angleFromStanding > 8) {
            if (ui.feedback) ui.feedback.textContent = `Hinge deeper... ${angleFromStanding.toFixed(0)}deg`;
          }
          break;

        case 'descending':
          // Track deepest hinge
          if (torsoAngle > state.deepestTorsoAngle) {
            state.deepestTorsoAngle = torsoAngle;
          }

          const quality = this.getQuality(angleFromStanding);

          // Knee bend warning
          const kneeBend = 180 - kneeAngle;
          let kneeWarning = '';
          if (kneeBend > RDL.MAX_KNEE_BEND_WARNING) {
            kneeWarning = ' | Straighten knees!';
          }

          if (ui.feedback) ui.feedback.textContent = `RDL ${angleFromStanding.toFixed(0)}deg ${quality.emoji}${kneeWarning}`;

          // Detect return (ascending): torso angle starts decreasing
          const isAngleDecreasing = state.dlAngleVelocity < -0.002;
          const hasMinHinge = angleFromStanding >= RDL.MIN_HINGE_ANGLE;
          const hasBeenHinged = state.setupEnteredTime && (performance.now() - state.setupEnteredTime) > RDL.MIN_HINGE_TIME_MS;

          if (isAngleDecreasing && hasMinHinge && hasBeenHinged) {
            utils.updateState('ascending', state, ui.status);
            state.ascentStartTime = performance.now();
            state.deepestHipY = hipY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            if (ui.feedback) ui.feedback.textContent = "Drive hips forward!";
          }
          break;

        case 'ascending': {
          const totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);
          const angleRecovery = totalROM > 0 ? ((state.deepestTorsoAngle - torsoAngle) / totalROM) * 100 : 0;
          const returnAngleDiff = Math.abs(torsoAngle - (state.standingTorsoAngle || 0));

          if (angleRecovery < 50) {
            if (ui.feedback) ui.feedback.textContent = `Return ${angleRecovery.toFixed(0)}%`;
          } else if (returnAngleDiff > RDL.RETURN_ANGLE_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = `Almost! ${angleRecovery.toFixed(0)}%`;
          }

          if (returnAngleDiff <= RDL.RETURN_ANGLE_THRESHOLD && angleRecovery >= RDL.RETURN_RECOVERY_PERCENT) {
            const repTime = (performance.now() - state.ascentStartTime) / 1000;
            const romDegrees = totalROM;
            const hipRise = state.deepestHipY ? state.deepestHipY - hipY : 0;
            const hipRiseInches = utils.normToInches(hipRise, state);
            const distanceForSpeed = Math.max(hipRiseInches, 1);
            const speedScore = utils.calculateSpeedScore(repTime, distanceForSpeed, this.referenceDepth);
            const repQuality = this.getQuality(romDegrees);

            state.repCount++;
            state.repTimes.push(repTime);
            state.repDepths.push(romDegrees);

            if (ui.onRepComplete) {
              ui.onRepComplete(repTime, hipRiseInches, speedScore, repQuality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount}`;
            if (ui.feedback) ui.feedback.textContent = `Rep ${state.repCount}: Speed ${speedScore} ${repQuality.emoji} | ${romDegrees.toFixed(0)}deg ROM`;

            this.displayRepTimes(state, ui.msg);

            utils.updateState('standing', state, ui.status);
            state.deepestTorsoAngle = null;
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
      let html = '<div style="margin-bottom: 10px; font-weight: bold;">RDL Speed Analysis</div>';

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
    },
  };

  console.log('RDL exercise module loaded');
})();
