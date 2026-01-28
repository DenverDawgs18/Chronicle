/**
 * Tests for squat.js - Velocity-Based Training squat detection
 *
 * These tests cover:
 * - Utility functions (unit conversion, calculations)
 * - Depth quality assessment
 * - State machine transitions
 * - Calibration logic
 * - Side detection
 * - Edge cases and error handling
 */

// ========== HYPERPARAMETERS (mirrored from squat.js) ==========
const HYPERPARAMETERS = {
  MIN_DEPTH_INCHES: 6,
  DESCENT_THRESHOLD_INCHES: 3.5,
  STABILITY_FRAMES: 6,
  CALIBRATION_SAMPLES: 5,
  BASELINE_TOLERANCE_INCHES: 5,
  MAX_STATE_TIME: 10000,
  VELOCITY_THRESHOLD: 0.001,
  RECOVERY_PERCENT: 80,
  HYSTERESIS_INCHES: 0.5,
  VELOCITY_WINDOW: 4,
  STANDING_DETECTION_FRAMES: 5,
  CALIBRATION_TOLERANCE_MULTIPLIER: 0.12,
  LANDMARK_VISIBILITY_THRESHOLD: 0.4,
  HIP_KNEE_RATIO: 0.24,
  DEPTH_MARKER_HALF: 6,
  DEPTH_MARKER_PARALLEL: 15.5,
  DEPTH_MARKER_DEEP: 17.5,
  VELOCITY_DROP_WARNING: 10,
  VELOCITY_DROP_CRITICAL: 20,
  SPEED_SCORE_MULTIPLIER: 1000,
  MIN_STANDING_TIME_MS: 800,
  SIDE_LOCK_CONFIDENCE_THRESHOLD: 0.15,
  DESCENT_VELOCITY_MIN: 0.0012,
  DRIFT_WARNING_THRESHOLD: 3,
  DRIFT_CRITICAL_THRESHOLD: 6,
  DEPTH_TRIGGER_MULTIPLIER: 1.15,
  BASELINE_UPDATE_ALPHA: 0.2,
  REBASELINE_STABILITY_FRAMES: 10,
  RECOVERY_WARNING_THRESHOLD: 50,
  TRACKING_LOSS_TOLERANCE_FRAMES: 30,
  RECALIBRATION_TIMEOUT_MS: 8000,
  MAX_DESCENT_TIME_MS: 6000,
  MAX_ASCENT_TIME_MS: 6000,
  HORIZONTAL_MOVEMENT_THRESHOLD: 0.08
};

// ========== PURE FUNCTION IMPLEMENTATIONS (for testing) ==========

/**
 * Convert normalized distance to inches
 */
function normToInches(normalizedDistance, inchesPerUnit) {
  return inchesPerUnit ? normalizedDistance * inchesPerUnit : 0;
}

/**
 * Convert inches to normalized units
 */
function inchesToNorm(inches, inchesPerUnit) {
  return inchesPerUnit ? inches / inchesPerUnit : 0;
}

/**
 * Calculate speed score based on time and depth
 */
function calculateSpeedScore(timeSeconds, depthInches) {
  const timePerInch = timeSeconds / depthInches;
  const speedScore = HYPERPARAMETERS.SPEED_SCORE_MULTIPLIER / timePerInch;
  return Math.round(speedScore);
}

/**
 * Get depth quality assessment based on depth in inches
 */
function getDepthQuality(depthInches) {
  if (depthInches >= HYPERPARAMETERS.DEPTH_MARKER_DEEP) {
    return { emoji: '🏆', label: 'Deep', color: '#00FF00' };
  }
  if (depthInches >= HYPERPARAMETERS.DEPTH_MARKER_PARALLEL) {
    return { emoji: '✓', label: 'Parallel', color: '#90EE90' };
  }
  if (depthInches >= HYPERPARAMETERS.DEPTH_MARKER_HALF) {
    return { emoji: '~', label: 'Half', color: '#FFD700' };
  }
  return { emoji: '⚠', label: 'Shallow', color: '#FFA500' };
}

/**
 * Check if a landmark is valid based on visibility threshold
 */
function isLandmarkValid(landmark, threshold = HYPERPARAMETERS.LANDMARK_VISIBILITY_THRESHOLD) {
  if (!landmark) return false;
  return (landmark.visibility || 0) > threshold;
}

/**
 * Determine which side should be tracked based on landmark visibility
 */
function determineSide(leftKnee, rightKnee, leftValid, rightValid, currentLockedSide) {
  const leftKneeVis = leftKnee ? (leftKnee.visibility || 0) : 0;
  const rightKneeVis = rightKnee ? (rightKnee.visibility || 0) : 0;

  if (currentLockedSide === null) {
    if (leftValid && rightValid) {
      return leftKneeVis > rightKneeVis ? 'left' : 'right';
    } else if (leftValid) {
      return 'left';
    } else if (rightValid) {
      return 'right';
    }
    return null;
  }
  return currentLockedSide;
}

/**
 * Calculate velocity from position history
 */
function calculateAverageVelocity(velocityHistory, windowSize = HYPERPARAMETERS.VELOCITY_WINDOW) {
  if (velocityHistory.length < windowSize) {
    return 0;
  }
  return velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length;
}

/**
 * Calculate calibration tolerance
 */
function calculateCalibrationTolerance(hipKneeDistance) {
  return hipKneeDistance * HYPERPARAMETERS.CALIBRATION_TOLERANCE_MULTIPLIER;
}

/**
 * Calculate expected hip-knee distance in inches based on height
 */
function calculateExpectedHipKneeInches(userHeightInches) {
  return userHeightInches * HYPERPARAMETERS.HIP_KNEE_RATIO;
}

/**
 * State machine helper - determine if should transition to descending
 */
function shouldStartDescent(currentDepthNorm, descentThresholdNorm, hysteresisNorm,
                            hasBeenStable, avgVelocity, depthTriggerMultiplier) {
  const isMovingDown = avgVelocity > HYPERPARAMETERS.DESCENT_VELOCITY_MIN;
  const wellPastThreshold = currentDepthNorm > descentThresholdNorm * depthTriggerMultiplier;
  const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;

  return isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold);
}

/**
 * Calculate recovery percentage during ascent
 */
function calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY) {
  const recovered = Math.max(0, deepestHipY - currentHipY);
  const totalDepth = deepestHipY - standingHipY;
  return totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;
}

// ========== TESTS ==========

describe('Unit Conversion Functions', () => {
  describe('normToInches', () => {
    test('converts normalized distance to inches correctly', () => {
      const inchesPerUnit = 100; // 1 norm unit = 100 inches
      expect(normToInches(0.1, inchesPerUnit)).toBe(10);
      expect(normToInches(0.5, inchesPerUnit)).toBe(50);
      expect(normToInches(1.0, inchesPerUnit)).toBe(100);
    });

    test('returns 0 when inchesPerUnit is not set', () => {
      expect(normToInches(0.5, null)).toBe(0);
      expect(normToInches(0.5, undefined)).toBe(0);
      expect(normToInches(0.5, 0)).toBe(0);
    });

    test('handles negative values', () => {
      expect(normToInches(-0.1, 100)).toBe(-10);
    });
  });

  describe('inchesToNorm', () => {
    test('converts inches to normalized units correctly', () => {
      const inchesPerUnit = 100;
      expect(inchesToNorm(10, inchesPerUnit)).toBe(0.1);
      expect(inchesToNorm(50, inchesPerUnit)).toBe(0.5);
      expect(inchesToNorm(100, inchesPerUnit)).toBe(1.0);
    });

    test('returns 0 when inchesPerUnit is not set', () => {
      expect(inchesToNorm(50, null)).toBe(0);
      expect(inchesToNorm(50, undefined)).toBe(0);
      expect(inchesToNorm(50, 0)).toBe(0);
    });

    test('normToInches and inchesToNorm are inverses', () => {
      const inchesPerUnit = 85.5;
      const originalInches = 17.5;
      const normalized = inchesToNorm(originalInches, inchesPerUnit);
      const backToInches = normToInches(normalized, inchesPerUnit);
      expect(backToInches).toBeCloseTo(originalInches, 10);
    });
  });
});

describe('Speed Score Calculation', () => {
  test('calculates speed score correctly', () => {
    // 1 second to travel 10 inches = 0.1 seconds per inch
    // Score = 1000 / 0.1 = 10000
    expect(calculateSpeedScore(1, 10)).toBe(10000);
  });

  test('faster times produce higher scores', () => {
    const fastScore = calculateSpeedScore(0.5, 15);
    const slowScore = calculateSpeedScore(1.5, 15);
    expect(fastScore).toBeGreaterThan(slowScore);
  });

  test('deeper squats at same time produce higher scores', () => {
    // Same time but more depth = faster per inch = higher score
    // Score = 1000 / (time / depth) = 1000 * depth / time
    const shallowScore = calculateSpeedScore(1, 10);
    const deepScore = calculateSpeedScore(1, 20);
    expect(deepScore).toBeGreaterThan(shallowScore);
  });

  test('returns rounded integer', () => {
    const score = calculateSpeedScore(0.7, 12);
    expect(Number.isInteger(score)).toBe(true);
  });

  test('handles typical rep values', () => {
    // Typical fast rep: 0.6s, 16 inches deep
    const typicalFastScore = calculateSpeedScore(0.6, 16);
    expect(typicalFastScore).toBeGreaterThan(0);
    expect(typicalFastScore).toBeLessThan(50000);

    // Typical slow rep: 1.5s, 16 inches deep
    const typicalSlowScore = calculateSpeedScore(1.5, 16);
    expect(typicalSlowScore).toBeLessThan(typicalFastScore);
  });
});

describe('Depth Quality Assessment', () => {
  test('returns Deep for depths >= 17.5 inches', () => {
    const quality = getDepthQuality(17.5);
    expect(quality.label).toBe('Deep');
    expect(quality.emoji).toBe('🏆');

    const deeperQuality = getDepthQuality(20);
    expect(deeperQuality.label).toBe('Deep');
  });

  test('returns Parallel for depths >= 15.5 and < 17.5 inches', () => {
    const quality = getDepthQuality(15.5);
    expect(quality.label).toBe('Parallel');
    expect(quality.emoji).toBe('✓');

    const midQuality = getDepthQuality(17);
    expect(midQuality.label).toBe('Parallel');
  });

  test('returns Half for depths >= 6 and < 15.5 inches', () => {
    const quality = getDepthQuality(6);
    expect(quality.label).toBe('Half');
    expect(quality.emoji).toBe('~');

    const midQuality = getDepthQuality(12);
    expect(midQuality.label).toBe('Half');
  });

  test('returns Shallow for depths < 6 inches', () => {
    const quality = getDepthQuality(5.9);
    expect(quality.label).toBe('Shallow');
    expect(quality.emoji).toBe('⚠');

    const veryShallow = getDepthQuality(2);
    expect(veryShallow.label).toBe('Shallow');
  });

  test('returns correct colors for each level', () => {
    expect(getDepthQuality(18).color).toBe('#00FF00');
    expect(getDepthQuality(16).color).toBe('#90EE90');
    expect(getDepthQuality(10).color).toBe('#FFD700');
    expect(getDepthQuality(3).color).toBe('#FFA500');
  });

  test('handles edge cases at boundaries', () => {
    // Exactly at boundaries
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_DEEP).label).toBe('Deep');
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_PARALLEL).label).toBe('Parallel');
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_HALF).label).toBe('Half');

    // Just below boundaries
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_DEEP - 0.1).label).toBe('Parallel');
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_PARALLEL - 0.1).label).toBe('Half');
    expect(getDepthQuality(HYPERPARAMETERS.DEPTH_MARKER_HALF - 0.1).label).toBe('Shallow');
  });
});

describe('Landmark Validation', () => {
  test('validates landmark with sufficient visibility', () => {
    const landmark = { x: 0.5, y: 0.5, visibility: 0.9 };
    expect(isLandmarkValid(landmark)).toBe(true);
  });

  test('invalidates landmark with low visibility', () => {
    const landmark = { x: 0.5, y: 0.5, visibility: 0.2 };
    expect(isLandmarkValid(landmark)).toBe(false);
  });

  test('invalidates null or undefined landmark', () => {
    expect(isLandmarkValid(null)).toBe(false);
    expect(isLandmarkValid(undefined)).toBe(false);
  });

  test('handles missing visibility property', () => {
    const landmark = { x: 0.5, y: 0.5 };
    expect(isLandmarkValid(landmark)).toBe(false);
  });

  test('respects custom threshold', () => {
    const landmark = { x: 0.5, y: 0.5, visibility: 0.3 };
    expect(isLandmarkValid(landmark, 0.2)).toBe(true);
    expect(isLandmarkValid(landmark, 0.5)).toBe(false);
  });

  test('validates at exactly threshold boundary', () => {
    const landmark = { x: 0.5, y: 0.5, visibility: 0.4 };
    expect(isLandmarkValid(landmark, 0.4)).toBe(false);
    expect(isLandmarkValid(landmark, 0.39)).toBe(true);
  });
});

describe('Side Detection', () => {
  const createKnee = (visibility) => ({ x: 0.5, y: 0.5, visibility });

  test('returns left side when only left is valid', () => {
    const leftKnee = createKnee(0.9);
    const rightKnee = createKnee(0.1);
    expect(determineSide(leftKnee, rightKnee, true, false, null)).toBe('left');
  });

  test('returns right side when only right is valid', () => {
    const leftKnee = createKnee(0.1);
    const rightKnee = createKnee(0.9);
    expect(determineSide(leftKnee, rightKnee, false, true, null)).toBe('right');
  });

  test('returns higher visibility side when both are valid', () => {
    const leftKnee = createKnee(0.9);
    const rightKnee = createKnee(0.6);
    expect(determineSide(leftKnee, rightKnee, true, true, null)).toBe('left');

    const leftKnee2 = createKnee(0.6);
    const rightKnee2 = createKnee(0.9);
    expect(determineSide(leftKnee2, rightKnee2, true, true, null)).toBe('right');
  });

  test('maintains locked side once set', () => {
    const leftKnee = createKnee(0.9);
    const rightKnee = createKnee(0.9);
    expect(determineSide(leftKnee, rightKnee, true, true, 'left')).toBe('left');
    expect(determineSide(leftKnee, rightKnee, true, true, 'right')).toBe('right');
  });

  test('returns null when neither side is valid', () => {
    const leftKnee = createKnee(0.1);
    const rightKnee = createKnee(0.1);
    expect(determineSide(leftKnee, rightKnee, false, false, null)).toBe(null);
  });
});

describe('Velocity Calculation', () => {
  test('calculates average velocity correctly', () => {
    const history = [0.1, 0.2, 0.1, 0.2];
    expect(calculateAverageVelocity(history)).toBeCloseTo(0.15, 10);
  });

  test('returns 0 when history is too short', () => {
    const shortHistory = [0.1, 0.2];
    expect(calculateAverageVelocity(shortHistory)).toBe(0);
  });

  test('handles negative velocities (ascending)', () => {
    const history = [-0.1, -0.2, -0.15, -0.15];
    expect(calculateAverageVelocity(history)).toBeCloseTo(-0.15, 10);
  });

  test('handles mixed positive and negative velocities', () => {
    const history = [0.1, -0.1, 0.1, -0.1];
    expect(calculateAverageVelocity(history)).toBeCloseTo(0, 10);
  });

  test('uses entire history for calculation', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    // Average of all 6 values = 0.35
    expect(calculateAverageVelocity(history)).toBeCloseTo(0.35, 10);
  });
});

describe('Calibration Logic', () => {
  test('calculates calibration tolerance based on hip-knee distance', () => {
    const hipKneeDist = 0.2;
    const tolerance = calculateCalibrationTolerance(hipKneeDist);
    expect(tolerance).toBe(hipKneeDist * HYPERPARAMETERS.CALIBRATION_TOLERANCE_MULTIPLIER);
  });

  test('calculates expected hip-knee distance from height', () => {
    const heightInches = 70; // 5'10"
    const expected = calculateExpectedHipKneeInches(heightInches);
    expect(expected).toBe(70 * HYPERPARAMETERS.HIP_KNEE_RATIO);
    expect(expected).toBeCloseTo(16.8, 1); // ~16.8 inches
  });

  test('shorter users have smaller expected hip-knee distance', () => {
    const shortExpected = calculateExpectedHipKneeInches(60);
    const tallExpected = calculateExpectedHipKneeInches(76);
    expect(shortExpected).toBeLessThan(tallExpected);
  });
});

describe('State Machine - Descent Detection', () => {
  const inchesPerUnit = 100;
  const descentThresholdNorm = inchesToNorm(HYPERPARAMETERS.DESCENT_THRESHOLD_INCHES, inchesPerUnit);
  const hysteresisNorm = inchesToNorm(HYPERPARAMETERS.HYSTERESIS_INCHES, inchesPerUnit);

  test('triggers descent when all conditions are met', () => {
    const currentDepthNorm = descentThresholdNorm + hysteresisNorm + 0.01;
    const avgVelocity = HYPERPARAMETERS.DESCENT_VELOCITY_MIN + 0.001;

    const shouldStart = shouldStartDescent(
      currentDepthNorm, descentThresholdNorm, hysteresisNorm,
      true, avgVelocity, HYPERPARAMETERS.DEPTH_TRIGGER_MULTIPLIER
    );
    expect(shouldStart).toBe(true);
  });

  test('does not trigger descent when not stable', () => {
    const currentDepthNorm = descentThresholdNorm + hysteresisNorm + 0.01;
    const avgVelocity = HYPERPARAMETERS.DESCENT_VELOCITY_MIN + 0.001;

    const shouldStart = shouldStartDescent(
      currentDepthNorm, descentThresholdNorm, hysteresisNorm,
      false, avgVelocity, HYPERPARAMETERS.DEPTH_TRIGGER_MULTIPLIER
    );
    expect(shouldStart).toBe(false);
  });

  test('does not trigger descent when depth below threshold', () => {
    const currentDepthNorm = descentThresholdNorm - 0.01;
    const avgVelocity = HYPERPARAMETERS.DESCENT_VELOCITY_MIN + 0.001;

    const shouldStart = shouldStartDescent(
      currentDepthNorm, descentThresholdNorm, hysteresisNorm,
      true, avgVelocity, HYPERPARAMETERS.DEPTH_TRIGGER_MULTIPLIER
    );
    expect(shouldStart).toBe(false);
  });

  test('triggers descent even with low velocity if well past threshold', () => {
    const currentDepthNorm = descentThresholdNorm * HYPERPARAMETERS.DEPTH_TRIGGER_MULTIPLIER + 0.01;
    const avgVelocity = 0; // No movement

    const shouldStart = shouldStartDescent(
      currentDepthNorm, descentThresholdNorm, hysteresisNorm,
      true, avgVelocity, HYPERPARAMETERS.DEPTH_TRIGGER_MULTIPLIER
    );
    expect(shouldStart).toBe(true);
  });
});

describe('Recovery Calculation', () => {
  test('calculates recovery percentage correctly', () => {
    const standingHipY = 0.3;
    const deepestHipY = 0.5;  // 0.2 units deep
    const currentHipY = 0.4;  // recovered 0.1 units (50%)

    const recovery = calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY);
    expect(recovery).toBeCloseTo(50, 5);
  });

  test('returns 100% when fully recovered', () => {
    const standingHipY = 0.3;
    const deepestHipY = 0.5;
    const currentHipY = 0.3; // Back to standing

    const recovery = calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY);
    expect(recovery).toBe(100);
  });

  test('returns 0% when at deepest point', () => {
    const standingHipY = 0.3;
    const deepestHipY = 0.5;
    const currentHipY = 0.5; // Still at bottom

    const recovery = calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY);
    expect(recovery).toBe(0);
  });

  test('handles edge case where no depth', () => {
    const standingHipY = 0.3;
    const deepestHipY = 0.3; // Never descended
    const currentHipY = 0.3;

    const recovery = calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY);
    expect(recovery).toBe(0);
  });

  test('clamps negative recovery to 0', () => {
    const standingHipY = 0.3;
    const deepestHipY = 0.5;
    const currentHipY = 0.6; // Went deeper than deepest (shouldn't happen normally)

    const recovery = calculateRecoveryPercent(deepestHipY, currentHipY, standingHipY);
    expect(recovery).toBe(0);
  });
});

describe('Hyperparameter Consistency', () => {
  test('MIN_DEPTH_INCHES equals DEPTH_MARKER_HALF', () => {
    expect(HYPERPARAMETERS.MIN_DEPTH_INCHES).toBe(HYPERPARAMETERS.DEPTH_MARKER_HALF);
  });

  test('depth markers are in ascending order', () => {
    expect(HYPERPARAMETERS.DEPTH_MARKER_HALF).toBeLessThan(HYPERPARAMETERS.DEPTH_MARKER_PARALLEL);
    expect(HYPERPARAMETERS.DEPTH_MARKER_PARALLEL).toBeLessThan(HYPERPARAMETERS.DEPTH_MARKER_DEEP);
  });

  test('RECOVERY_PERCENT is between 0 and 100', () => {
    expect(HYPERPARAMETERS.RECOVERY_PERCENT).toBeGreaterThan(0);
    expect(HYPERPARAMETERS.RECOVERY_PERCENT).toBeLessThanOrEqual(100);
  });

  test('velocity drop thresholds are in correct order', () => {
    expect(HYPERPARAMETERS.VELOCITY_DROP_WARNING).toBeLessThan(HYPERPARAMETERS.VELOCITY_DROP_CRITICAL);
  });

  test('drift thresholds are in correct order', () => {
    expect(HYPERPARAMETERS.DRIFT_WARNING_THRESHOLD).toBeLessThan(HYPERPARAMETERS.DRIFT_CRITICAL_THRESHOLD);
  });

  test('calibration tolerance multiplier is reasonable', () => {
    expect(HYPERPARAMETERS.CALIBRATION_TOLERANCE_MULTIPLIER).toBeGreaterThan(0);
    expect(HYPERPARAMETERS.CALIBRATION_TOLERANCE_MULTIPLIER).toBeLessThan(1);
  });

  test('HIP_KNEE_RATIO is anatomically reasonable', () => {
    // Hip to knee should be about 20-30% of total height
    expect(HYPERPARAMETERS.HIP_KNEE_RATIO).toBeGreaterThan(0.15);
    expect(HYPERPARAMETERS.HIP_KNEE_RATIO).toBeLessThan(0.35);
  });
});

describe('Edge Cases and Error Handling', () => {
  test('handles zero values gracefully', () => {
    expect(normToInches(0, 100)).toBe(0);
    expect(inchesToNorm(0, 100)).toBe(0);
    expect(getDepthQuality(0).label).toBe('Shallow');
    expect(calculateAverageVelocity([])).toBe(0);
  });

  test('handles very large values', () => {
    const largeScore = calculateSpeedScore(0.1, 30);
    expect(largeScore).toBeGreaterThan(0);
    expect(Number.isFinite(largeScore)).toBe(true);
  });

  test('handles very small values', () => {
    const smallResult = normToInches(0.001, 100);
    expect(smallResult).toBeCloseTo(0.1, 10);
  });
});

describe('Integration Scenarios', () => {
  test('complete rep cycle calculations', () => {
    const inchesPerUnit = 85.5; // Typical value for 5'10" person
    const userHeight = 70;

    // Verify calibration math
    const expectedHipKnee = calculateExpectedHipKneeInches(userHeight);
    expect(expectedHipKnee).toBeCloseTo(16.8, 1);

    // Simulate a deep squat (18 inches)
    const squatDepthInches = 18;
    const squatDepthNorm = inchesToNorm(squatDepthInches, inchesPerUnit);

    // Verify depth quality
    const quality = getDepthQuality(squatDepthInches);
    expect(quality.label).toBe('Deep');

    // Simulate ascent time of 0.7 seconds
    const ascentTime = 0.7;
    const speedScore = calculateSpeedScore(ascentTime, squatDepthInches);

    // Speed score should be reasonable (not too high or low)
    expect(speedScore).toBeGreaterThan(500);
    expect(speedScore).toBeLessThan(50000);
  });

  test('velocity drop analysis over multiple reps', () => {
    const repData = [
      { time: 0.6, depth: 17 },
      { time: 0.7, depth: 16.5 },
      { time: 0.8, depth: 16 },
      { time: 0.9, depth: 15.5 },
      { time: 1.1, depth: 15 }
    ];

    const scores = repData.map(rep => calculateSpeedScore(rep.time, rep.depth));

    // Verify scores decrease over time (fatigue simulation)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i-1]);
    }

    // Calculate velocity drop
    const firstScore = scores[0];
    const lastScore = scores[scores.length - 1];
    const dropPercent = ((firstScore - lastScore) / firstScore) * 100;

    // Should show meaningful fatigue
    expect(dropPercent).toBeGreaterThan(0);
  });
});
