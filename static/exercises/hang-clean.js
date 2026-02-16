// ========== Hang Clean Exercise Module ==========
// Tracks the explosive pull from hang position (mid-thigh) to catch at shoulders.
// Calibrates in standing position using hip-knee distance.
// Uses hip Y position to detect the pull (hip rises explosively) and catch (hip drops to absorb).
// Also monitors torso angle for the hinge-to-upright transition.
//
// State machine: standing -> descending (hinge to hang) -> ascending (explosive pull) -> catch -> rep counted.
// Camera should be positioned from the side so shoulder, hip, and knee are visible.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const HC = {
    // Hang position thresholds
    HANG_ANGLE_THRESHOLD: 15,        // Minimum torso hinge angle to enter hang position (degrees)
    MIN_HANG_TIME_MS: 300,           // Minimum time in hang before pull counts
    MAX_PULL_TIME_MS: 4000,          // Maximum time for pull phase

    // Pull detection
    PULL_VELOCITY_THRESHOLD: 0.004,  // Minimum upward hip velocity for explosive pull
    MIN_HIP_RISE_INCHES: 3,         // Minimum hip rise during pull phase

    // Catch detection
    CATCH_ANGLE_THRESHOLD: 10,       // Torso must return near upright (degrees from standing)
    CATCH_HIP_DROP_INCHES: 2,        // Hip drops slightly during catch/absorb
    CATCH_RECOVERY_PERCENT: 70,      // % of torso angle recovery needed for catch

    // Standing
    MIN_STANDING_TIME_MS: 400,
  };

  Chronicle.exercises['hang-clean'] = {
    key: 'hang-clean',
    name: 'Hang Clean',
    sessionName: 'Hang Clean Session',
    readyMsg: 'Hinge to hang position to begin',
    category: 'olympic',
    isSingleLeg: false,
    needsShoulder: true,
    needsHip: true,
    referenceDepth: 10,  // Typical hip rise in inches for hang clean
    hyperparams: HC,
    depthMarkers: null,

    cameraHint: 'Camera needs to see: Shoulder, Hip, Knee (side view)',

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
      var avgVelocity = utils.getAvgVelocity(state);

      // Calibration
      if (!state.isCalibrated && state.state === 'standing') {
        if (utils.calibrateHipBaseline(hipY, hipX, kneeY, torsoAngle, state, ui.feedback, this.readyMsg)) return;
      }

      // Auto-recalibration
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // State timeout
      if (state.state === 'ascending' && state.liftStartTime) {
        if (performance.now() - state.liftStartTime > HC.MAX_PULL_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = "Pull timed out - resetting";
          utils.resetHingeState(state, ui.status);
          return;
        }
      }

      var angleFromStanding = state.standingTorsoAngle !== null ? torsoAngle - state.standingTorsoAngle : 0;

      // Debug info
      state.debugInfo.torsoAngle = torsoAngle.toFixed(1);
      state.debugInfo.standingTorsoAngle = state.standingTorsoAngle ? state.standingTorsoAngle.toFixed(1) : '-';
      state.debugInfo.angleFromStanding = angleFromStanding.toFixed(1);
      state.debugInfo.dlState = state.state;
      state.debugInfo.angleVelocity = state.dlAngleVelocity.toFixed(3);
      state.debugInfo.hipVelocity = avgVelocity.toFixed(4);

      // State machine
      switch (state.state) {
        case 'standing':
          // Detect hinge to hang position
          if (angleFromStanding > HC.HANG_ANGLE_THRESHOLD) {
            utils.updateState('descending', state, ui.status);
            state.deepestTorsoAngle = torsoAngle;
            state.setupTorsoAngle = torsoAngle;
            state.setupEnteredTime = performance.now();
            state.lastSquatStartTime = performance.now();
            if (ui.feedback) ui.feedback.textContent = 'Hang position...';
          } else if (angleFromStanding > 8) {
            if (ui.feedback) ui.feedback.textContent = 'Hinging...';
          }
          break;

        case 'descending':
          // In hang position - waiting for explosive pull
          if (torsoAngle > state.deepestTorsoAngle) {
            state.deepestTorsoAngle = torsoAngle;
          }

          if (ui.feedback) ui.feedback.textContent = 'Hang position - PULL!';

          var hasBeenInHang = state.setupEnteredTime && (performance.now() - state.setupEnteredTime) > HC.MIN_HANG_TIME_MS;
          var isAngleDecreasing = state.dlAngleVelocity < -HC.PULL_VELOCITY_THRESHOLD;
          var isHipRising = avgVelocity < -C.VELOCITY_THRESHOLD;

          if (hasBeenInHang && (isAngleDecreasing || isHipRising)) {
            utils.updateState('ascending', state, ui.status);
            state.liftStartTime = performance.now();
            state.deepestHipY = hipY;
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            if (ui.feedback) ui.feedback.textContent = "PULL!";
          }
          break;

        case 'ascending': {
          var hipRise = state.deepestHipY ? state.deepestHipY - hipY : 0;
          var hipRiseInches = utils.normToInches(hipRise, state);

          var lockoutAngleDiff = Math.abs(torsoAngle - (state.standingTorsoAngle || 0));
          var totalROM = state.deepestTorsoAngle - (state.standingTorsoAngle || 0);
          var angleRecovery = totalROM > 0 ? ((state.deepestTorsoAngle - torsoAngle) / totalROM) * 100 : 0;

          if (angleRecovery < 50) {
            if (ui.feedback) ui.feedback.textContent = 'Pull! ' + angleRecovery.toFixed(0) + '% catch';
          } else if (lockoutAngleDiff > HC.CATCH_ANGLE_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = 'Catch it! ' + angleRecovery.toFixed(0) + '%';
          }

          // Rep counts when torso returns upright (catch position)
          if (lockoutAngleDiff <= HC.CATCH_ANGLE_THRESHOLD && angleRecovery >= HC.CATCH_RECOVERY_PERCENT) {
            var liftTime = (performance.now() - state.liftStartTime) / 1000;
            var distanceForSpeed = Math.max(hipRiseInches, 1);
            var speedScore = utils.calculateSpeedScore(liftTime, distanceForSpeed, this.referenceDepth);
            var quality = this.getQuality(lockoutAngleDiff);

            state.repCount++;
            state.repTimes.push(liftTime);
            state.repDepths.push(hipRiseInches);

            if (ui.onRepComplete) {
              ui.onRepComplete(liftTime, hipRiseInches, speedScore, quality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = 'Reps: ' + state.repCount;
            if (ui.feedback) ui.feedback.textContent = 'Rep ' + state.repCount + ': Speed ' + speedScore + ' ' + quality.emoji;

            this.displayRepTimes(state, ui.msg);

            utils.updateState('standing', state, ui.status);
            state.deepestTorsoAngle = null;
            state.setupTorsoAngle = null;
            state.liftStartTime = null;
            state.setupEnteredTime = null;
            state.deepestHipY = null;
            state.stableStandingStartTime = performance.now();

            setTimeout(function() {
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

      var firstRepTime = state.repTimes[0];
      var firstRepDepth = state.repDepths[0];
      var refDepth = this.referenceDepth;
      var firstSpeedScore = utils.calculateSpeedScore(firstRepTime, firstRepDepth, refDepth);
      var html = '<div style="margin-bottom: 10px; font-weight: bold;">Hang Clean Speed Analysis</div>';

      var recentReps = state.repTimes.slice(-5);
      var recentROMs = state.repDepths.slice(-5);

      recentReps.forEach(function(time, idx) {
        var actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        var romInches = recentROMs[idx];
        var speedScore = utils.calculateSpeedScore(time, romInches, refDepth);
        var scoreDrop = ((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1);
        var dropNum = parseFloat(scoreDrop);

        var color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += '<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">' +
          '<div style="font-size: 16px; margin-bottom: 4px;">' +
          'Rep ' + actualRepNum + ': Speed ' + speedScore +
          ' <span style="color: ' + color + '; margin-left: 10px; font-weight: bold;">' + (dropNum > 0 ? '-' : '+') + Math.abs(dropNum).toFixed(1) + '%</span>' +
          '</div></div>';
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

  console.log('Hang Clean exercise module loaded');
})();
