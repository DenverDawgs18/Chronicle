// ========== Dips Exercise Module ==========
// Tracks shoulder Y position since the body moves while hands stay fixed on the bars.
// Calibrates at lockout (top of dip, arms fully extended).
// Camera: side view so shoulder and elbow are visible (wrist may be occluded on bars).
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var DIPS = {
    MIN_DEPTH_INCHES: 3,           // Minimum shoulder drop for valid rep
    DESCENT_THRESHOLD_INCHES: 2,   // Shoulder drop to trigger descent state
    RECOVERY_PERCENT: 80,
    DESCENT_VELOCITY_MIN: 0.0010,
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 50,

    // Depth quality thresholds (shoulder drop in inches from lockout)
    DEPTH_MARKER_PARTIAL: 3,       // Partial dip
    DEPTH_MARKER_PARALLEL: 5,      // Elbow at ~90 degrees
    DEPTH_MARKER_DEEP: 7,          // Below parallel

    // Calibration - uses shoulder-to-elbow distance (upper arm length)
    SHOULDER_ELBOW_RATIO: 0.19,    // Approximate upper arm length as fraction of height
    CALIBRATION_TOLERANCE: 0.15,
  };

  var DIPS_CAL = {
    elbowFallback:  true,    // Wrist fixed on bars and may be occluded; only need shoulder+elbow
    ascentVerb:     'Push',
    getTrackPoint:  function(lm) { return lm.shoulder; },
    getRefDist:     function(lm) { return Math.abs(lm.elbow.y - lm.shoulder.y); },
    ratioFraction:  DIPS.SHOULDER_ELBOW_RATIO,
    tolerance:      DIPS.CALIBRATION_TOLERANCE,
    distMin:        0.02,
    distMax:        0.30,
    readyMsg:       'Ready for dips!',
    positionMsg:    'Hold lockout at top',
    badPositionMsg: 'Position camera to see your shoulder and elbow from the side',
  };

  Chronicle.exercises['dips'] = {
    key:           'dips',
    name:          'Dips',
    sessionName:   'Dips Session',
    readyMsg:      'Ready for dips!',
    category:      'press',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 6,

    hyperparams: DIPS,

    depthMarkers: [
      { inches: DIPS.DEPTH_MARKER_PARTIAL,  color: 'rgba(255, 165, 0, 0.4)' },
      { inches: DIPS.DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
      { inches: DIPS.DEPTH_MARKER_DEEP,     color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder + Elbow (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= DIPS.DEPTH_MARKER_DEEP)     return { emoji: '+++', label: 'Deep',     color: '#00FF00' };
      if (depthInches >= DIPS.DEPTH_MARKER_PARALLEL) return { emoji: '++',  label: 'Parallel', color: '#90EE90' };
      if (depthInches >= DIPS.DEPTH_MARKER_PARTIAL)  return { emoji: '+',   label: 'Partial',  color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, DIPS, DIPS_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Dips Speed Analysis', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('Dips exercise module loaded');
})();
