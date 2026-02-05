// ========== Chronicle Exercise Base Module ==========
// Shared utilities, state management, calibration, smoothing, and side detection
// All exercise modules build on this foundation.

window.Chronicle = window.Chronicle || {};
Chronicle.exercises = {};

// ========== SHARED CONSTANTS ==========
Chronicle.CONSTANTS = {
  // Calibration
  CALIBRATION_SAMPLES: 5,
  CALIBRATION_TOLERANCE_MULTIPLIER: 0.12,
  BASELINE_UPDATE_ALPHA: 0.2,
  RECALIBRATION_TIMEOUT_MS: 8000,

  // Landmark detection
  LANDMARK_VISIBILITY_THRESHOLD: 0.4,
  SIDE_LOCK_CONFIDENCE_THRESHOLD: 0.15,
  HIP_KNEE_RATIO: 0.24,
  TRACKING_LOSS_TOLERANCE_FRAMES: 30,

  // Position smoothing
  POSITION_SMOOTHING_ALPHA: 0.5,
  OUTLIER_THRESHOLD_MULTIPLIER: 6.0,
  MIN_FRAMES_FOR_OUTLIER_DETECTION: 10,
  VELOCITY_EMA_ALPHA: 0.4,
  VELOCITY_WINDOW: 4,

  // State timeouts
  MAX_DESCENT_TIME_MS: 6000,
  MAX_ASCENT_TIME_MS: 6000,
  MAX_STATE_TIME: 10000,

  // Depth quality & speed score normalization
  SPEED_SCORE_MULTIPLIER: 1000,
  STANDARD_REFERENCE_DEPTH: 15,    // Back squat parallel depth (inches) - normalization baseline
  VELOCITY_DROP_WARNING: 10,
  VELOCITY_DROP_CRITICAL: 20,

  // Standing / drift
  HORIZONTAL_MOVEMENT_THRESHOLD: 0.08,
  BASELINE_TOLERANCE_INCHES: 5,
  DRIFT_WARNING_THRESHOLD: 3,
  DRIFT_CRITICAL_THRESHOLD: 6,
  REBASELINE_STABILITY_FRAMES: 10,
  STABILITY_FRAMES: 6,
  MIN_STANDING_TIME_MS: 800,
  VELOCITY_THRESHOLD: 0.001,
  HYSTERESIS_INCHES: 0.5,
};

// ========== SHARED STATE ==========
// Central state object passed to exercise detection functions
Chronicle.createState = function() {
  return {
    // Core state machine
    state: 'standing',
    stateStartTime: null,
    repCount: 0,

    // Calibration
    isCalibrated: false,
    calibrationHipYValues: [],
    standingHipY: null,
    standingHipX: null,
    hipKneeDistance: null,
    inchesPerUnit: null,
    userHeightInches: null,

    // Side detection
    lockedSide: null,
    currentSide: 'left',

    // Position tracking
    smoothedHipY: null,
    smoothedHipX: null,
    positionHistory: [],
    typicalMovementMagnitude: 0.005,
    prevHipY: null,
    deepestHipY: null,

    // Velocity
    velocityHistory: [],
    smoothedVelocity: 0,

    // Stability
    stableFrameCount: 0,
    stableStandingStartTime: null,
    rebaselineStabilityCount: 0,
    potentialNewBaseline: null,
    trackingLossFrames: 0,

    // Timing
    ascentStartTime: null,
    lastSquatStartTime: null,
    calibrationCompletedTime: null,
    lastStandingRecalibrationTime: 0,

    // Rep data
    repTimes: [],
    repDepths: [],

    // Deadlift / hinge specific
    standingTorsoAngle: null,
    setupTorsoAngle: null,
    deepestTorsoAngle: null,
    liftStartTime: null,
    setupEnteredTime: null,
    dlSmoothedAngle: null,
    dlAngleVelocity: 0,
    prevTorsoAngle: null,

    // Single-leg specific
    workingSide: null,      // 'left' or 'right' - which leg is doing the work
    sideReps: { left: 0, right: 0 },
    lastSideChangeTime: null,
    sideChangeDetected: false,

    // Stance detection (sumo vs conventional)
    detectedStance: null,   // 'conventional', 'sumo', or null

    // Row elbow fallback tracking
    rowTrackingPoint: null,       // 'wrist' or 'elbow' - current frame
    rowCalibPoint: null,          // 'wrist' or 'elbow' - used during calibration
    rowWristElbowOffset: null,    // wristBaselineY - elbowBaselineY (from calibration)

    // Debug
    debugInfo: {},
  };
};

// ========== UTILITY FUNCTIONS ==========

Chronicle.utils = {
  /**
   * Convert normalized distance to inches using calibrated scale
   */
  normToInches: function(normalizedDistance, state) {
    return state.inchesPerUnit ? normalizedDistance * state.inchesPerUnit : 0;
  },

  /**
   * Convert inches to normalized distance
   */
  inchesToNorm: function(inches, state) {
    return state.inchesPerUnit ? inches / state.inchesPerUnit : 0;
  },

  /**
   * Calculate speed score from time and distance, normalized across exercises.
   * The referenceDepth parameter ensures that the same speed of movement
   * produces roughly the same score regardless of exercise type.
   *
   * @param {number} timeSeconds - Ascent/concentric duration
   * @param {number} depthInches - Measured ROM in inches (hip drop, hip rise, etc.)
   * @param {number} [referenceDepth] - Expected ROM for a "good rep" of this exercise (inches).
   *   If provided, the depth is scaled so all exercises produce comparable scores.
   *   If omitted, raw depth is used (backward compatible).
   */
  calculateSpeedScore: function(timeSeconds, depthInches, referenceDepth) {
    if (depthInches <= 0 || timeSeconds <= 0) return 0;
    const C = Chronicle.CONSTANTS;
    // Normalize: scale depth so that a rep at the reference depth maps to
    // the standard baseline (back squat parallel ~15"). This means a 1-second
    // rep at the exercise's reference depth produces the same score for all exercises.
    let effectiveDepth = depthInches;
    if (referenceDepth && referenceDepth > 0) {
      effectiveDepth = depthInches * (C.STANDARD_REFERENCE_DEPTH / referenceDepth);
    }
    const timePerInch = timeSeconds / effectiveDepth;
    return Math.round(C.SPEED_SCORE_MULTIPLIER / timePerInch);
  },

  /**
   * Calculate torso angle from vertical using shoulder and hip positions.
   * Returns degrees: 0 = upright, 90 = horizontal.
   */
  calculateTorsoAngle: function(shoulderX, shoulderY, hipX, hipY) {
    const dy = hipY - shoulderY;
    if (dy <= 0.01) return 90;
    const dx = Math.abs(shoulderX - hipX);
    return Math.atan2(dx, dy) * (180 / Math.PI);
  },

  /**
   * Calculate knee angle from hip, knee, and ankle positions.
   * Returns degrees: 180 = fully extended, smaller = more bent.
   */
  calculateKneeAngle: function(hipX, hipY, kneeX, kneeY, ankleX, ankleY) {
    const v1x = hipX - kneeX;
    const v1y = hipY - kneeY;
    const v2x = ankleX - kneeX;
    const v2y = ankleY - kneeY;
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (mag1 === 0 || mag2 === 0) return 180;
    const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cos) * (180 / Math.PI);
  },

  /**
   * Calculate horizontal distance between two landmarks (stance width)
   */
  stanceWidth: function(leftAnkle, rightAnkle) {
    if (!leftAnkle || !rightAnkle) return 0;
    return Math.abs(leftAnkle.x - rightAnkle.x);
  },

  /**
   * Calculate hip width for stance ratio
   */
  hipWidth: function(leftHip, rightHip) {
    if (!leftHip || !rightHip) return 0;
    return Math.abs(leftHip.x - rightHip.x);
  },

  /**
   * Detect if a position change is an outlier (sudden jump)
   */
  isOutlierMovement: function(newY, previousY, state) {
    const C = Chronicle.CONSTANTS;
    if (previousY === null || state.positionHistory.length < C.MIN_FRAMES_FOR_OUTLIER_DETECTION) {
      return false;
    }
    const movement = Math.abs(newY - previousY);
    const threshold = state.typicalMovementMagnitude * C.OUTLIER_THRESHOLD_MULTIPLIER;
    return movement > threshold;
  },

  /**
   * Update the running estimate of typical movement magnitude
   */
  updateTypicalMovement: function(movement, state) {
    const C = Chronicle.CONSTANTS;
    if (state.positionHistory.length >= C.MIN_FRAMES_FOR_OUTLIER_DETECTION) {
      state.typicalMovementMagnitude = state.typicalMovementMagnitude * 0.9 + Math.abs(movement) * 0.1;
      state.typicalMovementMagnitude = Math.max(0.005, Math.min(0.05, state.typicalMovementMagnitude));
    }
  },

  /**
   * Apply exponential moving average smoothing
   */
  smoothPosition: function(newValue, previousSmoothed, alpha) {
    alpha = alpha || Chronicle.CONSTANTS.POSITION_SMOOTHING_ALPHA;
    if (previousSmoothed === null) return newValue;
    return previousSmoothed * (1 - alpha) + newValue * alpha;
  },

  /**
   * Process raw hip position with outlier filtering and smoothing
   */
  processHipPosition: function(rawHipY, rawHipX, state) {
    if (this.isOutlierMovement(rawHipY, state.smoothedHipY, state)) {
      return { hipY: state.smoothedHipY, hipX: state.smoothedHipX, rejected: true };
    }

    if (state.smoothedHipY !== null) {
      this.updateTypicalMovement(rawHipY - state.smoothedHipY, state);
    }

    state.smoothedHipY = this.smoothPosition(rawHipY, state.smoothedHipY);
    state.smoothedHipX = this.smoothPosition(rawHipX, state.smoothedHipX);

    state.positionHistory.push(rawHipY);
    if (state.positionHistory.length > 30) {
      state.positionHistory.shift();
    }

    return { hipY: state.smoothedHipY, hipX: state.smoothedHipX, rejected: false };
  },

  /**
   * Update EMA-smoothed velocity
   */
  updateSmoothedVelocity: function(instantVelocity, state) {
    const alpha = Chronicle.CONSTANTS.VELOCITY_EMA_ALPHA;
    state.smoothedVelocity = state.smoothedVelocity * (1 - alpha) + instantVelocity * alpha;
    return state.smoothedVelocity;
  },

  /**
   * Get averaged velocity from history using EMA
   */
  getAvgVelocity: function(state) {
    const C = Chronicle.CONSTANTS;
    return state.velocityHistory.length >= C.VELOCITY_WINDOW ? state.smoothedVelocity : 0;
  },

  /**
   * Track hip velocity from frame to frame
   */
  trackVelocity: function(hipY, state) {
    const C = Chronicle.CONSTANTS;
    if (state.prevHipY !== null) {
      const instantVelocity = hipY - state.prevHipY;
      state.velocityHistory.push(instantVelocity);
      if (state.velocityHistory.length > C.VELOCITY_WINDOW) {
        state.velocityHistory.shift();
      }
      this.updateSmoothedVelocity(instantVelocity, state);
    }
    state.prevHipY = hipY;
  },

  // ========== SIDE DETECTION ==========

  /**
   * Detect which side of the body is visible (for bilateral exercises)
   * Uses knee visibility since hip visibility is unreliable in MediaPipe
   */
  detectSide: function(landmarks, state) {
    const C = Chronicle.CONSTANTS;
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];

    const leftHipValid = leftHip && (leftHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const rightHipValid = rightHip && (rightHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const leftKneeValid = leftKnee && (leftKnee.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const rightKneeValid = rightKnee && (rightKnee.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;

    const leftValid = leftHipValid && leftKneeValid;
    const rightValid = rightHipValid && rightKneeValid;

    if (!leftValid && !rightValid) {
      state.trackingLossFrames++;
      return { valid: false, leftValid: false, rightValid: false };
    }

    state.trackingLossFrames = 0;

    if (state.lockedSide === null) {
      const leftKneeVis = leftKnee ? (leftKnee.visibility || 0) : 0;
      const rightKneeVis = rightKnee ? (rightKnee.visibility || 0) : 0;

      if (leftValid && rightValid) {
        state.lockedSide = leftKneeVis > rightKneeVis ? 'left' : 'right';
      } else if (leftValid) {
        state.lockedSide = 'left';
      } else {
        state.lockedSide = 'right';
      }
    } else {
      const currentValid = (state.lockedSide === 'left') ? leftValid : rightValid;
      const otherValid = (state.lockedSide === 'left') ? rightValid : leftValid;
      const currentKneeVis = (state.lockedSide === 'left') ? (leftKnee.visibility || 0) : (rightKnee.visibility || 0);
      const otherKneeVis = (state.lockedSide === 'left') ? (rightKnee.visibility || 0) : (leftKnee.visibility || 0);

      if (!currentValid && otherValid &&
          (otherKneeVis - currentKneeVis > C.SIDE_LOCK_CONFIDENCE_THRESHOLD) &&
          state.state === 'standing') {
        state.lockedSide = state.lockedSide === 'left' ? 'right' : 'left';
      }
    }

    state.currentSide = state.lockedSide;
    return { valid: true, leftValid, rightValid, side: state.lockedSide };
  },

  /**
   * Detect which leg is the working leg for single-leg exercises.
   * Compares ankle Y positions - the planted foot has a higher Y (lower in frame).
   * Also detects side changes between reps.
   */
  detectWorkingLeg: function(landmarks, state) {
    const C = Chronicle.CONSTANTS;
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const leftAnkleValid = leftAnkle && (leftAnkle.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const rightAnkleValid = rightAnkle && (rightAnkle.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const leftKneeValid = leftKnee && (leftKnee.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const rightKneeValid = rightKnee && (rightKnee.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const leftHipValid = leftHip && (leftHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const rightHipValid = rightHip && (rightHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;

    if (!leftAnkleValid && !rightAnkleValid) {
      return { valid: false };
    }

    // For single-leg exercises, detect which ankle is planted (lower in frame = higher Y)
    // and which is raised (higher in frame = lower Y)
    if (leftAnkleValid && rightAnkleValid) {
      const ankleYDiff = Math.abs(leftAnkle.y - rightAnkle.y);

      // Significant height difference indicates single-leg stance
      if (ankleYDiff > 0.05) {
        const newWorkingSide = leftAnkle.y > rightAnkle.y ? 'left' : 'right';

        // Detect side change
        if (state.workingSide !== null && state.workingSide !== newWorkingSide && state.state === 'standing') {
          state.sideChangeDetected = true;
          state.lastSideChangeTime = performance.now();
        }

        state.workingSide = newWorkingSide;
      }
    } else if (leftAnkleValid && leftHipValid && leftKneeValid) {
      state.workingSide = 'left';
    } else if (rightAnkleValid && rightHipValid && rightKneeValid) {
      state.workingSide = 'right';
    }

    return {
      valid: true,
      workingSide: state.workingSide,
      sideChanged: state.sideChangeDetected
    };
  },

  /**
   * Detect stance type (conventional vs sumo) from ankle and hip positions
   */
  detectStance: function(landmarks) {
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const C = Chronicle.CONSTANTS;
    const allValid = leftAnkle && rightAnkle && leftHip && rightHip &&
      (leftAnkle.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD &&
      (rightAnkle.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD &&
      (leftHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD &&
      (rightHip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;

    if (!allValid) return null;

    const ankleSpread = this.stanceWidth(leftAnkle, rightAnkle);
    const hipW = this.hipWidth(leftHip, rightHip);

    if (hipW < 0.01) return null;

    const ratio = ankleSpread / hipW;
    // Sumo: ankles significantly wider than hips (ratio > 1.5)
    // Conventional: ankles roughly at or inside hip width (ratio < 1.3)
    if (ratio > 1.5) return 'sumo';
    return 'conventional';
  },

  /**
   * Get landmarks for the active side
   */
  getActiveLandmarks: function(landmarks, side) {
    const useLeft = (side === 'left');
    return {
      hip: useLeft ? landmarks[23] : landmarks[24],
      knee: useLeft ? landmarks[25] : landmarks[26],
      ankle: useLeft ? landmarks[27] : landmarks[28],
      shoulder: useLeft ? landmarks[11] : landmarks[12],
      otherHip: useLeft ? landmarks[24] : landmarks[23],
      otherKnee: useLeft ? landmarks[26] : landmarks[25],
      otherAnkle: useLeft ? landmarks[28] : landmarks[27],
      otherShoulder: useLeft ? landmarks[12] : landmarks[11],
    };
  },

  // ========== CALIBRATION ==========

  /**
   * Shared calibration logic for exercises that use hip Y as baseline.
   * Returns true if calibration is in progress (caller should return).
   */
  calibrateHipBaseline: function(hipY, hipX, kneeY, torsoAngle, state, feedbackEl, readyMsg) {
    const C = Chronicle.CONSTANTS;
    const currentHipKneeDist = Math.abs(kneeY - hipY);

    if (currentHipKneeDist < 0.05 || currentHipKneeDist > 0.5) {
      if (feedbackEl) feedbackEl.textContent = "Position yourself so full body is visible";
      return true;
    }

    if (state.calibrationHipYValues.length === 0) {
      state.calibrationHipYValues.push(hipY);
      state.hipKneeDistance = currentHipKneeDist;
      state.standingHipX = hipX;
      state.userHeightInches = state.getUserHeight ? state.getUserHeight() : 68;
      if (feedbackEl) feedbackEl.textContent = "Hold still for calibration... 1/" + C.CALIBRATION_SAMPLES;
      return true;
    }

    const recentAvg = state.calibrationHipYValues.slice(-3).reduce((a, b) => a + b, 0) /
                      Math.min(state.calibrationHipYValues.length, 3);
    const variation = Math.abs(hipY - recentAvg);
    const tolerance = currentHipKneeDist * C.CALIBRATION_TOLERANCE_MULTIPLIER;

    if (variation < tolerance) {
      state.calibrationHipYValues.push(hipY);
      state.hipKneeDistance = state.hipKneeDistance * (1 - C.BASELINE_UPDATE_ALPHA) + currentHipKneeDist * C.BASELINE_UPDATE_ALPHA;
      if (feedbackEl) feedbackEl.textContent = `Hold still... ${state.calibrationHipYValues.length}/${C.CALIBRATION_SAMPLES}`;

      if (state.calibrationHipYValues.length >= C.CALIBRATION_SAMPLES) {
        state.standingHipY = state.calibrationHipYValues.reduce((a, b) => a + b, 0) / state.calibrationHipYValues.length;
        state.standingHipX = hipX;
        state.stableFrameCount = C.STABILITY_FRAMES;
        state.stableStandingStartTime = performance.now();
        state.calibrationCompletedTime = performance.now();

        if (torsoAngle !== null) {
          state.standingTorsoAngle = torsoAngle;
        }

        const expectedHipKneeInches = state.userHeightInches * C.HIP_KNEE_RATIO;
        state.inchesPerUnit = expectedHipKneeInches / state.hipKneeDistance;
        state.isCalibrated = true;

        const estimatedHipKneeInches = this.normToInches(state.hipKneeDistance, state);
        const feet = Math.floor(state.userHeightInches / 12);
        const inches = state.userHeightInches % 12;

        let calMsg = `Calibrated! H:${feet}'${inches}" HK:${estimatedHipKneeInches.toFixed(1)}"`;
        if (torsoAngle !== null) {
          calMsg += ` | Torso: ${torsoAngle.toFixed(0)}deg`;
        }
        if (feedbackEl) feedbackEl.textContent = calMsg;

        setTimeout(() => {
          if (state.state === 'standing' && feedbackEl) {
            feedbackEl.textContent = readyMsg || 'Ready!';
          }
        }, 2000);
      }
    } else {
      state.calibrationHipYValues = [];
      if (feedbackEl) feedbackEl.textContent = "Too much movement - restarting calibration";
    }

    return true;
  },

  /**
   * Check if auto-recalibration is needed
   */
  checkAutoRecalibration: function(state, feedbackEl) {
    const C = Chronicle.CONSTANTS;
    if (state.isCalibrated && state.calibrationCompletedTime &&
        state.state === 'standing' && state.lastSquatStartTime === null) {
      const timeSinceCalibration = performance.now() - state.calibrationCompletedTime;
      if (timeSinceCalibration > C.RECALIBRATION_TIMEOUT_MS) {
        state.isCalibrated = false;
        state.calibrationHipYValues = [];
        state.standingHipY = null;
        state.standingHipX = null;
        state.standingTorsoAngle = null;
        state.stableFrameCount = 0;
        state.calibrationCompletedTime = null;
        if (feedbackEl) feedbackEl.textContent = "Auto-recalibrating - stay still";
        return true;
      }
    }
    return false;
  },

  // ========== STATE MANAGEMENT ==========

  /**
   * Update state and timestamp
   */
  updateState: function(newState, state, statusEl) {
    state.state = newState;
    state.stateStartTime = performance.now();
    if (statusEl) {
      statusEl.textContent = newState.toUpperCase();
      statusEl.className = `status-indicator status-${newState}`;
    }
  },

  /**
   * Reset to standing state (for squat-type exercises)
   */
  resetToStanding: function(state, statusEl) {
    this.updateState('standing', state, statusEl);
    state.deepestHipY = null;
    state.stableFrameCount = 0;
    state.ascentStartTime = null;
    state.velocityHistory = [];
    state.stableStandingStartTime = null;
    state.rebaselineStabilityCount = 0;
    state.potentialNewBaseline = null;
    state.trackingLossFrames = 0;
    state.smoothedVelocity = 0;
  },

  /**
   * Reset deadlift/hinge-specific state
   */
  resetHingeState: function(state, statusEl) {
    this.updateState('standing', state, statusEl);
    state.deepestHipY = null;
    state.deepestTorsoAngle = null;
    state.setupTorsoAngle = null;
    state.liftStartTime = null;
    state.setupEnteredTime = null;
    state.stableFrameCount = 0;
    state.velocityHistory = [];
    state.stableStandingStartTime = null;
    state.trackingLossFrames = 0;
    state.smoothedVelocity = 0;
    state.dlAngleVelocity = 0;
  },

  /**
   * Handle standing stability and baseline drift
   */
  handleStandingStability: function(hipY, hipX, state, feedbackEl, exerciseName) {
    const C = Chronicle.CONSTANTS;
    const distanceFromBaseline = Math.abs(hipY - state.standingHipY);
    const horizontalMovement = state.standingHipX ? Math.abs(hipX - state.standingHipX) : 0;
    const toleranceNorm = this.inchesToNorm(C.BASELINE_TOLERANCE_INCHES, state);
    const currentDepthNorm = hipY - state.standingHipY;
    const descentThresholdNorm = this.inchesToNorm(3.5, state);

    const isVerticalMovement = distanceFromBaseline > horizontalMovement * 1.5;
    const isStartingExercise = isVerticalMovement && currentDepthNorm > descentThresholdNorm * 0.4;

    if (!isStartingExercise && distanceFromBaseline < toleranceNorm) {
      state.stableFrameCount = Math.min(C.STABILITY_FRAMES, state.stableFrameCount + 1);
      state.rebaselineStabilityCount = 0;
      state.potentialNewBaseline = null;

      if (state.stableFrameCount >= C.STABILITY_FRAMES && state.stableStandingStartTime === null) {
        state.stableStandingStartTime = performance.now();
      }
    } else if (!isStartingExercise) {
      if (horizontalMovement > C.HORIZONTAL_MOVEMENT_THRESHOLD) {
        state.stableFrameCount = Math.max(0, state.stableFrameCount - 1);
        state.stableStandingStartTime = null;
      } else {
        state.stableFrameCount = Math.max(0, state.stableFrameCount - 1);
        state.stableStandingStartTime = null;

        const driftInches = this.normToInches(distanceFromBaseline, state);
        const avgVelocity = this.getAvgVelocity(state);
        const isStablePosition = state.velocityHistory.length >= 3 &&
          Math.abs(avgVelocity) < C.VELOCITY_THRESHOLD * 2;

        if (isStablePosition && driftInches > C.DRIFT_CRITICAL_THRESHOLD) {
          if (state.potentialNewBaseline === null || Math.abs(hipY - state.potentialNewBaseline) < toleranceNorm * 0.5) {
            state.potentialNewBaseline = hipY;
            state.rebaselineStabilityCount++;

            if (state.rebaselineStabilityCount >= C.REBASELINE_STABILITY_FRAMES) {
              state.standingHipY = state.potentialNewBaseline;
              state.standingHipX = hipX;
              state.stableFrameCount = C.STABILITY_FRAMES;
              state.stableStandingStartTime = performance.now();
              state.rebaselineStabilityCount = 0;
              state.potentialNewBaseline = null;
              if (feedbackEl) feedbackEl.textContent = `Position updated - ready to ${exerciseName.toLowerCase()}`;
            }
          } else {
            state.rebaselineStabilityCount = 0;
            state.potentialNewBaseline = null;
          }
        } else {
          state.rebaselineStabilityCount = 0;
          state.potentialNewBaseline = null;
        }
      }
    }
  },
};

// ========== DEPTH QUALITY FUNCTIONS ==========

Chronicle.quality = {
  squat: function(depthInches) {
    if (depthInches >= 17.5) return { emoji: '+++', label: 'Deep', color: '#00FF00' };
    if (depthInches >= 15.5) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
    if (depthInches >= 6) return { emoji: '+', label: 'Half', color: '#FFD700' };
    return { emoji: '!', label: 'Shallow', color: '#FFA500' };
  },

  lockout: function(angleDiffFromStanding) {
    if (angleDiffFromStanding <= 5) return { emoji: '+++', label: 'Full Lockout', color: '#00FF00' };
    if (angleDiffFromStanding <= 10) return { emoji: '++', label: 'Lockout', color: '#90EE90' };
    if (angleDiffFromStanding <= 20) return { emoji: '+', label: 'Partial', color: '#FFD700' };
    return { emoji: '!', label: 'Soft Lockout', color: '#FFA500' };
  },

  hingeDepth: function(angleDeg) {
    if (angleDeg >= 70) return { emoji: '+++', label: 'Full Stretch', color: '#00FF00' };
    if (angleDeg >= 50) return { emoji: '++', label: 'Parallel', color: '#90EE90' };
    if (angleDeg >= 30) return { emoji: '+', label: 'Partial', color: '#FFD700' };
    return { emoji: '!', label: 'Shallow', color: '#FFA500' };
  },
};

console.log('Chronicle base module loaded');
