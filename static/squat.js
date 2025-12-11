let audioEnabled = false;
let speechPrimed = false;
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const feedbackEl = document.getElementById('feedback');
const msgEl = document.getElementById('msg');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');
const audioBtn = document.getElementById('audioBtn');

let repCount = 0;
let state = 'standing';
let maxHipY = null;
let baselineHipY = null;
let pose = null;
let camera = null;
let mediaStream = null;
let isProcessing = false;
let stableFrameCount = 0;

// Rep timing data
let ascentStartTime = null;
let repTimes = [];
let repDepths = [];
let stateStartTime = null; // Track how long we've been in a state

// Thresholds
const DESCENT_THRESHOLD = 0.02375;   // Increased - less sensitive to walking
const MIN_DEPTH = 0.02375;           // Increased - must be a real squat
const ASCENT_THRESHOLD = 0.015;
const STABILITY_FRAMES = 5;       // Increased - need more stable frames
const BASELINE_TOLERANCE = 0.015; // Increased - more forgiving for standing
const MAX_STATE_TIME = 8000;      // 8 seconds max in descending/ascending before reset

audioBtn.addEventListener('click', () => {
  if (!audioEnabled) {
    audioEnabled = true;
    audioBtn.textContent = 'Turn Audio Off';
    const primeUtterance = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(primeUtterance);
    speechPrimed = true;
    feedbackEl.textContent = 'Audio enabled!';
  } else { 
    audioEnabled = false;
    speechPrimed = false;
    audioBtn.textContent = 'Turn Audio On';
    speechSynthesis.cancel();
    feedbackEl.textContent = 'Audio disabled';
  }
});

resetBtn.addEventListener('click', () => {
  repCount = 0;
  state = 'standing';
  maxHipY = null;
  baselineHipY = null;
  stableFrameCount = 0;
  ascentStartTime = null;
  stateStartTime = null;
  repTimes = [];
  repDepths = [];
  counterEl.textContent = 'Reps: 0';
  feedbackEl.textContent = 'Counter reset! Stand sideways';
  msgEl.innerHTML = '';
  updateStatus('standing');
});

function updateStatus(newState) {
  state = newState;
  stateStartTime = performance.now();
  statusEl.textContent = state.toUpperCase();
  statusEl.className = `status-indicator status-${state}`;
}

function displayRepTimes() {
  if (repTimes.length === 0) {
    msgEl.innerHTML = '<div style="color: #666;">No reps yet</div>';
    return;
  }

  const firstRepTime = repTimes[0];
  const firstRepDepth = repDepths[0];
  
  // Normalize first rep: time / depth, then multiply by 100 for readable numbers
  const firstNormalized = (firstRepTime / firstRepDepth) * 100;
  
  let html = '<div style="margin-bottom: 10px; font-weight: bold;">Bar Speed Analysis</div>';
  
  // Show last 5 reps
  const recentReps = repTimes.slice(-5);
  const recentDepths = repDepths.slice(-5);
  
  recentReps.forEach((time, idx) => {
    const actualRepNum = repTimes.length - recentReps.length + idx + 1;
    const depth = recentDepths[idx];
    const depthPercent = (depth * 100).toFixed(1);
    
    // Normalized speed score (time/depth * 100)
    const normalizedScore = (time / depth) * 100;
    const velocityDrop = ((normalizedScore - firstNormalized) / firstNormalized * 100).toFixed(1);
    const dropNum = parseFloat(velocityDrop);
    
    let color = '#00FF00'; // green
    if (dropNum > 20) color = '#FF4444'; // red
    else if (dropNum > 10) color = '#FFA500'; // orange
    
    html += `<div style="margin: 5px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
      <div style="font-size: 16px; margin-bottom: 4px;">
        Rep ${actualRepNum}: Speed Score ${normalizedScore.toFixed(1)}
        <span style="color: ${color}; margin-left: 10px; font-weight: bold;">${dropNum > 0 ? '+' : ''}${velocityDrop}%</span>
      </div>
      <div style="font-size: 12px; color: #999;">
        ${time.toFixed(2)}s • ${depthPercent}% depth
      </div>
    </div>`;
  });
  
  msgEl.innerHTML = html;
}

function detectSquat(landmarks) {
  // Only need hip and knee - don't require shoulder/ankle visibility
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  
  // Must have at least one complete hip-knee pair
  const leftValid = leftHip && leftKnee && (leftHip.visibility || 0) > 0.5 && (leftKnee.visibility || 0) > 0.5;
  const rightValid = rightHip && rightKnee && (rightHip.visibility || 0) > 0.5 && (rightKnee.visibility || 0) > 0.5;
  
  if (!leftValid && !rightValid) {
    // Can't track - reset if we've been stuck too long
    if (state !== 'standing' && stateStartTime && (performance.now() - stateStartTime) > MAX_STATE_TIME) {
      feedbackEl.textContent = "Lost tracking - reset";
      updateStatus('standing');
      maxHipY = null;
      baselineHipY = null;
      ascentStartTime = null;
    }
    return;
  }
  
  // Use the side with better visibility
  const useLeft = leftValid && (!rightValid || (leftHip.visibility || 0) > (rightHip.visibility || 0));
  const hip = useLeft ? leftHip : rightHip;
  const knee = useLeft ? leftKnee : rightKnee;

  const hipY = hip.y;
  const kneeY = knee.y;
  const hipKneeDistance = kneeY - hipY;
  
  // Check for stuck states and reset
  if ((state === 'descending' || state === 'ascending') && stateStartTime) {
    const timeInState = performance.now() - stateStartTime;
    if (timeInState > MAX_STATE_TIME) {
      feedbackEl.textContent = "Rep abandoned - resetting";
      updateStatus('standing');
      maxHipY = null;
      baselineHipY = hipKneeDistance;
      stableFrameCount = 0;
      ascentStartTime = null;
      return;
    }
  }
  
  // Establish baseline when standing
  if (state === 'standing') {
    if (baselineHipY === null) {
      baselineHipY = hipKneeDistance;
      stableFrameCount = 1;
    } else {
      const distanceVariation = Math.abs(hipKneeDistance - baselineHipY);
      baselineHipY = (baselineHipY * 0.9 + hipKneeDistance * 0.1);
      
      if (distanceVariation < BASELINE_TOLERANCE) {
        stableFrameCount++;
      } else {
        stableFrameCount = Math.max(1, stableFrameCount - 1);
      }
    }
    maxHipY = null;
  }

  if (state === 'descending' || state === 'ascending') {
    if (maxHipY === null) {
      maxHipY = baselineHipY;
    }
    if (hipKneeDistance < maxHipY) {
      maxHipY = hipKneeDistance;
    }
  }

  const distanceChange = baselineHipY ? baselineHipY - hipKneeDistance : 0;
  const currentDepth = (maxHipY !== null && baselineHipY) ? baselineHipY - maxHipY : 0;

  // Standing -> Descending
  if (state === 'standing' && baselineHipY && stableFrameCount >= STABILITY_FRAMES && distanceChange > DESCENT_THRESHOLD) {
    updateStatus('descending');
    maxHipY = baselineHipY;
    feedbackEl.textContent = "Going down...";
  } 
  // Descending -> Ascending (START TIMER HERE)
  else if (state === 'descending' && currentDepth >= MIN_DEPTH) {
    updateStatus('ascending');
    ascentStartTime = performance.now(); // Start timing the ascent
    feedbackEl.textContent = "Drive up!";
  } 
  // Ascending -> Standing (COUNT REP AND RECORD TIME)
  else if (state === 'ascending' && baselineHipY && maxHipY) {
    const distanceRecovered = hipKneeDistance - maxHipY;
    
    if (distanceRecovered >= (currentDepth * 0.7) && distanceChange < DESCENT_THRESHOLD) {
      // Calculate ascent time and store depth
      const ascentTime = (performance.now() - ascentStartTime) / 1000; // Convert to seconds
      repTimes.push(ascentTime);
      repDepths.push(currentDepth);
      repCount++;
      
      // Calculate normalized speed score
      const normalizedScore = (ascentTime / currentDepth) * 100;
      const velocityDrop = repTimes.length > 1 
        ? ((normalizedScore - (repTimes[0] / repDepths[0]) * 100) / ((repTimes[0] / repDepths[0]) * 100) * 100).toFixed(1)
        : 0;
      
      counterEl.textContent = `Reps: ${repCount}`;
      feedbackEl.textContent = `Rep ${repCount}: Speed ${normalizedScore.toFixed(1)}`;
      
      if (audioEnabled && speechPrimed) {
        const msg = velocityDrop > 20 
          ? `Rep ${repCount}. Consider stopping`
          : `Rep ${repCount}`;
        const utterance = new SpeechSynthesisUtterance(msg);
        speechSynthesis.speak(utterance);  
      }
      
      displayRepTimes();

      // Reset to standing
      updateStatus('standing');
      maxHipY = null;
      baselineHipY = hipKneeDistance;
      stableFrameCount = 0;
      ascentStartTime = null;

      setTimeout(() => {
        if (state === 'standing') {
          feedbackEl.textContent = "Ready for next rep";
        }
      }, 2000);
    }
  }
}

function drawPose(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  
  if (results.poseLandmarks) {
    const landmarks = results.poseLandmarks;
    
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    
    const leftValid = leftHip && leftKnee && (leftHip.visibility || 0) > 0.5 && (leftKnee.visibility || 0) > 0.5;
    const rightValid = rightHip && rightKnee && (rightHip.visibility || 0) > 0.5 && (rightKnee.visibility || 0) > 0.5;
    const useLeft = leftValid && (!rightValid || (leftHip.visibility || 0) > (rightHip.visibility || 0));
    
    const hip = useLeft ? leftHip : rightHip;
    const knee = useLeft ? leftKnee : rightKnee;

    if (hip && knee && ((useLeft && leftValid) || (!useLeft && rightValid))) {
      // Draw line connecting hip to knee
      ctx.beginPath();
      ctx.moveTo(hip.x * canvas.width, hip.y * canvas.height);
      ctx.lineTo(knee.x * canvas.width, knee.y * canvas.height);
      ctx.strokeStyle = '#00FF00';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Hip - Gold with white outline
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 12, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Knee - Blue with white outline
      ctx.fillStyle = '#00BFFF';
      ctx.beginPath();
      ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 10, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  
  ctx.restore();
}

function onResults(results) {
  if (isProcessing) return;
  isProcessing = true;

  drawPose(results);
  
  if (results.poseLandmarks?.length) {
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
      minTrackingConfidence: 0.7
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
    feedbackEl.textContent = "✅ Stand sideways and squat!";
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