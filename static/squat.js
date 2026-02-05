// ========== Chronicle VBT Tracker - Main Orchestrator ==========
// This file handles MediaPipe, camera, canvas drawing, workout tracking,
// and delegates exercise detection to the modular exercise system.
// Exercise logic is in static/exercises/*.js

const DEBUG_MODE = true;

// ========== DOM ELEMENTS ==========
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const feedbackEl = document.getElementById('feedback');
const msgEl = document.getElementById('msg');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');

// ========== CORE STATE ==========
let pose = null;
let camera = null;
let mediaStream = null;
let isProcessing = false;

// Exercise state managed by Chronicle
let currentExercise = 'squat';
let exerciseModule = null;
let trackingState = null;

// UI references passed to exercise modules
const ui = {
  feedback: feedbackEl,
  status: statusEl,
  counter: counterEl,
  msg: msgEl,
  onRepComplete: null, // Set below after function definitions
};

// ========== INITIALIZATION ==========

function initExerciseState() {
  trackingState = Chronicle.createState();
  trackingState.getUserHeight = getUserHeightInches;
  exerciseModule = Chronicle.registry.get(currentExercise);
  if (!exerciseModule) {
    console.error('Unknown exercise:', currentExercise);
    exerciseModule = Chronicle.registry.get('squat');
    currentExercise = 'squat';
  }
}

function getUserHeightInches() {
  return parseInt(document.getElementById('heightSlider').value);
}

// ========== HEIGHT SLIDER ==========
document.getElementById('heightSlider').addEventListener('change', (e) => {
  const heightInches = parseInt(e.target.value);
  fetch('/set_height', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ height: heightInches }),
  });
});

// ========== RESET BUTTON ==========
resetBtn.addEventListener('click', () => {
  const keepCalibration = trackingState.isCalibrated && trackingState.hipKneeDistance && trackingState.standingHipY;

  trackingState.repCount = 0;
  trackingState.state = 'standing';
  trackingState.deepestHipY = null;
  trackingState.prevHipY = null;
  trackingState.stableFrameCount = 0;
  trackingState.ascentStartTime = null;
  trackingState.stateStartTime = null;
  trackingState.repTimes = [];
  trackingState.repDepths = [];
  trackingState.velocityHistory = [];
  trackingState.stableStandingStartTime = null;
  trackingState.rebaselineStabilityCount = 0;
  trackingState.potentialNewBaseline = null;
  trackingState.trackingLossFrames = 0;
  trackingState.lastSquatStartTime = null;
  trackingState.calibrationCompletedTime = null;
  trackingState.smoothedVelocity = 0;

  // Reset exercise-specific state
  if (exerciseModule && exerciseModule.reset) {
    exerciseModule.reset(trackingState);
  }

  // Reset single-leg tracking
  trackingState.workingSide = null;
  trackingState.sideReps = { left: 0, right: 0 };
  trackingState.sideChangeDetected = false;
  trackingState.lastSideChangeTime = null;

  if (!keepCalibration) {
    trackingState.standingHipY = null;
    trackingState.standingHipX = null;
    trackingState.hipKneeDistance = null;
    trackingState.inchesPerUnit = null;
    trackingState.isCalibrated = false;
    trackingState.calibrationHipYValues = [];
    trackingState.lockedSide = null;
    trackingState.smoothedHipY = null;
    trackingState.smoothedHipX = null;
    trackingState.positionHistory = [];
    trackingState.typicalMovementMagnitude = 0.01;

    // Hinge state
    trackingState.standingTorsoAngle = null;
    trackingState.dlSmoothedAngle = null;
    trackingState.dlAngleVelocity = 0;
    trackingState.prevTorsoAngle = null;

    // Row elbow fallback state
    trackingState.rowTrackingPoint = null;
    trackingState.rowCalibPoint = null;
    trackingState.rowWristElbowOffset = null;

    feedbackEl.textContent = 'Counter reset! Stand sideways and stay still';
  } else {
    feedbackEl.textContent = `Counter reset! Calibration kept - ready to ${exerciseModule.name.toLowerCase()}`;
  }

  counterEl.textContent = 'Reps: 0';
  msgEl.innerHTML = '';
  Chronicle.utils.updateState('standing', trackingState, statusEl);
});

// ========== SPEED SCORE & QUALITY (kept for backward compat) ==========
function calculateSpeedScore(timeSeconds, depthInches, referenceDepth) {
  return Chronicle.utils.calculateSpeedScore(timeSeconds, depthInches, referenceDepth);
}

// ========== POSE DRAWING ==========
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
  const C = Chronicle.CONSTANTS;

  const isUpperBody = exerciseModule && exerciseModule.needsWrist;
  const isHybridRow = exerciseModule && exerciseModule.needsWrist && exerciseModule.needsHip;

  if (DEBUG_MODE) {
    const landmarksToShow = isHybridRow ? [
      { idx: 11, name: 'L_Shoulder', color: '#FF00FF' },
      { idx: 12, name: 'R_Shoulder', color: '#FF00FF' },
      { idx: 13, name: 'L_Elbow', color: '#FFD700' },
      { idx: 14, name: 'R_Elbow', color: '#FFD700' },
      { idx: 15, name: 'L_Wrist', color: '#00BFFF' },
      { idx: 16, name: 'R_Wrist', color: '#00BFFF' },
      { idx: 23, name: 'L_Hip', color: '#FF6B6B' },
      { idx: 24, name: 'R_Hip', color: '#FF6B6B' },
    ] : isUpperBody ? [
      { idx: 11, name: 'L_Shoulder', color: '#FF00FF' },
      { idx: 12, name: 'R_Shoulder', color: '#FF00FF' },
      { idx: 13, name: 'L_Elbow', color: '#FFD700' },
      { idx: 14, name: 'R_Elbow', color: '#FFD700' },
      { idx: 15, name: 'L_Wrist', color: '#00BFFF' },
      { idx: 16, name: 'R_Wrist', color: '#00BFFF' },
    ] : [
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

    const connections = isHybridRow
      ? [[11, 13], [12, 14], [13, 15], [14, 16], [11, 23], [12, 24]]
      : isUpperBody
      ? [[11, 13], [12, 14], [13, 15], [14, 16]]
      : [[23, 25], [24, 26], [25, 27], [26, 28]];
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

  // Draw active side tracking
  const side = trackingState.currentSide;
  const active = Chronicle.utils.getActiveLandmarks(landmarks, side);

  if (isUpperBody) {
    // Upper body drawing: shoulder-elbow-wrist
    const useLeft = (side === 'left');
    const shoulderUB = useLeft ? landmarks[11] : landmarks[12];
    const elbowUB = useLeft ? landmarks[13] : landmarks[14];
    const wristUB = useLeft ? landmarks[15] : landmarks[16];

    const shoulderValid = shoulderUB && (shoulderUB.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const elbowValid = elbowUB && (elbowUB.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const wristValid = wristUB && (wristUB.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;

    // For hybrid row (barbell row), allow drawing with just shoulder+elbow (wrist may be behind plates)
    const minDrawValid = isHybridRow
      ? (shoulderValid && elbowValid)
      : (shoulderValid && elbowValid && wristValid);

    if (minDrawValid) {
      const stateColor = trackingState.state === 'descending' ? '#FFA500'
        : trackingState.state === 'ascending' ? '#00FF00' : '#00BFFF';

      // Shoulder-elbow connection
      ctx.beginPath();
      ctx.moveTo(shoulderUB.x * canvas.width, shoulderUB.y * canvas.height);
      ctx.lineTo(elbowUB.x * canvas.width, elbowUB.y * canvas.height);
      ctx.strokeStyle = stateColor;
      ctx.lineWidth = 6;
      ctx.stroke();

      // Elbow-wrist connection (only if wrist visible)
      if (wristValid) {
        ctx.beginPath();
        ctx.moveTo(elbowUB.x * canvas.width, elbowUB.y * canvas.height);
        ctx.lineTo(wristUB.x * canvas.width, wristUB.y * canvas.height);
        ctx.strokeStyle = stateColor;
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      // Shoulder dot
      ctx.fillStyle = '#FF00FF';
      ctx.beginPath();
      ctx.arc(shoulderUB.x * canvas.width, shoulderUB.y * canvas.height, 12, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Elbow dot (larger when it's the active tracking point)
      const elbowRadius = (isHybridRow && !wristValid) ? 16 : 14;
      ctx.fillStyle = (isHybridRow && !wristValid) ? '#00BFFF' : '#FFD700';
      ctx.beginPath();
      ctx.arc(elbowUB.x * canvas.width, elbowUB.y * canvas.height, elbowRadius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Wrist dot (only if visible)
      if (wristValid) {
        ctx.fillStyle = '#00BFFF';
        ctx.beginPath();
        ctx.arc(wristUB.x * canvas.width, wristUB.y * canvas.height, 12, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Hybrid row: also draw shoulder-hip torso line and hip dot
      if (isHybridRow) {
        const hipUB = active.hip;
        const hipValid = hipUB && (hipUB.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
        if (hipValid) {
          // Shoulder-hip connection (torso line)
          ctx.beginPath();
          ctx.moveTo(shoulderUB.x * canvas.width, shoulderUB.y * canvas.height);
          ctx.lineTo(hipUB.x * canvas.width, hipUB.y * canvas.height);
          ctx.strokeStyle = stateColor === '#00BFFF' ? '#a78bfa' : stateColor;
          ctx.lineWidth = 6;
          ctx.stroke();

          // Hip dot
          ctx.fillStyle = '#FF6B6B';
          ctx.beginPath();
          ctx.arc(hipUB.x * canvas.width, hipUB.y * canvas.height, 12, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // Baseline and depth markers
      if (trackingState.standingHipY && trackingState.isCalibrated && trackingState.inchesPerUnit) {
        const baselinePos = trackingState.standingHipY * canvas.height;
        const invert = exerciseModule && exerciseModule.invertDepthMarkers;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, baselinePos);
        ctx.lineTo(canvas.width, baselinePos);
        ctx.stroke();
        ctx.setLineDash([]);

        if (exerciseModule && exerciseModule.depthMarkers) {
          exerciseModule.depthMarkers.forEach(({ inches, color }) => {
            const depthNorm = Chronicle.utils.inchesToNorm(inches, trackingState);
            const depthY = invert
              ? baselinePos - (depthNorm * canvas.height)   // Row: markers go upward
              : baselinePos + (depthNorm * canvas.height);  // Bench/OHP: markers go downward

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
    }
  } else {
    // Lower body drawing: hip-knee (+ shoulder for hinge)
    const hip = active.hip;
    const knee = active.knee;
    const shoulder = active.shoulder;

    const hipValid = hip && (hip.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;
    const kneeValid = knee && (knee.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD;

    if (hipValid && kneeValid) {
      // Hip-knee connection
      ctx.beginPath();
      ctx.moveTo(hip.x * canvas.width, hip.y * canvas.height);
      ctx.lineTo(knee.x * canvas.width, knee.y * canvas.height);

      if (trackingState.state === 'descending') ctx.strokeStyle = '#FFA500';
      else if (trackingState.state === 'ascending') ctx.strokeStyle = '#00FF00';
      else ctx.strokeStyle = '#00BFFF';

      ctx.lineWidth = 6;
      ctx.stroke();

      // Shoulder-hip line for hinge exercises
      if (exerciseModule && exerciseModule.needsShoulder && shoulder && (shoulder.visibility || 0) > C.LANDMARK_VISIBILITY_THRESHOLD) {
        ctx.beginPath();
        ctx.moveTo(shoulder.x * canvas.width, shoulder.y * canvas.height);
        ctx.lineTo(hip.x * canvas.width, hip.y * canvas.height);

        if (trackingState.state === 'descending') ctx.strokeStyle = '#FFA500';
        else if (trackingState.state === 'ascending') ctx.strokeStyle = '#00FF00';
        else ctx.strokeStyle = '#a78bfa';

        ctx.lineWidth = 6;
        ctx.stroke();

        // Shoulder dot
        ctx.fillStyle = '#FF00FF';
        ctx.beginPath();
        ctx.arc(shoulder.x * canvas.width, shoulder.y * canvas.height, 12, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Hip dot
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 14, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Knee dot
      ctx.fillStyle = '#00BFFF';
      ctx.beginPath();
      ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 12, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Standing baseline and depth markers
      if (trackingState.standingHipY && trackingState.isCalibrated && trackingState.inchesPerUnit) {
        const standingPos = trackingState.standingHipY * canvas.height;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, standingPos);
        ctx.lineTo(canvas.width, standingPos);
        ctx.stroke();
        ctx.setLineDash([]);

        // Depth markers (for squat-category exercises)
        if (exerciseModule && exerciseModule.depthMarkers) {
          exerciseModule.depthMarkers.forEach(({ inches, color }) => {
            const depthNorm = Chronicle.utils.inchesToNorm(inches, trackingState);
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
    }
  }

  // Debug overlay
  if (DEBUG_MODE && trackingState.debugInfo) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(-canvas.width, 0, 380, 380);

    ctx.fillStyle = '#00FF00';
    ctx.font = '11px monospace';
    let y = 15;

    const displaySide = trackingState.lockedSide === 'left' ? 'right' : 'left';
    ctx.fillText(`Exercise: ${exerciseModule ? exerciseModule.name : currentExercise}`, -canvas.width + 10, y);
    y += 15;
    ctx.fillText(`Tracking: ${displaySide} side (camera view)`, -canvas.width + 10, y);
    y += 15;

    if (exerciseModule && exerciseModule.isSingleLeg && trackingState.workingSide) {
      ctx.fillText(`Working leg: ${trackingState.workingSide} | L:${trackingState.sideReps.left} R:${trackingState.sideReps.right}`, -canvas.width + 10, y);
      y += 15;
    }

    if (trackingState.isCalibrated) {
      const hipKneeInches = Chronicle.utils.normToInches(trackingState.hipKneeDistance, trackingState);
      ctx.fillText(`Hip-Knee: ${hipKneeInches.toFixed(1)}"`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`Inches/Unit: ${trackingState.inchesPerUnit.toFixed(2)}`, -canvas.width + 10, y);
      y += 15;
      ctx.fillText(`State: ${trackingState.state}`, -canvas.width + 10, y);
      y += 15;

      if (trackingState.calibrationCompletedTime && trackingState.lastSquatStartTime === null) {
        const timeSinceCalibration = performance.now() - trackingState.calibrationCompletedTime;
        const secondsRemaining = Math.ceil((Chronicle.CONSTANTS.RECALIBRATION_TIMEOUT_MS - timeSinceCalibration) / 1000);
        ctx.fillText(`Recalib in: ${secondsRemaining}s`, -canvas.width + 10, y);
        y += 15;
      }

      // Bench press debug info
      if (trackingState.debugInfo.elbowAngle) {
        y += 5;
        ctx.fillStyle = '#FF00FF';
        ctx.fillText(`--- ${exerciseModule.name} ---`, -canvas.width + 10, y);
        y += 15;
        ctx.fillStyle = '#00FF00';
        ctx.fillText(`Elbow angle: ${trackingState.debugInfo.elbowAngle}deg`, -canvas.width + 10, y);
        y += 15;
        ctx.fillText(`Wrist depth: ${trackingState.debugInfo.wristDepthInches}"`, -canvas.width + 10, y);
        y += 15;
      }

      // Row exercise debug info
      if (trackingState.debugInfo.pullInches) {
        y += 5;
        ctx.fillStyle = '#FF00FF';
        ctx.fillText(`--- ${exerciseModule.name} ---`, -canvas.width + 10, y);
        y += 15;
        ctx.fillStyle = '#00FF00';
        ctx.fillText(`Pull height: ${trackingState.debugInfo.pullInches}"`, -canvas.width + 10, y);
        y += 15;
        if (trackingState.debugInfo.rowTrackPt) {
          ctx.fillStyle = trackingState.debugInfo.rowTrackPt === 'elbow' ? '#FFD700' : '#00FF00';
          ctx.fillText(`Track point: ${trackingState.debugInfo.rowTrackPt}`, -canvas.width + 10, y);
          y += 15;
          ctx.fillStyle = '#00FF00';
        }
        ctx.fillText(`Torso: ${trackingState.debugInfo.torsoAngle}deg`, -canvas.width + 10, y);
        y += 15;
        ctx.fillText(`Torso change: ${trackingState.debugInfo.torsoChange}deg`, -canvas.width + 10, y);
        y += 15;
        ctx.fillStyle = trackingState.debugInfo.cheating === 'YES' ? '#FF4444' : '#00FF00';
        ctx.fillText(`Cheating: ${trackingState.debugInfo.cheating}`, -canvas.width + 10, y);
        y += 15;
        ctx.fillStyle = '#00FF00';
      }

      // Hinge exercise debug info
      if (trackingState.debugInfo.angleFromStanding) {
        y += 5;
        ctx.fillStyle = '#FF00FF';
        ctx.fillText(`--- ${exerciseModule.name} ---`, -canvas.width + 10, y);
        y += 15;
        ctx.fillStyle = '#00FF00';
        ctx.fillText(`Torso: ${trackingState.debugInfo.torsoAngle}deg (standing: ${trackingState.debugInfo.standingTorsoAngle}deg)`, -canvas.width + 10, y);
        y += 15;
        ctx.fillText(`Angle from standing: ${trackingState.debugInfo.angleFromStanding}deg`, -canvas.width + 10, y);
        y += 15;
        ctx.fillText(`Angle velocity: ${trackingState.debugInfo.angleVelocity}`, -canvas.width + 10, y);
        y += 15;
        if (trackingState.debugInfo.stance) {
          ctx.fillText(`Stance: ${trackingState.debugInfo.stance}`, -canvas.width + 10, y);
          y += 15;
        }
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

// ========== POSE RESULTS CALLBACK ==========
function onResults(results) {
  if (isProcessing) return;
  isProcessing = true;

  drawPose(results);

  if (results.poseLandmarks && results.poseLandmarks.length && exerciseModule) {
    exerciseModule.detect(results.poseLandmarks, trackingState, ui);
  }

  isProcessing = false;
}

// ========== MEDIAPIPE & CAMERA ==========
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
    feedbackEl.textContent = "Set your height, then stand sideways and stay still";
    return true;
  } catch (err) {
    console.error("Camera error:", err);
    feedbackEl.textContent = "Camera access denied";
    return false;
  }
}

async function initialize() {
  try {
    const poseInitialized = await initializePose();
    if (poseInitialized) {
      await initializeCamera();
    } else {
      feedbackEl.textContent = "Pose detection failed";
    }
  } catch (err) {
    console.error("Initialization error:", err);
    feedbackEl.textContent = "Setup failed";
  }
}

// ========== WORKOUT TRACKING ==========
let currentWorkoutId = null;
let currentSetReps = [];

// Program tracking
let programExerciseId = null;
let programProgramId = null;

const saveSetBtn = document.getElementById('saveSetBtn');
const setCounterEl = document.getElementById('setCounter');
const programIndicator = document.getElementById('programExerciseIndicator');
const workoutChannel = new BroadcastChannel('chronicle-workout');

// Rep recording callback for exercise modules
ui.onRepComplete = function(timeSeconds, depthInches, velocity, quality) {
  recordRep(timeSeconds, depthInches, velocity, quality);
};

function checkProgramTracking() {
  const urlParams = new URLSearchParams(window.location.search);
  const exerciseId = urlParams.get('program_exercise');

  if (exerciseId) {
    programExerciseId = parseInt(exerciseId);
    const storedProgramId = sessionStorage.getItem('trackingProgramId');
    if (storedProgramId) {
      programProgramId = parseInt(storedProgramId);
    }

    if (programIndicator) {
      programIndicator.textContent = 'Program Tracking';
      programIndicator.classList.remove('hidden');
    }

    if (saveSetBtn) {
      saveSetBtn.textContent = 'Save to Program';
    }
  }
}

async function initWorkout() {
  try {
    const response = await fetch('/api/workouts/current');
    const data = await response.json();

    if (data.success && data.workout) {
      currentWorkoutId = data.workout.id;
      updateSetCounter(data.workout.sets?.length || 0);
    } else {
      const createResponse = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: exerciseModule ? exerciseModule.sessionName : 'Workout Session',
          exercise_type: currentExercise
        })
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

function recordRep(timeSeconds, depthInches, velocity, quality) {
  currentSetReps.push({
    time_seconds: timeSeconds,
    depth: depthInches,
    velocity: velocity,
    quality: quality
  });

  if (saveSetBtn) {
    saveSetBtn.classList.toggle('has-reps', currentSetReps.length > 0);
    saveSetBtn.textContent = `Save Set (${currentSetReps.length} reps)`;
  }
}

async function saveSet() {
  if (!currentWorkoutId || currentSetReps.length === 0) return;

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
      workoutChannel.postMessage({ type: 'SET_ADDED', set: data.set });

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
          feedbackEl.textContent = `Set saved to program! ${currentSetReps.length} reps recorded`;
        } catch (progErr) {
          console.error('Failed to log to program:', progErr);
          feedbackEl.textContent = `Set saved! ${currentSetReps.length} reps (program log failed)`;
        }
      } else {
        feedbackEl.textContent = `Set saved! ${currentSetReps.length} reps recorded`;
      }

      const setNum = data.set.set_number;
      currentSetReps = [];
      trackingState.repCount = 0;
      trackingState.repTimes = [];
      trackingState.repDepths = [];
      counterEl.textContent = 'Reps: 0';

      if (saveSetBtn) {
        saveSetBtn.classList.remove('has-reps');
        saveSetBtn.textContent = programExerciseId ? 'Save to Program' : 'Save Set';
      }

      updateSetCounter(setNum);

      setTimeout(() => {
        feedbackEl.textContent = 'Ready for next set - stand still to calibrate';
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to save set:', err);
    feedbackEl.textContent = 'Failed to save set';
  }
}

if (saveSetBtn) {
  saveSetBtn.addEventListener('click', saveSet);
}

// ========== CAMERA HINT TOOLTIP ==========

const cameraHints = {
  'squat': 'Camera needs: Hip + Knee visible (side view)',
  'hack-squat': 'Camera needs: Hip + Knee visible (side view)',
  'bulgarian-squat': 'Camera needs: Hip + Knee visible (side view)',
  'split-squat': 'Camera needs: Hip + Knee visible (side view)',
  'general-squat': 'Camera needs: Hip + Knee visible (side view)',
  'general-lunge': 'Camera needs: Hip + Knee visible (side view)',
  'deadlift': 'Camera needs: Shoulder + Hip + Knee visible (side view)',
  'rdl': 'Camera needs: Shoulder + Hip + Knee visible (side view)',
  'single-leg-rdl': 'Camera needs: Shoulder + Hip + Knee visible (side view)',
  'general-hinge': 'Camera needs: Shoulder + Hip + Knee visible (side view)',
  'bench-press': 'Camera needs: Shoulder + Elbow + Wrist visible (side view)',
  'overhead-press': 'Camera needs: Shoulder + Elbow + Wrist visible (side view)',
  'barbell-row': 'Camera needs: Shoulder + Hip + Wrist or Elbow visible (side view)',
};

function updateCameraHint() {
  const hintTextEl = document.getElementById('cameraHintText');
  if (hintTextEl) {
    hintTextEl.textContent = cameraHints[currentExercise] || 'Camera needs: Full body visible (side view)';
  }
}

// ========== EXERCISE SWITCHING ==========

function setExercise(exercise) {
  if (exercise === currentExercise) return;

  const newModule = Chronicle.registry.get(exercise);
  if (!newModule) {
    console.error('Unknown exercise:', exercise);
    return;
  }

  currentExercise = exercise;
  exerciseModule = newModule;

  // Full state reset
  trackingState = Chronicle.createState();
  trackingState.getUserHeight = getUserHeightInches;

  currentSetReps = [];

  // Update UI
  counterEl.textContent = 'Reps: 0';
  msgEl.innerHTML = '';
  feedbackEl.textContent = `Switched to ${exerciseModule.name} - ${exerciseModule.needsWrist ? 'hold lockout position and stay still' : 'stand sideways and stay still'}`;
  Chronicle.utils.updateState('standing', trackingState, statusEl);

  // Update camera hint tooltip
  updateCameraHint();

  if (saveSetBtn) {
    saveSetBtn.classList.remove('has-reps');
    saveSetBtn.textContent = programExerciseId ? 'Save to Program' : 'Save Set';
  }

  // Update selector UI
  document.querySelectorAll('.exercise-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.exercise === exercise);
  });

  // Update page title
  document.title = `Chronicle - ${exerciseModule.name} Tracker`;

  // Switch workout
  switchWorkoutForExercise();
}

async function switchWorkoutForExercise() {
  if (currentWorkoutId) {
    try {
      await fetch(`/api/workouts/${currentWorkoutId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complete: true })
      });
      workoutChannel.postMessage({ type: 'WORKOUT_UPDATED' });
    } catch (err) {
      console.error('Failed to finish workout:', err);
    }
  }

  try {
    const createResponse = await fetch('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: exerciseModule.sessionName,
        exercise_type: currentExercise
      })
    });
    const createData = await createResponse.json();
    if (createData.success) {
      currentWorkoutId = createData.workout.id;
      updateSetCounter(0);
      workoutChannel.postMessage({ type: 'WORKOUT_UPDATED' });
    }
  } catch (err) {
    console.error('Failed to create workout:', err);
  }
}

// ========== BOOTSTRAP ==========

// Initialize exercise state
initExerciseState();

// Read exercise type from URL params
(function initExerciseFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const exercise = urlParams.get('exercise');
  if (exercise && Chronicle.registry.get(exercise)) {
    currentExercise = exercise;
    exerciseModule = Chronicle.registry.get(exercise);
    trackingState = Chronicle.createState();
    trackingState.getUserHeight = getUserHeightInches;
    document.title = `Chronicle - ${exerciseModule.name} Tracker`;

    // Update selector UI if button exists
    document.querySelectorAll('.exercise-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.exercise === exercise);
    });
  }
})();

// Start everything
initialize();
initWorkout();
checkProgramTracking();
updateCameraHint();
