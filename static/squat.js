let testMode = false;  
let audioEnabled = false;
let speechPrimed = false;
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const feedbackEl = document.getElementById('feedback');
const msgEl = document.getElementById('msg');
const debugEl = document.getElementById('debug');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');
const toggleDebugBtn = document.getElementById('toggleDebugBtn');
const textBtn = document.getElementById('text');

let repCount = 0;
let state = 'standing';
let maxHipY = null;
let baselineHipY = null;
let frameCount = 0;
let pose = null;
let camera = null;
let mediaStream = null;
let isProcessing = false;
let debugVisible = false;
let stableFrameCount = 0;

// Fixed thresholds - realistic values for actual camera input
const DESCENT_THRESHOLD = 0.02;   
const MIN_DEPTH = 0.025;           // 2.5% - minimum hip-knee closure to count
const GOOD_DEPTH = 0.075;           // 5% - threshold for "good depth"
const ASCENT_THRESHOLD = 0.015;    // Must return most of the way up
const STABILITY_FRAMES = 5;        // Reasonable frame count for stability
const BASELINE_TOLERANCE = 0.01;   // 3% - accounts for breathing and minor movement

textBtn.addEventListener('click', () => {
  if (!audioEnabled) {
    audioEnabled = true;
    textBtn.textContent = 'Turn Audio Off';
    
    const primeUtterance = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(primeUtterance);
    speechPrimed = true;
    
    feedbackEl.textContent = 'Audio enabled! Start squatting!';
    
    setTimeout(() => {
      feedbackEl.textContent = 'Ready for next squat!';
    }, 2000);
  } else { 
    audioEnabled = false;
    speechPrimed = false;
    textBtn.textContent = 'Turn Audio On';
    speechSynthesis.cancel();
    feedbackEl.textContent = '🔇 Audio disabled';
    
    setTimeout(() => {
      feedbackEl.textContent = 'Ready for next squat!';
    }, 2000);
  }
});

resetBtn.addEventListener('click', () => {
  repCount = 0;
  state = 'standing';
  maxHipY = null;
  baselineHipY = null;
  stableFrameCount = 0;
  counterEl.textContent = 'Reps: 0';
  feedbackEl.textContent = 'Counter reset! Please stand sideways';
  totalMsg = "";
  msgEl.textContent = "";
  updateStatus('standing');
});

toggleDebugBtn.addEventListener('click', () => {
  debugVisible = !debugVisible;
  debugEl.style.display = debugVisible ? 'block' : 'none';
  toggleDebugBtn.textContent = debugVisible ? 'Hide Debug' : 'Show Debug';
});
function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
    });
    mediaStream = null;
  }
  
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

let totalMsg = '';
function detectSquat(landmarks) {
  // Use more robust hip detection - pick the most visible hip
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];
  
  // Choose the side with better visibility
  const useLeft = (leftHip?.visibility || 0) > (rightHip?.visibility || 0);
  const hip = useLeft ? leftHip : rightHip;
  const knee = useLeft ? leftKnee : rightKnee;
  const ankle = useLeft ? leftAnkle : rightAnkle;

  if (!hip || !knee || !ankle) return;

  const hipY = hip.y;
  const kneeY = knee.y;
  
  // Use hip-to-knee distance as the primary depth metric (more robust!)
  const hipKneeDistance = kneeY - hipY;  // When squatting, this decreases
  
  // Establish stable baseline when standing
  if (state === 'standing') {
    if (baselineHipY === null) {
      baselineHipY = hipKneeDistance;  // Store baseline hip-knee distance
      stableFrameCount = 1;
    } else {
      const distanceVariation = Math.abs(hipKneeDistance - baselineHipY);
      // Always update baseline with smoothing - much more forgiving
      baselineHipY = (baselineHipY * 0.9 + hipKneeDistance * 0.1);
      
      // If relatively still, increment stability counter
      if (distanceVariation < BASELINE_TOLERANCE) {
        stableFrameCount++;
      } else {
        // Only slightly decay if moving, don't reset completely
        stableFrameCount = Math.max(1, stableFrameCount - 1);
      }
    }
    // Reset maxHipY when standing so we can track the next squat
    maxHipY = null;
  }

  // Track the minimum hip-knee distance during descent/bottom
  // (minimum distance = maximum squat depth)
  if (state === 'descending' || state === 'ascending') {
    if (maxHipY === null) {
      maxHipY = baselineHipY;  // Start tracking from baseline distance
    }
    // Update to the minimum distance (deepest squat point)
    if (hipKneeDistance < maxHipY) {
      maxHipY = hipKneeDistance;
    }
  }

  // Calculate depth as the reduction in hip-knee distance from baseline
  const distanceChange = baselineHipY ? baselineHipY - hipKneeDistance : 0;
  const currentDepth = (maxHipY !== null && baselineHipY) ? baselineHipY - maxHipY : 0;

  if (debugVisible) {
    const direction = detectFacingDirection(landmarks);
    debugEl.textContent = `Frame: ${frameCount}
Side: ${useLeft ? 'LEFT' : 'RIGHT'} (vis: ${(hip.visibility * 100).toFixed(0)}%)
State: ${state}
Hip Y: ${hipY.toFixed(3)}
Knee Y: ${kneeY.toFixed(3)}
Hip-Knee Dist: ${hipKneeDistance.toFixed(3)}
Baseline Dist: ${baselineHipY ? baselineHipY.toFixed(3) : 'null'}
Min Dist (max depth): ${maxHipY ? maxHipY.toFixed(3) : 'null'}
Distance Change: ${distanceChange.toFixed(3)} (need ${DESCENT_THRESHOLD})
Current Depth: ${currentDepth.toFixed(3)} (min: ${MIN_DEPTH}, good: ${GOOD_DEPTH})
Stable Frames: ${stableFrameCount}/${STABILITY_FRAMES}`;
  }

  // Transition from standing to descending
  // Hip-knee distance decreases as you squat down
  if (state === 'standing' && baselineHipY && stableFrameCount >= STABILITY_FRAMES && distanceChange > DESCENT_THRESHOLD) {
    updateStatus('descending');
    maxHipY = baselineHipY;  // Initialize with baseline distance
    feedbackEl.textContent = "Going down...";
  } 
  // Transition from descending to ascending when minimum depth reached
  else if (state === 'descending' && currentDepth >= MIN_DEPTH) {
    updateStatus('ascending');
    const depthPercent = Math.round(currentDepth * 100);
  } 
  // Count rep when returning to standing position
  else if (state === 'ascending' && baselineHipY && maxHipY) {
    const distanceRecovered = hipKneeDistance - maxHipY;  // How much we've returned
    
    // Must recover most of the distance to count
    if (distanceRecovered >= (currentDepth * 0.7) && distanceChange < DESCENT_THRESHOLD) {
      repCount++;
      
      const depthGood = currentDepth >= GOOD_DEPTH;
      const depthPercent = Math.round(currentDepth * 100);
      const depthMsg = depthGood ? `Excellent depth!` : `Get deeper`;
      const msg = `Rep ${repCount}: ${depthMsg}!`;
      totalMsg = totalMsg + "\n" + msg;
      
      if (audioEnabled && speechPrimed) {
        const utterance = new SpeechSynthesisUtterance(depthGood ? `Rep ${repCount}. Excellent depth` : `Rep ${repCount}. Get deeper`);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.9;
        speechSynthesis.speak(utterance);  
      }
      
      msgEl.textContent = totalMsg;
      counterEl.textContent = `Reps: ${repCount}`;

      // Reset to standing
      updateStatus('standing');
      maxHipY = null;  // Clear maxHipY so it doesn't interfere
      baselineHipY = hipKneeDistance;  // Set new baseline
      stableFrameCount = 0;  // Reset stability counter

      setTimeout(() => {
        if (state === 'standing') {
          feedbackEl.textContent = "Ready for next squat!";
        }
      }, 2000);
    }
  }
}

function drawPose(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Flip canvas horizontally to mirror the video (makes it intuitive)
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  
  if (results.poseLandmarks) {
    const landmarks = results.poseLandmarks;
    
    // Draw connections
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

    // Highlight key points for squat tracking - use most visible side
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const useLeft = (leftHip?.visibility || 0) > (rightHip?.visibility || 0);
    
    const hip = useLeft ? leftHip : rightHip;
    const knee = useLeft ? landmarks[25] : landmarks[26];
    const ankle = useLeft ? landmarks[27] : landmarks[28];

    if (hip && knee && ankle) {
      // Hip - Gold
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 10, 0, 2 * Math.PI);
      ctx.fill();

      // Knee - Blue
      ctx.fillStyle = '#00BFFF';
      ctx.beginPath();
      ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 8, 0, 2 * Math.PI);
      ctx.fill();

      // Ankle - Green
      ctx.fillStyle = '#00FF00';
      ctx.beginPath();
      ctx.arc(ankle.x * canvas.width, ankle.y * canvas.height, 6, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  
  ctx.restore();
}

function onResults(results) {
  if (isProcessing) return;
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
      selfieMode: false,  // CRITICAL: Disabled to prevent coordinate flipping
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
    feedbackEl.textContent = "✅ Camera ready! Stand sideways and start squatting!";
    return true;
  } catch (err) {
    console.error("Camera error:", err);
    feedbackEl.textContent = "❌ Camera failed. Please give access";
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
    feedbackEl.textContent = "⚠️ Setup incomplete";
  }
}

async function checkIfPaid(email) {
  const response = await fetch(`/check-access?email=${encodeURIComponent(email)}`);
  const data = await response.json();
  console.log(data.paid)
  if (data.paid === true) {
    return true
  }
  else{
    return false;
  }
}

async function initializeApp() {
  const userEmail = prompt("Enter your email:");
  const isPaid = await checkIfPaid(userEmail);
  
  if (isPaid) {
    feedbackEl.textContent = "✅ Access verified! Start squatting!";
    initialize();
  } else {
    feedbackEl.innerHTML = '❌ No payment found. Please <a href="https://buy.stripe.com/test_5kQ28s82c0X5d1I6zNaAw00" target="_blank" style="color: #00BFFF; text-decoration: underline;">purchase access here</a>';
  }
}

initializeApp();


