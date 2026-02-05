// ========== General Press Exercise Module ==========
// Generic press-pattern tracker for exercises without a specific module.
// Uses wrist Y position tracking (same as bench press) with wider tolerances.
// Good for: incline bench, close-grip bench, dumbbell press, push-ups, dips,
//           machine press, floor press, JM press, board press, etc.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  const GEN_PR = {
    MIN_DEPTH_INCHES: 3,            // Lower than bench (varied ROM across exercises)
    DESCENT_THRESHOLD_INCHES: 2.0,  // Slightly easier to trigger
    RECOVERY_PERCENT: 76,           // More forgiving than specific bench
    DESCENT_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 45,

    // Depth quality thresholds (wrist travel in inches)
    DEPTH_MARKER_PARTIAL: 3,
    DEPTH_MARKER_PARALLEL: 7,
    DEPTH_MARKER_DEEP: 10,

    // Calibration
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.15,
  };

  // ========== PRESS-SPECIFIC UTILITIES ==========

  function getPressLandmarks(landmarks, side) {
    var useLeft = (side === 'left');
    return {
      shoulder: useLeft ? landmarks[11] : landmarks[12],
      elbow: useLeft ? landmarks[13] : landmarks[14],
      wrist: useLeft ? landmarks[15] : landmarks[16],
      otherShoulder: useLeft ? landmarks[12] : landmarks[11],
      otherElbow: useLeft ? landmarks[14] : landmarks[13],
      otherWrist: useLeft ? landmarks[16] : landmarks[15],
    };
  }

  function detectPressSide(landmarks, state) {
    var leftShoulder = landmarks[11];
    var rightShoulder = landmarks[12];
    var leftElbow = landmarks[13];
    var rightElbow = landmarks[14];
    var leftWrist = landmarks[15];
    var rightWrist = landmarks[16];

    var vis = function(lm) { return lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD; };

    var leftValid = vis(leftShoulder) && vis(leftElbow) && vis(leftWrist);
    var rightValid = vis(rightShoulder) && vis(rightElbow) && vis(rightWrist);

    if (!leftValid && !rightValid) {
      state.trackingLossFrames++;
      return { valid: false };
    }

    state.trackingLossFrames = 0;

    if (state.lockedSide === null) {
      if (leftValid && rightValid) {
        var leftWristVis = leftWrist.visibility || 0;
        var rightWristVis = rightWrist.visibility || 0;
        state.lockedSide = leftWristVis > rightWristVis ? 'left' : 'right';
      } else {
        state.lockedSide = leftValid ? 'left' : 'right';
      }
    } else {
      var currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
      var otherValid = state.lockedSide === 'left' ? rightValid : leftValid;
      var currentWristVis = state.lockedSide === 'left' ? (leftWrist.visibility || 0) : (rightWrist.visibility || 0);
      var otherWristVis = state.lockedSide === 'left' ? (rightWrist.visibility || 0) : (leftWrist.visibility || 0);

      if (!currentValid && otherValid &&
          (otherWristVis - currentWristVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
          state.state === 'standing') {
        state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
      }
    }

    state.currentSide = state.lockedSide;
    return { valid: true, side: state.lockedSide };
  }

  function calibratePressBaseline(wristY, wristX, shoulderY, state, feedbackEl) {
    var shoulderWristDist = Math.abs(wristY - shoulderY);

    if (shoulderWristDist < 0.02 || shoulderWristDist > 0.4) {
      if (feedbackEl) feedbackEl.textContent = 'Position camera to see your full arm from the side';
      return true;
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = shoulderWristDist;
      state.standingHipX = wristX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      if (feedbackEl) feedbackEl.textContent = 'Hold lockout... 1/' + C.CALIBRATION_SAMPLES;
      return true;
    }

    var recentAvg = state.calibrationHipYValues.slice(-3).reduce(function(a, b) { return a + b; }, 0) /
                    Math.min(state.calibrationHipYValues.length, 3);
    var variation = Math.abs(wristY - recentAvg);
    var tolerance = shoulderWristDist * GEN_PR.CALIBRATION_TOLERANCE;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderWristDist * 0.2;
      if (feedbackEl) feedbackEl.textContent = 'Hold lockout... ' + state.calibrationHipYValues.length + '/' + C.CALIBRATION_SAMPLES;

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce(function(a, b) { return a + b; }, 0) / state.calibrationHipYValues.length;
        state.standingHipX = wristX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        var expectedInches = state.userHeightInches * GEN_PR.SHOULDER_WRIST_RATIO;
        state.inchesPerUnit = expectedInches / state.hipKneeDistance;
        state.isCalibrated = true;

        var estimatedArmInches = utils.normToInches(state.hipKneeDistance, state);
        var feet = Math.floor(state.userHeightInches / 12);
        var inches = state.userHeightInches % 12;

        if (feedbackEl) feedbackEl.textContent = 'Calibrated! H:' + feet + "'" + inches + '" Arm:' + estimatedArmInches.toFixed(1) + '"';

        setTimeout(function() {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = 'Ready to press!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = 'Hold still at lockout - restarting calibration';
    }

    return true;
  }

  // ========== EXERCISE MODULE ==========

  Chronicle.exercises['general-press'] = {
    key: 'general-press',
    name: 'General Press',
    sessionName: 'Press Session',
    readyMsg: 'Ready to press!',
    category: 'press',
    isSingleLeg: false,
    needsShoulder: false,
    needsWrist: true,
    referenceDepth: 10,

    hyperparams: GEN_PR,

    depthMarkers: [
      { inches: GEN_PR.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: GEN_PR.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: GEN_PR.DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= GEN_PR.DEPTH_MARKER_DEEP) return { emoji: '+++', label: 'Full ROM', color: '#00FF00' };
      if (depthInches >= GEN_PR.DEPTH_MARKER_PARALLEL) return { emoji: '++', label: 'Good', color: '#90EE90' };
      if (depthInches >= GEN_PR.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      var sideResult = detectPressSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = 'Lost tracking - resetting';
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      var press = getPressLandmarks(landmarks, state.lockedSide);
      var rawWristY = press.wrist.y;
      var rawWristX = press.wrist.x;
      var shoulderY = press.shoulder.y;

      var processed = utils.processHipPosition(rawWristY, rawWristX, state);
      if (processed.rejected && processed.hipY === null) return;
      var wristY = processed.hipY;
      var wristX = processed.hipX;

      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      if (!state.isCalibrated && state.state === 'standing') {
        if (calibratePressBaseline(wristY, wristX, shoulderY, state, ui.feedback)) return;
      }

      utils.trackVelocity(wristY, state);
      var avgVelocity = utils.getAvgVelocity(state);

      if (state.state === 'descending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = 'Descent too slow - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }
      if (state.state === 'ascending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = 'Press stalled - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      if (state.state === 'standing') {
        utils.handleStandingStability(wristY, wristX, state, ui.feedback, this.name);
      }

      if (state.state === 'descending' || state.state === 'ascending') {
        if (state.deepestHipY === null || wristY > state.deepestHipY) {
          state.deepestHipY = wristY;
        }
      }

      var currentDepthNorm = wristY - state.standingHipY;
      var currentDepthInches = utils.normToInches(currentDepthNorm, state);
      var maxDepthNorm = state.deepestHipY ? state.deepestHipY - state.standingHipY : 0;
      var maxDepthInches = utils.normToInches(maxDepthNorm, state);
      var descentThresholdNorm = utils.inchesToNorm(GEN_PR.DESCENT_THRESHOLD_INCHES, state);
      var hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      var elbowAngle = utils.calculateKneeAngle(
        press.shoulder.x, press.shoulder.y,
        press.elbow.x, press.elbow.y,
        press.wrist.x, press.wrist.y
      );

      state.debugInfo.elbowAngle = elbowAngle.toFixed(0);
      state.debugInfo.wristDepthInches = currentDepthInches.toFixed(1);

      switch (state.state) {
        case 'standing': {
          var hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          var isMovingDown = avgVelocity > GEN_PR.DESCENT_VELOCITY_MIN;
          var wellPastThreshold = currentDepthNorm > descentThresholdNorm * GEN_PR.DEPTH_TRIGGER_MULTIPLIER;
          var isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
            utils.updateState('descending', state, ui.status);
            state.deepestHipY = wristY;
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
          var descendQuality = this.getQuality(currentDepthInches);
          if (ui.feedback) ui.feedback.textContent = 'Down ' + currentDepthInches.toFixed(1) + '" ' + descendQuality.emoji + ' ' + descendQuality.label;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity < -C.VELOCITY_THRESHOLD) {
            if (maxDepthInches >= GEN_PR.MIN_DEPTH_INCHES) {
              utils.updateState('ascending', state, ui.status);
              state.ascentStartTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              var quality = this.getQuality(maxDepthInches);
              if (ui.feedback) ui.feedback.textContent = 'Press! ' + quality.emoji + ' ' + quality.label;
            } else {
              if (ui.feedback) ui.feedback.textContent = 'Too shallow! Need at least ' + GEN_PR.MIN_DEPTH_INCHES + '"';
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

          var recovered = Math.max(0, state.deepestHipY - wristY);
          var totalDepth = maxDepthNorm;
          var recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;

          if (recoveryPercent < GEN_PR.RECOVERY_WARNING_THRESHOLD) {
            if (ui.feedback) ui.feedback.textContent = 'Press! ' + recoveryPercent.toFixed(0) + '% lockout';
          } else if (recoveryPercent < GEN_PR.RECOVERY_PERCENT) {
            if (ui.feedback) ui.feedback.textContent = 'Almost locked out! ' + recoveryPercent.toFixed(0) + '%';
          }

          var isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
          var hasMinDepth = maxDepthInches >= GEN_PR.MIN_DEPTH_INCHES;

          if (recoveryPercent >= GEN_PR.RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
            var ascentTime = (performance.now() - state.ascentStartTime) / 1000;
            var speedScore = utils.calculateSpeedScore(ascentTime, maxDepthInches, this.referenceDepth);
            var repQuality = this.getQuality(maxDepthInches);

            state.repTimes.push(ascentTime);
            state.repDepths.push(maxDepthInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(ascentTime, maxDepthInches, speedScore, repQuality.label.toLowerCase());
            }

            if (ui.counter) ui.counter.textContent = 'Reps: ' + state.repCount;
            if (ui.feedback) ui.feedback.textContent = 'Rep ' + state.repCount + ': Speed ' + speedScore + ' ' + repQuality.emoji + ' ' + repQuality.label;

            this.displayRepTimes(state, ui.msg);
            utils.resetToStanding(state, ui.status);

            setTimeout(function() {
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

      var firstRepTime = state.repTimes[0];
      var firstRepDepth = state.repDepths[0];
      var refDepth = this.referenceDepth;
      var firstSpeedScore = utils.calculateSpeedScore(firstRepTime, firstRepDepth, refDepth);

      var html = '<div style="margin-bottom: 10px; font-weight: bold;">Speed Analysis</div>';

      var recentReps = state.repTimes.slice(-5);
      var recentDepths = state.repDepths.slice(-5);

      var self = this;
      recentReps.forEach(function(time, idx) {
        var actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        var depthInches = recentDepths[idx];
        var quality = self.getQuality(depthInches);
        var speedScore = utils.calculateSpeedScore(time, depthInches, refDepth);
        var scoreDrop = ((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1);
        var dropNum = parseFloat(scoreDrop);

        var color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += '<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">' +
          '<div style="font-size: 16px; margin-bottom: 4px;">' +
          'Rep ' + actualRepNum + ': Speed ' + speedScore + ' ' + quality.emoji + ' ' + quality.label +
          ' <span style="color: ' + color + '; margin-left: 10px; font-weight: bold;">' + (dropNum > 0 ? '-' : '+') + Math.abs(dropNum).toFixed(1) + '%</span>' +
          '</div></div>';
      });

      msgEl.innerHTML = html;
    },

    reset: function(state) {
      // No exercise-specific state beyond shared state
    },
  };

  console.log('General Press exercise module loaded');
})();
