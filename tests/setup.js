// Mock DOM elements required by squat.js
document.body.innerHTML = `
  <video id="video"></video>
  <canvas id="canvas"></canvas>
  <div id="counter">Reps: 0</div>
  <div id="feedback"></div>
  <div id="msg"></div>
  <div id="status"></div>
  <button id="resetBtn"></button>
  <input type="range" id="heightSlider" value="70" />
`;

// Mock canvas context
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  save: jest.fn(),
  restore: jest.fn(),
  clearRect: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  fillRect: jest.fn(),
  fillText: jest.fn(),
  beginPath: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  setLineDash: jest.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: ''
}));

// Mock MediaPipe Pose class
global.Pose = jest.fn().mockImplementation(() => ({
  setOptions: jest.fn(),
  onResults: jest.fn(),
  send: jest.fn().mockResolvedValue(undefined)
}));

// Mock Camera class
global.Camera = jest.fn().mockImplementation(() => ({
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn()
}));

// Mock navigator.mediaDevices
Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }]
    })
  }
});

// Mock performance.now
global.performance = {
  now: jest.fn(() => Date.now())
};

// Mock fetch for height slider
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ success: true })
});
