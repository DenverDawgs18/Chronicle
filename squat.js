const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const counterEl = document.getElementById('counter');
    const feedbackEl = document.getElementById('feedback');
    const debugEl = document.getElementById('debug');
    const statusEl = document.getElementById('status');
    const resetBtn = document.getElementById('resetBtn');
    const toggleDebugBtn = document.getElementById('toggleDebugBtn');

    let repCount = 0;
    let state = 'standing';
    let maxHipY = null; // Track the lowest point (highest Y value)
    let baselineHipY = null; // Standing baseline
    let frameCount = 0;
    let pose = null;
    let camera = null;
    let isProcessing = false;
    let debugVisible = false;
    let stableFrameCount = 0;

    // Much more forgiving thresholds for better detection
    const DESCENT_THRESHOLD = 0.035;  // Very sensitive to hip drop
    const MIN_DEPTH = 0.002;          // Very forgiving minimum depth
    const GOOD_DEPTH = 0.15;         // Good squat depth
    const ASCENT_THRESHOLD = 0.035;   // How much hip must rise to complete squat
    const STABILITY_FRAMES = 3;       // Fewer frames needed for baseline

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
      
      // Use both shoulder and hip Z-depth to determine direction more reliably
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
      
      // Establish baseline when standing - much more responsive
      if (state === 'standing') {
        if (baselineHipY === null) {
          baselineHipY = hipY;
          stableFrameCount = 1;
        } else {
          const hipVariation = Math.abs(hipY - baselineHipY);
          if (hipVariation < 0.01) { // More forgiving stability check
            stableFrameCount++;
            baselineHipY = (baselineHipY * 0.9 + hipY * 0.1); // Smoother baseline update
          } else {
            stableFrameCount = Math.max(1, stableFrameCount - 1); // Don't reset completely
            baselineHipY = (baselineHipY * 0.95 + hipY * 0.05); // Still update slowly
          }
        }
      }

      // Track maximum hip Y (lowest point) during movement
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
Stable Frames: ${stableFrameCount}
Descent Thr: ${DESCENT_THRESHOLD}
Min Depth: ${MIN_DEPTH}`;
      }

      // Simplified state machine for squat detection
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

          // Voice feedback
          const utterance = new SpeechSynthesisUtterance(msg);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.volume = 0.9;
          speechSynthesis.speak(utterance);

          counterEl.textContent = `Reps: ${repCount}`;
          feedbackEl.textContent = msg;

          // Reset for next rep
          updateStatus('standing');
          maxHipY = null;
          baselineHipY = hipY; // Use current position as new baseline
          stableFrameCount = 1;

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
      
      if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        
        // Draw pose connections
        drawConnectors(ctx, landmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        
        // Draw all landmarks
        for (const lm of landmarks) {
          const x = lm.x * canvas.width;
          const y = lm.y * canvas.height;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2 * Math.PI);
          ctx.fillStyle = '#FF0000';
          ctx.fill();
        }

        // Highlight key joints for side view
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
      pose = new Pose({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        selfieMode: false, // Better for side view
        enableSegmentation: false,
        minDetectionConfidence: 0.8,
        minTrackingConfidence: 0.7
      });

      pose.onResults(onResults);
    }

    async function initialize() {
      try {
        await initializePose();

        camera = new Camera(video, {
          onFrame: async () => {
            if (pose && !isProcessing) {
              await pose.send({ image: video });
            }
          },
          width: 640,
          height: 480
        });

        camera.start();
        feedbackEl.textContent = "✅ Ready! Stand sideways and start squatting!";
      } catch (err) {
        console.error("Initialization error:", err);
        feedbackEl.textContent = "❌ Failed to start. Check camera permissions.";
      }
    }

    initialize();