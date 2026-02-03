// ========== Single Leg RDL Exercise Module ==========
// Hip hinge on one leg with auto side (working leg) detection.
// Tracks torso angle like RDL, but monitors which leg is planted.
// Automatically detects side changes when user switches legs.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const SLRDL = {
    HINGE_START_THRESHOLD: 18,      // Slightly lower threshold - balance is harder
    MIN_HINGE_ANGLE: 25,            // Minimum hinge depth for valid rep
    RETURN_ANGLE_THRESHOLD: 12,     // Return tolerance slightly wider for balance
    MIN_ROM_DEGREES: 18,
    MIN_HINGE_TIME_MS: 350,
    MAX_REP_TIME_MS: 10000,         // More time allowed (balance)
    RETURN_RECOVERY_PERCENT: 75,    // Slightly more forgiving for balance

    // Side detection
    ANKLE_HEIGHT_DIFF_THRESHOLD: 0.06,  // Min Y diff between ankles to detect single-leg stance
    SIDE_CHANGE_COOLDOWN_MS: 2000,      // Min time between side changes
    SIDE_CONFIRMATION_FRAMES: 5,        // Frames to confirm side before locking
  };

  // Track side confirmation
  let sideConfirmationCount = 0;
  let pendingSide = null;

  Chronicle.exercises['single-leg-rdl'] = {
    key: 'single-leg-rdl',
    name: 'Single Leg RDL',
    sessionName: 'Single Leg RDL Session',
    readyMsg: 'Stand on one leg, then hinge forward',
    category: 'deadlift',
    isSingleLeg: true,
    needsShoulder: true,
    referenceDepth: 6,   // Typical hip rise in inches for single-leg RDL
    hyperparams: SLRDL,
    depthMarkers: null,

    getQuality: function(hingeAngle) {
      return Chronicle.quality.hingeDepth(hingeAngle);
    },

    detect: function(landmarks, state, ui) {
      // Use bilateral side detection for camera view
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

      // Detect working leg (which ankle is planted)
      const legResult = utils.detectWorkingLeg(landmarks, state);

      // Handle side change detection
      if (legResult.valid && legResult.sideChanged && state.state === 'standing') {
        const now = performance.now();
        const cooldownPassed = !state.lastSideChangeTime ||
          (now - state.lastSideChangeTime) > SLRDL.SIDE_CHANGE_COOLDOWN_MS;

        if (cooldownPassed) {
          // Confirm the new side
          if (pendingSide === state.workingSide) {
            sideConfirmationCount++;
          } else {
            pendingSide = state.workingSide;
            sideConfirmationCount = 1;
          }

          if (sideConfirmationCount >= SLRDL.SIDE_CONFIRMATION_FRAMES) {
            state.sideChangeDetected = false;
            state.lastSideChangeTime = now;
            sideConfirmationCount = 0;
            pendingSide = null;

            const sideLabel = state.workingSide === 'left' ? 'Left' : 'Right';
            if (ui.feedback) ui.feedback.textContent = `Switched to ${sideLabel} leg`;

            // Don't reset calibration for side change - just note the switch
          }
        } else {
          state.sideChangeDetected = false;
        }
      }

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

      if (state.prevTorsoAngle !== null) {
        state.dlAngleVelocity = state.dlAngleVelocity * 0.6 + (torsoAngle - state.prevTorsoAngle) * 0.4;
      }
      state.prevTorsoAngle = torsoAngle;

      utils.trackVelocity(hipY, state);
      const avgVelocity = utils.getAvgVelocity(state);

      // Calibration
      if (!state.isCalibrated && state.state === 'standing') {
        if (utils.calibrateHipBaseline(hipY, hipX, kneeY, torsoAngle, state, ui.feedback, this.readyMsg)) return;
      }

      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      const angleFromStanding = state.standingTorsoAngle !== null ? torsoAngle - state.standingTorsoAngle : 0;

      // State timeout
      if ((state.state === 'descending' || state.state === 'ascending') && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > SLRDL.MAX_REP_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Rep timed out - resetting";
          utils.resetHingeState(state, ui.status);
          return;
        }
      }

      const sideLabel = state.workingSide ? (state.workingSide === 'left' ? 'L' : 'R') : '';

      // State machine
      switch (state.state) {
        case 'standing':
          if (angleFromStanding > SLRDL.HINGE_START_THRESHOLD) {
            utils.updateState('descending', state, ui.status);
            state.deepestTorsoAngle = torsoAngle;
            state.setupEnteredTime = performance.now();
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Hinging... ${angleFromStanding.toFixed(0)}deg`;
          } else if (angleFromStanding > 8) {
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Hinge deeper... ${angleFromStanding.toFixed(0)}deg`;
          }
          break;

        case 'descending':
          if (torsoAngle > state.deepestTorsoAngle) {
            state.deepestTorsoAngle = torsoAngle;
          }

          const quality = this.getQuality(angleFromStanding);
          if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] SL-RDL ${angleFromStanding.toFixed(0)}deg ${quality.emoji}`;

          const isAngleDecreasing = state.dlAngleVelocity < -0.002;
          const hasMinHinge = angleFromStanding >= SLRDL.MIN_HINGE_ANGLE;
          const hasBeenHinged = state.setupEnteredTime && (performance.now() - state.setupEnteredTime) > SLRDL.MIN_HINGE_TIME_MS;

          if (isAngleDecreasing && hasMinHinge && hasBeenHinged) {
            utils.updateState('ascending', state, ui.status);
            state.ascentStartTime = performance.now();
            state.deepestHipY = hipY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Drive up!`;
          }
          break;

        case 'ascending': {
          const totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);
          const angleRecovery = totalROM > 0 ? ((state.deepestTorsoAngle - torsoAngle) / totalROM) * 100 : 0;
          const returnAngleDiff = Math.abs(torsoAngle - (state.standingTorsoAngle || 0));

          if (angleRecovery < 50) {
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Return ${angleRecovery.toFixed(0)}%`;
          }

          if (returnAngleDiff <= SLRDL.RETURN_ANGLE_THRESHOLD && angleRecovery >= SLRDL.RETURN_RECOVERY_PERCENT) {
            const repTime = (performance.now() - state.ascentStartTime) / 1000;
            const romDegrees = totalROM;
            const hipRise = state.deepestHipY ? state.deepestHipY - hipY : 0;
            const hipRiseInches = utils.normToInches(hipRise, state);
            const distanceForSpeed = Math.max(hipRiseInches, 1);
            const speedScore = utils.calculateSpeedScore(repTime, distanceForSpeed, this.referenceDepth);
            const repQuality = this.getQuality(romDegrees);

            state.repCount++;
            if (state.workingSide) {
              state.sideReps[state.workingSide]++;
            }
            state.repTimes.push(repTime);
            state.repDepths.push(romDegrees);

            const repSide = state.workingSide || 'unknown';
            if (ui.onRepComplete) {
              ui.onRepComplete(repTime, hipRiseInches, speedScore, repQuality.label.toLowerCase());
            }

            const leftCount = state.sideReps.left;
            const rightCount = state.sideReps.right;
            if (ui.counter) ui.counter.textContent = `Reps: ${state.repCount} (L:${leftCount} R:${rightCount})`;
            if (ui.feedback) ui.feedback.textContent = `[${sideLabel}] Rep ${state.repCount}: Speed ${speedScore} ${repQuality.emoji} | ${romDegrees.toFixed(0)}deg`;

            this.displayRepTimes(state, ui.msg);

            utils.updateState('standing', state, ui.status);
            state.deepestTorsoAngle = null;
            state.setupEnteredTime = null;
            state.deepestHipY = null;
            state.stableStandingStartTime = performance.now();

            setTimeout(() => {
              if (state.state === 'standing' && ui.feedback) {
                ui.feedback.textContent = `[${sideLabel}] Ready for next rep`;
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
      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Single Leg RDL Analysis';
      html += ` (L:${state.sideReps.left} R:${state.sideReps.right})</div>`;

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
            Rep ${actualRepNum}: ${time.toFixed(2)}s | ${romDeg.toFixed(0)}deg
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
      state.workingSide = null;
      state.sideReps = { left: 0, right: 0 };
      state.sideChangeDetected = false;
      state.lastSideChangeTime = null;
      sideConfirmationCount = 0;
      pendingSide = null;
    },
  };

  console.log('Single Leg RDL exercise module loaded');
})();
