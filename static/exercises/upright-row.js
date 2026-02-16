// ========== Upright Row / High Pull Exercise Module ==========
// Tracks wrist Y position as the bar/dumbbell is pulled from hip level to chin/chest height.
// Calibrates in standing position with arms hanging down.
// Uses wrist tracking for pull height measurement.
//
// State machine: standing (arms at sides) -> ascending (pulling up) -> descending (lowering) -> rep counted.
// Camera should be positioned from the side so shoulder, elbow, and wrist are visible.
// Unlike bent-over rows, athlete stays upright - no torso hinge required.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  var UR = {
    MIN_PULL_INCHES: 4,            // Minimum wrist travel upward for valid rep
    PULL_THRESHOLD_INCHES: 2.5,    // Wrist rise to trigger pulling state
    RECOVERY_PERCENT: 80,          // % recovery (bar lowered back) to count rep
    PULL_VELOCITY_MIN: 0.0010,     // Minimum upward velocity for pull detection
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Pull height quality thresholds (wrist travel upward in inches)
    DEPTH_MARKER_LOW: 4,           // Below chest - low pull
    DEPTH_MARKER_CHEST: 7,         // Chest height
    DEPTH_MARKER_CHIN: 10,         // Chin height - full upright row

    // Calibration
    SHOULDER_WRIST_RATIO: 0.37,    // Scaling factor
    CALIBRATION_TOLERANCE: 0.15,

    // Posture monitoring
    MAX_TORSO_LEAN: 15,            // Degrees of torso lean = cheating
  };

  /**
   * Detect which side has better wrist/elbow/shoulder visibility.
   */
  function detectURSide(landmarks, state) {
    var leftShoulder = landmarks[11];
    var rightShoulder = landmarks[12];
    var leftElbow = landmarks[13];
    var rightElbow = landmarks[14];
    var leftWrist = landmarks[15];
    var rightWrist = landmarks[16];

    var vis = function(lm) { return lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD; };

    var leftValid = vis(leftShoulder) && vis(leftWrist);
    var rightValid = vis(rightShoulder) && vis(rightWrist);

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

  /**
   * Get the active landmarks for the tracked side.
   */
  function getURLandmarks(landmarks, side) {
    var useLeft = (side === 'left');
    return {
      shoulder: useLeft ? landmarks[11] : landmarks[12],
      elbow: useLeft ? landmarks[13] : landmarks[14],
      wrist: useLeft ? landmarks[15] : landmarks[16],
      hip: useLeft ? landmarks[23] : landmarks[24],
    };
  }

  /**
   * Calibrate wrist resting position (arms hanging at sides).
   * Uses shoulder-to-wrist distance for inches-per-unit scaling.
   */
  function calibrateURBaseline(wristY, wristX, shoulderY, state, feedbackEl) {
    var shoulderWristDist = Math.abs(wristY - shoulderY);

    // Sanity check: wrist should be below shoulder when arms are at sides
    if (wristY < shoulderY) {
      if (feedbackEl) feedbackEl.textContent = "Let arms hang at your sides - wrist should be below shoulder";
      return true;
    }

    if (shoulderWristDist < 0.03 || shoulderWristDist > 0.45) {
      if (feedbackEl) feedbackEl.textContent = "Stand with arms at sides - camera needs to see your full arm";
      return true;
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = shoulderWristDist;
      state.standingHipX = wristX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      if (feedbackEl) feedbackEl.textContent = "Hold still with arms at sides... 1/" + C.CALIBRATION_SAMPLES;
      return true;
    }

    var recentAvg = state.calibrationHipYValues.slice(-3).reduce(function(a, b) { return a + b; }, 0) /
                    Math.min(state.calibrationHipYValues.length, 3);
    var variation = Math.abs(wristY - recentAvg);
    var tolerance = shoulderWristDist * UR.CALIBRATION_TOLERANCE;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(wristY);
      state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderWristDist * 0.2;
      if (feedbackEl) feedbackEl.textContent = "Hold still... " + state.calibrationHipYValues.length + "/" + C.CALIBRATION_SAMPLES;

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce(function(a, b) { return a + b; }, 0) / state.calibrationHipYValues.length;
        state.standingHipX = wristX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        var expectedInches = state.userHeightInches * UR.SHOULDER_WRIST_RATIO;
        state.inchesPerUnit = expectedInches / state.hipKneeDistance;
        state.isCalibrated = true;

        var estimatedInches = utils.normToInches(state.hipKneeDistance, state);
        var feet = Math.floor(state.userHeightInches / 12);
        var inches = state.userHeightInches % 12;

        if (feedbackEl) feedbackEl.textContent = "Calibrated! H:" + feet + "'" + inches + '" Arm:' + estimatedInches.toFixed(1) + '"';

        setTimeout(function() {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = 'Ready to pull!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = "Hold still with arms at sides - restarting calibration";
    }

    return true;
  }

  Chronicle.exercises['upright-row'] = {
    key: 'upright-row',
    name: 'Upright Row / High Pull',
    sessionName: 'Upright Row Session',
    readyMsg: 'Ready to pull!',
    category: 'pull',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: false,
    invertDepthMarkers: true,  // Pull goes up
    referenceDepth: 10,

    hyperparams: UR,

    depthMarkers: [
      { inches: UR.DEPTH_MARKER_LOW, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: UR.DEPTH_MARKER_CHEST, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: UR.DEPTH_MARKER_CHIN, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder + Wrist (side view, stand upright)',

    getQuality: function(pullInches) {
      if (pullInches >= UR.DEPTH_MARKER_CHIN) return { emoji: '+++', label: 'Chin', color: '#00FF00' };
      if (pullInches >= UR.DEPTH_MARKER_CHEST) return { emoji: '++', label: 'Chest', color: '#90EE90' };
      if (pullInches >= UR.DEPTH_MARKER_LOW) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      // Side detection
      var sideResult = detectURSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = "Lost tracking - resetting";
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      var ur = getURLandmarks(landmarks, state.lockedSide);
      var rawWristY = ur.wrist.y;
      var rawWristX = ur.wrist.x;
      var shoulderY = ur.shoulder.y;
      var shoulderX = ur.shoulder.x;

      // Process wrist position
      var processed = utils.processHipPosition(rawWristY, rawWristX, state);
      if (processed.rejected && processed.hipY === null) return;
      var wristY = processed.hipY;
      var wristX = processed.hipX;

      // Auto-recalibration
      if (utils.checkAutoRecalibration(state, ui.feedback)) return;

      // Calibration at resting position (arms at sides)
      if (!state.isCalibrated && state.state === 'standing') {
        if (calibrateURBaseline(wristY, wristX, shoulderY, state, ui.feedback)) return;
      }

      // Velocity tracking
      utils.trackVelocity(wristY, state);
      var avgVelocity = utils.getAvgVelocity(state);

      // Track torso angle for posture monitoring
      if (ur.hip) {
        var currentTorsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, ur.hip.x, ur.hip.y);
        if (state.dlSmoothedAngle === null) {
          state.dlSmoothedAngle = currentTorsoAngle;
          state.standingTorsoAngle = currentTorsoAngle;
        } else {
          state.dlSmoothedAngle = state.dlSmoothedAngle * 0.6 + currentTorsoAngle * 0.4;
        }
      }

      var torsoLean = state.standingTorsoAngle !== null && state.dlSmoothedAngle !== null ?
        Math.abs(state.dlSmoothedAngle - state.standingTorsoAngle) : 0;
      var isLeaning = torsoLean > UR.MAX_TORSO_LEAN;

      // State timeouts
      if (state.state === 'ascending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_ASCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = 'Pull timed out - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }
      if (state.state === 'descending' && state.stateStartTime) {
        if (performance.now() - state.stateStartTime > C.MAX_DESCENT_TIME_MS) {
          if (ui.feedback) ui.feedback.textContent = 'Lowering timed out - resetting';
          utils.resetToStanding(state, ui.status);
          return;
        }
      }

      // Standing stability
      if (state.state === 'standing') {
        utils.handleStandingStability(wristY, wristX, state, ui.feedback, this.name);
      }

      // Track peak pull height (lowest Y = highest physical position)
      if (state.state === 'ascending' || state.state === 'descending') {
        if (state.deepestHipY === null || wristY < state.deepestHipY) {
          state.deepestHipY = wristY;
        }
      }

      // Pull height calculations (wrist moves up from hanging position)
      var currentPullNorm = state.standingHipY - wristY;
      var currentPullInches = utils.normToInches(currentPullNorm, state);
      var maxPullNorm = state.deepestHipY !== null ? state.standingHipY - state.deepestHipY : 0;
      var maxPullInches = utils.normToInches(maxPullNorm, state);
      var pullThresholdNorm = utils.inchesToNorm(UR.PULL_THRESHOLD_INCHES, state);
      var hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Debug info
      state.debugInfo.pullInches = currentPullInches.toFixed(1);
      state.debugInfo.torsoLean = torsoLean.toFixed(1);
      state.debugInfo.rowState = state.state;
      state.debugInfo.leaning = isLeaning ? 'YES' : 'no';

      // State machine
      switch (state.state) {
        case 'standing': {
          var hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          var isMovingUp = avgVelocity < -(UR.PULL_VELOCITY_MIN || 0.0010);
          var depthTrigger = UR.DEPTH_TRIGGER_MULTIPLIER || 1.5;
          var wellPastThreshold = currentPullNorm > pullThresholdNorm * depthTrigger;
          var isPastThreshold = currentPullNorm > pullThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingUp || wellPastThreshold)) {
            utils.updateState('ascending', state, ui.status);
            state.deepestHipY = wristY;
            state.ascentStartTime = performance.now();
            state.velocityHistory = [];
            state.smoothedVelocity = 0;
            state.stableStandingStartTime = null;
            state.rebaselineStabilityCount = 0;
            state.potentialNewBaseline = null;
            state.lastSquatStartTime = performance.now();

            if (ui.feedback) ui.feedback.textContent = 'Pulling...';
          }
          break;
        }

        case 'ascending': {
          var pullQuality = this.getQuality(currentPullInches);
          var leanMsg = isLeaning ? ' - stay upright!' : '';
          if (ui.feedback) ui.feedback.textContent = 'Pull ' + pullQuality.emoji + leanMsg;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity > C.VELOCITY_THRESHOLD) {
            if (maxPullInches >= UR.MIN_PULL_INCHES * Chronicle.settings.sensitivityMultiplier()) {
              utils.updateState('descending', state, ui.status);
              state.pullEndTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              var quality = this.getQuality(maxPullInches);
              var leanLabel = isLeaning ? ' - lean!' : '';
              if (ui.feedback) ui.feedback.textContent = 'Lowering... ' + quality.emoji + leanLabel;
            } else {
              if (ui.feedback) ui.feedback.textContent = 'Too shallow!';
              utils.resetToStanding(state, ui.status);
            }
          }
          break;
        }

        case 'descending': {
          if (state.deepestHipY === null || state.standingHipY === null) {
            utils.resetToStanding(state, ui.status);
            break;
          }

          var recovered = Math.max(0, wristY - state.deepestHipY);
          var totalPull = maxPullNorm;
          var recoveryPercent = totalPull > 0 ? (recovered / totalPull) * 100 : 0;
          var recoveryWarning = UR.RECOVERY_WARNING_THRESHOLD || 50;
          var recoveryTarget = UR.RECOVERY_PERCENT || 80;

          if (recoveryPercent < recoveryWarning) {
            if (ui.feedback) ui.feedback.textContent = 'Lowering... ' + recoveryPercent.toFixed(0) + '% return';
          } else if (recoveryPercent < recoveryTarget) {
            if (ui.feedback) ui.feedback.textContent = 'Almost there! ' + recoveryPercent.toFixed(0) + '% return';
          }

          var isNearBaseline = currentPullNorm < pullThresholdNorm - hysteresisNorm;
          var hasMinPull = maxPullInches >= UR.MIN_PULL_INCHES * Chronicle.settings.sensitivityMultiplier();

          if (recoveryPercent >= recoveryTarget && isNearBaseline && hasMinPull) {
            var pullTime = (state.pullEndTime - state.ascentStartTime) / 1000;
            var speedScore = utils.calculateSpeedScore(pullTime, maxPullInches, this.referenceDepth);
            var repQuality = this.getQuality(maxPullInches);

            state.repTimes.push(pullTime);
            state.repDepths.push(maxPullInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(pullTime, maxPullInches, speedScore, repQuality.label.toLowerCase());
            }

            var repLeanLabel = isLeaning ? ' - lean' : '';
            if (ui.counter) ui.counter.textContent = 'Reps: ' + state.repCount;
            if (ui.feedback) ui.feedback.textContent = 'Rep ' + state.repCount + ': Speed ' + speedScore + ' ' + repQuality.emoji + repLeanLabel;

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

      var html = '<div style="margin-bottom: 10px; font-weight: bold;">Upright Row Speed Analysis</div>';

      var recentReps = state.repTimes.slice(-5);
      var recentDepths = state.repDepths.slice(-5);

      recentReps.forEach(function(time, idx) {
        var actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        var depthInches = recentDepths[idx];
        var quality = Chronicle.exercises['upright-row'].getQuality(depthInches);
        var speedScore = utils.calculateSpeedScore(time, depthInches, refDepth);
        var scoreDrop = ((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1);
        var dropNum = parseFloat(scoreDrop);

        var color = '#00FF00';
        if (dropNum > C.VELOCITY_DROP_CRITICAL) color = '#FF4444';
        else if (dropNum > C.VELOCITY_DROP_WARNING) color = '#FFA500';

        html += '<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">' +
          '<div style="font-size: 16px; margin-bottom: 4px;">' +
          'Rep ' + actualRepNum + ': Speed ' + speedScore + ' ' + quality.emoji +
          ' <span style="color: ' + color + '; margin-left: 10px; font-weight: bold;">' + (dropNum > 0 ? '-' : '+') + Math.abs(dropNum).toFixed(1) + '%</span>' +
          '</div></div>';
      });

      msgEl.innerHTML = html;
    },

    reset: function(state) {
      state.dlSmoothedAngle = null;
      state.standingTorsoAngle = null;
      state.pullEndTime = null;
    },
  };

  console.log('Upright Row / High Pull exercise module loaded');
})();
