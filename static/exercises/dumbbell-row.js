// ========== Dumbbell Row Exercise Module ==========
// Single-arm bent-over dumbbell row.
// Tracks wrist position (no elbow fallback typically needed - no plates blocking).
// Relaxed hinge angle requirement since athlete may be in supported stance.
// Shorter ROM than barbell row due to single-arm mechanics.
// Camera should be positioned from the side to see shoulder, hip, and wrist.
//
// State machine: standing (hinged) -> ascending (pulling up) -> descending (lowering) -> rep counted.

(function() {
  const rowUtils = Chronicle.rowUtils;

  // Dumbbell Row hyperparameters - shorter ROM, relaxed hinge
  const DB_ROW = {
    MIN_PULL_INCHES: 3,            // Lower minimum for DB row
    PULL_THRESHOLD_INCHES: 2,      // Trigger pull state
    RECOVERY_PERCENT: 80,
    PULL_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Pull quality thresholds (shorter ROM for single arm)
    DEPTH_MARKER_PARTIAL: 3,       // Partial pull
    DEPTH_MARKER_MID: 5.5,         // Mid-range pull
    DEPTH_MARKER_FULL: 8,          // Full pull to ribcage

    // Calibration - relaxed hinge since athlete may be supported
    SETUP_MIN_ANGLE: 15,           // Lower hinge requirement
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.15,
    ELBOW_CAL_DIST_MIN: 0.01,
    ELBOW_CAL_DIST_MAX: 0.28,

    // Cheat detection - more relaxed for single-arm
    CHEAT_ANGLE_THRESHOLD: 20,
  };

  const calibConfig = {
    setupMinAngle: DB_ROW.SETUP_MIN_ANGLE,
    shoulderWristRatio: DB_ROW.SHOULDER_WRIST_RATIO,
    calibrationTolerance: DB_ROW.CALIBRATION_TOLERANCE,
    elbowCalDistMin: DB_ROW.ELBOW_CAL_DIST_MIN,
    elbowCalDistMax: DB_ROW.ELBOW_CAL_DIST_MAX,
    readyMsg: 'Ready to row!',
  };

  Chronicle.exercises['dumbbell-row'] = {
    key: 'dumbbell-row',
    name: 'Dumbbell Row',
    sessionName: 'Dumbbell Row Session',
    readyMsg: 'Ready to row!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: true,
    invertDepthMarkers: true,
    referenceDepth: 8,  // Shorter ROM than barbell row

    hyperparams: DB_ROW,

    depthMarkers: [
      { inches: DB_ROW.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: DB_ROW.DEPTH_MARKER_MID, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: DB_ROW.DEPTH_MARKER_FULL, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= DB_ROW.DEPTH_MARKER_FULL) return { emoji: '+++', label: 'Full', color: '#00FF00' };
      if (pullInches >= DB_ROW.DEPTH_MARKER_MID) return { emoji: '++', label: 'Mid', color: '#90EE90' };
      if (pullInches >= DB_ROW.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      rowUtils.detectRow(landmarks, state, ui, this, DB_ROW, calibConfig);
    },

    displayRepTimes: function(state, msgEl) {
      rowUtils.displayRowRepTimes(state, msgEl, 'Dumbbell Row Speed Analysis', this.getQuality, this.referenceDepth);
    },

    reset: function(state) {
      rowUtils.resetRowState(state);
    },
  };

  console.log('Dumbbell Row exercise module loaded');
})();
