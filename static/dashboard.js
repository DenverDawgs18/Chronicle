// Dashboard JavaScript - Smooth UX for workout tracking

// State
let currentWorkout = null;
let workouts = [];
let currentPage = 1;
let totalPages = 1;
let workoutToDelete = null;
let selectedMetrics = [];
let availableMetrics = [];
let liftStats = {};

// DOM Elements
const totalWorkoutsEl = document.getElementById('totalWorkouts');
const totalSetsEl = document.getElementById('totalSets');
const totalRepsEl = document.getElementById('totalReps');
const avgVelocityEl = document.getElementById('avgVelocity');

const noActiveWorkoutEl = document.getElementById('noActiveWorkout');
const currentWorkoutContentEl = document.getElementById('currentWorkoutContent');
const workoutNameEl = document.getElementById('workoutName');
const workoutDateEl = document.getElementById('workoutDate');
const currentSetsEl = document.getElementById('currentSets');
const summaryRepsEl = document.getElementById('summaryReps');
const summarySetsEl = document.getElementById('summarySets');

const workoutHistoryEl = document.getElementById('workoutHistory');
const loadMoreContainerEl = document.getElementById('loadMoreContainer');
const loadMoreBtn = document.getElementById('loadMoreBtn');

const deleteModal = document.getElementById('deleteModal');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

const newWorkoutBtn = document.getElementById('newWorkoutBtn');
const startWorkoutBtn = document.getElementById('startWorkoutBtn');
const finishWorkoutBtn = document.getElementById('finishWorkoutBtn');

// Lift stats elements
const liftStatsGrid = document.getElementById('liftStatsGrid');
const customizeMetricsBtn = document.getElementById('customizeMetricsBtn');
const metricsModal = document.getElementById('metricsModal');
const metricsOptions = document.getElementById('metricsOptions');
const cancelMetricsBtn = document.getElementById('cancelMetricsBtn');
const saveMetricsBtn = document.getElementById('saveMetricsBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    loadStats(),
    loadCurrentWorkout(),
    loadWorkoutHistory(),
    loadLiftStats()
  ]);

  setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
  // New workout buttons
  newWorkoutBtn.addEventListener('click', createNewWorkout);
  startWorkoutBtn.addEventListener('click', createNewWorkout);
  finishWorkoutBtn.addEventListener('click', finishCurrentWorkout);

  // Workout name editing
  workoutNameEl.addEventListener('blur', updateWorkoutName);
  workoutNameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      workoutNameEl.blur();
    }
  });

  // Load more history
  loadMoreBtn.addEventListener('click', () => {
    currentPage++;
    loadWorkoutHistory(true);
  });

  // Delete modal
  cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  confirmDeleteBtn.addEventListener('click', confirmDelete);
  deleteModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteModal);

  // Metrics customization
  if (customizeMetricsBtn) {
    customizeMetricsBtn.addEventListener('click', showMetricsModal);
  }
  if (cancelMetricsBtn) {
    cancelMetricsBtn.addEventListener('click', () => metricsModal.classList.add('hidden'));
  }
  if (saveMetricsBtn) {
    saveMetricsBtn.addEventListener('click', saveMetrics);
  }
  if (metricsModal) {
    metricsModal.querySelector('.modal-backdrop').addEventListener('click', () => metricsModal.classList.add('hidden'));
  }
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

// Stats
async function loadStats() {
  const data = await api('/api/stats');
  if (data.success) {
    const { stats } = data;
    animateValue(totalWorkoutsEl, stats.total_workouts);
    animateValue(totalSetsEl, stats.total_sets);
    animateValue(totalRepsEl, stats.total_reps);
    animateValue(avgVelocityEl, stats.avg_velocity || '-');
  }
}

function animateValue(element, value) {
  if (value === '-' || value === null) {
    element.textContent = '-';
    return;
  }

  const duration = 500;
  const start = parseInt(element.textContent) || 0;
  const end = parseInt(value);
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * easeOut);
    element.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Current Workout
async function loadCurrentWorkout() {
  const data = await api('/api/workouts/current');
  if (data.success && data.workout) {
    currentWorkout = data.workout;
    showCurrentWorkout();
  } else {
    showNoActiveWorkout();
  }
}

function showNoActiveWorkout() {
  noActiveWorkoutEl.classList.remove('hidden');
  currentWorkoutContentEl.classList.add('hidden');
}

function showCurrentWorkout() {
  noActiveWorkoutEl.classList.add('hidden');
  currentWorkoutContentEl.classList.remove('hidden');

  workoutNameEl.textContent = currentWorkout.name;
  workoutDateEl.textContent = formatDate(currentWorkout.created_at);

  renderCurrentSets();
  updateWorkoutSummary();
}

function renderCurrentSets() {
  if (!currentWorkout.sets || currentWorkout.sets.length === 0) {
    currentSetsEl.innerHTML = '<p class="empty-state">No sets recorded yet. Open the tracker to add sets.</p>';
    return;
  }

  const hingeExercises = ['deadlift', 'rdl', 'single-leg-rdl'];
  const isHinge = hingeExercises.includes(currentWorkout.exercise_type);
  const depthLabel = isHinge ? 'ROM' : 'Avg Depth';

  currentSetsEl.innerHTML = currentWorkout.sets.map(set => `
    <div class="set-card-wrapper" data-set-id="${set.id}">
      <div class="set-card" onclick="toggleSetReps(${set.id})">
        <div class="set-number">${set.set_number}</div>
        <div class="set-metrics">
          <div class="set-metric">
            <span class="metric-value">${set.reps_completed}</span>
            <span class="metric-label">Reps</span>
          </div>
          ${set.avg_depth ? `
            <div class="set-metric">
              <span class="metric-value">${set.avg_depth}"</span>
              <span class="metric-label">${depthLabel}</span>
            </div>
          ` : ''}
          ${set.avg_velocity ? `
            <div class="set-metric">
              <span class="metric-value">${set.avg_velocity}</span>
              <span class="metric-label">Avg Speed</span>
            </div>
          ` : ''}
          ${set.fatigue_drop ? `
            <div class="set-metric">
              <span class="metric-value ${set.fatigue_drop > 20 ? 'text-warning' : ''}">${set.fatigue_drop}%</span>
              <span class="metric-label">Fatigue</span>
            </div>
          ` : ''}
        </div>
        <div class="set-actions" onclick="event.stopPropagation()">
          <button class="btn-icon delete" onclick="deleteSet(${currentWorkout.id}, ${set.id})" title="Delete set">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      ${set.reps && set.reps.length > 0 ? `
        <div class="set-reps-detail">
          ${set.reps.map(rep => `
            <div class="rep-row">
              <span class="rep-number">Rep ${rep.rep_number}</span>
              <div class="rep-metrics">
                ${rep.depth ? `<span class="rep-metric">${rep.depth}"</span>` : ''}
                ${rep.velocity ? `<span class="rep-metric">Speed: ${rep.velocity}</span>` : ''}
                ${rep.time_seconds ? `<span class="rep-metric">${rep.time_seconds}s</span>` : ''}
                ${rep.quality ? `<span class="rep-quality rep-quality-${rep.quality}">${rep.quality}</span>` : ''}
              </div>
              <button class="btn-icon delete btn-delete-rep" onclick="event.stopPropagation(); deleteRep(${set.id}, ${rep.id})" title="Delete rep">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

function updateWorkoutSummary() {
  const totalReps = currentWorkout.sets?.reduce((sum, s) => sum + s.reps_completed, 0) || 0;
  const totalSets = currentWorkout.sets?.length || 0;

  summaryRepsEl.textContent = `${totalReps} rep${totalReps !== 1 ? 's' : ''}`;
  summarySetsEl.textContent = `${totalSets} set${totalSets !== 1 ? 's' : ''}`;
}

async function createNewWorkout() {
  // If there's already an active workout, finish it first
  if (currentWorkout) {
    await finishCurrentWorkout();
  }

  const data = await api('/api/workouts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Workout Session' })
  });

  if (data.success) {
    currentWorkout = data.workout;
    showCurrentWorkout();
    loadStats();
  }
}

async function finishCurrentWorkout() {
  if (!currentWorkout) return;

  const data = await api(`/api/workouts/${currentWorkout.id}`, {
    method: 'PUT',
    body: JSON.stringify({ complete: true })
  });

  if (data.success) {
    currentWorkout = null;
    showNoActiveWorkout();
    currentPage = 1;
    await loadWorkoutHistory();
    loadStats();
  }
}

async function updateWorkoutName() {
  if (!currentWorkout) return;

  const newName = workoutNameEl.textContent.trim();
  if (!newName || newName === currentWorkout.name) return;

  const data = await api(`/api/workouts/${currentWorkout.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: newName })
  });

  if (data.success) {
    currentWorkout.name = newName;
  }
}

async function deleteSet(workoutId, setId) {
  const data = await api(`/api/workouts/${workoutId}/sets/${setId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    // Reload current workout to get updated data
    await loadCurrentWorkout();
    loadStats();
  }
}

// Workout History
async function loadWorkoutHistory(append = false) {
  const data = await api(`/api/workouts?page=${currentPage}&per_page=10`);

  if (data.success) {
    totalPages = data.pages;

    if (!append) {
      workouts = data.workouts;
    } else {
      workouts = [...workouts, ...data.workouts];
    }

    renderWorkoutHistory(append);

    // Show/hide load more button
    if (currentPage < totalPages) {
      loadMoreContainerEl.classList.remove('hidden');
    } else {
      loadMoreContainerEl.classList.add('hidden');
    }
  }
}

function renderWorkoutHistory(append = false) {
  // Filter out the current active workout from history
  const historyWorkouts = workouts.filter(w =>
    !currentWorkout || w.id !== currentWorkout.id
  );

  if (historyWorkouts.length === 0 && !append) {
    workoutHistoryEl.innerHTML = '<div class="empty-state"><p>No completed workouts yet.</p></div>';
    return;
  }

  const html = historyWorkouts.map(workout => {
    const hingeTypes = ['deadlift', 'rdl', 'single-leg-rdl'];
    const dLabel = hingeTypes.includes(workout.exercise_type) ? 'ROM' : 'Depth';
    return `
    <div class="history-card glass-card" data-workout-id="${workout.id}" onclick="toggleWorkoutDetails(${workout.id})">
      <div class="history-header">
        <div class="history-info">
          <h3>${escapeHtml(workout.name)}</h3>
          <span class="history-date">${formatDate(workout.created_at)}</span>
        </div>
        <div class="history-stats">
          <div class="history-stat">
            <span class="history-stat-value">${workout.total_reps}</span>
            <span class="history-stat-label">Reps</span>
          </div>
          <div class="history-stat">
            <span class="history-stat-value">${workout.set_count}</span>
            <span class="history-stat-label">Sets</span>
          </div>
        </div>
      </div>
      <div class="history-sets-preview">
        ${workout.sets.slice(0, 5).map(set => `
          <span class="set-preview">${set.reps_completed}x${set.avg_depth ? ` @ ${set.avg_depth}"` : ''}</span>
        `).join('')}
        ${workout.sets.length > 5 ? `<span class="set-preview">+${workout.sets.length - 5} more</span>` : ''}
      </div>
      <div class="history-actions">
        <button class="btn-icon delete" onclick="event.stopPropagation(); showDeleteModal(${workout.id})" title="Delete workout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
      <div class="history-details">
        <div class="history-sets">
          ${workout.sets.map(set => `
            <div class="set-card">
              <div class="set-number">${set.set_number}</div>
              <div class="set-metrics">
                <div class="set-metric">
                  <span class="metric-value">${set.reps_completed}</span>
                  <span class="metric-label">Reps</span>
                </div>
                ${set.avg_depth ? `
                  <div class="set-metric">
                    <span class="metric-value">${set.avg_depth}"</span>
                    <span class="metric-label">${dLabel}</span>
                  </div>
                ` : ''}
                ${set.avg_velocity ? `
                  <div class="set-metric">
                    <span class="metric-value">${set.avg_velocity}</span>
                    <span class="metric-label">Speed</span>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `}).join('');

  if (append) {
    workoutHistoryEl.insertAdjacentHTML('beforeend', html);
  } else {
    workoutHistoryEl.innerHTML = html;
  }
}

function toggleWorkoutDetails(workoutId) {
  const card = document.querySelector(`.history-card[data-workout-id="${workoutId}"]`);
  if (card) {
    card.classList.toggle('expanded');
  }
}

// Delete Modal
function showDeleteModal(workoutId) {
  workoutToDelete = workoutId;
  deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
  workoutToDelete = null;
  deleteModal.classList.add('hidden');
}

async function confirmDelete() {
  if (!workoutToDelete) return;

  const data = await api(`/api/workouts/${workoutToDelete}`, {
    method: 'DELETE'
  });

  if (data.success) {
    // Remove from local state
    workouts = workouts.filter(w => w.id !== workoutToDelete);
    renderWorkoutHistory();
    loadStats();
  }

  closeDeleteModal();
}

// Utilities
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'long' }) + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== Lift Stats & Metrics Customization ==========

async function loadLiftStats() {
  // First load user's selected metrics
  const metricsData = await api('/api/dashboard/metrics');
  if (metricsData.success) {
    selectedMetrics = metricsData.selected_metrics || [];
    availableMetrics = metricsData.available_metrics || [];
  }

  // If no metrics selected, use defaults
  if (selectedMetrics.length === 0) {
    selectedMetrics = ['squat', 'bench', 'deadlift'];
  }

  // Load lift stats
  const statsData = await api('/api/dashboard/lift-stats');
  if (statsData.success) {
    liftStats = statsData.stats;
  }

  renderLiftStats();
}

function renderLiftStats() {
  if (!liftStatsGrid) return;

  // If no stats and no metrics, show empty state
  if (Object.keys(liftStats).length === 0 && selectedMetrics.length <= 3) {
    liftStatsGrid.innerHTML = selectedMetrics.map(metric => `
      <div class="lift-stat-card">
        <div class="lift-stat-name">${metric}</div>
        <div class="lift-stat-value lift-stat-empty">-</div>
        <div class="lift-stat-meta">No data yet</div>
      </div>
    `).join('');
    return;
  }

  // Render stats for selected metrics
  liftStatsGrid.innerHTML = selectedMetrics.map(metric => {
    const stat = liftStats[metric.toLowerCase()];
    if (stat) {
      let valueDisplay = '-';
      let unitDisplay = '';
      let metaDisplay = '';

      if (stat.max_weight) {
        valueDisplay = stat.max_weight;
        unitDisplay = ' lbs';
        metaDisplay = `Max | ${stat.total_sets} sets logged`;
      } else if (stat.avg_velocity) {
        valueDisplay = stat.avg_velocity;
        metaDisplay = `Avg Speed | ${stat.total_sets} sets`;
      } else if (stat.total_sets > 0) {
        valueDisplay = stat.total_sets;
        metaDisplay = 'Total sets';
      }

      return `
        <div class="lift-stat-card">
          <div class="lift-stat-name">${stat.name || metric}</div>
          <div class="lift-stat-value">${valueDisplay}<span class="lift-stat-unit">${unitDisplay}</span></div>
          <div class="lift-stat-meta">${metaDisplay}</div>
        </div>
      `;
    } else {
      return `
        <div class="lift-stat-card">
          <div class="lift-stat-name">${metric}</div>
          <div class="lift-stat-value lift-stat-empty">-</div>
          <div class="lift-stat-meta">No data yet</div>
        </div>
      `;
    }
  }).join('');
}

function showMetricsModal() {
  if (!metricsModal || !metricsOptions) return;

  // Combine available metrics with selected ones
  const allMetrics = new Set([...availableMetrics, ...selectedMetrics]);

  metricsOptions.innerHTML = Array.from(allMetrics).sort().map(metric => `
    <div class="metric-option ${selectedMetrics.includes(metric) ? 'selected' : ''}" data-metric="${metric}">
      <div class="metric-checkbox"></div>
      <span class="metric-name">${metric}</span>
    </div>
  `).join('');

  // Add click handlers
  metricsOptions.querySelectorAll('.metric-option').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('selected');
    });
  });

  metricsModal.classList.remove('hidden');
}

async function saveMetrics() {
  const selected = Array.from(metricsOptions.querySelectorAll('.metric-option.selected'))
    .map(el => el.dataset.metric);

  if (selected.length < 3) {
    alert('Please select at least 3 metrics');
    return;
  }
  if (selected.length > 6) {
    alert('Please select no more than 6 metrics');
    return;
  }

  const data = await api('/api/dashboard/metrics', {
    method: 'PUT',
    body: JSON.stringify({ metrics: selected })
  });

  if (data.success) {
    selectedMetrics = data.metrics;
    renderLiftStats();
    metricsModal.classList.add('hidden');
  }
}

function toggleSetReps(setId) {
  const wrapper = document.querySelector(`.set-card-wrapper[data-set-id="${setId}"]`);
  if (wrapper) {
    wrapper.classList.toggle('expanded');
  }
}

async function deleteRep(setId, repId) {
  const data = await api(`/api/sets/${setId}/reps/${repId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    await loadCurrentWorkout();
    loadStats();
  }
}

// Expose functions to global scope for onclick handlers
window.toggleWorkoutDetails = toggleWorkoutDetails;
window.showDeleteModal = showDeleteModal;
window.deleteSet = deleteSet;
window.toggleSetReps = toggleSetReps;
window.deleteRep = deleteRep;

// Listen for set additions from the tracker (via localStorage or BroadcastChannel)
const channel = new BroadcastChannel('chronicle-workout');
channel.onmessage = async (event) => {
  if (event.data.type === 'SET_ADDED' || event.data.type === 'WORKOUT_UPDATED') {
    await loadCurrentWorkout();
    loadStats();
  }
};
