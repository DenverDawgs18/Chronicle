// ========== Pendlay Row Exercise Module ==========
// Dead-stop barbell row from the floor. Strict form with full stop at bottom.
// Requires deeper hinge angle and higher quality thresholds than standard barbell row.
// Each rep starts from a dead stop with the bar on the floor.
// Stricter cheat detection since this is meant to be a strict-form movement.
// Camera should be positioned from the side so shoulder, hip, and arm are visible.
//
// ELBOW FALLBACK: When plates occlude the wrist from a side view, the module
// automatically falls back to tracking the elbow.
//
// State machine: standing (hinged) -> ascending (pulling up) -> descending (lowering) -> rep counted.

(function() {
  const rowUtils = Chronicle.rowUtils;

  // Pendlay Row hyperparameters - strict form, higher thresholds
  const PENDLAY = {
    MIN_PULL_INCHES: 5,            // Higher minimum for dead-stop row
    PULL_THRESHOLD_INCHES: 3,      // Trigger pull state
    RECOVERY_PERCENT: 90,          // Must return almost fully to floor
    PULL_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 60,

    // Pull quality thresholds (stricter for Pendlay)
    DEPTH_MARKER_PARTIAL: 5,       // Partial pull
    DEPTH_MARKER_MID: 8,           // Mid-torso
    DEPTH_MARKER_FULL: 11,         // Full pull to chest

    // Calibration - stricter hinge requirement
    SETUP_MIN_ANGLE: 30,           // Must be deeply hinged
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.15,
    ELBOW_CAL_DIST_MIN: 0.01,
    ELBOW_CAL_DIST_MAX: 0.28,

    // Cheat detection - very strict
    CHEAT_ANGLE_THRESHOLD: 10,     // Low tolerance for body english
  };

  const calibConfig = {
    setupMinAngle: PENDLAY.SETUP_MIN_ANGLE,
    shoulderWristRatio: PENDLAY.SHOULDER_WRIST_RATIO,
    calibrationTolerance: PENDLAY.CALIBRATION_TOLERANCE,
    elbowCalDistMin: PENDLAY.ELBOW_CAL_DIST_MIN,
    elbowCalDistMax: PENDLAY.ELBOW_CAL_DIST_MAX,
    readyMsg: 'Ready - dead stop each rep!',
  };

  Chronicle.exercises['pendlay-row'] = {
    key: 'pendlay-row',
    name: 'Pendlay Row',
    sessionName: 'Pendlay Row Session',
    readyMsg: 'Ready - dead stop each rep!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: true,
    invertDepthMarkers: true,
    referenceDepth: 11,  // Longer ROM expected

    hyperparams: PENDLAY,

    depthMarkers: [
      { inches: PENDLAY.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: PENDLAY.DEPTH_MARKER_MID, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: PENDLAY.DEPTH_MARKER_FULL, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist or Elbow (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= PENDLAY.DEPTH_MARKER_FULL) return { emoji: '+++', label: 'Full', color: '#00FF00' };
      if (pullInches >= PENDLAY.DEPTH_MARKER_MID) return { emoji: '++', label: 'Mid', color: '#90EE90' };
      if (pullInches >= PENDLAY.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      rowUtils.detectRow(landmarks, state, ui, this, PENDLAY, calibConfig);
    },

    displayRepTimes: function(state, msgEl) {
      rowUtils.displayRowRepTimes(state, msgEl, 'Pendlay Row Speed Analysis', this.getQuality, this.referenceDepth);
    },

    reset: function(state) {
      rowUtils.resetRowState(state);
    },
  };

  console.log('Pendlay Row exercise module loaded');
})();
