// ========== HYPERPARAMETERS - UPDATED VERSION ==========
const MIN_DEPTH_INCHES = 6;
const DESCENT_THRESHOLD_INCHES = 3.5;  // Balanced between Doc1 and Doc2
const STABILITY_FRAMES = 6;
const CALIBRATION_SAMPLES = 5;
const BASELINE_TOLERANCE_INCHES = 5;   // Slightly more forgiving
const MAX_STATE_TIME = 10000;
const VELOCITY_THRESHOLD = 0.001;
const RECOVERY_PERCENT = 80;
const HYSTERESIS_INCHES = 0.5;
const VELOCITY_WINDOW = 4;
const STANDING_DETECTION_FRAMES = 5;
const CALIBRATION_TOLERANCE_MULTIPLIER = 0.12;
const LANDMARK_VISIBILITY_THRESHOLD = 0.4;
const HIP_KNEE_RATIO = 0.24;
const DEPTH_MARKER_HALF = 6;
const DEPTH_MARKER_PARALLEL = 15.5;
const DEPTH_MARKER_DEEP = 17.5;
const VELOCITY_DROP_WARNING = 10;
const VELOCITY_DROP_CRITICAL = 20;
const SPEED_SCORE_MULTIPLIER = 1000;

const MIN_STANDING_TIME_MS = 800;  // Reduced for better responsiveness
const SIDE_LOCK_CONFIDENCE_THRESHOLD = 0.15;
const QUICK_CALIBRATION_MODE = true;
const DESCENT_VELOCITY_MIN = 0.0012;  // Increased sensitivity
const DRIFT_WARNING_THRESHOLD = 3;
const DRIFT_CRITICAL_THRESHOLD = 6;

const DEPTH_TRIGGER_MULTIPLIER = 1.15;  // Reduced for easier rep start
const BASELINE_UPDATE_ALPHA = 0.2;
const REBASELINE_STABILITY_FRAMES = 10;
const RECOVERY_WARNING_THRESHOLD = 50;
const TRACKING_LOSS_TOLERANCE_FRAMES = 30;

// NEW: Auto-recalibration and stricter state timeouts
const RECALIBRATION_TIMEOUT_MS = 8000;  // Recalibrate if no squat within 15s
const MAX_DESCENT_TIME_MS = 6000;  // Stricter timeout for descending
const MAX_ASCENT_TIME_MS = 6000;  // Stricter timeout for ascending
const HORIZONTAL_MOVEMENT_THRESHOLD = 0.08;  // Ignore horizontal drift during standing

// Position smoothing and outlier detection
const POSITION_SMOOTHING_ALPHA = 0.3;  // Lower = more smoothing
const OUTLIER_THRESHOLD_MULTIPLIER = 3.0;  // Reject jumps > 3x typical movement
const MIN_FRAMES_FOR_OUTLIER_DETECTION = 5;
const VELOCITY_EMA_ALPHA = 0.4;  // Exponential moving average for velocity

// DEBUG MODE
const DEBUG_MODE = true;
// ======================================================================

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const feedbackEl = document.getElementById('feedback');
const msgEl = document.getElementById('msg');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');

let pose = null;
let camera = null;
let mediaStream = null;
let isProcessing = false;

let state = 'standing';
let repCount = 0;
let stateStartTime = null;

let standingHipY = null;
let deepestHipY = null;
let prevHipY = null;

let hipKneeDistance = null;
let inchesPerUnit = null;
let userHeightInches = null;

let lockedSide = null;
let currentSide = 'left';

let stableFrameCount = 0;
let isCalibrated = false;
let calibrationHipYValues = [];

let velocityHistory = [];

let ascentStartTime = null;
let repTimes = [];
let repDepths = [];

let stableStandingStartTime = null;
let lastStandingRecalibrationTime = 0;

let rebaselineStabilityCount = 0;
let potentialNewBaseline = null;

let trackingLossFrames = 0;

// NEW: Track last squat time and standing hip X for horizontal movement detection
let lastSquatStartTime = null;
let calibrationCompletedTime = null;
let standingHipX = null;

// Position smoothing state
let smoothedHipY = null;
let smoothedHipX = null;
let positionHistory = [];
let typicalMovementMagnitude = 0.01;  // Running estimate of normal frame-to-frame movement
let smoothedVelocity = 0;  // EMA-smoothed velocity

let debugInfo = {};

function getUserHeightInches() {
  return parseInt(document.getElementById('heightSlider').value);
}

document.getElementById('heightSlider').addEventListener('change', (e) => { 
  const heightInches = parseInt(e.target.value);
  fetch('/set_height', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
  },
    body: JSON.stringify({ height: heightInches }),
  })});

resetBtn.addEventListener('click', () => {
  const keepCalibration = isCalibrated && hipKneeDistance && standingHipY;

  repCount = 0;
  state = 'standing';
  deepestHipY = null;
  prevHipY = null;
  stableFrameCount = 0;
  ascentStartTime = null;
  stateStartTime = null;
  repTimes = [];
  repDepths = [];
  velocityHistory = [];
  stableStandingStartTime = null;
  rebaselineStabilityCount = 0;
  potentialNewBaseline = null;
  trackingLossFrames = 0;
  lastSquatStartTime = null;
  calibrationCompletedTime = null;
  smoothedVelocity = 0;

  if (!keepCalibration) {
    standingHipY = null;
    standingHipX = null;
    hipKneeDistance = null;
    inchesPerUnit = null;
    isCalibrated = false;
    calibrationHipYValues = [];
    lockedSide = null;
    // Also reset smoothing state for full reset
    smoothedHipY = null;
    smoothedHipX = null;
    positionHistory = [];
    typicalMovementMagnitude = 0.01;
    feedbackEl.textContent = 'Counter reset! Stand sideways and stay still';
  } else {
    feedbackEl.textContent = 'Counter reset! Calibration kept - ready to squat';
  }

  counterEl.textContent = 'Reps: 0';
  msgEl.innerHTML = '';
  updateStatus('standing');
});

function updateStatus(newState) {
  state = newState;
  stateStartTime = performance.now();
  statusEl.textContent = newState.toUpperCase();
  statusEl.className = `status-indicator status-${newState}`;
}

function normToInches(normalizedDistance) {
  return inchesPerUnit ? normalizedDistance * inchesPerUnit : 0;
}

function inchesToNorm(inches) {
  return inchesPerUnit ? inches / inchesPerUnit : 0;
}

function calculateSpeedScore(timeSeconds, depthInches) {
  const timePerInch = timeSeconds / depthInches;
  const speedScore = SPEED_SCORE_MULTIPLIER / timePerInch;
  return Math.round(speedScore);
}

function getDepthQuality(depthInches) {
  if (depthInches >= DEPTH_MARKER_DEEP) return { emoji: '🏆', label: 'Deep', color: '#00FF00' };
  if (depthInches >= DEPTH_MARKER_PARALLEL) return { emoji: '✓', label: 'Parallel', color: '#90EE90' };
  if (depthInches >= DEPTH_MARKER_HALF) return { emoji: '~', label: 'Half', color: '#FFD700' };
  return { emoji: '⚠', label: 'Shallow', color: '#FFA500' };
}

/**
 * Detect if a position change is an outlier (sudden jump)
 * Returns true if the movement is abnormally large
 */
function isOutlierMovement(newY, previousY) {
  if (previousY === null || positionHistory.length < MIN_FRAMES_FOR_OUTLIER_DETECTION) {
    return false;
  }

  const movement = Math.abs(newY - previousY);
  const threshold = typicalMovementMagnitude * OUTLIER_THRESHOLD_MULTIPLIER;

  return movement > threshold;
}

/**
 * Update the running estimate of typical movement magnitude
 */
function updateTypicalMovement(movement) {
  if (positionHistory.length >= MIN_FRAMES_FOR_OUTLIER_DETECTION) {
    // Use EMA to update typical movement
    typicalMovementMagnitude = typicalMovementMagnitude * 0.95 + Math.abs(movement) * 0.05;
    // Clamp to reasonable bounds
    typicalMovementMagnitude = Math.max(0.001, Math.min(0.05, typicalMovementMagnitude));
  }
}

/**
 * Apply exponential moving average smoothing to position
 */
function smoothPosition(newValue, previousSmoothed, alpha = POSITION_SMOOTHING_ALPHA) {
  if (previousSmoothed === null) {
    return newValue;
  }
  return previousSmoothed * (1 - alpha) + newValue * alpha;
}

/**
 * Process raw hip position with outlier filtering and smoothing
 * Returns the processed position or null if rejected as outlier
 */
function processHipPosition(rawHipY, rawHipX) {
  // Check for outlier
  if (isOutlierMovement(rawHipY, smoothedHipY)) {
    // Don't update position, keep previous smoothed value
    if (DEBUG_MODE) {
      console.log('Outlier detected, rejecting frame:', rawHipY, 'previous:', smoothedHipY);
    }
    return { hipY: smoothedHipY, hipX: smoothedHipX, rejected: true };
  }

  // Update typical movement magnitude
  if (smoothedHipY !== null) {
    updateTypicalMovement(rawHipY - smoothedHipY);
  }

  // Apply smoothing
  smoothedHipY = smoothPosition(rawHipY, smoothedHipY);
  smoothedHipX = smoothPosition(rawHipX, smoothedHipX);

  // Track position history for outlier detection
  positionHistory.push(rawHipY);
  if (positionHistory.length > 30) {
    positionHistory.shift();
  }

  return { hipY: smoothedHipY, hipX: smoothedHipX, rejected: false };
}

/**
 * Calculate velocity with EMA smoothing for more stable readings
 */
function updateSmoothedVelocity(instantVelocity) {
  smoothedVelocity = smoothedVelocity * (1 - VELOCITY_EMA_ALPHA) + instantVelocity * VELOCITY_EMA_ALPHA;
  return smoothedVelocity;
}

function displayRepTimes() {
  if (repTimes.length === 0) {
    msgEl.innerHTML = '<div style="color: #666;">No reps yet</div>';
    return;
  }

  const firstRepTime = repTimes[0];
  const firstRepDepth = repDepths[0];
  const firstSpeedScore = calculateSpeedScore(firstRepTime, firstRepDepth);
  
  let html = '<div style="margin-bottom: 10px; font-weight: bold;">Speed Analysis</div>';
  
  const recentReps = repTimes.slice(-5);
  const recentDepths = repDepths.slice(-5);
  
  recentReps.forEach((time, idx) => {
    const actualRepNum = repTimes.length - recentReps.length + idx + 1;
    const depthInches = recentDepths[idx];
    const quality = getDepthQuality(depthInches);
    
    const speedScore = calculateSpeedScore(time, depthInches);
    const scoreDrop = ((firstSpeedScore - speedScore) / firstSpeedScore * 100).toFixed(1);
    const dropNum = parseFloat(scoreDrop);
    
    let color = '#00FF00';
    if (dropNum > VELOCITY_DROP_CRITICAL) color = '#FF4444';
    else if (dropNum > VELOCITY_DROP_WARNING) color = '#FFA500';
    
    html += `<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
      <div style="font-size: 16px; margin-bottom: 4px;">
        Rep ${actualRepNum}: Speed ${speedScore} ${quality.emoji} ${quality.label}
        <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '-' : '+'}${Math.abs(dropNum).toFixed(1)}%</span>
      </div>
    </div>`;
  });
  
  msgEl.innerHTML = html;
}

function detectSquat(landmarks) {
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];
  
  if (DEBUG_MODE) {
    debugInfo = {
      leftHip: leftHip ? { 
        x: leftHip.x.toFixed(3), 
        y: leftHip.y.toFixed(3), 
        vis: (leftHip.visibility || 0).toFixed(2) 
      } : null,
      rightHip: rightHip ? { 
        x: rightHip.x.toFixed(3), 
        y: rightHip.y.toFixed(3), 
        vis: (rightHip.visibility || 0).toFixed(2) 
      } : null,
      leftKnee: leftKnee ? { 
        x: leftKnee.x.toFixed(3), 
        y: leftKnee.y.toFixed(3), 
        vis: (leftKnee.visibility || 0).toFixed(2) 
      } : null,
      rightKnee: rightKnee ? { 
        x: rightKnee.x.toFixed(3), 
        y: rightKnee.y.toFixed(3), 
        vis: (rightKnee.visibility || 0).toFixed(2) 
      } : null,
      leftAnkle: leftAnkle ? { 
        x: leftAnkle.x.toFixed(3), 
        y: leftAnkle.y.toFixed(3), 
        vis: (leftAnkle.visibility || 0).toFixed(2) 
      } : null,
      rightAnkle: rightAnkle ? { 
        x: rightAnkle.x.toFixed(3), 
        y: rightAnkle.y.toFixed(3), 
        vis: (rightAnkle.visibility || 0).toFixed(2) 
      } : null,
      lockedSide: lockedSide,
      currentSide: currentSide
    };
  }
  
  const leftValid = leftHip && leftKnee && 
    (leftHip.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD && 
    (leftKnee.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD;
  const rightValid = rightHip && rightKnee && 
    (rightHip.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD && 
    (rightKnee.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD;
  
  if (!leftValid && !rightValid) {
    trackingLossFrames++;
    
    if (state !== 'standing' && trackingLossFrames > TRACKING_LOSS_TOLERANCE_FRAMES) {
      feedbackEl.textContent = "Lost tracking - resetting";
      resetToStanding();
    }
    return;
  }
  
  trackingLossFrames = 0;
  
  // Use KNEE visibility for side detection (hips have bugged equal visibility)
  if (lockedSide === null) {
    // Use knee visibility since hip visibility is bugged
    const leftKneeVis = leftKnee ? (leftKnee.visibility || 0) : 0;
    const rightKneeVis = rightKnee ? (rightKnee.visibility || 0) : 0;
    
    if (leftValid && rightValid) {
      // Both detected - use knee visibility to determine which side is actually visible
      lockedSide = leftKneeVis > rightKneeVis ? 'left' : 'right';
    } else if (leftValid) {
      lockedSide = 'left';
    } else if (rightValid) {
      lockedSide = 'right';
    }
  } else {
    // Allow side switching only when standing and there's clear evidence
    const currentValid = (lockedSide === 'left') ? leftValid : rightValid;
    const otherValid = (lockedSide === 'left') ? rightValid : leftValid;
    
    const currentKneeVis = (lockedSide === 'left') ? (leftKnee.visibility || 0) : (rightKnee.visibility || 0);
    const otherKneeVis = (lockedSide === 'left') ? (rightKnee.visibility || 0) : (leftKnee.visibility || 0);
    
    const shouldSwitch = !currentValid && otherValid && 
      (otherKneeVis - currentKneeVis > SIDE_LOCK_CONFIDENCE_THRESHOLD);
    
    if (shouldSwitch && state === 'standing') {
      lockedSide = lockedSide === 'left' ? 'right' : 'left';
      feedbackEl.textContent = `Switched to ${lockedSide} side view`;
    }
  }
  
  const useLeft = (lockedSide === 'left');
  currentSide = lockedSide;

  const hip = useLeft ? leftHip : rightHip;
  const knee = useLeft ? leftKnee : rightKnee;
  const rawHipY = hip.y;
  const rawHipX = hip.x;
  const kneeY = knee.y;

  // Apply position smoothing and outlier filtering
  const processed = processHipPosition(rawHipY, rawHipX);
  if (processed.rejected && processed.hipY === null) {
    // First frame was rejected, skip processing
    return;
  }
  const hipY = processed.hipY;
  const hipX = processed.hipX;
  
  // ========== AUTO-RECALIBRATION CHECK ==========
  if (isCalibrated && calibrationCompletedTime && state === 'standing' && lastSquatStartTime === null) {
    const timeSinceCalibration = performance.now() - calibrationCompletedTime;
    
    if (timeSinceCalibration > RECALIBRATION_TIMEOUT_MS) {
      // Force recalibration
      isCalibrated = false;
      calibrationHipYValues = [];
      standingHipY = null;
      standingHipX = null;
      stableFrameCount = 0;
      calibrationCompletedTime = null;
      feedbackEl.textContent = "Auto-recalibrating - stay still";
      return;
    }
  }
  
  // ========== CALIBRATION ==========
  if (!isCalibrated && state === 'standing') {
    const currentHipKneeDist = Math.abs(kneeY - hipY);
    
    if (currentHipKneeDist < 0.05 || currentHipKneeDist > 0.5) {
      feedbackEl.textContent = "Position yourself so full body is visible";
      return;
    }
    
    if (calibrationHipYValues.length === 0) {
      calibrationHipYValues.push(hipY);
      hipKneeDistance = currentHipKneeDist;
      standingHipX = hipX;
      userHeightInches = getUserHeightInches();
      feedbackEl.textContent = "Hold still for calibration... 1/" + CALIBRATION_SAMPLES;
      return;
    }
    
    const recentAvg = calibrationHipYValues.slice(-3).reduce((a, b) => a + b, 0) / 
                      Math.min(calibrationHipYValues.length, 3);
    const variation = Math.abs(hipY - recentAvg);
    const tolerance = currentHipKneeDist * CALIBRATION_TOLERANCE_MULTIPLIER;
    
    if (variation < tolerance) {
      calibrationHipYValues.push(hipY);
      hipKneeDistance = hipKneeDistance * (1 - BASELINE_UPDATE_ALPHA) + currentHipKneeDist * BASELINE_UPDATE_ALPHA;
      feedbackEl.textContent = `Hold still... ${calibrationHipYValues.length}/${CALIBRATION_SAMPLES}`;
      
      if (calibrationHipYValues.length >= CALIBRATION_SAMPLES) {
        standingHipY = calibrationHipYValues.reduce((a, b) => a + b, 0) / calibrationHipYValues.length;
        standingHipX = hipX;
        stableFrameCount = STABILITY_FRAMES;
        stableStandingStartTime = performance.now();
        calibrationCompletedTime = performance.now();
        
        const expectedHipKneeInches = userHeightInches * HIP_KNEE_RATIO;
        inchesPerUnit = expectedHipKneeInches / hipKneeDistance;
        
        isCalibrated = true;
        
        const estimatedHipKneeInches = normToInches(hipKneeDistance);
        const feet = Math.floor(userHeightInches / 12);
        const inches = userHeightInches % 12;
        
        feedbackEl.textContent = `✓ Calibrated! H:${feet}'${inches}" HK:${estimatedHipKneeInches.toFixed(1)}"`;
        
        setTimeout(() => {
          if (state === 'standing') {
            feedbackEl.textContent = "Ready to squat!";
          }
        }, 2000);
      }
    } else {
      calibrationHipYValues = [];
      feedbackEl.textContent = "Too much movement - restarting calibration";
    }
    
    return;
  }
  
  // ========== VELOCITY TRACKING ==========
  if (prevHipY !== null) {
    const instantVelocity = hipY - prevHipY;
    velocityHistory.push(instantVelocity);
    if (velocityHistory.length > VELOCITY_WINDOW) {
      velocityHistory.shift();
    }
    // Update EMA-smoothed velocity
    updateSmoothedVelocity(instantVelocity);
  }
  prevHipY = hipY;

  // Use EMA-smoothed velocity for more stable detection
  const avgVelocity = velocityHistory.length >= VELOCITY_WINDOW
    ? smoothedVelocity
    : 0;
  
  // ========== STATE TIMEOUT CHECK - STRICTER ==========
  if (state === 'descending' && stateStartTime) {
    const timeInState = performance.now() - stateStartTime;
    if (timeInState > MAX_DESCENT_TIME_MS) {
      feedbackEl.textContent = "Descent too slow - resetting";
      resetToStanding();
      return;
    }
  }
  
  if (state === 'ascending' && stateStartTime) {
    const timeInState = performance.now() - stateStartTime;
    if (timeInState > MAX_ASCENT_TIME_MS) {
      feedbackEl.textContent = "Ascent stalled - resetting";
      resetToStanding();
      return;
    }
  }
  
  // ========== BASELINE STABILITY & DRIFT HANDLING ==========
  if (state === 'standing') {
    const distanceFromBaseline = Math.abs(hipY - standingHipY);
    const horizontalMovement = standingHipX ? Math.abs(hipX - standingHipX) : 0;
    const toleranceNorm = inchesToNorm(BASELINE_TOLERANCE_INCHES);
    const currentDepthNorm = hipY - standingHipY;
    const descentThresholdNorm = inchesToNorm(DESCENT_THRESHOLD_INCHES);
    
    // Check if this looks like a squat start (vertical movement) vs horizontal drift (reracking)
    const isVerticalMovement = distanceFromBaseline > horizontalMovement * 1.5;
    const isStartingSquat = isVerticalMovement && currentDepthNorm > descentThresholdNorm * 0.4;
    
    if (!isStartingSquat && distanceFromBaseline < toleranceNorm) {
      stableFrameCount = Math.min(STABILITY_FRAMES, stableFrameCount + 1);
      rebaselineStabilityCount = 0;
      potentialNewBaseline = null;
      
      if (stableFrameCount >= STABILITY_FRAMES && stableStandingStartTime === null) {
        stableStandingStartTime = performance.now();
      }
    } else if (!isStartingSquat) {
      // Only warn/recalibrate if it's not horizontal movement
      if (horizontalMovement > HORIZONTAL_MOVEMENT_THRESHOLD) {
        // Likely reracking - don't penalize
        stableFrameCount = Math.max(0, stableFrameCount - 1);
        stableStandingStartTime = null;
      } else {
        // Vertical drift - handle as before
        stableFrameCount = Math.max(0, stableFrameCount - 1);
        stableStandingStartTime = null;
        
        const driftInches = normToInches(distanceFromBaseline);
        
        const isStablePosition = velocityHistory.length >= 3 && 
          Math.abs(avgVelocity) < VELOCITY_THRESHOLD * 2;
        
        if (isStablePosition && driftInches > DRIFT_CRITICAL_THRESHOLD) {
          if (potentialNewBaseline === null || Math.abs(hipY - potentialNewBaseline) < toleranceNorm * 0.5) {
            potentialNewBaseline = hipY;
            rebaselineStabilityCount++;
            
            if (rebaselineStabilityCount >= REBASELINE_STABILITY_FRAMES) {
              standingHipY = potentialNewBaseline;
              standingHipX = hipX;
              stableFrameCount = STABILITY_FRAMES;
              stableStandingStartTime = performance.now();
              rebaselineStabilityCount = 0;
              potentialNewBaseline = null;
              feedbackEl.textContent = `✓ Position updated - ready to squat`;
            } else {
              feedbackEl.textContent = `Detecting new position... ${rebaselineStabilityCount}/${REBASELINE_STABILITY_FRAMES}`;
            }
          } else {
            rebaselineStabilityCount = 0;
            potentialNewBaseline = null;
          }
        } else {
          rebaselineStabilityCount = 0;
          potentialNewBaseline = null;
          
          if (driftInches > DRIFT_WARNING_THRESHOLD) {
            feedbackEl.textContent = `⚠ ${driftInches.toFixed(1)}" from baseline - stand still`;
          } else if (stableFrameCount > 0 && stableFrameCount < STABILITY_FRAMES) {
            feedbackEl.textContent = `Stabilizing... ${stableFrameCount}/${STABILITY_FRAMES}`;
          }
        }
      }
    } else if (stableFrameCount > 0 && stableFrameCount < STABILITY_FRAMES) {
      feedbackEl.textContent = `Stabilizing... ${stableFrameCount}/${STABILITY_FRAMES}`;
    }
  }
  
  // ========== TRACK DEEPEST POINT ==========
  if (state === 'descending' || state === 'ascending') {
    if (deepestHipY === null || hipY > deepestHipY) {
      deepestHipY = hipY;
    }
  }
  
  // ========== DEPTH CALCULATIONS ==========
  const currentDepthNorm = hipY - standingHipY;
  const currentDepthInches = normToInches(currentDepthNorm);
  
  const maxDepthNorm = deepestHipY ? deepestHipY - standingHipY : 0;
  const maxDepthInches = normToInches(maxDepthNorm);
  
  const descentThresholdNorm = inchesToNorm(DESCENT_THRESHOLD_INCHES);
  const minDepthNorm = inchesToNorm(MIN_DEPTH_INCHES);
  const hysteresisNorm = inchesToNorm(HYSTERESIS_INCHES);
  
  // ========== STATE MACHINE ==========
  switch (state) {
    case 'standing':
      const hasBeenStable = stableStandingStartTime && 
        (performance.now() - stableStandingStartTime) >= MIN_STANDING_TIME_MS;
      
      const isMovingDown = avgVelocity > DESCENT_VELOCITY_MIN;
      const wellPastThreshold = currentDepthNorm > descentThresholdNorm * DEPTH_TRIGGER_MULTIPLIER;
      const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;
      
      if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
        updateStatus('descending');
        deepestHipY = hipY;
        velocityHistory = [];
        stableStandingStartTime = null;
        rebaselineStabilityCount = 0;
        potentialNewBaseline = null;
        lastSquatStartTime = performance.now();
        
        const quality = getDepthQuality(currentDepthInches);
        feedbackEl.textContent = `⬇ Descending... ${quality.emoji}`;
      } else if (isPastThreshold && !hasBeenStable && stableStandingStartTime) {
        const timeUntilReady = Math.ceil((MIN_STANDING_TIME_MS - 
          (performance.now() - stableStandingStartTime)) / 1000);
        if (timeUntilReady > 0) {
          feedbackEl.textContent = `Setup detected - stabilizing... ${timeUntilReady}s`;
        }
      }
      break;
      
    case 'descending':
      const descendQuality = getDepthQuality(currentDepthInches);
      feedbackEl.textContent = `⬇ ${currentDepthInches.toFixed(1)}" ${descendQuality.emoji} ${descendQuality.label}`;
      
      if (velocityHistory.length >= VELOCITY_WINDOW && avgVelocity < -VELOCITY_THRESHOLD) {
        if (maxDepthInches >= MIN_DEPTH_INCHES) {
          updateStatus('ascending');
          ascentStartTime = performance.now();
          velocityHistory = [];
          
          const quality = getDepthQuality(maxDepthInches);
          feedbackEl.textContent = `⬆ Drive up! ${quality.emoji} ${quality.label}`;
        } else {
          feedbackEl.textContent = `⚠ Too shallow! Need at least ${MIN_DEPTH_INCHES}"`;
          resetToStanding();
        }
      }
      break;
      
    case 'ascending':
      if (deepestHipY === null || standingHipY === null) {
        resetToStanding();
        break;
      }
      
      const recovered = Math.max(0, deepestHipY - hipY);
      const totalDepth = maxDepthNorm;
      const recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;
      
      if (recoveryPercent < RECOVERY_WARNING_THRESHOLD) {
        feedbackEl.textContent = `⬆ Drive up! ${recoveryPercent.toFixed(0)}% recovery`;
      } else if (recoveryPercent < RECOVERY_PERCENT) {
        feedbackEl.textContent = `⬆ Almost there! ${recoveryPercent.toFixed(0)}% recovery`;
      }
      
      const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
      const hasMinDepth = maxDepthInches >= MIN_DEPTH_INCHES;
      
      if (recoveryPercent >= RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
        const ascentTime = (performance.now() - ascentStartTime) / 1000;
        repTimes.push(ascentTime);
        repDepths.push(maxDepthInches);
        repCount++;

        const speedScore = calculateSpeedScore(ascentTime, maxDepthInches);
        const quality = getDepthQuality(maxDepthInches);

        // Record rep for workout tracking
        recordRep(ascentTime, maxDepthInches, speedScore, quality.label.toLowerCase());

        counterEl.textContent = `Reps: ${repCount}`;
        feedbackEl.textContent = `✓ Rep ${repCount}: Speed ${speedScore} ${quality.emoji} ${quality.label}`;

        displayRepTimes();
        resetToStanding();
        
        setTimeout(() => {
          if (state === 'standing') {
            feedbackEl.textContent = "Ready for next rep";
          }
        }, 1500);
      }
      break;
  }
}

function resetToStanding() {
  updateStatus('standing');
  deepestHipY = null;
  stableFrameCount = 0;
  ascentStartTime = null;
  velocityHistory = [];
  stableStandingStartTime = null;
  rebaselineStabilityCount = 0;
  potentialNewBaseline = null;
  trackingLossFrames = 0;
  smoothedVelocity = 0;
}

function drawPose(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!results.poseLandmarks || results.poseLandmarks.length === 0) {
    ctx.restore();
    return;
  }
  
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  
  const landmarks = results.poseLandmarks;
  
  if (DEBUG_MODE) {
    const landmarksToShow = [
      { idx: 11, name: 'L_Shoulder', color: '#FF00FF' },
      { idx: 12, name: 'R_Shoulder', color: '#FF00FF' },
      { idx: 23, name: 'L_Hip', color: '#FFD700' },
      { idx: 24, name: 'R_Hip', color: '#FFD700' },
      { idx: 25, name: 'L_Knee', color: '#00BFFF' },
      { idx: 26, name: 'R_Knee', color: '#00BFFF' },
      { idx: 27, name: 'L_Ankle', color: '#00FF00' },
      { idx: 28, name: 'R_Ankle', color: '#00FF00' }
    ];
    
    ctx.font = '12px Arial';
    landmarksToShow.forEach(({ idx, name, color }) => {
      const lm = landmarks[idx];
      if (lm && (lm.visibility || 0) > 0.1) {
        const x = lm.x * canvas.width;
        const y = lm.y * canvas.height;
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.fillStyle = '#FFF';
        const displayName = name.startsWith('L_') ? 'R_' + name.substring(2) : 'L_' + name.substring(2);
        ctx.fillText(displayName, 10, -10);
        ctx.fillText(`v:${(lm.visibility || 0).toFixed(2)}`, 10, 5);
        ctx.fillText(`y:${lm.y.toFixed(3)}`, 10, 20);
        ctx.restore();
      }
    });
    
    const connections = [
      [23, 25], [24, 26], [25, 27], [26, 28]
    ];
    
    connections.forEach(([start, end]) => {
      const lm1 = landmarks[start];
      const lm2 = landmarks[end];
      if (lm1 && lm2 && (lm1.visibility || 0) > 0.3 && (lm2.visibility || 0) > 0.3) {
        ctx.beginPath();
        ctx.moveTo(lm1.x * canvas.width, lm1.y * canvas.height);
        ctx.lineTo(lm2.x * canvas.width, lm2.y * canvas.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }
  
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  
  const leftValid = leftHip && leftKnee && 
    (leftHip.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD && 
    (leftKnee.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD;
  const rightValid = rightHip && rightKnee && 
    (rightHip.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD && 
    (rightKnee.visibility || 0) > LANDMARK_VISIBILITY_THRESHOLD;
  
  const useLeft = (currentSide === 'left');
  const hip = useLeft ? leftHip : rightHip;
  const knee = useLeft ? leftKnee : rightKnee;

  if (hip && knee && ((useLeft && leftValid) || (!useLeft && rightValid))) {
    ctx.beginPath();
    ctx.moveTo(hip.x * canvas.width, hip.y * canvas.height);
    ctx.lineTo(knee.x * canvas.width, knee.y * canvas.height);
    
    if (state === 'descending') ctx.strokeStyle = '#FFA500';
    else if (state === 'ascending') ctx.strokeStyle = '#00FF00';
    else ctx.strokeStyle = '#00BFFF';
    
    ctx.lineWidth = 6;
    ctx.stroke();
    
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#00BFFF';
    ctx.beginPath();
    ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    if (standingHipY && isCalibrated && inchesPerUnit) {
      const standingPos = standingHipY * canvas.height;
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, standingPos);
      ctx.lineTo(canvas.width, standingPos);
      ctx.stroke();
      ctx.setLineDash([]);
      
      const depthMarkers = [
        { inches: DEPTH_MARKER_HALF, color: 'rgba(255, 165, 0, 0.4)' },
        { inches: DEPTH_MARKER_PARALLEL, color: 'rgba(255, 255, 0, 0.4)' },
        { inches: DEPTH_MARKER_DEEP, color: 'rgba(0, 255, 0, 0.4)' }
      ];
      
      depthMarkers.forEach(({ inches, color }) => {
        const depthNorm = inchesToNorm(inches);
        const depthY = standingPos + (depthNorm * canvas.height);
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, depthY);
        ctx.lineTo(canvas.width, depthY);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
  }
  
  if (DEBUG_MODE && debugInfo.leftHip) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(-canvas.width, 0, 350, 320);
    
    ctx.fillStyle = '#00FF00';
    ctx.font = '11px monospace';
    let y = 15;
    
    const displaySide = lockedSide === 'left' ? 'right' : 'left';
    ctx.fillText(`Tracking: ${displaySide} side (camera view)`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`Physical: ${lockedSide} side`, -canvas.width + 10, y);
    y += 20;
    
    ctx.fillText(`L_Hip: x:${debugInfo.leftHip.x} y:${debugInfo.leftHip.y} v:${debugInfo.leftHip.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`R_Hip: x:${debugInfo.rightHip.x} y:${debugInfo.rightHip.y} v:${debugInfo.rightHip.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`L_Knee: x:${debugInfo.leftKnee.x} y:${debugInfo.leftKnee.y} v:${debugInfo.leftKnee.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`R_Knee: x:${debugInfo.rightKnee.x} y:${debugInfo.rightKnee.y} v:${debugInfo.rightKnee.vis}`, -canvas.width + 10, y);
    y += 15;
    
    if (debugInfo.leftAnkle) {
      ctx.fillText(`L_Ankle: y:${debugInfo.leftAnkle.y} v:${debugInfo.leftAnkle.vis}`, -canvas.width + 10, y);
      y += 15;
    }
    if (debugInfo.rightAnkle) {
      ctx.fillText(`R_Ankle: y:${debugInfo.rightAnkle.y} v:${debugInfo.rightAnkle.vis}`, -canvas.width + 10, y);
      y += 15;
    }
    
    y += 10;
    
    if (isCalibrated) {
      const hipKneePixels = hipKneeDistance * canvas.height;
      const hipKneeInches = normToInches(hipKneeDistance);
      ctx.fillText(`Hip-Knee: ${hipKneeInches.toFixed(1)}" (${hipKneePixels.toFixed(0)}px)`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`Standing Y: ${(standingHipY * canvas.height).toFixed(0)}px`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`Inches/Unit: ${inchesPerUnit.toFixed(2)}`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`State: ${state}`, -canvas.width + 10, y);
      y += 15;
      
      if (calibrationCompletedTime && lastSquatStartTime === null) {
        const timeSinceCalibration = performance.now() - calibrationCompletedTime;
        const secondsRemaining = Math.ceil((RECALIBRATION_TIMEOUT_MS - timeSinceCalibration) / 1000);
        ctx.fillText(`Recalib in: ${secondsRemaining}s`, -canvas.width + 10, y);
        y += 15;
      }
    }
    
    ctx.restore();
  }
  
  ctx.restore();
}

function onResults(results) {
  if (isProcessing) return;
  isProcessing = true;

  drawPose(results);
  
  if (results.poseLandmarks && results.poseLandmarks.length) {
    detectSquat(results.poseLandmarks);
  }

  isProcessing = false;
}

async function initializePose() {
  try {
    pose = new Pose({
      locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      selfieMode: false,
      enableSegmentation: false,
      minDetectionConfidence: 0.8,
      minTrackingConfidence: 0.8
    });

    pose.onResults(onResults);
    return true;
  } catch (error) {
    console.error('Failed to initialize pose:', error);
    return false;
  }
}

async function initializeCamera() {
  try {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: isMobile ? 480 : 640 },
        height: { ideal: isMobile ? 640 : 480 },
        facingMode: 'user'
      }
    });
    
    video.srcObject = mediaStream;
    
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });
    
    camera = new Camera(video, {
      onFrame: async () => {
        if (pose && !isProcessing) {
          await pose.send({ image: video });
        }
      },
      width: video.videoWidth,
      height: video.videoHeight
    });

    await camera.start();
    feedbackEl.textContent = "✅ Set your height, then stand sideways and stay still";
    return true;
  } catch (err) {
    console.error("Camera error:", err);
    feedbackEl.textContent = "❌ Camera access denied";
    return false;
  }
}

async function initialize() {
  try {
    const poseInitialized = await initializePose();
    if (poseInitialized) {
      await initializeCamera();
    } else {
      feedbackEl.textContent = "⚠️ Pose detection failed";
    }
  } catch (err) {
    console.error("Initialization error:", err);
    feedbackEl.textContent = "⚠️ Setup failed";
  }
}

// ========== WORKOUT TRACKING ==========
let currentWorkoutId = null;
let currentSetReps = [];  // Store individual rep data for current set

// Program tracking
let programExerciseId = null;
let programProgramId = null;

const saveSetBtn = document.getElementById('saveSetBtn');
const setCounterEl = document.getElementById('setCounter');
const programIndicator = document.getElementById('programExerciseIndicator');
const workoutChannel = new BroadcastChannel('chronicle-workout');

// Check for program exercise tracking
function checkProgramTracking() {
  const urlParams = new URLSearchParams(window.location.search);
  const exerciseId = urlParams.get('program_exercise');

  if (exerciseId) {
    programExerciseId = parseInt(exerciseId);
    // Also check session storage for program ID
    const storedProgramId = sessionStorage.getItem('trackingProgramId');
    if (storedProgramId) {
      programProgramId = parseInt(storedProgramId);
    }

    // Show program indicator
    if (programIndicator) {
      programIndicator.textContent = 'Program Tracking';
      programIndicator.classList.remove('hidden');
    }

    // Update save button
    if (saveSetBtn) {
      saveSetBtn.textContent = 'Save to Program';
    }
  }
}

// Get or create current workout on page load
async function initWorkout() {
  try {
    const response = await fetch('/api/workouts/current');
    const data = await response.json();

    if (data.success && data.workout) {
      currentWorkoutId = data.workout.id;
      updateSetCounter(data.workout.sets?.length || 0);
    } else {
      // Create a new workout
      const createResponse = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Squat Session' })
      });
      const createData = await createResponse.json();
      if (createData.success) {
        currentWorkoutId = createData.workout.id;
        updateSetCounter(0);
      }
    }
  } catch (err) {
    console.error('Failed to init workout:', err);
  }
}

function updateSetCounter(count) {
  if (setCounterEl) {
    setCounterEl.textContent = `Set ${count + 1}`;
  }
}

// Track rep data when rep is completed
function recordRep(timeSeconds, depthInches, velocity, quality) {
  currentSetReps.push({
    time_seconds: timeSeconds,
    depth: depthInches,
    velocity: velocity,
    quality: quality
  });

  // Update save button state
  if (saveSetBtn) {
    saveSetBtn.classList.toggle('has-reps', currentSetReps.length > 0);
    saveSetBtn.textContent = `Save Set (${currentSetReps.length} reps)`;
  }
}

// Save the current set
async function saveSet() {
  if (!currentWorkoutId || currentSetReps.length === 0) {
    return;
  }

  // Calculate fatigue drop
  let fatigueDrop = null;
  if (currentSetReps.length >= 2) {
    const firstVelocity = currentSetReps[0].velocity;
    const lastVelocity = currentSetReps[currentSetReps.length - 1].velocity;
    if (firstVelocity > 0) {
      fatigueDrop = ((firstVelocity - lastVelocity) / firstVelocity) * 100;
    }
  }

  try {
    const response = await fetch(`/api/workouts/${currentWorkoutId}/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reps_completed: currentSetReps.length,
        reps: currentSetReps,
        fatigue_drop: fatigueDrop
      })
    });

    const data = await response.json();
    if (data.success) {
      // Notify dashboard via BroadcastChannel
      workoutChannel.postMessage({ type: 'SET_ADDED', set: data.set });

      // If tracking for a program exercise, also log to program
      if (programExerciseId) {
        try {
          await fetch(`/api/exercises/${programExerciseId}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reps_completed: currentSetReps.length,
              velocity_tracked: true,
              workout_set_id: data.set.id
            })
          });
          feedbackEl.textContent = `✅ Set saved to program! ${currentSetReps.length} reps recorded`;
        } catch (progErr) {
          console.error('Failed to log to program:', progErr);
          feedbackEl.textContent = `✅ Set saved! ${currentSetReps.length} reps (program log failed)`;
        }
      } else {
        feedbackEl.textContent = `✅ Set saved! ${currentSetReps.length} reps recorded`;
      }

      // Reset for next set
      const setNum = data.set.set_number;
      currentSetReps = [];
      repCount = 0;
      repTimes = [];
      repDepths = [];
      counterEl.textContent = 'Reps: 0';

      if (saveSetBtn) {
        saveSetBtn.classList.remove('has-reps');
        saveSetBtn.textContent = programExerciseId ? 'Save to Program' : 'Save Set';
      }

      updateSetCounter(setNum);

      // Reset calibration for fresh set
      setTimeout(() => {
        feedbackEl.textContent = 'Ready for next set - stand still to calibrate';
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to save set:', err);
    feedbackEl.textContent = '❌ Failed to save set';
  }
}

// Hook into save button
if (saveSetBtn) {
  saveSetBtn.addEventListener('click', saveSet);
}

// Initialize
initialize();
initWorkout();
checkProgramTracking();