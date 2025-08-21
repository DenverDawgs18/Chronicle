let testMode = false;  
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const feedbackEl = document.getElementById('feedback');
const debugEl = document.getElementById('debug');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');
const toggleDebugBtn = document.getElementById('toggleDebugBtn');
const simulateBtn = document.getElementById('simulateBtn');

let repCount = 0;
let state = 'standing';
let maxHipY = null;
let baselineHipY = null;
let frameCount = 0;
let pose = null;
let camera = null;
let mediaStream = null; // Track the media stream separately
let isProcessing = false;
let debugVisible = false;
let stableFrameCount = 0;
let simulationInterval = null;
let isSimulating = false;

// Thresholds
const DESCENT_THRESHOLD = 0.035;
const MIN_DEPTH = 0.002;
const GOOD_DEPTH = 0.15;
const ASCENT_THRESHOLD = 0.035;
const STABILITY_FRAMES = 3;

resetBtn.addEventListener('click', () => {
  repCount = 0;
  state = 'standing';
  maxHipY = null;
  baselineHipY = null;
  stableFrameCount = 0;
  counterEl.textContent = 'Reps: 0';
  feedbackEl.textContent = 'Counter reset! Please stand sideways';
  updateStatus('standing');
});

toggleDebugBtn.addEventListener('click', () => {
  debugVisible = !debugVisible;
  debugEl.style.display = debugVisible ? 'block' : 'none';
  toggleDebugBtn.textContent = debugVisible ? 'Hide Debug' : 'Show Debug';
});

simulateBtn.addEventListener('click', () => {
  if (isSimulating) {
    stopSimulation();
  } else {
    startSimulation();
  }
});

function startSimulation() {
  // Stop camera if it's running
  if (camera) {
    stopCamera();
  }
  
  isSimulating = true;
  simulateBtn.textContent = 'Stop Simulation';
  feedbackEl.textContent = '🧪 Simulation running - watch the counter!';
  
  // Reset state for clean simulation
  repCount = 0;
  state = 'standing';
  maxHipY = null;
  baselineHipY = null;
  stableFrameCount = 0;
  counterEl.textContent = 'Reps: 0';
  updateStatus('standing');
  
  simulateSquat();
}

function stopSimulation() {
  isSimulating = false;
  simulateBtn.textContent = 'Simulate Squat';
  
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  feedbackEl.textContent = 'Simulation stopped. Click to restart or allow camera for real tracking.';
  
  // Restart camera if pose is available
  if (pose) {
    initializeCamera();
  }
}

function stopCamera() {
  // Stop the media stream tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
    });
    mediaStream = null;
  }
  
  // Clear the video source
  video.srcObject = null;
  camera = null;
}

function updateStatus(newState) {
  state = newState;
  statusEl.textContent = state.toUpperCase();
  statusEl.className = `status-indicator status-${state}`;
}

function detectFacingDirection(landmarks) {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
  
  const leftAvgZ = (leftShoulder.z + leftHip.z) / 2;
  const rightAvgZ = (rightShoulder.z + rightHip.z) / 2;
  
  return leftAvgZ < rightAvgZ ? 'left' : 'right';
}

function detectSquat(landmarks) {
  const direction = detectFacingDirection(landmarks);
  if (!direction) return;

  const isFacingLeft = direction === 'left';
  const hip = isFacingLeft ? landmarks[23] : landmarks[24];
  const knee = isFacingLeft ? landmarks[25] : landmarks[26];
  const ankle = isFacingLeft ? landmarks[27] : landmarks[28];

  if (!hip || !knee || !ankle) return;

  const hipY = hip.y;
  const kneeY = knee.y;
  
  // Establish baseline when standing
  if (state === 'standing') {
    if (baselineHipY === null) {
      baselineHipY = hipY;
      stableFrameCount = 1;
    } else {
      const hipVariation = Math.abs(hipY - baselineHipY);
      if (hipVariation < 0.01) {
        stableFrameCount++;
        baselineHipY = (baselineHipY * 0.9 + hipY * 0.1);
      } else {
        stableFrameCount = Math.max(1, stableFrameCount - 1);
        baselineHipY = (baselineHipY * 0.95 + hipY * 0.05);
      }
    }
  }

  // Track maximum hip Y during movement
  if (state === 'descending' || state === 'ascending') {
    if (maxHipY === null || hipY > maxHipY) {
      maxHipY = hipY;
    }
  }

  const hipDrop = baselineHipY ? hipY - baselineHipY : 0;
  const currentDepth = maxHipY ? maxHipY - baselineHipY : 0;

  if (debugVisible) {
    debugEl.textContent = `Frame: ${frameCount}
Facing: ${direction}
State: ${state}
Hip Y: ${hipY.toFixed(3)}
Knee Y: ${kneeY.toFixed(3)}
Baseline Hip: ${baselineHipY ? baselineHipY.toFixed(3) : 'null'}
Max Hip Y: ${maxHipY ? maxHipY.toFixed(3) : 'null'}
Hip Drop: ${hipDrop.toFixed(3)}
Current Depth: ${currentDepth.toFixed(3)}
Stable Frames: ${stableFrameCount}`;
  }

  // State machine for squat detection
  if (state === 'standing' && baselineHipY && hipDrop > DESCENT_THRESHOLD) {
    updateStatus('descending');
    maxHipY = hipY;
    feedbackEl.textContent = "Going down...";
  } 
  else if (state === 'descending' && currentDepth >= MIN_DEPTH) {
    updateStatus('ascending');
    feedbackEl.textContent = "Good depth! Now stand up!";
  } 
  else if (state === 'ascending' && baselineHipY && maxHipY) {
    const hipRise = maxHipY - hipY;
    
    if (hipRise >= ASCENT_THRESHOLD) {
      repCount++;
      
      const depthGood = currentDepth >= GOOD_DEPTH;
      const depthMsg = depthGood ? "Excellent depth" : "Good rep - try going deeper";
      const msg = `${depthMsg}! Rep ${repCount}`;

      // Voice feedback (only if not simulating to avoid spam)
      if (!isSimulating) {
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.9;
        speechSynthesis.speak(utterance);
      }

      counterEl.textContent = `Reps: ${repCount}`;
      feedbackEl.textContent = msg;

      // Reset for next rep
      updateStatus('standing');
      maxHipY = null;
      baselineHipY = hipY;
      stableFrameCount = 1;

      setTimeout(() => {
        if (state === 'standing') {
          feedbackEl.textContent = isSimulating ? "🧪 Simulation running..." : "Ready for next squat!";
        }
      }, 2000);
    }
  }
}

function drawPose(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (results.poseLandmarks) {
    const landmarks = results.poseLandmarks;
    
    // Draw pose connections if available
    if (typeof drawConnectors !== 'undefined' && typeof POSE_CONNECTIONS !== 'undefined') {
      drawConnectors(ctx, landmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    }
    
    // Draw all landmarks
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm) {
        const x = lm.x * canvas.width;
        const y = lm.y * canvas.height;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#FF0000';
        ctx.fill();
      }
    }

    // Highlight key joints
    const direction = detectFacingDirection(landmarks);
    if (direction) {
      const isFacingLeft = direction === 'left';
      const hip = isFacingLeft ? landmarks[23] : landmarks[24];
      const knee = isFacingLeft ? landmarks[25] : landmarks[26];
      const ankle = isFacingLeft ? landmarks[27] : landmarks[28];

      if (hip && knee && ankle) {
        // Draw hip as large gold circle
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 10, 0, 2 * Math.PI);
        ctx.fill();

        // Draw knee as large blue circle
        ctx.fillStyle = '#00BFFF';
        ctx.beginPath();
        ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 8, 0, 2 * Math.PI);
        ctx.fill();

        // Draw ankle as smaller green circle
        ctx.fillStyle = '#00FF00';
        ctx.beginPath();
        ctx.arc(ankle.x * canvas.width, ankle.y * canvas.height, 6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  
  ctx.restore();
}

function simulateSquat() {
  let t = 0;

  simulationInterval = setInterval(() => {
    if (!isSimulating) return;

    // Create a more realistic squat motion
    // Complete squat cycle every ~4 seconds (40 frames at 100ms intervals)
    const cycleProgress = (t % 40) / 40;
    let hipOffset = 0;

    if (cycleProgress < 0.3) {
      // Descent phase (0-30% of cycle)
      hipOffset = 0.12 * Math.sin((cycleProgress / 0.3) * Math.PI * 0.5);
    } else if (cycleProgress < 0.7) {
      // Bottom hold phase (30-70% of cycle)
      hipOffset = 0.12;
    } else {
      // Ascent phase (70-100% of cycle)
      const ascentProgress = (cycleProgress - 0.7) / 0.3;
      hipOffset = 0.12 * Math.cos(ascentProgress * Math.PI * 0.5);
    }

    const baseHipY = 0.5;
    const fakeHipY = baseHipY + hipOffset;

    // Create realistic landmark positions
    const fakeLandmarks = [];
    
    // Initialize all positions to avoid undefined
    for (let i = 0; i < 33; i++) {
      fakeLandmarks[i] = null;
    }

    // Only set the landmarks we need
    fakeLandmarks[11] = { x: 0.4, y: 0.35, z: 0, visibility: 1 }; // left shoulder
    fakeLandmarks[12] = { x: 0.6, y: 0.35, z: 0.2, visibility: 1 }; // right shoulder
    fakeLandmarks[23] = { x: 0.45, y: fakeHipY, z: 0, visibility: 1 }; // left hip
    fakeLandmarks[24] = { x: 0.55, y: fakeHipY, z: 0.2, visibility: 1 }; // right hip
    fakeLandmarks[25] = { x: 0.45, y: fakeHipY + 0.18 + hipOffset * 0.5, z: 0, visibility: 1 }; // left knee
    fakeLandmarks[26] = { x: 0.55, y: fakeHipY + 0.18 + hipOffset * 0.5, z: 0.2, visibility: 1 }; // right knee
    fakeLandmarks[27] = { x: 0.45, y: fakeHipY + 0.35, z: 0, visibility: 1 }; // left ankle
    fakeLandmarks[28] = { x: 0.55, y: fakeHipY + 0.35, z: 0.2, visibility: 1 }; // right ankle

    const fakeResults = { poseLandmarks: fakeLandmarks };

    frameCount++;
    drawPose(fakeResults);
    detectSquat(fakeLandmarks);

    t++;
    
    // Stop after a few squats for demo
    if (t > 200) { // About 20 seconds
      stopSimulation();
    }
  }, 100); // ~10 FPS
}

function onResults(results) {
  if (isProcessing || isSimulating) return;
  isProcessing = true;

  frameCount++;
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
  if (isSimulating) return; // Don't start camera during simulation
  
  try {
    // Get user media stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480,
        facingMode: 'user'
      }
    });
    
    // Set video source
    video.srcObject = mediaStream;
    
    // Create camera instance
    camera = new Camera(video, {
      onFrame: async () => {
        if (pose && !isProcessing && !isSimulating) {
          await pose.send({ image: video });
        }
      },
      width: 640,
      height: 480
    });

    await camera.start();
    feedbackEl.textContent = "✅ Camera ready! Stand sideways and start squatting!";
    return true;
  } catch (err) {
    console.error("Camera error:", err);
    feedbackEl.textContent = "❌ Camera failed. Use 'Simulate Squat' to test the app.";
    return false;
  }
}

async function initialize() {
  try {
    const poseInitialized = await initializePose();
    if (poseInitialized) {
      await initializeCamera();
    } else {
      feedbackEl.textContent = "⚠️ Pose detection failed. Use 'Simulate Squat' to test.";
    }
  } catch (err) {
    console.error("Initialization error:", err);
    feedbackEl.textContent = "⚠️ Setup incomplete. Use 'Simulate Squat' to test functionality.";
  }
}

// Initialize on load
initialize();