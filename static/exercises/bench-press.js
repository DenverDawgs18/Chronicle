// ========== Flat Bench Press Exercise Module ==========
// Tracks wrist Y position for bar path (descent/ascent).
// Calibrates at locked-out position (arms extended, bar over chest).
// Camera: side view so shoulder, elbow, and wrist are all visible.
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var C = Chronicle.CONSTANTS;
  var utils = Chronicle.utils;

  var BENCH = {
    MIN_DEPTH_INCHES: 4,            // Minimum wrist travel for valid rep
    DESCENT_THRESHOLD_INCHES: 2.5, // Wrist drop to trigger descent state
    RECOVERY_PERCENT: 80,
    DESCENT_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth quality thresholds (wrist travel in inches from lockout)
    DEPTH_MARKER_PARTIAL: 4,
    DEPTH_MARKER_PARALLEL: 8,       // ~90 degree elbow zone
    DEPTH_MARKER_DEEP: 11,          // Chest touch / below shoulder

    // Calibration
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.18,    // Slightly wider than before for comfort at lockout
  };

  // Calibration config passed to press-base
  var BENCH_CAL = {
    elbowFallback:  false,
    ascentVerb:     'Press',
    getTrackPoint:  function(lm) { return lm.wrist; },
    getRefDist:     function(lm) { return Math.abs(lm.wrist.y - lm.shoulder.y); },
    ratioFraction:  BENCH.SHOULDER_WRIST_RATIO,
    tolerance:      BENCH.CALIBRATION_TOLERANCE,
    distMin:        0.02,
    distMax:        0.40,
    readyMsg:       'Ready to bench!',
    positionMsg:    'Hold lockout',
    badPositionMsg: 'Position camera to see shoulder, elbow, and wrist from the side',
  };

  Chronicle.exercises['bench-press'] = {
    key:           'bench-press',
    name:          'Bench Press',
    sessionName:   'Bench Press Session',
    readyMsg:      'Ready to bench!',
    category:      'press',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 10,

    hyperparams: BENCH,

    depthMarkers: [
      { inches: BENCH.DEPTH_MARKER_PARTIAL,  color: 'rgba(255, 165, 0, 0.4)' },
      { inches: BENCH.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: BENCH.DEPTH_MARKER_DEEP,     color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= BENCH.DEPTH_MARKER_DEEP)     return { emoji: '+++', label: 'Chest',    color: '#00FF00' };
      if (depthInches >= BENCH.DEPTH_MARKER_PARALLEL) return { emoji: '++',  label: 'Parallel', color: '#90EE90' };
      if (depthInches >= BENCH.DEPTH_MARKER_PARTIAL)  return { emoji: '+',   label: 'Partial',  color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, BENCH, BENCH_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Bench Press Speed Analysis', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('Bench Press exercise module loaded');
})();
