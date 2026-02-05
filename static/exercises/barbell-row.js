// ========== Barbell Row Exercise Module ==========
// Hybrid exercise: tracks torso angle (hip hinge) + wrist/elbow position (pull).
// Calibrates in hinged-over position with bar hanging down.
// Quality based on how far the tracking point rises toward torso during the pull.
// Monitors torso angle change during pull for cheat detection.
// Camera should be positioned from the side so shoulder, hip, and arm are visible.
//
// ELBOW FALLBACK: When plates occlude the wrist from a side view, the module
// automatically falls back to tracking the elbow (which sits above the plates).
//
// State machine: standing (hinged) -> ascending (pulling up) -> descending (lowering) -> rep counted.

(function() {
  const rowUtils = Chronicle.rowUtils;
  const utils = Chronicle.utils;

  // Barbell Row hyperparameters
  const ROW = {
    MIN_PULL_INCHES: 4,            // Minimum wrist travel upward for valid rep
    PULL_THRESHOLD_INCHES: 2.5,    // Wrist rise to trigger pulling state
    RECOVERY_PERCENT: 80,          // % recovery (bar lowered back) to count rep
    PULL_VELOCITY_MIN: 0.0010,     // Minimum upward velocity for pull detection
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Pull quality thresholds (wrist-equivalent travel upward in inches)
    DEPTH_MARKER_PARTIAL: 4,       // Partial pull
    DEPTH_MARKER_BELLY: 7,         // Mid-torso / belly button area
    DEPTH_MARKER_CHEST: 10,        // Full pull to chest/ribcage

    // Calibration
    SETUP_MIN_ANGLE: 25,           // Minimum torso hinge angle for calibration (degrees)
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.15,
    ELBOW_CAL_DIST_MIN: 0.01,
    ELBOW_CAL_DIST_MAX: 0.28,

    // Cheat detection
    CHEAT_ANGLE_THRESHOLD: 15,     // Degrees of torso angle change = cheating
  };

  // Calibration config for shared function
  const calibConfig = {
    setupMinAngle: ROW.SETUP_MIN_ANGLE,
    shoulderWristRatio: ROW.SHOULDER_WRIST_RATIO,
    calibrationTolerance: ROW.CALIBRATION_TOLERANCE,
    elbowCalDistMin: ROW.ELBOW_CAL_DIST_MIN,
    elbowCalDistMax: ROW.ELBOW_CAL_DIST_MAX,
    readyMsg: 'Ready to row!',
  };

  Chronicle.exercises['barbell-row'] = {
    key: 'barbell-row',
    name: 'Barbell Row',
    sessionName: 'Barbell Row Session',
    readyMsg: 'Ready to row!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: true,
    invertDepthMarkers: true,
    referenceDepth: 10,

    hyperparams: ROW,

    depthMarkers: [
      { inches: ROW.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: ROW.DEPTH_MARKER_BELLY, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: ROW.DEPTH_MARKER_CHEST, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist or Elbow (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= ROW.DEPTH_MARKER_CHEST) return { emoji: '+++', label: 'Chest', color: '#00FF00' };
      if (pullInches >= ROW.DEPTH_MARKER_BELLY) return { emoji: '++', label: 'Belly', color: '#90EE90' };
      if (pullInches >= ROW.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      rowUtils.detectRow(landmarks, state, ui, this, ROW, calibConfig);
    },

    displayRepTimes: function(state, msgEl) {
      rowUtils.displayRowRepTimes(state, msgEl, 'Barbell Row Speed Analysis', this.getQuality, this.referenceDepth);
    },

    reset: function(state) {
      rowUtils.resetRowState(state);
    },
  };

  console.log('Barbell Row exercise module loaded');
})();
