// ========== Press Exercise Shared Utilities ==========
// Shared functions for all press exercise variations (bench, OHP, dips, kneeling, general).
// Handles side detection, sliding-window calibration, and the full press state machine.
//
// Each press variation module calls Chronicle.pressUtils.detectPress() with
// exercise-specific hyperparameters and a calConfig object that describes how to
// get the tracking point and reference distance for that exercise.
//
// calConfig shape:
//   getTrackPoint(lm)  - returns {y,x} of the tracking point (wrist or shoulder)
//   getRefDist(lm)     - returns normalized reference distance (shoulder-wrist or shoulder-elbow)
//   ratioFraction      - expected reference distance as fraction of body height (e.g. 0.37)
//   tolerance          - calibration stillness tolerance multiplied by refDist (default 0.18)
//   distMin            - minimum valid refDist for sanity check (default 0.015)
//   distMax            - maximum valid refDist for sanity check (default 0.45)
//   readyMsg           - message shown after calibration completes
//   positionMsg        - message shown while collecting calibration samples
//   badPositionMsg     - message shown when landmarks are out of range
//   elbowFallback      - if true, wrist is not required for side detection (dips)
//   ascentVerb         - verb used in feedback during ascent phase (default 'Press')

(function() {
  var C = Chronicle.CONSTANTS;
  var utils = Chronicle.utils;

  Chronicle.pressUtils = {

    // ── Landmarks ──────────────────────────────────────────────────────────────

    getPressLandmarks: function(landmarks, side) {
      var useLeft = (side === 'left');
      return {
        shoulder: useLeft ? landmarks[11] : landmarks[12],
        elbow:    useLeft ? landmarks[13] : landmarks[14],
        wrist:    useLeft ? landmarks[15] : landmarks[16],
      };
    },

    // ── Side Detection ─────────────────────────────────────────────────────────

    detectPressSide: function(landmarks, state, config) {
      var leftShoulder  = landmarks[11];
      var rightShoulder = landmarks[12];
      var leftElbow     = landmarks[13];
      var rightElbow    = landmarks[14];
      var leftWrist     = landmarks[15];
      var rightWrist    = landmarks[16];

      var vis = function(lm) { return lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD; };
      var elbowFallback = config && config.elbowFallback;

      // For dips the wrist is fixed on bars and may be invisible – only require shoulder+elbow.
      var leftValid  = vis(leftShoulder)  && vis(leftElbow)  && (elbowFallback || vis(leftWrist));
      var rightValid = vis(rightShoulder) && vis(rightElbow) && (elbowFallback || vis(rightWrist));

      if (!leftValid && !rightValid) {
        state.trackingLossFrames++;
        return { valid: false };
      }
      state.trackingLossFrames = 0;

      if (state.lockedSide === null) {
        if (leftValid && rightValid) {
          var leftVis  = elbowFallback ? (leftElbow.visibility  || 0) : (leftWrist.visibility  || 0);
          var rightVis = elbowFallback ? (rightElbow.visibility || 0) : (rightWrist.visibility || 0);
          state.lockedSide = leftVis > rightVis ? 'left' : 'right';
        } else {
          state.lockedSide = leftValid ? 'left' : 'right';
        }
      } else {
        var currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
        var otherValid   = state.lockedSide === 'left' ? rightValid : leftValid;
        var currentVis = state.lockedSide === 'left'
          ? (elbowFallback ? (leftElbow.visibility  || 0) : (leftWrist.visibility  || 0))
          : (elbowFallback ? (rightElbow.visibility || 0) : (rightWrist.visibility || 0));
        var otherVis = state.lockedSide === 'left'
          ? (elbowFallback ? (rightElbow.visibility || 0) : (rightWrist.visibility || 0))
          : (elbowFallback ? (leftElbow.visibility  || 0) : (leftWrist.visibility  || 0));

        if (!currentValid && otherValid &&
            (otherVis - currentVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
            state.state === 'standing') {
          state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
        }
      }

      state.currentSide = state.lockedSide;
      return { valid: true, side: state.lockedSide };
    },

    // ── Calibration ────────────────────────────────────────────────────────────

    /**
     * Calibrate at the lockout position using a sliding window.
     * When a frame is too unstable, the oldest sample is dropped rather than
     * resetting to zero – this makes calibration much more forgiving.
     */
    calibrate: function(lm, state, feedbackEl, config) {
      var raw    = config.getTrackPoint(lm);
      var trackY = raw.y;
      var trackX = raw.x;
      var refDist = config.getRefDist(lm);

      var distMin        = config.distMin        !== undefined ? config.distMin        : 0.015;
      var distMax        = config.distMax        !== undefined ? config.distMax        : 0.45;
      var tolerance      = config.tolerance      !== undefined ? config.tolerance      : 0.18;
      var ratioFraction  = config.ratioFraction  !== undefined ? config.ratioFraction  : 0.37;
      var readyMsg       = config.readyMsg       || 'Ready to press!';
      var positionMsg    = config.positionMsg    || 'Hold lockout';
      var badPositionMsg = config.badPositionMsg || 'Position camera to see full arm from the side';

      if (refDist < distMin || refDist > distMax) {
        if (feedbackEl) feedbackEl.textContent = badPositionMsg;
        return true;
      }

      if (state.calibrationHipYValues.length === 0) {
        state.calibrationHipYValues.push(trackY);
        state.hipKneeDistance  = refDist;
        state.standingHipX     = trackX;
        state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
        if (feedbackEl) feedbackEl.textContent = positionMsg + ' 1/' + C.CALIBRATION_SAMPLES;
        return true;
      }

      var recentAvg = state.calibrationHipYValues.slice(-3).reduce(function(a, b) { return a + b; }, 0) /
                      Math.min(state.calibrationHipYValues.length, 3);
      var variation = Math.abs(trackY - recentAvg);
      var tol = refDist * tolerance;

      if (variation < tol) {
        state.calibrationHipYValues.push(trackY);
        state.hipKneeDistance = state.hipKneeDistance * 0.8 + refDist * 0.2;

        if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
          state.standingHipY = state.calibrationHipYValues.reduce(function(a, b) { return a + b; }, 0) /
                               state.calibrationHipYValues.length;
          state.standingHipX             = trackX;
          state.stableFrameCount         = C.STABILITY_FRAMES;
          state.stableStandingStartTime  = performance.now();
          state.calibrationCompletedTime = performance.now();

          var expectedInches = state.userHeightInches * ratioFraction;
          state.inchesPerUnit = expectedInches / state.hipKneeDistance;
          state.isCalibrated  = true;

          var estimatedArmInches = utils.normToInches(state.hipKneeDistance, state);
          var feet   = Math.floor(state.userHeightInches / 12);
          var inches = state.userHeightInches % 12;
          if (feedbackEl) feedbackEl.textContent = 'Calibrated! H:' + feet + "'" + inches + '" Arm:' + estimatedArmInches.toFixed(1) + '"';

          setTimeout(function() {
            if (state.state === 'standing' && feedbackEl) feedbackEl.textContent = readyMsg;
          }, 2000);
        } else {
          if (feedbackEl) feedbackEl.textContent = positionMsg + ' ' + state.calibrationHipYValues.length + '/' + C.CALIBRATION_SAMPLES;
        }
      } else {
        // Sliding window: drop the oldest sample so one wobble doesn't reset the whole count.
        if (state.calibrationHipYValues.length > 0) {
          state.calibrationHipYValues.shift();
        }
        if (feedbackEl) feedbackEl.textContent = positionMsg + ' ' + state.calibrationHipYValues.length + '/' + C.CALIBRATION_SAMPLES;
      }

      return true;
    },

    // ── Main Detection Loop ────────────────────────────────────────────────────

    /**
     * Shared press detection loop used by all press exercise modules.
     * @param {object} landmarks - MediaPipe pose landmarks
     * @param {object} state     - Tracking state
     * @param {object} ui        - UI elements { feedback, status, counter, msg, onRepComplete }
     * @param {object} exercise  - Exercise module (getQuality, name, referenceDepth, displayRepTimes)
     * @param {object} hyper     - Exercise hyperparameters (MIN_DEPTH_INCHES, DESCENT_THRESHOLD_INCHES, …)
     * @param {object} config    - Calibration + detection config (see module header)
     */
    detectPress: function(landmarks, state, ui, exercise, hyper, config) {
      var sideResult = this.detectPressSide(landmarks, state, config);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = 'Lost tracking - resetting';
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      var lm  = this.getPressLandmarks(landmarks, state.lockedSide);
      var raw = config.getTrackPoint(lm);

      var processed = utils.processHipPosition(raw.y, raw.x, state);
      if (processed.rejected && processed.hipY === null) return;
      var trackY = processed.hipY;
      var trackX = processed.hipX;

      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      if (!state.isCalibrated && state.state === 'standing') {
        if (this.calibrate(lm, state, ui.feedback, config)) return;
      }

      utils.trackVelocity(trackY, state);
      var avgVelocity = utils.getAvgVelocity(state);

      // State timeouts
      if (state.state === 'descending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = 'Descent too slow - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }
      if (state.state === 'ascending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = (config.ascentVerb || 'Press') + ' stalled - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      if (state.state === 'standing') {
        utils.handleStandingStability(trackY, trackX, state, ui.feedback, exercise.name);
      }

      if (state.state === 'descending' || state.state === 'ascending') {
        if (state.deepestHipY === null || trackY > state.deepestHipY) {
          state.deepestHipY = trackY;
        }
      }

      var currentDepthNorm   = trackY - state.standingHipY;
      var currentDepthInches = utils.normToInches(currentDepthNorm, state);
      var maxDepthNorm       = state.deepestHipY ? state.deepestHipY - state.standingHipY : 0;
      var maxDepthInches     = utils.normToInches(maxDepthNorm, state);
      var descentThreshNorm  = utils.inchesToNorm(hyper.DESCENT_THRESHOLD_INCHES, state);
      var hysteresisNorm     = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Elbow angle for debug overlay
      var elbowAngle = utils.calculateKneeAngle(
        lm.shoulder.x, lm.shoulder.y,
        lm.elbow.x, lm.elbow.y,
        lm.wrist.x, lm.wrist.y
      );
      state.debugInfo.elbowAngle       = elbowAngle.toFixed(0);
      state.debugInfo.pressDepthInches = currentDepthInches.toFixed(1);
      state.debugInfo.pressState       = state.state;

      var ascentVerb = config.ascentVerb || 'Press';

      switch (state.state) {

        case 'standing': {
          var hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;
          var isMovingDown = avgVelocity > (hyper.DESCENT_VELOCITY_MIN || 0.0010);
          var wellPast     = currentDepthNorm > descentThreshNorm * (hyper.DEPTH_TRIGGER_MULTIPLIER || 1.5);
          var isPastThresh = currentDepthNorm > descentThreshNorm + hysteresisNorm;

          if (isPastThresh && hasBeenStable && (isMovingDown || wellPast)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = trackY;
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
          var descendQuality = exercise.getQuality(currentDepthInches);
          if (ui.feedback) ui.feedback.textContent = 'Down ' + descendQuality.emoji;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= hyper.MIN_DEPTH_INCHES * Chronicle.settings.sensitivityMultiplier()) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime  = performance.now();
              state.velocityHistory  = [];
              state.smoothedVelocity = 0;
              var quality = exercise.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = ascentVerb + '! ' + quality.emoji;
            } else {
              if (ui.feedback) ui.feedback.textContent = 'Too shallow!';
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

          var recovered       = Math.max(0, state.deepestHipY - trackY);
          var totalDepth      = maxDepthNorm;
          var recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;

          if (recoveryPercent < (hyper.RECOVERY_WARNING_THRESHOLD || 50)) {
            if (ui.feedback) ui.feedback.textContent = ascentVerb + '! ' + recoveryPercent.toFixed(0) + '% lockout';
          } else if (recoveryPercent < hyper.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = 'Almost locked out! ' + recoveryPercent.toFixed(0) + '%';
          }

          var isAboveThresh = currentDepthNorm < descentThreshNorm - hysteresisNorm;
          var hasMinDepth   = maxDepthInches >= hyper.MIN_DEPTH_INCHES * Chronicle.settings.sensitivityMultiplier();

          if (recoveryPercent >= hyper.RECOVERY_PERCENT && isAboveThresh && hasMinDepth) {
            var ascentTime = (performance.now() - state.ascentStartTime) / 1000;
            var speedScore = utils.calculateSpeedScore(ascentTime, maxDepthInches, exercise.referenceDepth);
            var repQuality = exercise.getQuality(maxDepthInches);

            state.repTimes.push(ascentTime);
            state.repDepths.push(maxDepthInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(ascentTime, maxDepthInches, speedScore, repQuality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = 'Reps: ' + state.repCount;
            if (ui.feedback) ui.feedback.textContent = 'Rep ' + state.repCount + ': Speed ' + speedScore + ' ' + repQuality.emoji;

            exercise.displayRepTimes(state, ui.msg);
            utils.resetToStanding(state, ui.status);

            setTimeout(function() {
              if (state.state === 'standing' && ui.feedback) ui.feedback.textContent = 'Ready for next rep';
            }, 1500);
          }
          break;
        }
      }
    },

    // ── Rep Display ────────────────────────────────────────────────────────────

    displayRepTimes: function(state, msgEl, title, getQuality, referenceDepth) {
      if (!msgEl || state.repTimes.length === 0) return;

      var firstSpeedScore = utils.calculateSpeedScore(state.repTimes[0], state.repDepths[0], referenceDepth);
      var html = '<div style="margin-bottom: 10px; font-weight: bold;">' + title + '</div>';
      var recentReps   = state.repTimes.slice(-5);
      var recentDepths = state.repDepths.slice(-5);

      recentReps.forEach(function(time, idx) {
        var actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        var depthInches  = recentDepths[idx];
        var quality      = getQuality(depthInches);
        var speedScore   = utils.calculateSpeedScore(time, depthInches, referenceDepth);
        var dropNum      = parseFloat(((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1));
        var color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += '<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">' +
          '<div style="font-size: 16px; margin-bottom: 4px;">' +
          'Rep ' + actualRepNum + ': Speed ' + speedScore + ' ' + quality.emoji +
          ' <span style="color: ' + color + '; margin-left: 10px; font-weight: bold;">' +
          (dropNum > 0 ? '-' : '+') + Math.abs(dropNum).toFixed(1) + '%</span>' +
          '</div></div>';
      });

      msgEl.innerHTML = html;
    },

  };

  console.log('Press shared utilities loaded');
})();
