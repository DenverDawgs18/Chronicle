// ========== Overhead Press Exercise Module ==========
// Tracks wrist Y position for bar path overhead.
// Calibrates at overhead lockout (arms fully extended overhead, wrist above shoulder).
// Camera: side view so shoulder, elbow, and wrist are visible.
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var C = Chronicle.CONSTANTS;

  var OHP = {
    MIN_DEPTH_INCHES: 6,            // Minimum wrist travel for valid rep
    DESCENT_THRESHOLD_INCHES: 3,   // Wrist drop to trigger descent state
    RECOVERY_PERCENT: 80,
    DESCENT_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth quality thresholds (wrist travel in inches from overhead lockout)
    DEPTH_MARKER_PARTIAL: 6,        // Partial rep (above head)
    DEPTH_MARKER_PARALLEL: 10,      // Head level / chin height
    DEPTH_MARKER_DEEP: 14,          // Full ROM to shoulders

    // Calibration
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.18,
  };

  var OHP_CAL = {
    elbowFallback:  false,
    ascentVerb:     'Press',
    // At overhead lockout the wrist is above the shoulder (smaller Y).
    // The absolute value gives the arm-length distance regardless of direction.
    getTrackPoint:  function(lm) { return lm.wrist; },
    getRefDist:     function(lm) { return Math.abs(lm.wrist.y - lm.shoulder.y); },
    ratioFraction:  OHP.SHOULDER_WRIST_RATIO,
    tolerance:      OHP.CALIBRATION_TOLERANCE,
    distMin:        0.03,
    distMax:        0.45,
    readyMsg:       'Ready to press!',
    positionMsg:    'Hold overhead lockout',
    badPositionMsg: 'Hold bar overhead - camera needs to see your full arm from the side',
  };

  Chronicle.exercises['overhead-press'] = {
    key:           'overhead-press',
    name:          'Overhead Press',
    sessionName:   'Overhead Press Session',
    readyMsg:      'Ready to press!',
    category:      'press',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 12,

    hyperparams: OHP,

    depthMarkers: [
      { inches: OHP.DEPTH_MARKER_PARTIAL,  color: 'rgba(255, 165, 0, 0.4)' },
      { inches: OHP.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: OHP.DEPTH_MARKER_DEEP,     color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= OHP.DEPTH_MARKER_DEEP)     return { emoji: '+++', label: 'Shoulders',  color: '#00FF00' };
      if (depthInches >= OHP.DEPTH_MARKER_PARALLEL) return { emoji: '++',  label: 'Head Clear', color: '#90EE90' };
      if (depthInches >= OHP.DEPTH_MARKER_PARTIAL)  return { emoji: '+',   label: 'Partial',    color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, OHP, OHP_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Overhead Press Speed Analysis', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('Overhead Press exercise module loaded');
})();
