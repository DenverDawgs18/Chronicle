// ========== Pec Fly / Machine Fly Exercise Module ==========
// Velocity-only tracker for pec dec, machine fly, etc.
// Very relaxed ROM thresholds - we're just tracking concentric speed.
// Camera: side view so shoulder, elbow, and wrist are visible.
// Delegates detection to Chronicle.pressUtils (press-base.js).

(function() {
  var PEC_FLY = {
    MIN_DEPTH_INCHES: 1.5,            // Very low - just needs to detect movement
    DESCENT_THRESHOLD_INCHES: 1.0,    // Easy to trigger
    RECOVERY_PERCENT: 65,             // Forgiving lockout
    DESCENT_VELOCITY_MIN: 0.0008,
    DEPTH_TRIGGER_MULTIPLIER: 1.3,
    RECOVERY_WARNING_THRESHOLD: 35,

    // No meaningful depth markers for flies - velocity only
    DEPTH_MARKER_PARTIAL: 1.5,
    DEPTH_MARKER_PARALLEL: 4,
    DEPTH_MARKER_DEEP: 7,

    // Calibration
    SHOULDER_WRIST_RATIO: 0.37,
    CALIBRATION_TOLERANCE: 0.20,      // More forgiving calibration
  };

  var PEC_FLY_CAL = {
    elbowFallback:  false,
    ascentVerb:     'Fly',
    getTrackPoint:  function(lm) { return lm.wrist; },
    getRefDist:     function(lm) { return Math.abs(lm.wrist.y - lm.shoulder.y); },
    ratioFraction:  PEC_FLY.SHOULDER_WRIST_RATIO,
    tolerance:      PEC_FLY.CALIBRATION_TOLERANCE,
    distMin:        0.015,
    distMax:        0.45,
    readyMsg:       'Ready to fly!',
    positionMsg:    'Hold start position',
    badPositionMsg: 'Position camera to see your full arm from the side',
  };

  Chronicle.exercises['pec-fly'] = {
    key:           'pec-fly',
    name:          'Pec Fly',
    sessionName:   'Pec Fly Session',
    readyMsg:      'Ready to fly!',
    category:      'fly',
    isSingleLeg:   false,
    needsShoulder: false,
    needsWrist:    true,
    referenceDepth: 8,

    hyperparams: PEC_FLY,

    depthMarkers: [],   // No depth markers - velocity only

    cameraHint: 'Camera needs to see: Shoulder, Elbow, Wrist (side view)',

    getQuality: function(depthInches) {
      // No ROM judgment - always return neutral
      return { emoji: '', label: 'rep', color: '#90EE90' };
    },

    detect: function(landmarks, state, ui) {
      Chronicle.pressUtils.detectPress(landmarks, state, ui, this, PEC_FLY, PEC_FLY_CAL);
    },

    displayRepTimes: function(state, msgEl) {
      Chronicle.pressUtils.displayRepTimes(state, msgEl, 'Pec Fly Speed', this.getQuality.bind(this), this.referenceDepth);
    },

    reset: function(state) {
      // No module-specific state beyond shared fields
    },
  };

  console.log('Pec Fly exercise module loaded');
})();
