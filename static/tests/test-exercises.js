// ========== Tests for Exercise Modules ==========
// Tests registration, detection, state machines, and rep counting.

(function() {
  const { suite, test, assert, assertEqual, assertApprox, assertInRange,
          createStandingLandmarks, createSquatLandmarks, createHingeLandmarks,
          createSingleLegLandmarks, createSumoLandmarks, createSplitStanceLandmarks,
          createMockUI, createMockUIWithRepCallback,
          calibrateState, simulateSquatRep, simulateHingeRep,
          mockTime, advanceTime } = TestHelpers;

  // ========== REGISTRY ==========
  suite('Exercise Registry', function() {
    test('all 7 exercises registered', function() {
      const keys = Chronicle.registry.keys();
      assert(keys.length >= 7, `Expected >= 7 exercises, got ${keys.length}`);
    });

    test('squat is registered', function() {
      assert(Chronicle.registry.get('squat') !== null, 'squat not found');
    });

    test('deadlift is registered', function() {
      assert(Chronicle.registry.get('deadlift') !== null, 'deadlift not found');
    });

    test('rdl is registered', function() {
      assert(Chronicle.registry.get('rdl') !== null, 'rdl not found');
    });

    test('single-leg-rdl is registered', function() {
      assert(Chronicle.registry.get('single-leg-rdl') !== null, 'single-leg-rdl not found');
    });

    test('hack-squat is registered', function() {
      assert(Chronicle.registry.get('hack-squat') !== null, 'hack-squat not found');
    });

    test('bulgarian-squat is registered', function() {
      assert(Chronicle.registry.get('bulgarian-squat') !== null, 'bulgarian-squat not found');
    });

    test('split-squat is registered', function() {
      assert(Chronicle.registry.get('split-squat') !== null, 'split-squat not found');
    });

    test('unknown exercise returns null', function() {
      assertEqual(Chronicle.registry.get('bicep-curl'), null);
    });

    test('getName returns display name', function() {
      assertEqual(Chronicle.registry.getName('squat'), 'Back Squat');
      assertEqual(Chronicle.registry.getName('rdl'), 'Romanian Deadlift');
    });

    test('getSessionName returns workout session name', function() {
      const name = Chronicle.registry.getSessionName('squat');
      assert(name.includes('Squat'), `Session name "${name}" should include Squat`);
    });

    test('byCategory groups exercises', function() {
      const cats = Chronicle.registry.byCategory();
      assert(cats.hasOwnProperty('squat'), 'should have squat category');
      assert(cats.hasOwnProperty('deadlift'), 'should have deadlift category');
    });

    test('all exercises have required interface', function() {
      Chronicle.registry.keys().forEach(function(key) {
        const ex = Chronicle.registry.get(key);
        assert(typeof ex.detect === 'function', `${key} missing detect()`);
        assert(typeof ex.reset === 'function', `${key} missing reset()`);
        assert(typeof ex.getQuality === 'function', `${key} missing getQuality()`);
        assert(typeof ex.name === 'string', `${key} missing name`);
        assert(typeof ex.sessionName === 'string', `${key} missing sessionName`);
        assert(typeof ex.category === 'string', `${key} missing category`);
        assert(typeof ex.isSingleLeg === 'boolean', `${key} missing isSingleLeg`);
      });
    });

    test('single-leg exercises flagged correctly', function() {
      assertEqual(Chronicle.registry.get('squat').isSingleLeg, false);
      assertEqual(Chronicle.registry.get('deadlift').isSingleLeg, false);
      assertEqual(Chronicle.registry.get('rdl').isSingleLeg, false);
      assertEqual(Chronicle.registry.get('single-leg-rdl').isSingleLeg, true);
      assertEqual(Chronicle.registry.get('hack-squat').isSingleLeg, false);
      assertEqual(Chronicle.registry.get('bulgarian-squat').isSingleLeg, true);
      assertEqual(Chronicle.registry.get('split-squat').isSingleLeg, true);
    });

    test('hinge exercises need shoulder tracking', function() {
      assertEqual(Chronicle.registry.get('deadlift').needsShoulder, true);
      assertEqual(Chronicle.registry.get('rdl').needsShoulder, true);
      assertEqual(Chronicle.registry.get('single-leg-rdl').needsShoulder, true);
      assertEqual(Chronicle.registry.get('squat').needsShoulder, false);
      assertEqual(Chronicle.registry.get('hack-squat').needsShoulder, false);
    });
  });

  // ========== BACK SQUAT ==========
  suite('Back Squat - Detection', function() {
    test('calibrates from standing position', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUI();

      const calibrated = calibrateState(state, module, ui);
      assert(calibrated, 'should calibrate successfully');
      assert(state.standingHipY !== null, 'standing hip Y should be set');
    });

    test('detects descent from standing', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUI();

      calibrateState(state, module, ui);

      // Let stability time pass
      advanceTime(1500);
      const standLm = createStandingLandmarks();
      module.detect(standLm, state, ui);

      // Start descending
      for (let i = 1; i <= 10; i++) {
        advanceTime(33);
        const lm = createSquatLandmarks({ depthNorm: i * 0.01 });
        module.detect(lm, state, ui);
      }

      assertEqual(state.state, 'descending', 'should enter descending state');
    });

    test('rejects shallow rep', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUIWithRepCallback();

      calibrateState(state, module, ui);

      // Very shallow movement (tiny depth)
      advanceTime(1500);
      const standLm = createStandingLandmarks();
      module.detect(standLm, state, ui);

      // Tiny descent
      for (let i = 0; i < 5; i++) {
        advanceTime(33);
        const lm = createSquatLandmarks({ depthNorm: 0.005 * (i + 1) });
        module.detect(lm, state, ui);
      }
      // Back up
      for (let i = 5; i >= 0; i--) {
        advanceTime(33);
        const lm = createSquatLandmarks({ depthNorm: 0.005 * i });
        module.detect(lm, state, ui);
      }

      assertEqual(ui.reps.length, 0, 'shallow rep should not count');
    });

    test('quality assessment is correct', function() {
      const module = Chronicle.registry.get('squat');
      assertEqual(module.getQuality(18).label, 'Deep');
      assertEqual(module.getQuality(16).label, 'Parallel');
      assertEqual(module.getQuality(10).label, 'Half');
      assertEqual(module.getQuality(3).label, 'Shallow');
    });

    test('has depth markers', function() {
      const module = Chronicle.registry.get('squat');
      assert(module.depthMarkers !== null, 'should have depth markers');
      assert(module.depthMarkers.length >= 3, 'should have at least 3 markers');
    });
  });

  // ========== DEADLIFT ==========
  suite('Deadlift - Detection', function() {
    test('calibrates with torso angle', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('deadlift');
      const ui = createMockUI();

      const landmarks = createHingeLandmarks({ angleDeg: 5 });
      const calibrated = calibrateState(state, module, ui, { landmarks: landmarks });
      assert(calibrated, 'should calibrate');
      assert(state.standingTorsoAngle !== null, 'standing torso angle should be set');
    });

    test('quality is based on lockout angle', function() {
      const module = Chronicle.registry.get('deadlift');
      assertEqual(module.getQuality(3).label, 'Full Lockout');
      assertEqual(module.getQuality(15).label, 'Partial');
    });

    test('stance detection during calibration', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('deadlift');
      const ui = createMockUI();

      // Use sumo landmarks
      const landmarks = createSumoLandmarks({ angleDeg: 5 });
      calibrateState(state, module, ui, { landmarks: landmarks });

      assertEqual(state.detectedStance, 'sumo', 'should detect sumo stance');
    });

    test('conventional stance detected', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('deadlift');
      const ui = createMockUI();

      const landmarks = createHingeLandmarks({ angleDeg: 5 });
      // Make all landmarks visible for stance detection
      for (let i = 0; i < landmarks.length; i++) {
        if (landmarks[i].visibility < 0.5) landmarks[i].visibility = 0.7;
      }
      // Set conventional stance: ankles at hip width
      landmarks[23].x = 0.45;
      landmarks[24].x = 0.55;
      landmarks[27].x = 0.47;
      landmarks[28].x = 0.53;

      calibrateState(state, module, ui, { landmarks: landmarks });

      assertEqual(state.detectedStance, 'conventional', 'should detect conventional stance');
    });

    test('has no depth markers (hinge exercise)', function() {
      const module = Chronicle.registry.get('deadlift');
      assertEqual(module.depthMarkers, null, 'hinge exercises should not have depth markers');
    });

    test('reset clears deadlift-specific state', function() {
      const state = Chronicle.createState();
      state.standingTorsoAngle = 5;
      state.detectedStance = 'sumo';
      state.dlSmoothedAngle = 30;
      state.prevTorsoAngle = 25;

      const module = Chronicle.registry.get('deadlift');
      module.reset(state);

      assertEqual(state.standingTorsoAngle, null);
      assertEqual(state.detectedStance, null);
      assertEqual(state.dlSmoothedAngle, null);
      assertEqual(state.prevTorsoAngle, null);
    });
  });

  // ========== RDL ==========
  suite('RDL - Detection', function() {
    test('module properties', function() {
      const module = Chronicle.registry.get('rdl');
      assertEqual(module.name, 'Romanian Deadlift');
      assertEqual(module.category, 'deadlift');
      assertEqual(module.isSingleLeg, false);
      assertEqual(module.needsShoulder, true);
    });

    test('quality is based on hinge depth', function() {
      const module = Chronicle.registry.get('rdl');
      assertEqual(module.getQuality(75).label, 'Full Stretch');
      assertEqual(module.getQuality(55).label, 'Parallel');
      assertEqual(module.getQuality(35).label, 'Partial');
      assertEqual(module.getQuality(20).label, 'Shallow');
    });

    test('calibrates correctly', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('rdl');
      const ui = createMockUI();

      const landmarks = createHingeLandmarks({ angleDeg: 3 });
      const calibrated = calibrateState(state, module, ui, { landmarks: landmarks });
      assert(calibrated, 'should calibrate');
    });

    test('reset clears hinge state', function() {
      const state = Chronicle.createState();
      state.standingTorsoAngle = 5;
      state.deepestTorsoAngle = 60;
      state.dlSmoothedAngle = 30;

      const module = Chronicle.registry.get('rdl');
      module.reset(state);

      assertEqual(state.standingTorsoAngle, null);
      assertEqual(state.deepestTorsoAngle, null);
      assertEqual(state.dlSmoothedAngle, null);
    });
  });

  // ========== SINGLE LEG RDL ==========
  suite('Single Leg RDL - Detection', function() {
    test('module properties', function() {
      const module = Chronicle.registry.get('single-leg-rdl');
      assertEqual(module.name, 'Single Leg RDL');
      assertEqual(module.category, 'deadlift');
      assertEqual(module.isSingleLeg, true);
      assertEqual(module.needsShoulder, true);
    });

    test('has more forgiving thresholds than bilateral RDL', function() {
      const rdl = Chronicle.registry.get('rdl');
      const slrdl = Chronicle.registry.get('single-leg-rdl');
      assert(slrdl.hyperparams.HINGE_START_THRESHOLD < rdl.hyperparams.HINGE_START_THRESHOLD,
        'SL-RDL should have lower start threshold');
      assert(slrdl.hyperparams.RETURN_RECOVERY_PERCENT < rdl.hyperparams.RETURN_RECOVERY_PERCENT,
        'SL-RDL should have lower recovery requirement');
    });

    test('reset clears side tracking', function() {
      const state = Chronicle.createState();
      state.workingSide = 'left';
      state.sideReps = { left: 5, right: 3 };
      state.sideChangeDetected = true;

      const module = Chronicle.registry.get('single-leg-rdl');
      module.reset(state);

      assertEqual(state.workingSide, null);
      assertEqual(state.sideReps.left, 0);
      assertEqual(state.sideReps.right, 0);
      assertEqual(state.sideChangeDetected, false);
    });
  });

  // ========== HACK SQUAT ==========
  suite('Hack Squat - Detection', function() {
    test('module properties', function() {
      const module = Chronicle.registry.get('hack-squat');
      assertEqual(module.name, 'Hack Squat');
      assertEqual(module.category, 'squat');
      assertEqual(module.isSingleLeg, false);
      assertEqual(module.needsShoulder, false);
    });

    test('has lower thresholds than back squat', function() {
      const squat = Chronicle.registry.get('squat');
      const hack = Chronicle.registry.get('hack-squat');
      assert(hack.hyperparams.MIN_DEPTH_INCHES <= squat.hyperparams.MIN_DEPTH_INCHES,
        'hack squat should have lower/equal min depth');
      assert(hack.hyperparams.DESCENT_THRESHOLD_INCHES <= squat.hyperparams.DESCENT_THRESHOLD_INCHES,
        'hack squat should have lower/equal descent threshold');
    });

    test('has 5-tier quality assessment', function() {
      const module = Chronicle.registry.get('hack-squat');
      assertEqual(module.getQuality(19).label, 'Deep');
      assertEqual(module.getQuality(15).label, 'Parallel');
      assertEqual(module.getQuality(9).label, 'Half');
      assertEqual(module.getQuality(5).label, 'Quarter');
      assertEqual(module.getQuality(2).label, 'Shallow');
    });

    test('has depth markers', function() {
      const module = Chronicle.registry.get('hack-squat');
      assert(module.depthMarkers !== null);
      assert(module.depthMarkers.length >= 3);
    });

    test('calibrates successfully', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('hack-squat');
      const ui = createMockUI();

      const calibrated = calibrateState(state, module, ui);
      assert(calibrated, 'should calibrate');
    });
  });

  // ========== BULGARIAN SPLIT SQUAT ==========
  suite('Bulgarian Split Squat - Detection', function() {
    test('module properties', function() {
      const module = Chronicle.registry.get('bulgarian-squat');
      assertEqual(module.name, 'Bulgarian Split Squat');
      assertEqual(module.category, 'squat');
      assertEqual(module.isSingleLeg, true);
      assertEqual(module.needsShoulder, false);
    });

    test('has lower recovery threshold for balance', function() {
      const squat = Chronicle.registry.get('squat');
      const bulg = Chronicle.registry.get('bulgarian-squat');
      assert(bulg.hyperparams.RECOVERY_PERCENT < squat.hyperparams.RECOVERY_PERCENT,
        'bulgarian should have lower recovery requirement');
    });

    test('has more confirmation frames for side change', function() {
      const bulg = Chronicle.registry.get('bulgarian-squat');
      assert(bulg.hyperparams.SIDE_CONFIRMATION_FRAMES >= 8,
        'should require 8+ frames to confirm side change');
    });

    test('has longer side change cooldown', function() {
      const bulg = Chronicle.registry.get('bulgarian-squat');
      assert(bulg.hyperparams.SIDE_CHANGE_COOLDOWN_MS >= 3000,
        'should have 3s+ cooldown between side changes');
    });

    test('quality assessment tiers', function() {
      const module = Chronicle.registry.get('bulgarian-squat');
      assertEqual(module.getQuality(17).label, 'Deep');
      assertEqual(module.getQuality(13).label, 'Parallel');
      assertEqual(module.getQuality(8).label, 'Half');
      assertEqual(module.getQuality(5).label, 'Quarter');
      assertEqual(module.getQuality(2).label, 'Shallow');
    });

    test('reset clears single-leg state', function() {
      const state = Chronicle.createState();
      state.workingSide = 'right';
      state.sideReps = { left: 3, right: 5 };
      state.sideChangeDetected = true;

      const module = Chronicle.registry.get('bulgarian-squat');
      module.reset(state);

      assertEqual(state.workingSide, null);
      assertEqual(state.sideReps.left, 0);
      assertEqual(state.sideReps.right, 0);
    });

    test('has depth markers', function() {
      const module = Chronicle.registry.get('bulgarian-squat');
      assert(module.depthMarkers !== null);
      assert(module.depthMarkers.length >= 3);
    });
  });

  // ========== SPLIT SQUAT ==========
  suite('Split Squat - Detection', function() {
    test('module properties', function() {
      const module = Chronicle.registry.get('split-squat');
      assertEqual(module.name, 'Split Squat');
      assertEqual(module.category, 'squat');
      assertEqual(module.isSingleLeg, true);
      assertEqual(module.needsShoulder, false);
    });

    test('similar parameters to bulgarian', function() {
      const split = Chronicle.registry.get('split-squat');
      const bulg = Chronicle.registry.get('bulgarian-squat');
      assert(Math.abs(split.hyperparams.MIN_DEPTH_INCHES - bulg.hyperparams.MIN_DEPTH_INCHES) <= 2,
        'split and bulgarian should have similar min depths');
    });

    test('quality assessment tiers', function() {
      const module = Chronicle.registry.get('split-squat');
      assertEqual(module.getQuality(16).label, 'Deep');
      assertEqual(module.getQuality(12).label, 'Parallel');
      assertEqual(module.getQuality(8).label, 'Half');
      assertEqual(module.getQuality(5).label, 'Quarter');
      assertEqual(module.getQuality(2).label, 'Shallow');
    });

    test('reset clears side tracking', function() {
      const state = Chronicle.createState();
      state.workingSide = 'left';
      state.sideReps = { left: 4, right: 3 };

      const module = Chronicle.registry.get('split-squat');
      module.reset(state);

      assertEqual(state.workingSide, null);
      assertEqual(state.sideReps.left, 0);
      assertEqual(state.sideReps.right, 0);
    });

    test('has depth markers', function() {
      const module = Chronicle.registry.get('split-squat');
      assert(module.depthMarkers !== null);
      assert(module.depthMarkers.length >= 3);
    });
  });

  // ========== STATE MACHINE TRANSITIONS ==========
  suite('State Machine - Transitions', function() {
    test('squat: standing -> descending transition', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUI();

      calibrateState(state, module, ui);
      assertEqual(state.state, 'standing');

      // Let stability time pass
      advanceTime(1500);
      module.detect(createStandingLandmarks(), state, ui);

      // Start descent
      for (let i = 1; i <= 12; i++) {
        advanceTime(33);
        module.detect(createSquatLandmarks({ depthNorm: i * 0.01 }), state, ui);
      }

      assertEqual(state.state, 'descending', 'should transition to descending');
    });

    test('state timeout resets to standing', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUI();

      calibrateState(state, module, ui);

      // Enter descending
      state.state = 'descending';
      state.stateStartTime = performance.now();

      // Wait past timeout
      advanceTime(Chronicle.CONSTANTS.MAX_DESCENT_TIME_MS + 100);
      module.detect(createSquatLandmarks({ depthNorm: 0.05 }), state, ui);

      assertEqual(state.state, 'standing', 'should timeout and reset to standing');
    });

    test('tracking loss resets state', function() {
      mockTime(0);
      const state = Chronicle.createState();
      const module = Chronicle.registry.get('squat');
      const ui = createMockUI();

      calibrateState(state, module, ui);
      state.state = 'descending';

      // Feed invisible landmarks
      const badLandmarks = [];
      for (let i = 0; i < 33; i++) {
        badLandmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 });
      }

      for (let i = 0; i < Chronicle.CONSTANTS.TRACKING_LOSS_TOLERANCE_FRAMES + 5; i++) {
        advanceTime(33);
        module.detect(badLandmarks, state, ui);
      }

      assertEqual(state.state, 'standing', 'should reset after tracking loss');
    });
  });

  // ========== HYPERPARAMETER VALIDATION ==========
  suite('Hyperparameter Validation', function() {
    test('all squat-type exercises have positive MIN_DEPTH_INCHES', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.hyperparams.MIN_DEPTH_INCHES > 0, `${key} MIN_DEPTH_INCHES should be > 0`);
      });
    });

    test('all squat-type exercises have positive DESCENT_THRESHOLD', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.hyperparams.DESCENT_THRESHOLD_INCHES > 0, `${key} DESCENT_THRESHOLD should be > 0`);
      });
    });

    test('MIN_DEPTH > DESCENT_THRESHOLD for squat types', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.hyperparams.MIN_DEPTH_INCHES >= module.hyperparams.DESCENT_THRESHOLD_INCHES,
          `${key}: MIN_DEPTH should be >= DESCENT_THRESHOLD`);
      });
    });

    test('recovery percent in valid range (50-100)', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assertInRange(module.hyperparams.RECOVERY_PERCENT, 50, 100,
          `${key}: RECOVERY_PERCENT should be 50-100`);
      });
    });

    test('hinge exercises have reasonable angle thresholds', function() {
      ['rdl', 'single-leg-rdl'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.hyperparams.HINGE_START_THRESHOLD > 0 && module.hyperparams.HINGE_START_THRESHOLD < 90,
          `${key}: HINGE_START should be 0-90`);
        assert(module.hyperparams.MIN_HINGE_ANGLE > module.hyperparams.HINGE_START_THRESHOLD,
          `${key}: MIN_HINGE should be > HINGE_START`);
      });
    });

    test('deadlift has valid setup angle thresholds', function() {
      const dl = Chronicle.registry.get('deadlift');
      assert(dl.hyperparams.SETUP_ANGLE_THRESHOLD > 0, 'SETUP_ANGLE should be > 0');
      assert(dl.hyperparams.LOCKOUT_ANGLE_THRESHOLD < dl.hyperparams.SETUP_ANGLE_THRESHOLD,
        'LOCKOUT should be < SETUP angle');
      assert(dl.hyperparams.SUMO_SETUP_ANGLE_THRESHOLD < dl.hyperparams.SETUP_ANGLE_THRESHOLD,
        'Sumo SETUP angle should be less (more upright torso)');
    });

    test('single-leg exercises have side change cooldown', function() {
      ['single-leg-rdl', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.hyperparams.SIDE_CHANGE_COOLDOWN_MS >= 1000,
          `${key}: cooldown should be >= 1s`);
        assert(module.hyperparams.SIDE_CONFIRMATION_FRAMES >= 3,
          `${key}: confirmation frames should be >= 3`);
      });
    });
  });

  // ========== EXERCISE CATEGORY CONSISTENCY ==========
  suite('Exercise Categories', function() {
    test('squat-type exercises are in squat category', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        assertEqual(Chronicle.registry.get(key).category, 'squat',
          `${key} should be in squat category`);
      });
    });

    test('hinge exercises are in deadlift category', function() {
      ['deadlift', 'rdl', 'single-leg-rdl'].forEach(function(key) {
        assertEqual(Chronicle.registry.get(key).category, 'deadlift',
          `${key} should be in deadlift category`);
      });
    });

    test('squat-type exercises have depthMarkers', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assert(module.depthMarkers !== null && module.depthMarkers.length > 0,
          `${key} should have depth markers`);
      });
    });

    test('hinge exercises have null depthMarkers', function() {
      ['deadlift', 'rdl', 'single-leg-rdl'].forEach(function(key) {
        const module = Chronicle.registry.get(key);
        assertEqual(module.depthMarkers, null, `${key} should have null depth markers`);
      });
    });

    test('hinge exercises need shoulder tracking', function() {
      ['deadlift', 'rdl', 'single-leg-rdl'].forEach(function(key) {
        assertEqual(Chronicle.registry.get(key).needsShoulder, true, `${key} should need shoulder`);
      });
    });

    test('squat-type exercises do not need shoulder', function() {
      ['squat', 'hack-squat', 'bulgarian-squat', 'split-squat'].forEach(function(key) {
        assertEqual(Chronicle.registry.get(key).needsShoulder, false, `${key} should not need shoulder`);
      });
    });
  });
})();
