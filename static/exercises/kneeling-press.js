// ========== Kneeling Press Exercise Module ==========
// Overhead press variations done from a kneeling position or with reduced ROM.
// Good for: kneeling OHP, kneeling single-arm press, Z-press, landmine press,
//           half-kneeling press, tall-kneeling press, seated OHP, Viking press, etc.
//
// Key differences from standing OHP:
// - Wider calibration tolerance (kneeling is less stable than standing)
// - Lower depth thresholds (shorter ROM from kneeling/seated positions)
// - Lower velocity threshold (controlled kneeling movement)
//
// Camera: side view so shoulder, elbow, and wrist are visible.
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var KP = {
    MIN_DEPTH_INCHES: 3,            // Kneeling press has shorter ROM than standing OHP
    DESCENT_THRESHOLD_INCHES: 1.5,  // Low trigger for shorter press path
    RECOVERY_PERCENT: 74,           // Forgiving - kneeling is less stable
    DESCENT_VELOCITY_MIN: 0.0008,   // Lower velocity - controlled kneeling movement
    DEPTH_TRIGGER_MULTIPLIER: 1.5,
    RECOVERY_WARNING_THRESHOLD: 40,

    // Depth quality thresholds (wrist travel in inches from lockout)
    DEPTH_MARKER_PARTIAL: 3,        // Partial rep
    DEPTH_MARKER_GOOD: 6,           // Good ROM for kneeling press
    DEPTH_MARKER_FULL: 9,           // Full ROM to shoulders

    // Calibration - relaxed for kneeling/angled press paths
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.20,    // Wider tolerance - kneeling is less stable
  };

  var KP_CAL = {
    elbowFallback:  false,
    ascentVerb:     'Press',
    getTrackPoint:  function(lm) { return lm.wrist; },
    getRefDist:     function(lm) { return Math.abs(lm.wrist.y - lm.shoulder.y); },
    ratioFraction:  KP.SHOULDER_WRIST_RATIO,
    tolerance:      KP.CALIBRATION_TOLERANCE,
    distMin:        0.015,
    distMax:        0.45,
    readyMsg:       'Ready to press!',
    positionMsg:    'Hold lockout',
    badPositionMsg: 'Hold press at lockout - camera needs to see your full arm from the side',
  };

  Chronicle.exercises['kneeling-press'] = {
    key:           'kneeling-press',
    name:          'Kneeling Press',
    sessionName:   'Kneeling Press Session',
    readyMsg:      'Ready to press!',
    category:      'press',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 8,   // Shorter wrist travel than standing OHP

    hyperparams: KP,

    depthMarkers: [
      { inches: KP.DEPTH_MARKER_PARTIAL, color: 'rgba(255, 165, 0, 0.4)' },
      { inches: KP.DEPTH_MARKER_GOOD,    color: 'rgba(255, 255, 0, 0.4)' },
      { inches: KP.DEPTH_MARKER_FULL,    color: 'rgba(0, 255, 0, 0.4)' },
    ],

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      if (depthInches >= KP.DEPTH_MARKER_FULL)    return { emoji: '+++', label: 'Full ROM', color: '#00FF00' };
      if (depthInches >= KP.DEPTH_MARKER_GOOD)    return { emoji: '++',  label: 'Good',    color: '#90EE90' };
      if (depthInches >= KP.DEPTH_MARKER_PARTIAL) return { emoji: '+',   label: 'Partial', color: '#FFD700' };
      return { emoji: '!', label: 'Shallow', color: '#FFA500' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, KP, KP_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Kneeling Press Speed Analysis', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('Kneeling Press exercise module loaded');
})();
