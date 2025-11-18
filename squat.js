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
    const simulateBtn = document.getElementById('simulateBtn');
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
    let simulationInterval = null;
    let isSimulating = false;

    const DESCENT_THRESHOLD = 0.035;
    const MIN_DEPTH = 0.002;
    const GOOD_DEPTH = 0.08;
    const ASCENT_THRESHOLD = 0.035;
    const STABILITY_FRAMES = 3;

  textBtn.addEventListener('click', () => {
        if (!audioEnabled) {
          audioEnabled = true;
          textBtn.textContent = 'Turn Audio Off';
          
          // Prime speech synthesis on iOS with a silent utterance
          const primeUtterance = new SpeechSynthesisUtterance('');
          speechSynthesis.speak(primeUtterance);
          speechPrimed = true;
          
          feedbackEl.textContent = '🔊 Audio enabled! Start squatting!';
          
          // Clear the message after 2 seconds if in standing state
          setTimeout(() => {
            if (state === 'standing' && !isSimulating) {
              feedbackEl.textContent = 'Ready for next squat!';
            } else if (isSimulating) {
              feedbackEl.textContent = '🧪 Simulation running...';
            }
          }, 2000);
        } else { 
          audioEnabled = false;
          speechPrimed = false;
          textBtn.textContent = 'Turn Audio On';
          speechSynthesis.cancel(); // Stop any ongoing speech
          feedbackEl.textContent = '🔇 Audio disabled';
          
          setTimeout(() => {
            if (state === 'standing' && !isSimulating) {
              feedbackEl.textContent = 'Ready for next squat!';
            } else if (isSimulating) {
              feedbackEl.textContent = '🧪 Simulation running...';
            }
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
      msgEl.textContent = "";
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
      if (camera) {
        stopCamera();
      }
      
      isSimulating = true;
      simulateBtn.textContent = 'Stop Simulation';
      feedbackEl.textContent = '🧪 Simulation running - watch the counter!';
      
      repCount = 0;
      state = 'standing';
      maxHipY = null;
      baselineHipY = null;
      stableFrameCount = 0;
      counterEl.textContent = 'Reps: 0';
      updateStatus('standing');
      
      // Set canvas size for simulation
      canvas.width = 640;
      canvas.height = 480;
      
      simulateSquat();
    }

    function stopSimulation() {
      isSimulating = false;
      simulateBtn.textContent = 'Simulate Squat';
      
      if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      feedbackEl.textContent = 'Simulation stopped. Click to restart or allow camera for real tracking.';
      
      if (pose) {
        initializeCamera();
      }
    }

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
      const direction = detectFacingDirection(landmarks);
      if (!direction) return;

      const isFacingLeft = direction === 'left';
      const hip = isFacingLeft ? landmarks[23] : landmarks[24];
      const knee = isFacingLeft ? landmarks[25] : landmarks[26];
      const ankle = isFacingLeft ? landmarks[27] : landmarks[28];

      if (!hip || !knee || !ankle) return;

      const hipY = hip.y;
      const kneeY = knee.y;
      
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
          const depthMsg = depthGood ? "Excellent depth" : "Get deeper";
          const msg = `Rep ${repCount} ${depthMsg}!`;
          totalMsg = totalMsg + " " + msg;
          
        if (audioEnabled && speechPrimed) {
            const utterance = new SpeechSynthesisUtterance(msg);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 0.9;
            speechSynthesis.speak(utterance);  
          }
          msgEl.textContent = totalMsg;
          counterEl.textContent = `Reps: ${repCount}`;

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
      
      // Flip canvas horizontally to match video
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      
      if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        
        if (typeof drawConnectors !== 'undefined' && typeof POSE_CONNECTIONS !== 'undefined') {
          drawConnectors(ctx, landmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        }
        
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

        const direction = detectFacingDirection(landmarks);
        if (direction) {
          const isFacingLeft = direction === 'left';
          const hip = isFacingLeft ? landmarks[23] : landmarks[24];
          const knee = isFacingLeft ? landmarks[25] : landmarks[26];
          const ankle = isFacingLeft ? landmarks[27] : landmarks[28];

          if (hip && knee && ankle) {
            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(hip.x * canvas.width, hip.y * canvas.height, 10, 0, 2 * Math.PI);
            ctx.fill();

            ctx.fillStyle = '#00BFFF';
            ctx.beginPath();
            ctx.arc(knee.x * canvas.width, knee.y * canvas.height, 8, 0, 2 * Math.PI);
            ctx.fill();

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

        const cycleProgress = (t % 40) / 40;
        let hipOffset = 0;
        let kneeForward = 0;

        if (cycleProgress < 0.3) {
          const descentProgress = cycleProgress / 0.3;
          hipOffset = 0.12 * Math.sin(descentProgress * Math.PI * 0.5);
          kneeForward = 0.08 * Math.sin(descentProgress * Math.PI * 0.5);
        } else if (cycleProgress < 0.7) {
          hipOffset = 0.12;
          kneeForward = 0.08;
        } else {
          const ascentProgress = (cycleProgress - 0.7) / 0.3;
          hipOffset = 0.12 * Math.cos(ascentProgress * Math.PI * 0.5);
          kneeForward = 0.08 * Math.cos(ascentProgress * Math.PI * 0.5);
        }

        const baseHipY = 0.5;
        const fakeHipY = baseHipY + hipOffset;

        const fakeLandmarks = [];
        
        for (let i = 0; i < 33; i++) {
          fakeLandmarks[i] = null;
        }

        const frontZ = 0.05;
        const backZ = 0.15;
        const frontX = 0.45;
        const backX = 0.46;
        
        fakeLandmarks[11] = { x: frontX, y: 0.35, z: frontZ, visibility: 1 };
        fakeLandmarks[12] = { x: backX, y: 0.35, z: backZ, visibility: 1 };
        fakeLandmarks[23] = { x: frontX, y: fakeHipY, z: frontZ, visibility: 1 };
        fakeLandmarks[24] = { x: backX, y: fakeHipY, z: backZ, visibility: 1 };
        
        const kneeY = fakeHipY + 0.15 + hipOffset * 0.3;
        fakeLandmarks[25] = { x: frontX + kneeForward, y: kneeY, z: frontZ, visibility: 1 };
        fakeLandmarks[26] = { x: backX + kneeForward, y: kneeY, z: backZ, visibility: 1 };
        
        const ankleY = 0.85;
        fakeLandmarks[27] = { x: frontX + kneeForward * 0.3, y: ankleY, z: frontZ, visibility: 1 };
        fakeLandmarks[28] = { x: backX + kneeForward * 0.3, y: ankleY, z: backZ, visibility: 1 };

        fakeLandmarks[0] = { x: frontX + 0.005, y: 0.15, z: frontZ + 0.02, visibility: 1 };
        fakeLandmarks[15] = { x: frontX + 0.02, y: 0.18, z: frontZ, visibility: 1 };
        fakeLandmarks[16] = { x: frontX - 0.02, y: 0.18, z: frontZ, visibility: 1 };

        const fakeResults = { poseLandmarks: fakeLandmarks };

        frameCount++;
        drawPose(fakeResults);
        detectSquat(fakeLandmarks);

        t++;
        
        if (t > 200) {
          stopSimulation();
        }
      }, 100);
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
      if (isSimulating) return;
      
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
            if (pose && !isProcessing && !isSimulating) {
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

    initialize();