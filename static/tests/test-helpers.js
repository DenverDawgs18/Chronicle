// ========== Test Helpers ==========
// Mock landmark generators, test runner, and assertion helpers
// for testing Chronicle exercise detection modules.

window.TestHelpers = {};

// ========== MINI TEST FRAMEWORK ==========
TestHelpers.results = { passed: 0, failed: 0, errors: [], suites: {} };
let currentSuite = 'default';

TestHelpers.suite = function(name, fn) {
  currentSuite = name;
  TestHelpers.results.suites[name] = { passed: 0, failed: 0, errors: [] };
  try {
    fn();
  } catch (e) {
    TestHelpers.results.suites[name].errors.push({ test: 'Suite setup', error: e.message });
    TestHelpers.results.failed++;
  }
  currentSuite = 'default';
};

TestHelpers.test = function(name, fn) {
  try {
    fn();
    TestHelpers.results.passed++;
    if (TestHelpers.results.suites[currentSuite]) {
      TestHelpers.results.suites[currentSuite].passed++;
    }
  } catch (e) {
    TestHelpers.results.failed++;
    const errObj = { test: `${currentSuite}: ${name}`, error: e.message };
    TestHelpers.results.errors.push(errObj);
    if (TestHelpers.results.suites[currentSuite]) {
      TestHelpers.results.suites[currentSuite].failed++;
      TestHelpers.results.suites[currentSuite].errors.push(errObj);
    }
  }
};

TestHelpers.assert = function(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

TestHelpers.assertEqual = function(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
};

TestHelpers.assertApprox = function(actual, expected, tolerance, message) {
  tolerance = tolerance || 0.01;
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message || `Expected ~${expected} (±${tolerance}), got ${actual}`);
  }
};

TestHelpers.assertInRange = function(actual, min, max, message) {
  if (actual < min || actual > max) {
    throw new Error(message || `Expected ${actual} to be in range [${min}, ${max}]`);
  }
};

TestHelpers.assertThrows = function(fn, message) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) {
    throw new Error(message || 'Expected function to throw');
  }
};

// ========== MOCK PERFORMANCE.NOW ==========
// Allow controlling time in tests
let mockTime = 0;
const originalPerformanceNow = performance.now.bind(performance);

TestHelpers.mockTime = function(t) {
  mockTime = t;
  performance.now = function() { return mockTime; };
};

TestHelpers.advanceTime = function(ms) {
  mockTime += ms;
};

TestHelpers.restoreTime = function() {
  performance.now = originalPerformanceNow;
};

// ========== MOCK UI ==========
TestHelpers.createMockUI = function() {
  return {
    feedback: { textContent: '' },
    status: { textContent: '', className: '' },
    counter: { textContent: '' },
    msg: { innerHTML: '' },
    onRepComplete: null,
    lastRep: null,
  };
};

TestHelpers.createMockUIWithRepCallback = function() {
  const ui = TestHelpers.createMockUI();
  ui.reps = [];
  ui.onRepComplete = function(time, depth, velocity, quality) {
    ui.reps.push({ time, depth, velocity, quality });
    ui.lastRep = { time, depth, velocity, quality };
  };
  return ui;
};

// ========== MOCK LANDMARKS ==========
// MediaPipe returns 33 landmarks. We primarily use:
// 11: left shoulder, 12: right shoulder
// 23: left hip, 24: right hip
// 25: left knee, 26: right knee
// 27: left ankle, 28: right ankle

/**
 * Create a full set of 33 landmarks with default positions.
 * Simulates a person standing sideways (left side to camera).
 * Y increases downward (0=top, 1=bottom).
 */
TestHelpers.createStandingLandmarks = function(options) {
  options = options || {};
  const side = options.side || 'left'; // which side faces camera
  const hipY = options.hipY || 0.5;
  const height = options.height || 0.4; // distance from shoulder to ankle

  const landmarks = [];
  for (let i = 0; i < 33; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 });
  }

  const vis = side === 'left' ? 0.95 : 0.3;
  const otherVis = side === 'left' ? 0.3 : 0.95;

  // Shoulders
  landmarks[11] = { x: 0.5, y: hipY - height * 0.5, z: 0, visibility: vis };   // left shoulder
  landmarks[12] = { x: 0.5, y: hipY - height * 0.5, z: 0, visibility: otherVis }; // right shoulder

  // Hips
  landmarks[23] = { x: 0.5, y: hipY, z: 0, visibility: vis };   // left hip
  landmarks[24] = { x: 0.5, y: hipY, z: 0, visibility: otherVis }; // right hip

  // Knees (standing = straight below hips)
  const kneeY = hipY + height * 0.3;
  landmarks[25] = { x: 0.5, y: kneeY, z: 0, visibility: vis };   // left knee
  landmarks[26] = { x: 0.5, y: kneeY, z: 0, visibility: otherVis }; // right knee

  // Ankles
  const ankleY = hipY + height * 0.55;
  landmarks[27] = { x: 0.5, y: ankleY, z: 0, visibility: vis };   // left ankle
  landmarks[28] = { x: 0.5, y: ankleY, z: 0, visibility: otherVis }; // right ankle

  return landmarks;
};

/**
 * Create landmarks simulating a squat at a given depth.
 * Hip Y moves down as depth increases.
 */
TestHelpers.createSquatLandmarks = function(options) {
  options = options || {};
  const depth = options.depthNorm || 0.05; // normalized Y displacement of hip
  const side = options.side || 'left';
  const baseHipY = options.baseHipY || 0.5;

  const landmarks = TestHelpers.createStandingLandmarks({ side: side, hipY: baseHipY + depth });

  // Knees move forward and down during squat
  const vis = side === 'left' ? 0.95 : 0.3;
  const otherVis = side === 'left' ? 0.3 : 0.95;
  landmarks[25] = { x: 0.55, y: baseHipY + 0.12 + depth * 0.3, z: 0, visibility: vis };
  landmarks[26] = { x: 0.55, y: baseHipY + 0.12 + depth * 0.3, z: 0, visibility: otherVis };

  return landmarks;
};

/**
 * Create landmarks simulating a hip hinge (deadlift/RDL).
 * Shoulder moves forward to create a torso angle.
 */
TestHelpers.createHingeLandmarks = function(options) {
  options = options || {};
  const angleDeg = options.angleDeg || 0; // torso angle from vertical
  const side = options.side || 'left';
  const hipY = options.hipY || 0.5;

  const landmarks = TestHelpers.createStandingLandmarks({ side: side, hipY: hipY });

  const vis = side === 'left' ? 0.95 : 0.3;
  const otherVis = side === 'left' ? 0.3 : 0.95;

  // Move shoulder to create angle
  const torsoLength = 0.2; // normalized torso length
  const angleRad = angleDeg * Math.PI / 180;
  const shoulderX = 0.5 + Math.sin(angleRad) * torsoLength;
  const shoulderY = hipY - Math.cos(angleRad) * torsoLength;

  landmarks[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };
  landmarks[12] = { x: shoulderX, y: shoulderY, z: 0, visibility: otherVis };

  // During hinge, hip rises slightly
  const hipRise = angleDeg > 0 ? Math.sin(angleRad) * 0.03 : 0;
  landmarks[23].y = hipY - hipRise;
  landmarks[24].y = hipY - hipRise;

  return landmarks;
};

/**
 * Create landmarks simulating a single-leg stance.
 * One ankle is raised (lower Y value = higher in frame).
 */
TestHelpers.createSingleLegLandmarks = function(options) {
  options = options || {};
  const plantedSide = options.plantedSide || 'left'; // which leg is on the ground
  const raisedHeight = options.raisedHeight || 0.15;  // how high the other foot is raised
  const hipY = options.hipY || 0.5;
  const angleDeg = options.angleDeg || 0;

  const landmarks = angleDeg > 0
    ? TestHelpers.createHingeLandmarks({ angleDeg: angleDeg, hipY: hipY })
    : TestHelpers.createStandingLandmarks({ hipY: hipY });

  // Make both sides visible for ankle detection
  for (let i = 0; i < landmarks.length; i++) {
    if (landmarks[i].visibility < 0.5) {
      landmarks[i].visibility = 0.7;
    }
  }

  const ankleY = hipY + 0.22; // base ankle position
  if (plantedSide === 'left') {
    landmarks[27].y = ankleY;       // left ankle planted (higher Y = lower in frame)
    landmarks[28].y = ankleY - raisedHeight; // right ankle raised
  } else {
    landmarks[28].y = ankleY;       // right ankle planted
    landmarks[27].y = ankleY - raisedHeight; // left ankle raised
  }

  return landmarks;
};

/**
 * Create landmarks for sumo stance (wide feet).
 */
TestHelpers.createSumoLandmarks = function(options) {
  options = options || {};
  const landmarks = TestHelpers.createHingeLandmarks(options);

  // Set realistic hip width first (hips need separate X positions)
  landmarks[23].x = 0.45;  // left hip
  landmarks[24].x = 0.55;  // right hip

  // Widen ankle spread well beyond hip width (ratio > 1.5 triggers sumo)
  const hipWidth = 0.1;
  landmarks[27].x = 0.5 - hipWidth * 1.5; // left ankle wide (0.35)
  landmarks[28].x = 0.5 + hipWidth * 1.5; // right ankle wide (0.65)

  // Make all landmarks visible
  for (let i = 0; i < landmarks.length; i++) {
    if (landmarks[i].visibility < 0.5) {
      landmarks[i].visibility = 0.7;
    }
  }

  return landmarks;
};

/**
 * Create landmarks for split squat stance.
 * Front foot lower (higher Y), rear foot same height or slightly higher.
 */
TestHelpers.createSplitStanceLandmarks = function(options) {
  options = options || {};
  const frontSide = options.frontSide || 'left'; // which leg is in front
  const depth = options.depthNorm || 0;           // how deep the squat is
  const hipY = options.hipY || 0.5;

  const landmarks = TestHelpers.createStandingLandmarks({ hipY: hipY + depth });

  // Make all landmarks visible
  for (let i = 0; i < landmarks.length; i++) {
    if (landmarks[i].visibility < 0.5) {
      landmarks[i].visibility = 0.7;
    }
  }

  const ankleY = hipY + 0.22;
  if (frontSide === 'left') {
    landmarks[27].y = ankleY + 0.05;  // left ankle forward and lower
    landmarks[28].y = ankleY - 0.03;  // right ankle rear and higher
    landmarks[27].x = 0.4;            // forward position
    landmarks[28].x = 0.6;            // rear position
  } else {
    landmarks[28].y = ankleY + 0.05;
    landmarks[27].y = ankleY - 0.03;
    landmarks[28].x = 0.4;
    landmarks[27].x = 0.6;
  }

  return landmarks;
};

// ========== CALIBRATION HELPERS ==========

/**
 * Run calibration frames on a state with standing landmarks.
 * Returns true if calibration succeeded.
 */
TestHelpers.calibrateState = function(state, exerciseModule, ui, options) {
  options = options || {};
  const numFrames = options.frames || 10;
  const landmarks = options.landmarks || TestHelpers.createStandingLandmarks();

  state.getUserHeight = function() { return options.height || 68; };

  for (let i = 0; i < numFrames; i++) {
    TestHelpers.advanceTime(100);
    exerciseModule.detect(landmarks, state, ui);
  }

  return state.isCalibrated;
};

/**
 * Simulate a full rep cycle for squat-type exercises.
 * Standing -> descend -> ascend -> standing.
 * Returns the state after rep completion.
 */
TestHelpers.simulateSquatRep = function(state, exerciseModule, ui, options) {
  options = options || {};
  const baseHipY = state.standingHipY || 0.5;
  const maxDepth = options.maxDepthNorm || 0.1;
  const descentFrames = options.descentFrames || 15;
  const ascentFrames = options.ascentFrames || 12;
  const frameTimeMs = options.frameTimeMs || 33;

  // Ensure standing stability
  for (let i = 0; i < 8; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const standLm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: 0 });
    exerciseModule.detect(standLm, state, ui);
  }

  // Let standing time elapse
  TestHelpers.advanceTime(1000);
  const standLm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: 0 });
  exerciseModule.detect(standLm, state, ui);

  // Descend
  for (let i = 1; i <= descentFrames; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const depth = (i / descentFrames) * maxDepth;
    const lm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: depth });
    exerciseModule.detect(lm, state, ui);
  }

  // Hold at bottom briefly
  for (let i = 0; i < 3; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const lm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: maxDepth });
    exerciseModule.detect(lm, state, ui);
  }

  // Ascend
  for (let i = 1; i <= ascentFrames; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const depth = maxDepth * (1 - i / ascentFrames);
    const lm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: depth });
    exerciseModule.detect(lm, state, ui);
  }

  // Back to standing
  for (let i = 0; i < 5; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const lm = TestHelpers.createSquatLandmarks({ baseHipY: baseHipY, depthNorm: 0 });
    exerciseModule.detect(lm, state, ui);
  }

  return state;
};

/**
 * Simulate a full hinge rep cycle (deadlift/RDL).
 */
TestHelpers.simulateHingeRep = function(state, exerciseModule, ui, options) {
  options = options || {};
  const maxAngle = options.maxAngleDeg || 50;
  const descentFrames = options.descentFrames || 15;
  const ascentFrames = options.ascentFrames || 12;
  const frameTimeMs = options.frameTimeMs || 33;

  // Ensure standing stability
  for (let i = 0; i < 8; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const standLm = TestHelpers.createHingeLandmarks({ angleDeg: 0 });
    exerciseModule.detect(standLm, state, ui);
  }

  TestHelpers.advanceTime(1000);
  const standLm = TestHelpers.createHingeLandmarks({ angleDeg: 0 });
  exerciseModule.detect(standLm, state, ui);

  // Hinge down
  for (let i = 1; i <= descentFrames; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const angle = (i / descentFrames) * maxAngle;
    const lm = TestHelpers.createHingeLandmarks({ angleDeg: angle });
    exerciseModule.detect(lm, state, ui);
  }

  // Hold at bottom
  for (let i = 0; i < 5; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const lm = TestHelpers.createHingeLandmarks({ angleDeg: maxAngle });
    exerciseModule.detect(lm, state, ui);
  }

  // Hinge up
  for (let i = 1; i <= ascentFrames; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const angle = maxAngle * (1 - i / ascentFrames);
    const lm = TestHelpers.createHingeLandmarks({ angleDeg: angle });
    exerciseModule.detect(lm, state, ui);
  }

  // Standing
  for (let i = 0; i < 5; i++) {
    TestHelpers.advanceTime(frameTimeMs);
    const lm = TestHelpers.createHingeLandmarks({ angleDeg: 0 });
    exerciseModule.detect(lm, state, ui);
  }

  return state;
};

// ========== RESULT REPORTING ==========

TestHelpers.printResults = function() {
  const r = TestHelpers.results;
  const total = r.passed + r.failed;

  let output = `\n========== TEST RESULTS ==========\n`;
  output += `Total: ${total} | Passed: ${r.passed} | Failed: ${r.failed}\n`;
  output += `==================================\n\n`;

  for (const suite in r.suites) {
    const s = r.suites[suite];
    const status = s.failed === 0 ? 'PASS' : 'FAIL';
    output += `[${status}] ${suite}: ${s.passed}/${s.passed + s.failed}\n`;
    if (s.errors.length > 0) {
      s.errors.forEach(e => {
        output += `  FAIL: ${e.test}\n    ${e.error}\n`;
      });
    }
  }

  if (r.errors.length > 0) {
    output += `\n--- Failed Tests ---\n`;
    r.errors.forEach(e => {
      output += `FAIL: ${e.test}\n  ${e.error}\n`;
    });
  }

  output += `\n==================================\n`;
  output += r.failed === 0 ? 'ALL TESTS PASSED' : `${r.failed} TEST(S) FAILED`;
  output += `\n==================================\n`;

  return output;
};

TestHelpers.renderResults = function(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const r = TestHelpers.results;
  const total = r.passed + r.failed;

  let html = `<div class="test-summary ${r.failed === 0 ? 'all-pass' : 'has-failures'}">`;
  html += `<h2>${r.failed === 0 ? 'ALL TESTS PASSED' : `${r.failed} FAILURE(S)`}</h2>`;
  html += `<p>${r.passed}/${total} passed</p>`;
  html += `</div>`;

  for (const suite in r.suites) {
    const s = r.suites[suite];
    const status = s.failed === 0 ? 'pass' : 'fail';
    html += `<div class="test-suite ${status}">`;
    html += `<h3>${suite} <span class="count">${s.passed}/${s.passed + s.failed}</span></h3>`;
    if (s.errors.length > 0) {
      html += `<ul class="failures">`;
      s.errors.forEach(e => {
        html += `<li><strong>${e.test}</strong><br><code>${e.error}</code></li>`;
      });
      html += `</ul>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
};
