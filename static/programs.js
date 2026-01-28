// Programs Page JavaScript

// State
let programs = [];
let currentProgram = null;
let currentDayId = null;
let currentExerciseId = null;

// DOM Elements
const programsGrid = document.getElementById('programsGrid');
const noPrograms = document.getElementById('noPrograms');
const programsList = document.getElementById('programsList');
const programDetail = document.getElementById('programDetail');
const programTitle = document.getElementById('programTitle');
const programDescriptionEl = document.getElementById('programDescription');
const programDays = document.getElementById('programDays');
const headerSubtext = document.getElementById('headerSubtext');

// Modals
const createProgramModal = document.getElementById('createProgramModal');
const addDayModal = document.getElementById('addDayModal');
const addExerciseModal = document.getElementById('addExerciseModal');
const logSetModal = document.getElementById('logSetModal');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Check URL params for direct program view
  const urlParams = new URLSearchParams(window.location.search);
  const programId = urlParams.get('id');

  loadPrograms().then(() => {
    if (programId) {
      loadProgramDetail(parseInt(programId));
    }
  });

  setupEventListeners();

  // Update header text based on user type
  if (IS_COACH) {
    headerSubtext.textContent = 'Create and manage training programs for your athletes';
  }

  // Hide video URL field for non-coaches
  if (!IS_COACH) {
    document.getElementById('videoUrlGroup').style.display = 'none';
  }
});

function setupEventListeners() {
  // Create program modal
  document.getElementById('createProgramBtn').addEventListener('click', () => showModal(createProgramModal));
  document.getElementById('cancelCreateBtn').addEventListener('click', () => hideModal(createProgramModal));
  document.getElementById('confirmCreateBtn').addEventListener('click', createProgram);
  createProgramModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(createProgramModal));

  // Add day modal
  document.getElementById('addDayBtn').addEventListener('click', () => showModal(addDayModal));
  document.getElementById('cancelDayBtn').addEventListener('click', () => hideModal(addDayModal));
  document.getElementById('confirmDayBtn').addEventListener('click', addDay);
  addDayModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(addDayModal));

  // Add exercise modal
  document.getElementById('cancelExerciseBtn').addEventListener('click', () => hideModal(addExerciseModal));
  document.getElementById('confirmExerciseBtn').addEventListener('click', addExercise);
  addExerciseModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(addExerciseModal));

  // Log set modal
  document.getElementById('cancelLogBtn').addEventListener('click', () => hideModal(logSetModal));
  document.getElementById('confirmLogBtn').addEventListener('click', logSet);
  logSetModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(logSetModal));

  // Navigation
  document.getElementById('backToListBtn').addEventListener('click', showProgramsList);

  // Program actions
  document.getElementById('deleteProgramBtn').addEventListener('click', deleteCurrentProgram);

  // Program title editing
  programTitle.addEventListener('blur', updateProgramTitle);
  programTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      programTitle.blur();
    }
  });
}

// API Helpers
async function api(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response.json();
}

// Programs List
async function loadPrograms() {
  const data = await api('/api/programs');
  if (data.success) {
    programs = data.programs;
    renderPrograms();
  }
}

function renderPrograms() {
  if (programs.length === 0) {
    programsGrid.innerHTML = '';
    noPrograms.classList.remove('hidden');
    return;
  }

  noPrograms.classList.add('hidden');
  programsGrid.innerHTML = programs.map(program => `
    <div class="program-card" onclick="loadProgramDetail(${program.id})">
      <h3>${escapeHtml(program.name)}</h3>
      ${program.description ? `<p class="program-desc">${escapeHtml(program.description)}</p>` : ''}
      <div class="program-card-meta">
        <span class="program-status ${program.is_active ? 'active' : 'inactive'}">
          ${program.is_active ? 'Active' : 'Inactive'}
        </span>
        <span>${formatDate(program.created_at)}</span>
      </div>
    </div>
  `).join('');
}

// Program Detail
async function loadProgramDetail(programId) {
  const data = await api(`/api/programs/${programId}`);
  if (!data.success) {
    alert('Failed to load program');
    return;
  }

  currentProgram = data.program;
  programTitle.textContent = currentProgram.name;
  programDescriptionEl.textContent = currentProgram.description || '';

  renderProgramDays();

  programsList.classList.add('hidden');
  programDetail.classList.remove('hidden');

  // Update URL without reload
  history.pushState(null, '', `/programs?id=${programId}`);
}

function renderProgramDays() {
  if (!currentProgram.days || currentProgram.days.length === 0) {
    programDays.innerHTML = '<p class="empty-text">No training days yet. Add a day to get started.</p>';
    return;
  }

  programDays.innerHTML = currentProgram.days.map(day => `
    <div class="day-card" data-day-id="${day.id}">
      <div class="day-header">
        <h3>
          <span class="day-number">Day ${day.day_number}</span>
          ${day.name || ''}
        </h3>
        <div class="day-actions">
          <button class="btn-icon" onclick="editDay(${day.id})" title="Edit day">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon delete" onclick="deleteDay(${day.id})" title="Delete day">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="exercises-list">
        ${renderExercises(day.exercises, day.id)}
        <button class="add-exercise-btn" onclick="showAddExercise(${day.id})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Exercise
        </button>
      </div>
    </div>
  `).join('');
}

function renderExercises(exercises, dayId) {
  if (!exercises || exercises.length === 0) {
    return '<p class="empty-text">No exercises yet</p>';
  }

  return exercises.map((ex, idx) => `
    <div class="exercise-item" data-exercise-id="${ex.id}">
      <span class="exercise-order">${idx + 1}</span>
      <div class="exercise-info">
        <p class="exercise-name">
          ${ex.video_url ? `<a href="${escapeHtml(ex.video_url)}" target="_blank" rel="noopener">${escapeHtml(ex.name)}</a>` : escapeHtml(ex.name)}
          ${ex.video_url ? '<svg class="video-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>' : ''}
          ${ex.exercise_type === 'squat_velocity' ? '<span class="exercise-type-badge">VBT</span>' : ''}
        </p>
        <p class="exercise-prescription">
          ${ex.sets_prescribed} sets x ${ex.reps_prescribed} reps
          ${ex.weight_prescribed ? ` @ ${escapeHtml(ex.weight_prescribed)}` : ''}
        </p>
      </div>
      <div class="exercise-actions">
        ${!IS_COACH ? (ex.exercise_type === 'squat_velocity' ?
          `<button class="track-velocity-btn" onclick="trackVelocity(${ex.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            Track
          </button>` :
          `<button class="log-set-btn" onclick="showLogSet(${ex.id}, '${escapeHtml(ex.name)}')">Log Set</button>`
        ) : ''}
        <button class="btn-icon" onclick="editExercise(${ex.id})" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon delete" onclick="deleteExercise(${ex.id})" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function showProgramsList() {
  programDetail.classList.add('hidden');
  programsList.classList.remove('hidden');
  currentProgram = null;
  history.pushState(null, '', '/programs');
}

// CRUD Operations
async function createProgram() {
  const name = document.getElementById('newProgramName').value.trim();
  if (!name) {
    alert('Please enter a program name');
    return;
  }

  const data = await api('/api/programs', {
    method: 'POST',
    body: JSON.stringify({
      name: name,
      description: document.getElementById('newProgramDescription').value.trim()
    })
  });

  if (data.success) {
    hideModal(createProgramModal);
    document.getElementById('newProgramName').value = '';
    document.getElementById('newProgramDescription').value = '';
    programs.push(data.program);
    renderPrograms();
    loadProgramDetail(data.program.id);
  }
}

async function updateProgramTitle() {
  if (!currentProgram) return;
  const newName = programTitle.textContent.trim();
  if (!newName || newName === currentProgram.name) return;

  await api(`/api/programs/${currentProgram.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: newName })
  });

  currentProgram.name = newName;
}

async function deleteCurrentProgram() {
  if (!currentProgram) return;
  if (!confirm('Are you sure you want to delete this program? This cannot be undone.')) return;

  const data = await api(`/api/programs/${currentProgram.id}`, {
    method: 'DELETE'
  });

  if (data.success) {
    programs = programs.filter(p => p.id !== currentProgram.id);
    showProgramsList();
    renderPrograms();
  }
}

async function addDay() {
  if (!currentProgram) return;
  const name = document.getElementById('newDayName').value.trim();

  const data = await api(`/api/programs/${currentProgram.id}/days`, {
    method: 'POST',
    body: JSON.stringify({ name: name || null })
  });

  if (data.success) {
    hideModal(addDayModal);
    document.getElementById('newDayName').value = '';
    // Reload program to get updated days
    loadProgramDetail(currentProgram.id);
  }
}

async function deleteDay(dayId) {
  if (!confirm('Delete this training day and all its exercises?')) return;

  const data = await api(`/api/programs/${currentProgram.id}/days/${dayId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    loadProgramDetail(currentProgram.id);
  }
}

function showAddExercise(dayId) {
  currentDayId = dayId;
  document.getElementById('exerciseName').value = '';
  document.getElementById('exerciseSets').value = '3';
  document.getElementById('exerciseReps').value = '8-10';
  document.getElementById('exerciseWeight').value = '';
  document.getElementById('exerciseVideo').value = '';
  document.getElementById('exerciseType').value = 'standard';
  document.getElementById('exerciseNotes').value = '';
  showModal(addExerciseModal);
}

async function addExercise() {
  if (!currentDayId) return;

  const name = document.getElementById('exerciseName').value.trim();
  if (!name) {
    alert('Please enter an exercise name');
    return;
  }

  const exerciseData = {
    name: name,
    sets_prescribed: parseInt(document.getElementById('exerciseSets').value) || 3,
    reps_prescribed: document.getElementById('exerciseReps').value || '8-10',
    weight_prescribed: document.getElementById('exerciseWeight').value.trim() || null,
    exercise_type: document.getElementById('exerciseType').value,
    notes: document.getElementById('exerciseNotes').value.trim() || null
  };

  // Only include video URL for coaches
  if (IS_COACH) {
    const videoUrl = document.getElementById('exerciseVideo').value.trim();
    if (videoUrl) {
      exerciseData.video_url = videoUrl;
    }
  }

  const data = await api(`/api/program-days/${currentDayId}/exercises`, {
    method: 'POST',
    body: JSON.stringify(exerciseData)
  });

  if (data.success) {
    hideModal(addExerciseModal);
    currentDayId = null;
    loadProgramDetail(currentProgram.id);
  }
}

async function deleteExercise(exerciseId) {
  if (!confirm('Delete this exercise?')) return;

  const data = await api(`/api/exercises/${exerciseId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    loadProgramDetail(currentProgram.id);
  }
}

// Set Logging
function showLogSet(exerciseId, exerciseName) {
  currentExerciseId = exerciseId;
  document.getElementById('logSetTitle').textContent = `Log Set - ${exerciseName}`;
  document.getElementById('logReps').value = '';
  document.getElementById('logWeight').value = '';
  document.getElementById('logRpe').value = '';
  document.getElementById('logNotes').value = '';
  showModal(logSetModal);
}

async function logSet() {
  if (!currentExerciseId) return;

  const reps = parseInt(document.getElementById('logReps').value);
  const weight = parseFloat(document.getElementById('logWeight').value);

  if (!reps && !weight) {
    alert('Please enter at least reps or weight');
    return;
  }

  const logData = {
    reps_completed: reps || null,
    weight: weight || null,
    weight_unit: document.getElementById('logWeightUnit').value,
    rpe: parseFloat(document.getElementById('logRpe').value) || null,
    notes: document.getElementById('logNotes').value.trim() || null
  };

  const data = await api(`/api/exercises/${currentExerciseId}/log`, {
    method: 'POST',
    body: JSON.stringify(logData)
  });

  if (data.success) {
    hideModal(logSetModal);
    currentExerciseId = null;
    // Show success feedback
    alert('Set logged successfully!');
  }
}

// Velocity Tracking
function trackVelocity(exerciseId) {
  // Store exercise ID in session storage and redirect to tracker
  sessionStorage.setItem('trackingExerciseId', exerciseId);
  sessionStorage.setItem('trackingProgramId', currentProgram.id);
  window.location.href = '/tracker?program_exercise=' + exerciseId;
}

// Utilities
function showModal(modal) {
  modal.classList.remove('hidden');
}

function hideModal(modal) {
  modal.classList.add('hidden');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// Expose to global scope
window.loadProgramDetail = loadProgramDetail;
window.editDay = function(dayId) {
  // For simplicity, just allow inline editing
  alert('Day editing coming soon');
};
window.deleteDay = deleteDay;
window.showAddExercise = showAddExercise;
window.editExercise = function(exerciseId) {
  alert('Exercise editing coming soon');
};
window.deleteExercise = deleteExercise;
window.showLogSet = showLogSet;
window.trackVelocity = trackVelocity;
