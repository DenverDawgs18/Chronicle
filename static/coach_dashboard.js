// Coach Dashboard JavaScript

// State
let athletes = [];
let invites = [];
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

// Invite elements
const inviteAthleteBtn = document.getElementById('inviteAthleteBtn');
const inviteAthleteModal = document.getElementById('inviteAthleteModal');
const athleteEmail = document.getElementById('athleteEmail');
const inviteError = document.getElementById('inviteError');
const cancelInviteBtn = document.getElementById('cancelInviteBtn');
const confirmInviteBtn = document.getElementById('confirmInviteBtn');

const inviteLinkModal = document.getElementById('inviteLinkModal');
const inviteLinkInput = document.getElementById('inviteLinkInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const inviteEmailDisplay = document.getElementById('inviteEmailDisplay');
const closeInviteLinkBtn = document.getElementById('closeInviteLinkBtn');

const invitesSection = document.getElementById('invitesSection');
const invitesGrid = document.getElementById('invitesGrid');

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
  loadInvites();
  setupEventListeners();
});

function setupEventListeners() {
  // Invite athlete modal
  inviteAthleteBtn.addEventListener('click', () => showModal(inviteAthleteModal));
  cancelInviteBtn.addEventListener('click', () => hideModal(inviteAthleteModal));
  confirmInviteBtn.addEventListener('click', createInvite);
  inviteAthleteModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(inviteAthleteModal));

  // Invite link modal
  copyLinkBtn.addEventListener('click', copyInviteLink);
  closeInviteLinkBtn.addEventListener('click', () => hideModal(inviteLinkModal));
  inviteLinkModal.querySelector('.modal-backdrop').addEventListener('click', () => hideModal(inviteLinkModal));

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
    if (e.key === 'Enter') createInvite();
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

// ========== Athletes ==========

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
        <span class="status-badge status-joined">Joined</span>
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

// ========== Invitations ==========

async function loadInvites() {
  const data = await api('/api/coach/invites');
  if (data.success) {
    invites = data.invites.filter(i => i.status === 'pending');
    renderInvites();
  }
}

function renderInvites() {
  if (invites.length === 0) {
    invitesSection.classList.add('hidden');
    return;
  }

  invitesSection.classList.remove('hidden');
  invitesGrid.innerHTML = invites.map(invite => `
    <div class="invite-card">
      <div class="invite-card-header">
        <div class="invite-avatar">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <div class="invite-info">
          <h3>${escapeHtml(invite.email)}</h3>
          <span>Invited ${formatDate(invite.created_at)}</span>
        </div>
        <span class="status-badge status-pending">Pending</span>
      </div>
      <div class="invite-card-actions">
        <button class="btn-sm btn-secondary" onclick="copyInviteLinkById(${invite.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Link
        </button>
        <button class="btn-sm btn-danger-outline" onclick="deleteInvite(${invite.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Cancel
        </button>
      </div>
    </div>
  `).join('');
}

async function createInvite() {
  const email = athleteEmail.value.trim().toLowerCase();
  if (!email) {
    showError(inviteError, 'Please enter an email address');
    return;
  }

  confirmInviteBtn.disabled = true;
  confirmInviteBtn.textContent = 'Sending...';

  const data = await api('/api/coach/invite', {
    method: 'POST',
    body: JSON.stringify({ email })
  });

  confirmInviteBtn.disabled = false;
  confirmInviteBtn.textContent = 'Send Invite';

  if (data.success) {
    hideModal(inviteAthleteModal);
    athleteEmail.value = '';
    inviteError.classList.remove('show');

    // Show the invite link modal
    inviteLinkInput.value = data.invite_url;
    inviteEmailDisplay.textContent = email;
    showModal(inviteLinkModal);

    loadInvites();
  } else {
    showError(inviteError, data.error || 'Failed to create invite');
  }
}

function copyInviteLink() {
  inviteLinkInput.select();
  navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
    copyLinkBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      copyLinkBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      `;
    }, 2000);
  });
}

async function copyInviteLinkById(inviteId) {
  const invite = invites.find(i => i.id === inviteId);
  if (!invite) return;

  // We need to reconstruct the URL since we don't store it
  // Make a quick API call to get fresh invite data with URL
  const data = await api('/api/coach/invite', {
    method: 'POST',
    body: JSON.stringify({ email: invite.email })
  });

  if (data.success && data.invite_url) {
    navigator.clipboard.writeText(data.invite_url).then(() => {
      // Show feedback
      const btn = event.target.closest('button');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Copied!
      `;
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
    });
  }
}

async function deleteInvite(inviteId) {
  if (!confirm('Cancel this invite?')) return;

  const data = await api(`/api/coach/invites/${inviteId}`, {
    method: 'DELETE'
  });

  if (data.success) {
    loadInvites();
  }
}

// ========== Programs ==========

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

// ========== Utilities ==========

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
window.copyInviteLinkById = copyInviteLinkById;
window.deleteInvite = deleteInvite;
