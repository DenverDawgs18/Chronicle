// ========== General Press Exercise Module ==========
// Generic press-pattern tracker for exercises without a specific module.
// Good for: incline bench, close-grip bench, dumbbell press, push-ups,
//           machine press, floor press, JM press, board press, etc.
// Camera: side view so shoulder, elbow, and wrist are visible.
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var GEN_PR = {
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
    CALIBRATION_TOLERANCE: 0.18,
  };

  var GEN_PR_CAL = {
    elbowFallback:  false,
    ascentVerb:     'Press',
    getTrackPoint:  function(lm) { return lm.wrist; },
    getRefDist:     function(lm) { return Math.abs(lm.wrist.y - lm.shoulder.y); },
    ratioFraction:  GEN_PR.SHOULDER_WRIST_RATIO,
    tolerance:      GEN_PR.CALIBRATION_TOLERANCE,
    distMin:        0.02,
    distMax:        0.40,
    readyMsg:       'Ready to press!',
    positionMsg:    'Hold lockout',
    badPositionMsg: 'Position camera to see your full arm from the side',
  };

  Chronicle.exercises['general-press'] = {
    key:           'general-press',
    name:          'General Press',
    sessionName:   'Press Session',
    readyMsg:      'Ready to press!',
    category:      'press',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 10,

    hyperparams: GEN_PR,

    depthMarkers: [
      { inches: GEN_PR.DEPTH_MARKER_PARTIAL,  color: 'rgba(255, 165, 0, 0.4)' },
      { inches: GEN_PR.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: GEN_PR.DEPTH_MARKER_DEEP,     color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= GEN_PR.DEPTH_MARKER_DEEP)     return { emoji: '+++', label: 'Full ROM', color: '#00FF00' };
      if (depthInches >= GEN_PR.DEPTH_MARKER_PARALLEL) return { emoji: '++',  label: 'Good',    color: '#90EE90' };
      if (depthInches >= GEN_PR.DEPTH_MARKER_PARTIAL)  return { emoji: '+',   label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, GEN_PR, GEN_PR_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Press Speed Analysis', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('General Press exercise module loaded');
})();
