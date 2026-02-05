// ========== Row Exercise Shared Utilities ==========
// Shared functions for all row exercise variations.
// Handles side detection, tracking point selection, elbow fallback,
// and calibration for row-category exercises.
//
// Each row variation module uses Chronicle.rowUtils instead of duplicating
// these functions. The calibrateRowBaseline function accepts a config object
// so each variation can set its own hinge angle, tolerance, and scaling.

(function() {
  const C = Chronicle.CONSTANTS;
  const utils = Chronicle.utils;

  Chronicle.rowUtils = {
    /**
     * Check if a landmark is visible above threshold
     */
    isVisible: function(lm) {
      return lm && (lm.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    },

    /**
     * Get the active wrist, elbow, shoulder, and hip landmarks for the tracked side
     */
    getRowLandmarks: function(landmarks, side) {
      const useLeft = (side === 'left');
      return {
        shoulder: useLeft ? landmarks[11] : landmarks[12],
        elbow: useLeft ? landmarks[13] : landmarks[14],
        wrist: useLeft ? landmarks[15] : landmarks[16],
        hip: useLeft ? landmarks[23] : landmarks[24],
        otherShoulder: useLeft ? landmarks[12] : landmarks[11],
        otherElbow: useLeft ? landmarks[14] : landmarks[13],
        otherWrist: useLeft ? landmarks[16] : landmarks[15],
        otherHip: useLeft ? landmarks[24] : landmarks[23],
      };
    },

    /**
     * Select the best available tracking point (wrist preferred, elbow fallback).
     * Returns { y, x, point: 'wrist'|'elbow' } or null if neither is visible.
     */
    selectTrackingPoint: function(row) {
      if (this.isVisible(row.wrist)) {
        return { y: row.wrist.y, x: row.wrist.x, point: 'wrist' };
      }
      if (this.isVisible(row.elbow)) {
        return { y: row.elbow.y, x: row.elbow.x, point: 'elbow' };
      }
      return null;
    },

    /**
     * Convert a raw tracking Y to the calibrated coordinate space.
     * If the current tracking point differs from the calibration point,
     * applies the stored offset to produce consistent values.
     */
    adjustTrackingY: function(rawY, currentPoint, state) {
      if (!state.rowCalibPoint || currentPoint === state.rowCalibPoint) {
        return rawY;
      }
      if (state.rowWristElbowOffset !== null) {
        if (state.rowCalibPoint === 'wrist' && currentPoint === 'elbow') {
          return rawY + state.rowWristElbowOffset;
        } else if (state.rowCalibPoint === 'elbow' && currentPoint === 'wrist') {
          return rawY - state.rowWristElbowOffset;
        }
      }
      return rawY;
    },

    /**
     * Detect which side has better shoulder + hip + (wrist OR elbow) visibility.
     * Accepts elbow as a fallback when wrist is occluded by plates.
     */
    detectRowSide: function(landmarks, state) {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftElbow = landmarks[13];
      const rightElbow = landmarks[14];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];

      const leftTrackOk = this.isVisible(leftWrist) || this.isVisible(leftElbow);
      const rightTrackOk = this.isVisible(rightWrist) || this.isVisible(rightElbow);
      const leftValid = this.isVisible(leftShoulder) && leftTrackOk && this.isVisible(leftHip);
      const rightValid = this.isVisible(rightShoulder) && rightTrackOk && this.isVisible(rightHip);

      if (!leftValid && !rightValid) {
        state.trackingLossFrames++;
        return { valid: false };
      }

      state.trackingLossFrames = 0;

      if (state.lockedSide === null) {
        if (leftValid && rightValid) {
          const leftBestVis = Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0);
          const rightBestVis = Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0);
          state.lockedSide = leftBestVis > rightBestVis ? 'left' : 'right';
        } else {
          state.lockedSide = leftValid ? 'left' : 'right';
        }
      } else {
        const currentValid = state.lockedSide === 'left' ? leftValid : rightValid;
        const otherValid = state.lockedSide === 'left' ? rightValid : leftValid;
        const currentBestVis = state.lockedSide === 'left'
          ? Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0)
          : Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0);
        const otherBestVis = state.lockedSide === 'left'
          ? Math.max(rightWrist.visibility || 0, rightElbow.visibility || 0)
          : Math.max(leftWrist.visibility || 0, leftElbow.visibility || 0);

        if (!currentValid && otherValid &&
            (otherBestVis - currentBestVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
            state.state === 'standing') {
          state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
        }
      }

      state.currentSide = state.lockedSide;
      return { valid: true, side: state.lockedSide };
    },

    /**
     * Calibrate tracking point position at resting position.
     * Requires sufficient torso hinge angle before accepting calibration (configurable).
     * Uses shoulder-to-tracking-point distance for inches-per-unit scaling.
     *
     * @param {number} trackY - Current tracking point Y (normalized)
     * @param {number} trackX - Current tracking point X (normalized)
     * @param {string} trackPoint - 'wrist' or 'elbow'
     * @param {object} row - Landmark object from getRowLandmarks
     * @param {object} state - Tracking state
     * @param {HTMLElement} feedbackEl - Feedback display element
     * @param {object} config - Exercise-specific settings:
     *   setupMinAngle: minimum torso hinge angle (0 to skip check)
     *   shoulderWristRatio: scaling factor (default 0.37)
     *   calibrationTolerance: stillness tolerance (default 0.15)
     *   elbowCalDistMin: min shoulder-elbow distance (default 0.01)
     *   elbowCalDistMax: max shoulder-elbow distance (default 0.28)
     *   readyMsg: message after calibration completes
     */
    calibrateRowBaseline: function(trackY, trackX, trackPoint, row, state, feedbackEl, config) {
      const shoulderY = row.shoulder.y;
      const shoulderX = row.shoulder.x;
      const hipY = row.hip.y;
      const hipX = row.hip.x;

      const setupMinAngle = config.setupMinAngle || 0;
      const shoulderWristRatio = config.shoulderWristRatio || 0.37;
      const calibTolerance = config.calibrationTolerance || 0.15;
      const elbowDistMin = config.elbowCalDistMin || 0.01;
      const elbowDistMax = config.elbowCalDistMax || 0.28;
      const readyMsg = config.readyMsg || 'Ready to row!';

      // Calculate torso angle to verify athlete position
      const torsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY);

      // Check minimum hinge angle (skip if setupMinAngle is 0)
      if (setupMinAngle > 0 && torsoAngle < setupMinAngle) {
        if (feedbackEl) feedbackEl.textContent = 'Bend over more - ' + torsoAngle.toFixed(0) + '\u00B0 (need ' + setupMinAngle + '\u00B0)';
        return true;
      }

      const shoulderTrackDist = Math.abs(trackY - shoulderY);

      // Sanity check: distance should be reasonable for the tracking point
      const distMin = trackPoint === 'elbow' ? elbowDistMin : 0.02;
      const distMax = trackPoint === 'elbow' ? elbowDistMax : 0.4;
      if (shoulderTrackDist < distMin || shoulderTrackDist > distMax) {
        const hint = trackPoint === 'elbow'
          ? 'Position camera to see shoulder, hip, and elbow from the side'
          : 'Position camera to see shoulder, hip, and wrist from the side';
        if (feedbackEl) feedbackEl.textContent = hint;
        return true;
      }

      if (state.calibrationHipYValues.length === 0) {
        state.calibrationHipYValues.push(trackY);
        state.hipKneeDistance = shoulderTrackDist;
        state.standingHipX = trackX;
        state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
        state.standingTorsoAngle = torsoAngle;
        state.rowCalibPoint = trackPoint;
        if (feedbackEl) {
          const label = trackPoint === 'elbow' ? 'Hold position (elbow tracking)... ' : 'Hold position... ';
          feedbackEl.textContent = label + '1/' + C.CALIBRATION_SAMPLES;
        }
        return true;
      }

      const recentAvg = state.calibrationHipYValues.slice(-3).reduce(function(a, b) { return a + b; }, 0) /
                        Math.min(state.calibrationHipYValues.length, 3);
      const variation = Math.abs(trackY - recentAvg);
      const tolerance = shoulderTrackDist * calibTolerance;

      if (variation < tolerance) {
        state.calibrationHipYValues.push(trackY);
        state.hipKneeDistance = state.hipKneeDistance * 0.8 + shoulderTrackDist * 0.2;
        state.standingTorsoAngle = state.standingTorsoAngle * 0.8 + torsoAngle * 0.2;
        if (feedbackEl) {
          const label = trackPoint === 'elbow' ? 'Hold position (elbow tracking)... ' : 'Hold position... ';
          feedbackEl.textContent = label + state.calibrationHipYValues.length + '/' + C.CALIBRATION_SAMPLES;
        }

        if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
          state.standingHipY = state.calibrationHipYValues.reduce(function(a, b) { return a + b; }, 0) / state.calibrationHipYValues.length;
          state.standingHipX = trackX;
          state.stableFrameCount = C.STABILITY_FRAMES;
          state.stableStandingStartTime = performance.now();
          state.calibrationCompletedTime = performance.now();

          // Scale: use shoulderWristRatio regardless of tracking point.
          // For elbow: the shorter distance produces a larger inchesPerUnit.
          const expectedInches = state.userHeightInches * shoulderWristRatio;
          state.inchesPerUnit = expectedInches / state.hipKneeDistance;
          state.isCalibrated = true;
          state.rowCalibPoint = trackPoint;

          // Record offset between wrist and elbow if both are visible
          if (this.isVisible(row.wrist) && this.isVisible(row.elbow)) {
            state.rowWristElbowOffset = row.wrist.y - row.elbow.y;
          }

          const estimatedInches = utils.normToInches(state.hipKneeDistance, state);
          const feet = Math.floor(state.userHeightInches / 12);
          const inches = state.userHeightInches % 12;
          const trackLabel = trackPoint === 'elbow' ? ' (elbow)' : '';

          if (feedbackEl) feedbackEl.textContent = 'Calibrated' + trackLabel + '! H:' + feet + "'" + inches + '" Arm:' + estimatedInches.toFixed(1) + '"';

          setTimeout(function() {
            if (state.state === 'standing' && feedbackEl) {
              feedbackEl.textContent = readyMsg;
            }
          }, 2000);
        }
      } else {
        state.calibrationHipYValues = [];
        if (feedbackEl) feedbackEl.textContent = 'Hold still in position - restarting calibration';
      }

      return true;
    },

    /**
     * Shared row detection loop. Called by each row variation's detect() method.
     * Handles side detection, tracking point selection, calibration, velocity,
     * torso angle monitoring, and the row state machine.
     *
     * @param {object} landmarks - MediaPipe pose landmarks
     * @param {object} state - Tracking state
     * @param {object} ui - UI elements { feedback, status, counter, msg, onRepComplete }
     * @param {object} exercise - The exercise module (for getQuality, referenceDepth, etc.)
     * @param {object} hyper - Exercise-specific hyperparameters
     * @param {object} calConfig - Calibration config passed to calibrateRowBaseline
     */
    detectRow: function(landmarks, state, ui, exercise, hyper, calConfig) {
      var rowUtils = this;

      // Side detection
      var sideResult = this.detectRowSide(landmarks, state);
      if (!sideResult.valid) {
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = 'Lost tracking - resetting';
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      var row = this.getRowLandmarks(landmarks, state.lockedSide);
      var shoulderY = row.shoulder.y;
      var shoulderX = row.shoulder.x;
      var hipY = row.hip.y;
      var hipX = row.hip.x;

      // Select best tracking point
      var tracking = this.selectTrackingPoint(row);
      if (!tracking) {
        state.trackingLossFrames++;
        if (state.state !== 'standing' && state.trackingLossFrames > C.TRACKING_LOSS_TOLERANCE_FRAMES) {
          if (ui.feedback) ui.feedback.textContent = 'Lost arm tracking - resetting';
          utils.resetToStanding(state, ui.status);
        }
        return;
      }

      state.rowTrackingPoint = tracking.point;

      // Adjust tracking Y for elbow/wrist switching
      var rawTrackY = this.adjustTrackingY(tracking.y, tracking.point, state);
      var rawTrackX = tracking.x;

      // Smooth position
      var processed = utils.processHipPosition(rawTrackY, rawTrackX, state);
      if (processed.rejected && processed.hipY === null) return;
      var trackY = processed.hipY;
      var trackX = processed.hipX;

      // Auto-recalibration check
      if (utils.checkAutoRecalibration(state, ui.feedback)) {
        state.rowCalibPoint = null;
        state.rowWristElbowOffset = null;
        return;
      }

      // Calibration
      if (!state.isCalibrated && state.state === 'standing') {
        if (this.calibrateRowBaseline(trackY, trackX, tracking.point, row, state, ui.feedback, calConfig)) return;
      }

      // Record offset if both points become visible after calibration
      if (state.isCalibrated && state.rowWristElbowOffset === null &&
          this.isVisible(row.wrist) && this.isVisible(row.elbow)) {
        state.rowWristElbowOffset = row.wrist.y - row.elbow.y;
      }

      // Velocity tracking
      utils.trackVelocity(trackY, state);
      var avgVelocity = utils.getAvgVelocity(state);

      // Track torso angle for cheat detection
      var currentTorsoAngle = utils.calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY);
      if (state.dlSmoothedAngle === null) {
        state.dlSmoothedAngle = currentTorsoAngle;
      } else {
        state.dlSmoothedAngle = state.dlSmoothedAngle * 0.6 + currentTorsoAngle * 0.4;
      }
      var smoothedTorsoAngle = state.dlSmoothedAngle;

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
        utils.handleStandingStability(trackY, trackX, state, ui.feedback, exercise.name);
      }

      // Track peak pull height (lowest Y = highest physical pull)
      if (state.state === 'ascending' || state.state === 'descending') {
        if (state.deepestHipY === null || trackY < state.deepestHipY) {
          state.deepestHipY = trackY;
        }
      }

      // Pull height calculations
      var currentPullNorm = state.standingHipY - trackY;
      var currentPullInches = utils.normToInches(currentPullNorm, state);
      var maxPullNorm = state.deepestHipY !== null ? state.standingHipY - state.deepestHipY : 0;
      var maxPullInches = utils.normToInches(maxPullNorm, state);
      var pullThresholdNorm = utils.inchesToNorm(hyper.PULL_THRESHOLD_INCHES, state);
      var hysteresisNorm = utils.inchesToNorm(C.HYSTERESIS_INCHES, state);

      // Cheat detection
      var torsoAngleChange = state.standingTorsoAngle !== null ?
        Math.abs(smoothedTorsoAngle - state.standingTorsoAngle) : 0;
      var isCheating = torsoAngleChange > hyper.CHEAT_ANGLE_THRESHOLD;

      // Debug info
      state.debugInfo.pullInches = currentPullInches.toFixed(1);
      state.debugInfo.torsoAngle = smoothedTorsoAngle.toFixed(1);
      state.debugInfo.torsoChange = torsoAngleChange.toFixed(1);
      state.debugInfo.rowState = state.state;
      state.debugInfo.cheating = isCheating ? 'YES' : 'no';
      state.debugInfo.rowTrackPt = tracking.point;

      // State machine
      switch (state.state) {
        case 'standing': {
          var hasBeenStable = state.stableStandingStartTime &&
            (performance.now() - state.stableStandingStartTime) >= C.MIN_STANDING_TIME_MS;

          var isMovingUp = avgVelocity < -(hyper.PULL_VELOCITY_MIN || 0.0010);
          var depthTrigger = hyper.DEPTH_TRIGGER_MULTIPLIER || 1.5;
          var wellPastThreshold = currentPullNorm > pullThresholdNorm * depthTrigger;
          var isPastThreshold = currentPullNorm > pullThresholdNorm + hysteresisNorm;

          if (isPastThreshold && hasBeenStable && (isMovingUp || wellPastThreshold)) {
            utils.updateState('ascending', state, ui.status);
            state.deepestHipY = trackY;
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
          var pullQuality = exercise.getQuality(currentPullInches);
          var cheatMsg = isCheating ? ' \u26A0 body english!' : '';
          if (ui.feedback) ui.feedback.textContent = 'Pull ' + currentPullInches.toFixed(1) + '" ' + pullQuality.emoji + ' ' + pullQuality.label + cheatMsg;

          if (state.velocityHistory.length >= C.VELOCITY_WINDOW && avgVelocity > C.VELOCITY_THRESHOLD) {
            if (maxPullInches >= hyper.MIN_PULL_INCHES) {
              utils.updateState('descending', state, ui.status);
              state.pullEndTime = performance.now();
              state.velocityHistory = [];
              state.smoothedVelocity = 0;

              var quality = exercise.getQuality(maxPullInches);
              var cheatLabel = isCheating ? ' \u26A0 Cheat' : '';
              if (ui.feedback) ui.feedback.textContent = 'Lowering... ' + quality.emoji + ' ' + quality.label + cheatLabel;
            } else {
              if (ui.feedback) ui.feedback.textContent = 'Too shallow! Need at least ' + hyper.MIN_PULL_INCHES + '"';
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

          var recovered = Math.max(0, trackY - state.deepestHipY);
          var totalPull = maxPullNorm;
          var recoveryPercent = totalPull > 0 ? (recovered / totalPull) * 100 : 0;
          var recoveryWarning = hyper.RECOVERY_WARNING_THRESHOLD || 50;
          var recoveryTarget = hyper.RECOVERY_PERCENT || 80;

          if (recoveryPercent < recoveryWarning) {
            if (ui.feedback) ui.feedback.textContent = 'Lowering... ' + recoveryPercent.toFixed(0) + '% return';
          } else if (recoveryPercent < recoveryTarget) {
            if (ui.feedback) ui.feedback.textContent = 'Almost there! ' + recoveryPercent.toFixed(0) + '% return';
          }

          var isNearBaseline = currentPullNorm < pullThresholdNorm - hysteresisNorm;
          var hasMinPull = maxPullInches >= hyper.MIN_PULL_INCHES;

          if (recoveryPercent >= recoveryTarget && isNearBaseline && hasMinPull) {
            var pullTime = (state.pullEndTime - state.ascentStartTime) / 1000;
            var speedScore = utils.calculateSpeedScore(pullTime, maxPullInches, exercise.referenceDepth);
            var repQuality = exercise.getQuality(maxPullInches);

            state.repTimes.push(pullTime);
            state.repDepths.push(maxPullInches);
            state.repCount++;

            if (ui.onRepComplete) {
              ui.onRepComplete(pullTime, maxPullInches, speedScore, repQuality.label.toLowerCase());
            }

            var repCheatLabel = isCheating ? ' \u26A0 Cheat' : '';
            if (ui.counter) ui.counter.textContent = 'Reps: ' + state.repCount;
            if (ui.feedback) ui.feedback.textContent = 'Rep ' + state.repCount + ': Speed ' + speedScore + ' ' + repQuality.emoji + ' ' + repQuality.label + repCheatLabel;

            exercise.displayRepTimes(state, ui.msg);
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

    /**
     * Shared row rep times display function.
     * @param {object} state - Tracking state
     * @param {HTMLElement} msgEl - Message display element
     * @param {string} title - Display title (e.g., "Barbell Row Speed Analysis")
     * @param {function} getQuality - Quality function from exercise module
     * @param {number} referenceDepth - Reference depth for speed normalization
     */
    displayRowRepTimes: function(state, msgEl, title, getQuality, referenceDepth) {
      if (!msgEl || state.repTimes.length === 0) return;

      var firstRepTime = state.repTimes[0];
      var firstRepDepth = state.repDepths[0];
      var firstSpeedScore = utils.calculateSpeedScore(firstRepTime, firstRepDepth, referenceDepth);

      var html = '<div style="margin-bottom: 10px; font-weight: bold;">' + title + '</div>';

      var recentReps = state.repTimes.slice(-5);
      var recentDepths = state.repDepths.slice(-5);

      recentReps.forEach(function(time, idx) {
        var actualRepNum = state.repTimes.length - recentReps.length + idx + 1;
        var depthInches = recentDepths[idx];
        var quality = getQuality(depthInches);
        var speedScore = utils.calculateSpeedScore(time, depthInches, referenceDepth);
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

    /**
     * Shared reset function for row exercises
     */
    resetRowState: function(state) {
      state.standingTorsoAngle = null;
      state.dlSmoothedAngle = null;
      state.pullEndTime = null;
      state.rowTrackingPoint = null;
      state.rowCalibPoint = null;
      state.rowWristElbowOffset = null;
    },
  };

  console.log('Row shared utilities loaded');
})();
