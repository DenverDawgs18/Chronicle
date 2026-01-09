// ========== HYPERPARAMETERS - ADJUSTED FOR GYM ROBUSTNESS ==========
const MIN_DEPTH_INCHES = 4;
const DESCENT_THRESHOLD_INCHES = 3;
const STABILITY_FRAMES = 6;
const CALIBRATION_SAMPLES = 5;
const BASELINE_TOLERANCE_INCHES = 4;
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

const MIN_STANDING_TIME_MS = 1000;
const SIDE_LOCK_CONFIDENCE_THRESHOLD = 0.15;
const QUICK_CALIBRATION_MODE = true;
const DESCENT_VELOCITY_MIN = 0.001;  // Lowered from 0.002
const DRIFT_WARNING_THRESHOLD = 3;   // Lowered from 6
const DRIFT_CRITICAL_THRESHOLD = 6;  // New: for re-baseline trigger

// New constants for clarity
const DEPTH_TRIGGER_MULTIPLIER = 1.2;
const BASELINE_UPDATE_ALPHA = 0.2;
const REBASELINE_STABILITY_FRAMES = 10;  // Frames of stability needed to re-baseline
const RECOVERY_WARNING_THRESHOLD = 50;  // Show feedback at 50% recovery

// DEBUG MODE - Set to true to see detailed landmark info
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

// New: separate stability tracker for re-baseline
let rebaselineStabilityCount = 0;
let potentialNewBaseline = null;

// Debug info
let debugInfo = {};

function getUserHeightInches() {
  return parseInt(document.getElementById('heightSlider').value);
}

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
  
  if (!keepCalibration) {
    standingHipY = null;
    hipKneeDistance = null;
    inchesPerUnit = null;
    isCalibrated = false;
    calibrationHipYValues = [];
    lockedSide = null;
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
  
  // Store debug info
  if (DEBUG_MODE) {
    debugInfo = {
      leftHip: leftHip ? { x: leftHip.x.toFixed(3), y: leftHip.y.toFixed(3), vis: (leftHip.visibility || 0).toFixed(2) } : null,
      rightHip: rightHip ? { x: rightHip.x.toFixed(3), y: rightHip.y.toFixed(3), vis: (rightHip.visibility || 0).toFixed(2) } : null,
      leftKnee: leftKnee ? { x: leftKnee.x.toFixed(3), y: leftKnee.y.toFixed(3), vis: (leftKnee.visibility || 0).toFixed(2) } : null,
      rightKnee: rightKnee ? { x: rightKnee.x.toFixed(3), y: rightKnee.y.toFixed(3), vis: (rightKnee.visibility || 0).toFixed(2) } : null,
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
    if (state !== 'standing' && stateStartTime && 
        (performance.now() - stateStartTime) > MAX_STATE_TIME) {
      feedbackEl.textContent = "Lost tracking - resetting";
      resetToStanding();
    }
    return;
  }
  
  // Side selection logic - simplified
  if (lockedSide === null) {
    const leftVisibility = leftValid ? (leftHip.visibility || 0) : 0;
    const rightVisibility = rightValid ? (rightHip.visibility || 0) : 0;
    lockedSide = leftVisibility > rightVisibility ? 'left' : 'right';
  } else {
    const currentValid = (lockedSide === 'left') ? leftValid : rightValid;
    const otherValid = (lockedSide === 'left') ? rightValid : leftValid;
    const currentVisibility = (lockedSide === 'left') ? (leftHip.visibility || 0) : (rightHip.visibility || 0);
    const otherVisibility = (lockedSide === 'left') ? (rightHip.visibility || 0) : (leftHip.visibility || 0);
    
    const shouldSwitch = !currentValid && otherValid && 
      (otherVisibility - currentVisibility > SIDE_LOCK_CONFIDENCE_THRESHOLD);
    
    if (shouldSwitch && state === 'standing') {
      lockedSide = lockedSide === 'left' ? 'right' : 'left';
      feedbackEl.textContent = `Switched to ${lockedSide} side view`;
    }
  }
  
  const useLeft = (lockedSide === 'left');
  currentSide = lockedSide;
  
  const hip = useLeft ? leftHip : rightHip;
  const knee = useLeft ? leftKnee : rightKnee;
  const hipY = hip.y;
  const kneeY = knee.y;
  
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
        stableFrameCount = STABILITY_FRAMES;
        stableStandingStartTime = performance.now();
        
        const expectedHipKneeInches = userHeightInches * HIP_KNEE_RATIO;
        inchesPerUnit = expectedHipKneeInches / hipKneeDistance;
        
        // Set calibrated flag AFTER all calculations are complete
        isCalibrated = true;
        
        const estimatedHipKneeInches = normToInches(hipKneeDistance);
        const feet = Math.floor(userHeightInches / 12);
        const inches = userHeightInches % 12;
        feedbackEl.textContent = `✓ Calibrated! Height: ${feet}'${inches}", Hip-knee: ~${estimatedHipKneeInches.toFixed(1)}"`;
        
        setTimeout(() => {
          if (state === 'standing') {
            feedbackEl.textContent = "Ready to squat!";
          }
        }, 1500);
      }
    } else {
      calibrationHipYValues = [];
      feedbackEl.textContent = "Too much movement - restarting calibration";
    }
    
    return;
  }
  
  // ========== VELOCITY TRACKING ==========
  if (prevHipY !== null) {
    const velocity = hipY - prevHipY;
    velocityHistory.push(velocity);
    if (velocityHistory.length > VELOCITY_WINDOW) {
      velocityHistory.shift();
    }
  }
  prevHipY = hipY;
  
  const avgVelocity = velocityHistory.length >= VELOCITY_WINDOW
    ? velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length
    : 0;
  
  // ========== STATE TIMEOUT CHECK ==========
  if ((state === 'descending' || state === 'ascending') && stateStartTime) {
    const timeInState = performance.now() - stateStartTime;
    if (timeInState > MAX_STATE_TIME) {
      feedbackEl.textContent = "Rep abandoned - resetting";
      resetToStanding();
      return;
    }
  }
  
  // ========== BASELINE STABILITY & DRIFT HANDLING ==========
  if (state === 'standing') {
    const distanceFromBaseline = Math.abs(hipY - standingHipY);
    const toleranceNorm = inchesToNorm(BASELINE_TOLERANCE_INCHES);
    const currentDepthNorm = hipY - standingHipY;
    const descentThresholdNorm = inchesToNorm(DESCENT_THRESHOLD_INCHES);
    
    // Check if we're starting to squat
    const isStartingSquat = currentDepthNorm > descentThresholdNorm * 0.5;
    
    if (!isStartingSquat && distanceFromBaseline < toleranceNorm) {
      // Within baseline tolerance - stable
      stableFrameCount = Math.min(STABILITY_FRAMES, stableFrameCount + 1);
      rebaselineStabilityCount = 0;
      potentialNewBaseline = null;
      
      if (stableFrameCount >= STABILITY_FRAMES && stableStandingStartTime === null) {
        stableStandingStartTime = performance.now();
      }
    } else if (!isStartingSquat) {
      // Outside baseline tolerance - potential drift
      stableFrameCount = Math.max(0, stableFrameCount - 1);
      stableStandingStartTime = null;
      
      const driftInches = normToInches(distanceFromBaseline);
      
      // Check if position is stable at new location (for re-baseline)
      const isStablePosition = velocityHistory.length >= 3 && 
        Math.abs(avgVelocity) < VELOCITY_THRESHOLD * 2;
      
      if (isStablePosition && driftInches > DRIFT_CRITICAL_THRESHOLD) {
        // Track stability at this new position
        if (potentialNewBaseline === null || Math.abs(hipY - potentialNewBaseline) < toleranceNorm * 0.5) {
          potentialNewBaseline = hipY;
          rebaselineStabilityCount++;
          
          if (rebaselineStabilityCount >= REBASELINE_STABILITY_FRAMES) {
            // Re-baseline to new position
            standingHipY = potentialNewBaseline;
            stableFrameCount = STABILITY_FRAMES;
            stableStandingStartTime = performance.now();
            rebaselineStabilityCount = 0;
            potentialNewBaseline = null;
            feedbackEl.textContent = `✓ Position updated - ready to squat`;
          } else {
            feedbackEl.textContent = `Detecting new position... ${rebaselineStabilityCount}/${REBASELINE_STABILITY_FRAMES}`;
          }
        } else {
          // Position changed, reset re-baseline tracking
          rebaselineStabilityCount = 0;
          potentialNewBaseline = null;
        }
      } else {
        rebaselineStabilityCount = 0;
        potentialNewBaseline = null;
        
        // Show drift warnings
        if (driftInches > DRIFT_WARNING_THRESHOLD) {
          feedbackEl.textContent = `⚠ ${driftInches.toFixed(1)}" from baseline - stand still`;
        } else if (stableFrameCount > 0 && stableFrameCount < STABILITY_FRAMES) {
          feedbackEl.textContent = `Stabilizing... ${stableFrameCount}/${STABILITY_FRAMES}`;
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
      
      // Check conditions for starting descent
      const isMovingDown = avgVelocity > DESCENT_VELOCITY_MIN;
      const wellPastThreshold = currentDepthNorm > descentThresholdNorm * DEPTH_TRIGGER_MULTIPLIER;
      const isPastThreshold = currentDepthNorm > descentThresholdNorm + hysteresisNorm;
      
      // Start descent if: past threshold AND (moving down OR significantly past threshold)
      if (isPastThreshold && hasBeenStable && (isMovingDown || wellPastThreshold)) {
        updateStatus('descending');
        deepestHipY = hipY;
        velocityHistory = [];
        stableStandingStartTime = null;
        rebaselineStabilityCount = 0;
        potentialNewBaseline = null;
        
        const quality = getDepthQuality(currentDepthInches);
        feedbackEl.textContent = `⬇ Descending... ${quality.emoji}`;
      } else if (isPastThreshold && !hasBeenStable && stableStandingStartTime) {
        // Show countdown if we have a valid start time
        const timeUntilReady = Math.ceil((MIN_STANDING_TIME_MS - 
          (performance.now() - stableStandingStartTime)) / 1000);
        if (timeUntilReady > 0) {
          feedbackEl.textContent = `Setup detected - stabilizing... ${timeUntilReady}s`;
        }
      }
      break;
      
    case 'descending':
      // Show real-time depth quality
      const descendQuality = getDepthQuality(currentDepthInches);
      feedbackEl.textContent = `⬇ ${currentDepthInches.toFixed(1)}" ${descendQuality.emoji} ${descendQuality.label}`;
      
      // Check if starting to ascend
      if (velocityHistory.length >= VELOCITY_WINDOW && avgVelocity < -VELOCITY_THRESHOLD) {
        // Check if minimum depth was reached
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
      // Defensive null checks for edge cases where tracking is lost
      if (deepestHipY === null || standingHipY === null) {
        resetToStanding();
        break;
      }
      
      const recovered = Math.max(0, deepestHipY - hipY);  // Prevent negative values
      const totalDepth = maxDepthNorm;
      const recoveryPercent = totalDepth > 0 ? (recovered / totalDepth) * 100 : 0;
      
      // Show recovery feedback
      if (recoveryPercent < RECOVERY_WARNING_THRESHOLD) {
        feedbackEl.textContent = `⬆ Drive up! ${recoveryPercent.toFixed(0)}% recovery`;
      } else if (recoveryPercent < RECOVERY_PERCENT) {
        feedbackEl.textContent = `⬆ Almost there! ${recoveryPercent.toFixed(0)}% recovery`;
      }
      
      // Check if rep is complete
      const isAboveThreshold = currentDepthNorm < descentThresholdNorm - hysteresisNorm;
      const hasMinDepth = maxDepthInches >= MIN_DEPTH_INCHES;
      
      if (recoveryPercent >= RECOVERY_PERCENT && isAboveThreshold && hasMinDepth) {
        const ascentTime = (performance.now() - ascentStartTime) / 1000;
        repTimes.push(ascentTime);
        repDepths.push(maxDepthInches);
        repCount++;
        
        const speedScore = calculateSpeedScore(ascentTime, maxDepthInches);
        
        counterEl.textContent = `Reps: ${repCount}`;
        
        const quality = getDepthQuality(maxDepthInches);
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
}

function drawPose(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Only proceed if we have landmarks to draw
  if (!results.poseLandmarks || results.poseLandmarks.length === 0) {
    ctx.restore();
    return;
  }
  
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  
  const landmarks = results.poseLandmarks;
  
  // Draw ALL relevant landmarks in debug mode
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
        
        // Draw circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw label (un-mirror the text)
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.fillStyle = '#FFF';
        ctx.fillText(name, 10, -10);
        ctx.fillText(`v:${(lm.visibility || 0).toFixed(2)}`, 10, 5);
        ctx.restore();
      }
    });
    
    // Draw connections
    const connections = [
      [23, 25], // left hip to knee
      [24, 26], // right hip to knee
      [25, 27], // left knee to ankle
      [26, 28]  // right knee to ankle
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
    // Draw TRACKED hip-knee line
    ctx.beginPath();
    ctx.moveTo(hip.x * canvas.width, hip.y * canvas.height);
    ctx.lineTo(knee.x * canvas.width, knee.y * canvas.height);
    
    if (state === 'descending') ctx.strokeStyle = '#FFA500';
    else if (state === 'ascending') ctx.strokeStyle = '#00FF00';
    else ctx.strokeStyle = '#00BFFF';
    
    ctx.lineWidth = 6;
    ctx.stroke();
    
    // Draw tracked hip
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw tracked knee
    ctx.fillStyle = '#00BFFF';
    ctx.beginPath();
    ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    if (standingHipY && isCalibrated && inchesPerUnit) {
      const standingPos = standingHipY * canvas.height;
      
      // Draw baseline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, standingPos);
      ctx.lineTo(canvas.width, standingPos);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw depth markers
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
  
  // Display debug info
  if (DEBUG_MODE && debugInfo.leftHip) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(-canvas.width, 0, 300, 180);
    
    ctx.fillStyle = '#00FF00';
    ctx.font = '11px monospace';
    let y = 15;
    ctx.fillText(`Side: ${debugInfo.lockedSide} (${debugInfo.currentSide})`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`L_Hip: x:${debugInfo.leftHip.x} y:${debugInfo.leftHip.y} v:${debugInfo.leftHip.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`R_Hip: x:${debugInfo.rightHip.x} y:${debugInfo.rightHip.y} v:${debugInfo.rightHip.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`L_Knee: x:${debugInfo.leftKnee.x} y:${debugInfo.leftKnee.y} v:${debugInfo.leftKnee.vis}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`R_Knee: x:${debugInfo.rightKnee.x} y:${debugInfo.rightKnee.y} v:${debugInfo.rightKnee.vis}`, -canvas.width + 10, y);
    y += 20;
    
    if (isCalibrated) {
      ctx.fillText(`Hip-Knee Dist: ${(hipKneeDistance * canvas.height).toFixed(0)}px`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`Standing Y: ${(standingHipY * canvas.height).toFixed(0)}px`, -canvas.width + 10, y);
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

initialize();