// ========== Cable Row Exercise Module ==========
// Standing cable row / low row. Works for low cable pulls, face pulls, etc.
// No strict hinge angle requirement - athlete can be upright or slightly bent.
// Tracks wrist Y position as it pulls upward toward the torso.
// No cheat detection since body position varies significantly in cable exercises.
// Camera should be positioned from the side to see shoulder, hip, and wrist.
//
// Best for: standing cable rows, low cable face pulls, band rows
// For seated cable rows, camera needs angle to see arm path.
//
// State machine: standing -> ascending (pulling up) -> descending (lowering) -> rep counted.

(function() {
  const rowUtils = Chronicle.rowUtils;

  // Cable Row hyperparameters - flexible positioning, no strict hinge
  const CABLE = {
    MIN_PULL_INCHES: 2.5,          // Lower minimum for cable exercises
    PULL_THRESHOLD_INCHES: 1.5,    // Trigger pull state
    RECOVERY_PERCENT: 75,          // More relaxed recovery
    PULL_VELOCITY_MIN: 0.0008,     // Slightly lower velocity threshold
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 40,

    // Pull quality thresholds (shorter ROM typical for cable)
    DEPTH_MARKER_PARTIAL: 2.5,     // Partial pull
    DEPTH_MARKER_MID: 4.5,         // Mid-range
    DEPTH_MARKER_FULL: 7,          // Full contraction

    // Calibration - no hinge requirement (can be upright)
    SETUP_MIN_ANGLE: 0,            // Accept any torso angle
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.18,   // Slightly more tolerant
    ELBOW_CAL_DIST_MIN: 0.01,
    ELBOW_CAL_DIST_MAX: 0.35,      // Allow more variance

    // Cheat detection disabled (varied body positions in cable work)
    CHEAT_ANGLE_THRESHOLD: 999,    // Effectively disabled
  };

  const calibConfig = {
    setupMinAngle: CABLE.SETUP_MIN_ANGLE,
    shoulderWristRatio: CABLE.SHOULDER_WRIST_RATIO,
    calibrationTolerance: CABLE.CALIBRATION_TOLERANCE,
    elbowCalDistMin: CABLE.ELBOW_CAL_DIST_MIN,
    elbowCalDistMax: CABLE.ELBOW_CAL_DIST_MAX,
    readyMsg: 'Ready to pull!',
  };

  Chronicle.exercises['cable-row'] = {
    key: 'cable-row',
    name: 'Cable Row',
    sessionName: 'Cable Row Session',
    readyMsg: 'Ready to pull!',
    category: 'row',
    isSingleLeg: false,
    needsShoulder: true,
    needsWrist: true,
    needsHip: true,
    invertDepthMarkers: true,
    referenceDepth: 7,  // Shorter ROM typical

    hyperparams: CABLE,

    depthMarkers: [
      { inches: CABLE.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: CABLE.DEPTH_MARKER_MID, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: CABLE.DEPTH_MARKER_FULL, color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Hip, Wrist (side view)',

    getQuality: function(pullInches) {
      if (pullInches >= CABLE.DEPTH_MARKER_FULL) return { emoji: '+++', label: 'Full', color: '#00FF00' };
      if (pullInches >= CABLE.DEPTH_MARKER_MID) return { emoji: '++', label: 'Mid', color: '#90EE90' };
      if (pullInches >= CABLE.DEPTH_MARKER_PARTIAL) return { emoji: '+', label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      rowUtils.detectRow(landmarks, state, ui, this, CABLE, calibConfig);
    },

    displayRepTimes: function(state, msgEl) {
      rowUtils.displayRowRepTimes(state, msgEl, 'Cable Row Speed Analysis', this.getQuality, this.referenceDepth);
    },

    reset: function(state) {
      rowUtils.resetRowState(state);
    },
  };

  console.log('Cable Row exercise module loaded');
})();
