// ========== General Pull Exercise Module ==========
// Generic pull-pattern tracker for pulling exercises without a specific module.
// Uses wrist/elbow Y position tracking with upward pull detection.
// No torso hinge requirement (unlike barbell row), so it works for both
// standing and seated pulls.
// Good for: pull-ups, chin-ups, lat pulldowns, face pulls, cable pulls,
//           rear delt flyes, band pull-aparts, straight-arm pulldowns, etc.
//
// Uses row-base shared utilities for side detection and tracking point selection,
// but with relaxed setup requirements (no minimum hinge angle).

(function() {
  var C = Chronicle.CONSTANTS;
  var utils = Chronicle.utils;
  var rowUtils = Chronicle.rowUtils;

  var GEN_PL = {
    MIN_PULL_INCHES: 3,            // Lower than barbell row (varied ROM)
    PULL_THRESHOLD_INCHES: 2.0,    // Easier to trigger pull state
    RECOVERY_PERCENT: 74,          // More forgiving
    PULL_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 45,

    // Pull quality thresholds (inches of tracking point travel)
    DEPTH_MARKER_PARTIAL: 3,
    DEPTH_MARKER_GOOD: 6,
    DEPTH_MARKER_FULL: 9,

    // Calibration
    SETUP_MIN_ANGLE: 0,           // No hinge requirement (standing/seated pulls)
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.15,
    ELBOW_CAL_DIST_MIN: 0.01,
    ELBOW_CAL_DIST_MAX: 0.28,

    // Cheat detection (torso swing)
    CHEAT_ANGLE_THRESHOLD: 20,    // More forgiving than strict rows
  };

  var calibConfig = {
    setupMinAngle: GEN_PL.SETUP_MIN_ANGLE,
    shoulderWristRatio: GEN_PL.SHOULDER_WRIST_RATIO,
    calibrationTolerance: GEN_PL.CALIBRATION_TOLERANCE,
    elbowCalDistMin: GEN_PL.ELBOW_CAL_DIST_MIN,
    elbowCalDistMax: GEN_PL.ELBOW_CAL_DIST_MAX,
    readyMsg: 'Ready to pull!',
  };

  Chronicle.exercises['general-pull'] = {
    key: 'general-pull',
    name: 'General Pull',
    sessionName: 'Pull Session',
    readyMsg: 'Ready to pull!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: true,
    invertDepthMarkers: true,
    referenceDepth: 8,

    hyperparams: GEN_PL,

    depthMarkers: [
      { inches: GEN_PL.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: GEN_PL.DEPTH_MARKER_GOOD, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: GEN_PL.DEPTH_MARKER_FULL, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist or Elbow (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= GEN_PL.DEPTH_MARKER_FULL) return { emoji: '+++', label: 'Full ROM', color: '#00FF00' };
      if (pullInches >= GEN_PL.DEPTH_MARKER_GOOD) return { emoji: '++', label: 'Good', color: '#90EE90' };
      if (pullInches >= GEN_PL.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      rowUtils.detectRow(landmarks, state, ui, this, GEN_PL, calibConfig);
    },

    displayRepTimes: function(state, msgEl) {
      rowUtils.displayRowRepTimes(state, msgEl, 'Speed Analysis', this.getQuality, this.referenceDepth);
    },

    reset: function(state) {
      rowUtils.resetRowState(state);
    },
  };

  console.log('General Pull exercise module loaded');
})();
