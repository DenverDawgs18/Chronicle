// Coach Dashboard JavaScript

// State
let athletes = [];
let selectedAthlete = null;
let selectedAthleteId = null;

// DOM Elements
const athletesGrid = document.getElementById('athletesGrid');
const noAthletes = document.getElementById('noAthletes');
const athleteDetail = document.getElementById('athleteDetail');
const athleteName = document.getElementById('athleteName');
const athleteStats = document.getElementById('athleteStats');
const athletePrograms = document.getElementById('athletePrograms');
const athleteWorkouts = document.getElementById('athleteWorkouts');

const addAthleteBtn = document.getElementById('addAthleteBtn');
const addAthleteModal = document.getElementById('addAthleteModal');
const athleteEmail = document.getElementById('athleteEmail');
const addAthleteError = document.getElementById('addAthleteError');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const confirmAddBtn = document.getElementById('confirmAddBtn');

const createProgramModal = document.getElementById('createProgramModal');
const programName = document.getElementById('programName');
const programDescription = document.getElementById('programDescription');
const createProgramBtn = document.getElementById('createProgramBtn');
const cancelProgramBtn = document.getElementById('cancelProgramBtn');
const confirmProgramBtn = document.getElementById('confirmProgramBtn');

const closeDetailBtn = document.getElementById('closeDetailBtn');
const removeAthleteBtn = document.getElementById('removeAthleteBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadAthletes();
  setupEventListeners();
});

function setupEventListeners() {
  // Add athlete modal
  addAthleteBtn.addEventListener('click', () => showModal(addAthleteModal));
  cancelAddBtn.addEventListener('click', () => hideModal(addAthleteModal));
  confirmAddBtn.addEventListener('click', addAthlete);
  addAthleteModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(addAthleteModal));

  // Create program modal
  cancelProgramBtn.addEventListener('click', () => hideModal(createProgramModal));
  confirmProgramBtn.addEventListener('click', createProgram);
  createProgramModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(createProgramModal));
  createProgramBtn.addEventListener('click', () => showModal(createProgramModal));

  // Detail panel
  closeDetailBtn.addEventListener('click', closeAthleteDetail);
  removeAthleteBtn.addEventListener('click', removeAthlete);

  // Enter key in email input
  athleteEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addAthlete();
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

// Athletes
async function loadAthletes() {
  const data = await api('/api/coach/athletes');
  if (data.success) {
    athletes = data.athletes;
    renderAthletes();
  }
}

function renderAthletes() {
  if (athletes.length === 0) {
    athletesGrid.innerHTML = '';
    noAthletes.classList.remove('hidden');
    return;
  }

  noAthletes.classList.add('hidden');
  athletesGrid.innerHTML = athletes.map(athlete => `
    <div class="athlete-card" onclick="selectAthlete(${athlete.id})">
      <div class="athlete-card-header">
        <div class="athlete-avatar">${getInitials(athlete.name)}</div>
        <div class="athlete-info">
          <h3>${escapeHtml(athlete.name)}</h3>
          <span>${athlete.email}</span>
        </div>
      </div>
      <div class="athlete-card-stats">
        <div class="mini-stat">
          <div class="mini-stat-value">${athlete.total_workouts}</div>
          <div class="mini-stat-label">Workouts</div>
        </div>
        <div class="mini-stat">
          <div class="mini-stat-value">${athlete.total_sets}</div>
          <div class="mini-stat-label">Sets</div>
        </div>
        <div class="mini-stat">
          <div class="mini-stat-value">${athlete.avg_velocity || '-'}</div>
          <div class="mini-stat-label">Avg Speed</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function selectAthlete(athleteId) {
  const data = await api(`/api/coach/athletes/${athleteId}`);
  if (!data.success) return;

  selectedAthlete = data;
  selectedAthleteId = athleteId;

  athleteName.textContent = data.athlete.name;

  // Render stats
  athleteStats.innerHTML = `
    <div class="stat-box">
      <div class="stat-box-value">${data.workouts.length}</div>
      <div class="stat-box-label">Recent Workouts</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-value">${data.programs.length}</div>
      <div class="stat-box-label">Programs</div>
    </div>
  `;

  // Render programs
  if (data.programs.length === 0) {
    athletePrograms.innerHTML = '<p class="empty-text">No programs yet</p>';
  } else {
    athletePrograms.innerHTML = data.programs.map(p => `
      <a href="/programs?id=${p.id}" class="program-item">
        <h4>${escapeHtml(p.name)}</h4>
        <span>${p.is_active ? 'Active' : 'Inactive'}</span>
      </a>
    `).join('');
  }

  // Render workouts
  if (data.workouts.length === 0) {
    athleteWorkouts.innerHTML = '<p class="empty-text">No workouts yet</p>';
  } else {
    athleteWorkouts.innerHTML = data.workouts.map(w => `
      <div class="workout-item">
        <h4>${escapeHtml(w.name)}</h4>
        <span>${w.set_count} sets | ${w.total_reps} reps | ${formatDate(w.created_at)}</span>
      </div>
    `).join('');
  }

  athleteDetail.classList.remove('hidden');
}

function closeAthleteDetail() {
  athleteDetail.classList.add('hidden');
  selectedAthlete = null;
  selectedAthleteId = null;
}

async function addAthlete() {
  const email = athleteEmail.value.trim().toLowerCase();
  if (!email) {
    showError(addAthleteError, 'Please enter an email address');
    return;
  }

  const data = await api('/api/coach/add-athlete', {
    method: 'POST',
    body: JSON.stringify({ email })
  });

  if (data.success) {
    hideModal(addAthleteModal);
    athleteEmail.value = '';
    addAthleteError.classList.remove('show');
    loadAthletes();
  } else {
    showError(addAthleteError, data.error || 'Failed to add athlete');
  }
}

async function removeAthlete() {
  if (!selectedAthleteId) return;

  if (!confirm('Are you sure you want to remove this athlete?')) return;

  const data = await api(`/api/coach/remove-athlete/${selectedAthleteId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    closeAthleteDetail();
    loadAthletes();
  }
}

async function createProgram() {
  if (!selectedAthleteId) return;

  const name = programName.value.trim();
  if (!name) {
    alert('Please enter a program name');
    return;
  }

  const data = await api('/api/programs', {
    method: 'POST',
    body: JSON.stringify({
      athlete_id: selectedAthleteId,
      name: name,
      description: programDescription.value.trim()
    })
  });

  if (data.success) {
    hideModal(createProgramModal);
    programName.value = '';
    programDescription.value = '';
    // Refresh athlete detail
    selectAthlete(selectedAthleteId);
    // Navigate to program editor
    window.location.href = `/programs?id=${data.program.id}`;
  }
}

// Utilities
function showModal(modal) {
  modal.classList.remove('hidden');
}

function hideModal(modal) {
  modal.classList.add('hidden');
}

function showError(el, message) {
  el.textContent = message;
  el.classList.add('show');
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Expose to global scope
window.selectAthlete = selectAthlete;
