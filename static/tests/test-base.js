// ========== Tests for Chronicle Base Module ==========
// Tests shared utilities, state management, calibration, and detection helpers.

(function() {
  const { suite, test, assert, assertEqual, assertApprox, assertInRange,
          createStandingLandmarks, createHingeLandmarks, createSingleLegLandmarks,
          createSumoLandmarks, createMockUI, mockTime, advanceTime } = TestHelpers;

  // ========== STATE CREATION ==========
  suite('Chronicle.createState', function() {
    test('returns a fresh state object', function() {
      const state = Chronicle.createState();
      assert(state !== null, 'state should not be null');
      assertEqual(state.state, 'standing', 'initial state should be standing');
      assertEqual(state.repCount, 0, 'initial rep count should be 0');
      assertEqual(state.isCalibrated, false, 'should not be calibrated');
    });

    test('each call returns a new independent state', function() {
      const s1 = Chronicle.createState();
      const s2 = Chronicle.createState();
      s1.repCount = 5;
      assertEqual(s2.repCount, 0, 'states should be independent');
    });

    test('state has all required properties', function() {
      const state = Chronicle.createState();
      assert(state.hasOwnProperty('state'), 'missing state');
      assert(state.hasOwnProperty('repCount'), 'missing repCount');
      assert(state.hasOwnProperty('isCalibrated'), 'missing isCalibrated');
      assert(state.hasOwnProperty('calibrationHipYValues'), 'missing calibrationHipYValues');
      assert(state.hasOwnProperty('standingHipY'), 'missing standingHipY');
      assert(state.hasOwnProperty('smoothedHipY'), 'missing smoothedHipY');
      assert(state.hasOwnProperty('velocityHistory'), 'missing velocityHistory');
      assert(state.hasOwnProperty('lockedSide'), 'missing lockedSide');
      assert(state.hasOwnProperty('workingSide'), 'missing workingSide');
      assert(state.hasOwnProperty('sideReps'), 'missing sideReps');
      assert(state.hasOwnProperty('detectedStance'), 'missing detectedStance');
      assert(state.hasOwnProperty('debugInfo'), 'missing debugInfo');
    });

    test('sideReps initialized to zero for both sides', function() {
      const state = Chronicle.createState();
      assertEqual(state.sideReps.left, 0, 'left reps should be 0');
      assertEqual(state.sideReps.right, 0, 'right reps should be 0');
    });
  });

  // ========== UTILITY FUNCTIONS ==========
  suite('Chronicle.utils - Conversions', function() {
    test('normToInches converts using calibrated scale', function() {
      const state = { inchesPerUnit: 100 };
      assertApprox(Chronicle.utils.normToInches(0.1, state), 10, 0.01);
    });

    test('normToInches returns 0 when not calibrated', function() {
      const state = { inchesPerUnit: null };
      assertEqual(Chronicle.utils.normToInches(0.1, state), 0);
    });

    test('inchesToNorm converts back correctly', function() {
      const state = { inchesPerUnit: 100 };
      assertApprox(Chronicle.utils.inchesToNorm(10, state), 0.1, 0.001);
    });

    test('normToInches and inchesToNorm are inverse operations', function() {
      const state = { inchesPerUnit: 150 };
      const inches = 15;
      const norm = Chronicle.utils.inchesToNorm(inches, state);
      const back = Chronicle.utils.normToInches(norm, state);
      assertApprox(back, inches, 0.001);
    });
  });

  suite('Chronicle.utils - Speed Score', function() {
    test('calculates speed score correctly', function() {
      // 1000 / (time / depth) = 1000 / (1.0 / 15) = 15000
      const score = Chronicle.utils.calculateSpeedScore(1.0, 15);
      assertEqual(score, 15000);
    });

    test('returns 0 for zero depth', function() {
      assertEqual(Chronicle.utils.calculateSpeedScore(1.0, 0), 0);
    });

    test('returns 0 for zero time', function() {
      assertEqual(Chronicle.utils.calculateSpeedScore(0, 15), 0);
    });

    test('returns 0 for negative values', function() {
      assertEqual(Chronicle.utils.calculateSpeedScore(-1, 15), 0);
      assertEqual(Chronicle.utils.calculateSpeedScore(1, -5), 0);
    });

    test('faster reps produce higher scores', function() {
      const fast = Chronicle.utils.calculateSpeedScore(0.5, 15);
      const slow = Chronicle.utils.calculateSpeedScore(2.0, 15);
      assert(fast > slow, `fast (${fast}) should be > slow (${slow})`);
    });

    test('no referenceDepth gives backward-compatible result', function() {
      // Without referenceDepth, should behave exactly as before
      const score = Chronicle.utils.calculateSpeedScore(1.0, 15);
      assertEqual(score, 15000);
    });

    test('referenceDepth equal to standard produces same result', function() {
      // referenceDepth == STANDARD_REFERENCE_DEPTH (15) should be identity
      const score = Chronicle.utils.calculateSpeedScore(1.0, 15, 15);
      assertEqual(score, 15000);
    });

    test('smaller referenceDepth scales score up', function() {
      // RDL with 8" reference: 8" depth at 1.0s should equal squat 15" depth at 1.0s
      const rdlScore = Chronicle.utils.calculateSpeedScore(1.0, 8, 8);
      const squatScore = Chronicle.utils.calculateSpeedScore(1.0, 15, 15);
      assertEqual(rdlScore, squatScore, 'same speed effort should produce same score');
    });

    test('normalization makes exercises comparable', function() {
      // A fast squat and a fast RDL at the reference depth should score the same
      const squatScore = Chronicle.utils.calculateSpeedScore(0.7, 15, 15);
      const deadliftScore = Chronicle.utils.calculateSpeedScore(0.7, 12, 12);
      const rdlScore = Chronicle.utils.calculateSpeedScore(0.7, 8, 8);
      const slrdlScore = Chronicle.utils.calculateSpeedScore(0.7, 6, 6);

      // All should be equal since each exercise is at its reference depth
      assertEqual(squatScore, deadliftScore, 'squat and deadlift at ref depths should match');
      assertEqual(squatScore, rdlScore, 'squat and RDL at ref depths should match');
      assertEqual(squatScore, slrdlScore, 'squat and SL-RDL at ref depths should match');
    });

    test('deeper rep still scores higher within same exercise', function() {
      // Going deeper than reference should still give a higher score
      const normalDepth = Chronicle.utils.calculateSpeedScore(1.0, 15, 15);
      const deeperRep = Chronicle.utils.calculateSpeedScore(1.0, 18, 15);
      assert(deeperRep > normalDepth, `deeper (${deeperRep}) should be > normal (${normalDepth})`);
    });
  });

  suite('Chronicle.utils - Torso Angle', function() {
    test('vertical torso returns ~0 degrees', function() {
      // Shoulder directly above hip
      const angle = Chronicle.utils.calculateTorsoAngle(0.5, 0.3, 0.5, 0.5);
      assertApprox(angle, 0, 1);
    });

    test('horizontal torso returns ~90 degrees', function() {
      // Shoulder and hip at same Y, shoulder far to the side
      const angle = Chronicle.utils.calculateTorsoAngle(0.8, 0.5, 0.5, 0.5);
      assert(angle > 85, `Angle ${angle} should be close to 90`);
    });

    test('45 degree angle', function() {
      // Equal dx and dy
      const angle = Chronicle.utils.calculateTorsoAngle(0.7, 0.3, 0.5, 0.5);
      assertApprox(angle, 45, 2);
    });
  });

  suite('Chronicle.utils - Knee Angle', function() {
    test('straight leg returns ~180 degrees', function() {
      // Hip, knee, ankle in a straight vertical line
      const angle = Chronicle.utils.calculateKneeAngle(0.5, 0.3, 0.5, 0.5, 0.5, 0.7);
      assertApprox(angle, 180, 1);
    });

    test('bent knee returns less than 180', function() {
      // Knee pushed forward
      const angle = Chronicle.utils.calculateKneeAngle(0.5, 0.3, 0.6, 0.5, 0.5, 0.7);
      assert(angle < 180, `Angle ${angle} should be < 180 for bent knee`);
    });

    test('right angle knee returns ~90', function() {
      const angle = Chronicle.utils.calculateKneeAngle(0.5, 0.3, 0.5, 0.5, 0.7, 0.5);
      assertApprox(angle, 90, 5);
    });
  });

  // ========== POSITION PROCESSING ==========
  suite('Chronicle.utils - Position Processing', function() {
    test('first position is accepted without smoothing', function() {
      const state = Chronicle.createState();
      const result = Chronicle.utils.processHipPosition(0.5, 0.5, state);
      assertEqual(result.rejected, false, 'first frame should not be rejected');
      assertApprox(result.hipY, 0.5, 0.01);
    });

    test('smooth movement is accepted', function() {
      const state = Chronicle.createState();
      Chronicle.utils.processHipPosition(0.5, 0.5, state);

      // Many small movements to build history
      for (let i = 0; i < 15; i++) {
        Chronicle.utils.processHipPosition(0.5 + i * 0.001, 0.5, state);
      }

      const result = Chronicle.utils.processHipPosition(0.515, 0.5, state);
      assertEqual(result.rejected, false, 'smooth movement should be accepted');
    });

    test('outlier jump is rejected', function() {
      const state = Chronicle.createState();

      // Build up position history with small movements
      for (let i = 0; i < 15; i++) {
        Chronicle.utils.processHipPosition(0.5 + i * 0.0005, 0.5, state);
      }

      // Massive jump should be rejected
      const result = Chronicle.utils.processHipPosition(0.9, 0.5, state);
      assertEqual(result.rejected, true, 'large jump should be rejected as outlier');
    });

    test('position smoothing applies EMA', function() {
      const state = Chronicle.createState();
      Chronicle.utils.processHipPosition(0.5, 0.5, state);

      const result = Chronicle.utils.processHipPosition(0.6, 0.5, state);
      // EMA with alpha=0.5: 0.5 * 0.5 + 0.6 * 0.5 = 0.55
      assertApprox(result.hipY, 0.55, 0.01, 'smoothed position should be EMA');
    });
  });

  // ========== SMOOTHING ==========
  suite('Chronicle.utils - Smoothing', function() {
    test('smoothPosition returns raw value when no previous', function() {
      const result = Chronicle.utils.smoothPosition(0.5, null);
      assertApprox(result, 0.5, 0.001);
    });

    test('smoothPosition applies EMA correctly', function() {
      const result = Chronicle.utils.smoothPosition(1.0, 0.0, 0.3);
      assertApprox(result, 0.3, 0.001); // 0 * 0.7 + 1.0 * 0.3
    });

    test('custom alpha parameter works', function() {
      const result = Chronicle.utils.smoothPosition(1.0, 0.0, 0.8);
      assertApprox(result, 0.8, 0.001); // 0 * 0.2 + 1.0 * 0.8
    });
  });

  // ========== SIDE DETECTION ==========
  suite('Chronicle.utils - Side Detection', function() {
    test('detects left side when left landmarks more visible', function() {
      const state = Chronicle.createState();
      const landmarks = createStandingLandmarks({ side: 'left' });
      const result = Chronicle.utils.detectSide(landmarks, state);

      assert(result.valid, 'should be valid');
      assertEqual(state.lockedSide, 'left', 'should lock to left side');
    });

    test('detects right side when right landmarks more visible', function() {
      const state = Chronicle.createState();
      const landmarks = createStandingLandmarks({ side: 'right' });
      const result = Chronicle.utils.detectSide(landmarks, state);

      assert(result.valid, 'should be valid');
      assertEqual(state.lockedSide, 'right', 'should lock to right side');
    });

    test('invalid when no landmarks visible', function() {
      const state = Chronicle.createState();
      const landmarks = [];
      for (let i = 0; i < 33; i++) {
        landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 });
      }
      const result = Chronicle.utils.detectSide(landmarks, state);
      assertEqual(result.valid, false, 'should be invalid');
    });

    test('side stays locked once set', function() {
      const state = Chronicle.createState();
      const leftLm = createStandingLandmarks({ side: 'left' });
      Chronicle.utils.detectSide(leftLm, state);
      assertEqual(state.lockedSide, 'left');

      // Even with slightly better right visibility, stays locked
      const ambiguousLm = createStandingLandmarks({ side: 'left' });
      ambiguousLm[26].visibility = 0.85; // right knee slightly more visible
      Chronicle.utils.detectSide(ambiguousLm, state);
      assertEqual(state.lockedSide, 'left', 'side should remain locked');
    });
  });

  // ========== WORKING LEG DETECTION ==========
  suite('Chronicle.utils - Working Leg Detection', function() {
    test('detects left planted leg when left ankle is lower', function() {
      const state = Chronicle.createState();
      const landmarks = createSingleLegLandmarks({ plantedSide: 'left' });
      const result = Chronicle.utils.detectWorkingLeg(landmarks, state);

      assert(result.valid, 'should be valid');
      assertEqual(state.workingSide, 'left', 'left should be working side (planted)');
    });

    test('detects right planted leg', function() {
      const state = Chronicle.createState();
      const landmarks = createSingleLegLandmarks({ plantedSide: 'right' });
      const result = Chronicle.utils.detectWorkingLeg(landmarks, state);

      assert(result.valid, 'should be valid');
      assertEqual(state.workingSide, 'right', 'right should be working side');
    });

    test('detects side change', function() {
      const state = Chronicle.createState();
      state.state = 'standing';

      // First: left planted
      const leftLm = createSingleLegLandmarks({ plantedSide: 'left' });
      Chronicle.utils.detectWorkingLeg(leftLm, state);
      assertEqual(state.workingSide, 'left');

      // Switch to right planted
      const rightLm = createSingleLegLandmarks({ plantedSide: 'right' });
      const result = Chronicle.utils.detectWorkingLeg(rightLm, state);
      assertEqual(state.workingSide, 'right');
      assert(result.sideChanged, 'should detect side change');
    });

    test('no side change detected during non-standing state', function() {
      const state = Chronicle.createState();
      state.state = 'descending';

      const leftLm = createSingleLegLandmarks({ plantedSide: 'left' });
      Chronicle.utils.detectWorkingLeg(leftLm, state);
      state.workingSide = 'left';

      const rightLm = createSingleLegLandmarks({ plantedSide: 'right' });
      state.state = 'descending';
      const result = Chronicle.utils.detectWorkingLeg(rightLm, state);
      assertEqual(result.sideChanged, false, 'no side change during descent');
    });
  });

  // ========== STANCE DETECTION ==========
  suite('Chronicle.utils - Stance Detection', function() {
    test('detects conventional stance with narrow feet', function() {
      const landmarks = createStandingLandmarks();
      // Make both sides visible
      for (let i = 0; i < landmarks.length; i++) {
        if (landmarks[i].visibility < 0.5) landmarks[i].visibility = 0.7;
      }
      // Hips wider than ankles
      landmarks[23].x = 0.45;
      landmarks[24].x = 0.55;
      landmarks[27].x = 0.47;
      landmarks[28].x = 0.53;

      const result = Chronicle.utils.detectStance(landmarks);
      assertEqual(result, 'conventional', 'narrow stance should be conventional');
    });

    test('detects sumo stance with wide feet', function() {
      const landmarks = createSumoLandmarks();
      const result = Chronicle.utils.detectStance(landmarks);
      assertEqual(result, 'sumo', 'wide stance should be sumo');
    });

    test('returns null with insufficient visibility', function() {
      const landmarks = createStandingLandmarks();
      // Keep low visibility
      const result = Chronicle.utils.detectStance(landmarks);
      assertEqual(result, null, 'should return null with low visibility');
    });
  });

  // ========== CALIBRATION ==========
  suite('Chronicle.utils - Calibration', function() {
    test('calibration requires multiple stable frames', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.getUserHeight = function() { return 68; };
      const ui = createMockUI();

      // First frame
      const result1 = Chronicle.utils.calibrateHipBaseline(0.5, 0.5, 0.62, null, state, ui.feedback, 'Ready');
      assertEqual(result1, true, 'calibration in progress');
      assertEqual(state.isCalibrated, false, 'not yet calibrated');
    });

    test('calibration succeeds after enough stable frames', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.getUserHeight = function() { return 68; };
      const ui = createMockUI();

      // Feed stable positions
      for (let i = 0; i < 10; i++) {
        advanceTime(100);
        Chronicle.utils.calibrateHipBaseline(0.5, 0.5, 0.62, null, state, ui.feedback, 'Ready');
      }

      assert(state.isCalibrated, 'should be calibrated after stable frames');
      assertApprox(state.standingHipY, 0.5, 0.01, 'standing hip Y should be set');
      assert(state.inchesPerUnit > 0, 'inches per unit should be positive');
    });

    test('calibration resets with too much movement', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.getUserHeight = function() { return 68; };
      const ui = createMockUI();

      // First stable frame
      Chronicle.utils.calibrateHipBaseline(0.5, 0.5, 0.62, null, state, ui.feedback, 'Ready');
      assertEqual(state.calibrationHipYValues.length, 1);

      // Large movement
      advanceTime(100);
      Chronicle.utils.calibrateHipBaseline(0.8, 0.5, 0.92, null, state, ui.feedback, 'Ready');
      assertEqual(state.calibrationHipYValues.length, 0, 'should reset calibration on movement');
    });

    test('calibration stores torso angle when provided', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.getUserHeight = function() { return 68; };
      const ui = createMockUI();

      for (let i = 0; i < 10; i++) {
        advanceTime(100);
        Chronicle.utils.calibrateHipBaseline(0.5, 0.5, 0.62, 5.0, state, ui.feedback, 'Ready');
      }

      assert(state.isCalibrated, 'should be calibrated');
      assertApprox(state.standingTorsoAngle, 5.0, 0.1, 'standing torso angle should be stored');
    });

    test('calibration rejected for bad hip-knee distance', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.getUserHeight = function() { return 68; };
      const ui = createMockUI();

      // Hip and knee too close (< 0.05)
      Chronicle.utils.calibrateHipBaseline(0.5, 0.5, 0.52, null, state, ui.feedback, 'Ready');
      assertEqual(state.calibrationHipYValues.length, 0, 'should reject bad distance');
      assert(ui.feedback.textContent.includes('Position'), 'should show positioning message');
    });
  });

  // ========== AUTO RECALIBRATION ==========
  suite('Chronicle.utils - Auto Recalibration', function() {
    test('triggers after timeout when no reps started', function() {
      mockTime(1000);
      const state = Chronicle.createState();
      state.isCalibrated = true;
      state.calibrationCompletedTime = 1000; // must be truthy (non-zero)
      state.state = 'standing';
      state.lastSquatStartTime = null;
      const ui = createMockUI();

      advanceTime(Chronicle.CONSTANTS.RECALIBRATION_TIMEOUT_MS + 100);
      const result = Chronicle.utils.checkAutoRecalibration(state, ui.feedback);

      assert(result, 'should trigger recalibration');
      assertEqual(state.isCalibrated, false, 'should reset calibration');
    });

    test('does not trigger when reps have been done', function() {
      mockTime(0);
      const state = Chronicle.createState();
      state.isCalibrated = true;
      state.calibrationCompletedTime = 0;
      state.state = 'standing';
      state.lastSquatStartTime = 100; // has started squatting
      const ui = createMockUI();

      advanceTime(Chronicle.CONSTANTS.RECALIBRATION_TIMEOUT_MS + 100);
      const result = Chronicle.utils.checkAutoRecalibration(state, ui.feedback);

      assertEqual(result, false, 'should not recalibrate when reps done');
    });
  });

  // ========== STATE MANAGEMENT ==========
  suite('Chronicle.utils - State Management', function() {
    test('updateState changes state and sets timestamp', function() {
      mockTime(1000);
      const state = Chronicle.createState();
      const ui = createMockUI();

      Chronicle.utils.updateState('descending', state, ui.status);
      assertEqual(state.state, 'descending');
      assertEqual(state.stateStartTime, 1000);
    });

    test('resetToStanding clears tracking state', function() {
      const state = Chronicle.createState();
      state.deepestHipY = 0.7;
      state.ascentStartTime = 500;
      state.velocityHistory = [1, 2, 3];
      const ui = createMockUI();

      Chronicle.utils.resetToStanding(state, ui.status);
      assertEqual(state.state, 'standing');
      assertEqual(state.deepestHipY, null);
      assertEqual(state.ascentStartTime, null);
      assertEqual(state.velocityHistory.length, 0);
    });

    test('resetHingeState clears hinge-specific state', function() {
      const state = Chronicle.createState();
      state.deepestTorsoAngle = 50;
      state.setupTorsoAngle = 30;
      state.liftStartTime = 1000;
      const ui = createMockUI();

      Chronicle.utils.resetHingeState(state, ui.status);
      assertEqual(state.state, 'standing');
      assertEqual(state.deepestTorsoAngle, null);
      assertEqual(state.setupTorsoAngle, null);
      assertEqual(state.liftStartTime, null);
    });
  });

  // ========== QUALITY FUNCTIONS ==========
  suite('Chronicle.quality', function() {
    test('squat quality tiers', function() {
      assertEqual(Chronicle.quality.squat(18).label, 'Deep');
      assertEqual(Chronicle.quality.squat(16).label, 'Parallel');
      assertEqual(Chronicle.quality.squat(10).label, 'Half');
      assertEqual(Chronicle.quality.squat(4).label, 'Shallow');
    });

    test('lockout quality tiers', function() {
      assertEqual(Chronicle.quality.lockout(3).label, 'Full Lockout');
      assertEqual(Chronicle.quality.lockout(8).label, 'Lockout');
      assertEqual(Chronicle.quality.lockout(15).label, 'Partial');
      assertEqual(Chronicle.quality.lockout(25).label, 'Soft Lockout');
    });

    test('hinge depth quality tiers', function() {
      assertEqual(Chronicle.quality.hingeDepth(75).label, 'Full Stretch');
      assertEqual(Chronicle.quality.hingeDepth(55).label, 'Parallel');
      assertEqual(Chronicle.quality.hingeDepth(35).label, 'Partial');
      assertEqual(Chronicle.quality.hingeDepth(20).label, 'Shallow');
    });
  });

  // ========== VELOCITY TRACKING ==========
  suite('Chronicle.utils - Velocity Tracking', function() {
    test('tracks velocity from frame differences', function() {
      const state = Chronicle.createState();

      Chronicle.utils.trackVelocity(0.5, state);
      Chronicle.utils.trackVelocity(0.52, state);

      assert(state.velocityHistory.length > 0, 'should have velocity history');
      assert(state.smoothedVelocity > 0, 'downward movement should have positive velocity');
    });

    test('getAvgVelocity returns 0 before enough frames', function() {
      const state = Chronicle.createState();
      Chronicle.utils.trackVelocity(0.5, state);

      const avg = Chronicle.utils.getAvgVelocity(state);
      assertEqual(avg, 0, 'should return 0 without enough frames');
    });

    test('upward movement produces negative velocity', function() {
      const state = Chronicle.createState();

      // Build up history
      for (let i = 0; i < 6; i++) {
        Chronicle.utils.trackVelocity(0.5 - i * 0.01, state); // moving up (Y decreasing)
      }

      const avg = Chronicle.utils.getAvgVelocity(state);
      assert(avg < 0, `upward movement velocity (${avg}) should be negative`);
    });
  });

  // ========== ACTIVE LANDMARKS ==========
  suite('Chronicle.utils - Active Landmarks', function() {
    test('getActiveLandmarks returns left side landmarks', function() {
      const landmarks = createStandingLandmarks({ side: 'left' });
      const active = Chronicle.utils.getActiveLandmarks(landmarks, 'left');

      assertEqual(active.hip, landmarks[23], 'hip should be left hip');
      assertEqual(active.knee, landmarks[25], 'knee should be left knee');
      assertEqual(active.ankle, landmarks[27], 'ankle should be left ankle');
      assertEqual(active.shoulder, landmarks[11], 'shoulder should be left shoulder');
    });

    test('getActiveLandmarks returns right side landmarks', function() {
      const landmarks = createStandingLandmarks({ side: 'right' });
      const active = Chronicle.utils.getActiveLandmarks(landmarks, 'right');

      assertEqual(active.hip, landmarks[24], 'hip should be right hip');
      assertEqual(active.knee, landmarks[26], 'knee should be right knee');
      assertEqual(active.ankle, landmarks[28], 'ankle should be right ankle');
    });
  });
})();
