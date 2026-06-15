// app.js

// State variables
let currentUsername = localStorage.getItem('soccer_prediction_username') || '';
let currentUserSecret = localStorage.getItem('soccer_prediction_secret') || '';
let currentUserIsAdmin = localStorage.getItem('soccer_prediction_is_admin') === 'true';
let adminPasscode = sessionStorage.getItem('admin_passcode') || '';
let matches = [];
let currentFilter = 'open'; // 'open' or 'past'
let activeTab = 'predictions';
let countdownInterval = null;
let pollInterval = null;

// Pending vote confirmation state
let pendingVoteMatchId = null;
let pendingVotePrediction = null;

// Match Log (football-data.org fixtures)
let fixturesData = [];
let fixturesCurrentIndex = 0;

// Racing leaderboard chart state
let raceFrames = [];
let raceCurrentFrame = 0;
let racePlaying = false;
let raceIntervalHandle = null;
let raceMaxPoints = 1;
let raceRowsByName = new Map();
const RACE_FRAME_DURATION_MS = 700;

// DOM Elements
const usernameModal = document.getElementById('usernameModal');
const usernameInput = document.getElementById('usernameInput');
const currentUserNameDisplay = document.getElementById('currentUserNameDisplay');
const userStatusArea = document.getElementById('userStatusArea');
const changeUserBtn = document.getElementById('changeUserBtn');
const matchesGrid = document.getElementById('matchesGrid');
const leaderboardBody = document.getElementById('leaderboardBody');
const leaderboardTableView = document.getElementById('leaderboardTableView');
const leaderboardRaceView = document.getElementById('leaderboardRaceView');
const raceFrameLabel = document.getElementById('raceFrameLabel');
const raceBars = document.getElementById('raceBars');
const raceEmptyState = document.getElementById('raceEmptyState');
const racePlayPauseBtn = document.getElementById('racePlayPauseBtn');
const raceScrubber = document.getElementById('raceScrubber');
const raceDateLabel = document.getElementById('raceDateLabel');

const adminAuthCard = document.getElementById('adminAuthCard');
const adminWorkspace = document.getElementById('adminWorkspace');
const adminPasscodeInput = document.getElementById('adminPasscodeInput');
const adminAuthMessage = document.getElementById('adminAuthMessage');
const adminMatchesList = document.getElementById('adminMatchesList');
const addMatchMessage = document.getElementById('addMatchMessage');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  setupUser();
  startIntervals();
  
  // Switch/Change User button listener (logs out current session)
  changeUserBtn.addEventListener('click', () => {
    localStorage.removeItem('soccer_prediction_username');
    localStorage.removeItem('soccer_prediction_secret');
    localStorage.removeItem('soccer_prediction_is_admin');
    currentUsername = '';
    currentUserSecret = '';
    currentUserIsAdmin = false;
    updateAdminTabVisibility();
    usernameInput.value = '';
    usernameModal.style.display = 'flex';
    usernameInput.focus();
  });
});

// Setup User Identification
function setupUser() {
  if (!currentUserSecret) {
    usernameModal.style.display = 'flex';
  } else {
    usernameModal.style.display = 'none';
    currentUserNameDisplay.textContent = currentUsername;
    updateAdminTabVisibility();
    loadDashboardData();
  }
}

// Update Admin Tab visibility depending on user role
function updateAdminTabVisibility() {
  const adminTabBtn = document.getElementById('tabBtnAdmin');
  if (adminTabBtn) {
    if (currentUserIsAdmin) {
      adminTabBtn.style.display = 'inline-flex';
    } else {
      adminTabBtn.style.display = 'none';
      if (activeTab === 'admin') {
        switchTab('predictions');
      }
    }
  }
}

// Start polling and timer updates
function startIntervals() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateAllTimers, 1000);

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (currentUserSecret) {
      loadDashboardData();
    }
  }, 10000);
}

// Global Tab Switcher
function switchTab(tabName) {
  if (tabName !== 'leaderboard' && racePlaying) {
    pauseRacePlayback();
  }

  activeTab = tabName;
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tabBtn${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  const activeContent = document.getElementById(`tabContent${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (activeContent) activeContent.classList.add('active');

  if (tabName === 'predictions') {
    renderMatches();
  } else if (tabName === 'results') {
    renderResults();
  } else if (tabName === 'leaderboard') {
    loadLeaderboard();
  } else if (tabName === 'admin') {
    checkAdminState();
    initializeDefaultKickoff();
  }
}

// Filter matches (Open vs. Past)
function filterMatches(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  
  if (filter === 'open') {
    document.getElementById('filterOpenBtn').classList.add('active');
  } else {
    document.getElementById('filterPastBtn').classList.add('active');
  }
  
  renderMatches();
}

// Helper: Get team flags/emojis (FIFA vibe)
function getTeamFlag(teamName) {
  const flags = {
    'argentina': '🇦🇷', 'france': '🇫🇷', 'brazil': '🇧🇷', 'germany': '🇩🇪',
    'spain': '🇪🇸', 'italy': '🇮🇹', 'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'usa': '🇺🇸',
    'portugal': '🇵🇹', 'belgium': '🇧🇪', 'netherlands': '🇳🇱', 'uruguay': '🇺🇾',
    'mexico': '🇲🇽', 'canada': '🇨🇦', 'croatia': '🇭🇷', 'morocco': '🇲🇦',
    'japan': '🇯🇵', 'senegal': '🇸🇳', 'switzerland': '🇨🇭', 'denmark': '🇩🇰'
  };
  return flags[teamName.toLowerCase().trim()] || '⚽';
}

// Fetch matches (requires passcode header)
async function loadDashboardData() {
  if (!currentUserSecret) return;
  try {
    const response = await fetch('/api/matches', {
      headers: {
        'x-user-secret': currentUserSecret
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        // Passcode revoked or cleared on server
        localStorage.removeItem('soccer_prediction_secret');
        localStorage.removeItem('soccer_prediction_username');
        localStorage.removeItem('soccer_prediction_is_admin');
        currentUserSecret = '';
        currentUsername = '';
        currentUserIsAdmin = false;
        setupUser();
        return;
      }
      throw new Error('Failed to load matches');
    }
    matches = await response.json();
    
    if (activeTab === 'predictions') {
      renderMatches();
    } else if (activeTab === 'results') {
      renderResults();
    }
    
    if (activeTab === 'admin' && adminPasscode) {
      loadAdminMatches();
      loadAdminHistory();
      loadAdminVotes();
    }
  } catch (err) {
    console.error('Error getting match data:', err);
  }
}

// Fetch standings
async function loadLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    if (!response.ok) throw new Error('Failed to load leaderboard');
    const leaderboard = await response.json();
    
    leaderboardBody.innerHTML = '';
    
    if (leaderboard.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }
    
    leaderboard.forEach((player, index) => {
      const rank = index + 1;
      let rankClass = 'rank-other';
      if (rank === 1) rankClass = 'rank-1';
      else if (rank === 2) rankClass = 'rank-2';
      else if (rank === 3) rankClass = 'rank-3';

      const total = player.totalPredictions || 0;
      const correct = player.correct || 0;
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
      const pending = player.liveNotVoted || 0;
      const pendingCell = pending > 0
        ? `<span class="pending-badge">${pending}</span>`
        : `<span class="pending-none">0</span>`;

      const row = document.createElement('tr');
      row.className = rankClass;
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${player.points}<span class="unit-label"> pts</span></td>
      `;
      leaderboardBody.appendChild(row);
    });
  } catch (err) {
    console.error('Error getting leaderboard:', err);
    leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state error-text">Error loading standings.</td></tr>`;
  }
}

// Toggle between the Table and Race views in the Leaderboard tab
function switchLeaderboardView(view) {
  document.getElementById('leaderboardViewTableBtn').classList.toggle('active', view === 'table');
  document.getElementById('leaderboardViewRaceBtn').classList.toggle('active', view === 'race');

  if (view === 'table') {
    leaderboardTableView.style.display = '';
    leaderboardRaceView.style.display = 'none';
    pauseRacePlayback();
  } else {
    leaderboardTableView.style.display = 'none';
    leaderboardRaceView.style.display = '';
    if (raceFrames.length === 0) {
      loadLeaderboardHistory();
    }
  }
}

// Fetch leaderboard history frames and render the initial (start) frame
async function loadLeaderboardHistory() {
  try {
    const response = await fetch('/api/leaderboard/history');
    if (!response.ok) throw new Error('Failed to load leaderboard history');
    raceFrames = await response.json();

    raceMaxPoints = 1;
    raceFrames.forEach(frame => {
      frame.standings.forEach(player => {
        if (player.points > raceMaxPoints) raceMaxPoints = player.points;
      });
    });

    raceCurrentFrame = raceFrames.length - 1;
    raceScrubber.max = String(Math.max(raceFrames.length - 1, 0));
    raceScrubber.value = String(raceCurrentFrame);

    const hasMatches = raceFrames.length > 1;
    raceEmptyState.style.display = hasMatches ? 'none' : '';
    racePlayPauseBtn.disabled = !hasMatches;
    raceScrubber.disabled = !hasMatches;

    initRaceBars();
    renderRaceFrame(raceCurrentFrame, false);
  } catch (err) {
    console.error('Error loading leaderboard history:', err);
    raceBars.innerHTML = `<p class="loading-state error-text">Error loading race data.</p>`;
  }
}

// Build one row per player from the start frame, in initial order
function initRaceBars() {
  raceBars.innerHTML = '';
  raceRowsByName = new Map();

  const startFrame = raceFrames[0];
  startFrame.standings.forEach(player => {
    const row = document.createElement('div');
    row.className = 'race-row';
    row.innerHTML = `
      <span class="race-name">${escapeHtml(player.name)}</span>
      <div class="race-bar-track"><div class="race-bar-fill"></div></div>
      <span class="race-points">0 pts</span>
    `;
    raceBars.appendChild(row);
    raceRowsByName.set(player.name, row);
  });
}

// Render a given frame, animating bar width and row order changes (FLIP technique)
function renderRaceFrame(frameIndex, animate) {
  const frame = raceFrames[frameIndex];
  if (!frame) return;

  raceFrameLabel.textContent = frame.matchNumber
    ? `Match ${frame.matchNumber}: ${frame.homeTeam} vs ${frame.awayTeam}`
    : 'Start';

  raceDateLabel.textContent = frame.kickoff
    ? new Date(frame.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const rows = Array.from(raceRowsByName.values());
  const firstRects = new Map();
  if (animate) {
    rows.forEach(row => firstRects.set(row, row.getBoundingClientRect()));
  }

  frame.standings.forEach((player, index) => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    row.querySelector('.race-bar-fill').style.width = `${pct}%`;
    row.querySelector('.race-points').textContent = `${player.points} pts`;
    row.classList.toggle('race-row-leader', index === 0 && player.points > 0);

    raceBars.appendChild(row);
  });

  if (!animate) return;

  rows.forEach(row => {
    const first = firstRects.get(row);
    const last = row.getBoundingClientRect();
    const deltaY = first.top - last.top;
    if (deltaY) {
      row.style.transition = 'none';
      row.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        row.style.transition = `transform ${RACE_FRAME_DURATION_MS}ms ease`;
        row.style.transform = '';
      });
    }
  });
}

// Play/Pause button handler
function toggleRacePlayback() {
  if (racePlaying) {
    pauseRacePlayback();
    return;
  }

  raceCurrentFrame = 0;
  raceScrubber.value = '0';
  renderRaceFrame(0, false);

  startRacePlayback();
}

function startRacePlayback() {
  if (raceFrames.length <= 1) return;

  racePlaying = true;
  racePlayPauseBtn.innerHTML = '&#9208;';

  raceIntervalHandle = setInterval(() => {
    raceCurrentFrame += 1;
    if (raceCurrentFrame >= raceFrames.length) {
      raceCurrentFrame = raceFrames.length - 1;
      pauseRacePlayback();
      return;
    }
    raceScrubber.value = String(raceCurrentFrame);
    renderRaceFrame(raceCurrentFrame, true);
  }, RACE_FRAME_DURATION_MS);
}

function pauseRacePlayback() {
  racePlaying = false;
  racePlayPauseBtn.innerHTML = '&#9654;';
  if (raceIntervalHandle) {
    clearInterval(raceIntervalHandle);
    raceIntervalHandle = null;
  }
}

// Scrubber handler: jump to a frame without animation, pausing playback
function onRaceScrubberInput() {
  pauseRacePlayback();
  raceCurrentFrame = parseInt(raceScrubber.value, 10);
  renderRaceFrame(raceCurrentFrame, false);
}

// Render matches grid (Only open matches + admin-extended matches)
// Show/update the "you haven't voted on N open matches" banner on the predictions tab.
function updateNotVotedAlert(count) {
  const alertBox = document.getElementById('notVotedAlert');
  if (!alertBox) return;
  if (count > 0) {
    const plural = count === 1 ? 'match' : 'matches';
    alertBox.className = 'not-voted-alert warn';
    alertBox.innerHTML = `⚠️ You still have <strong>${count}</strong> open ${plural} you haven't voted on. Cast your votes before kickoff!`;
    alertBox.style.display = 'block';
  } else {
    alertBox.className = 'not-voted-alert ok';
    alertBox.innerHTML = `✅ You're all caught up — you've voted on every open match!`;
    alertBox.style.display = 'block';
  }
}

function renderMatches() {
  matchesGrid.innerHTML = '';
  const now = new Date();

  // Count live, open matches the user hasn't voted on yet (drives the alert banner).
  // Same definition as the leaderboard "Not Yet Voted" column: not resolved, not
  // admin-locked, still before kickoff (or extension active), and no vote cast.
  const notVotedCount = matches.filter(match => {
    if (match.status === 'resolved') return false;
    if (match.votingLocked) return false;
    const started = new Date(match.kickoff) <= now;
    const open = !started || match.extensionActive;
    return open && !match.myVote;
  }).length;
  updateNotVotedAlert(notVotedCount);

  // Filter only scheduled matches whose kickoff is in the future,
  // OR matches with an active voting extension
  const filtered = matches.filter(match => {
    const isStarted = new Date(match.kickoff) <= now;
    if (!isStarted && match.status === 'scheduled') return true;
    // Also show started matches with active extension
    if (isStarted && match.status !== 'resolved' && match.extensionActive) return true;
    return false;
  });

  if (filtered.length === 0) {
    matchesGrid.innerHTML = `<div class="loading-state">No matches open for predictions right now.</div>`;
    return;
  }

  // Sort by kickoff date asc (soonest first)
  filtered.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  filtered.forEach(match => {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.id = `card_${match.id}`;

    const kickoffTime = new Date(match.kickoff);
    const dateStr = kickoffTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const isLocked = !!match.votingLocked;
    const isExtended = !!match.extensionActive;
    const isHomeSelected = match.myVote === 'home' ? 'selected' : '';
    const isAwaySelected = match.myVote === 'away' ? 'selected' : '';
    const isDrawSelected = match.myVote === 'draw' ? 'selected' : '';

    let optionsHtml = '';
    if (isLocked) {
      // Admin-locked: show a locked banner
      const lockedVoteHtml = match.myVote
        ? `<div style="margin-top: 6px; font-size: 0.85rem; color: var(--color-accent);">Your vote: <strong>${match.myVote === 'home' ? escapeHtml(match.homeTeam) : match.myVote === 'away' ? escapeHtml(match.awayTeam) : 'Draw'}</strong> 🔒</div>`
        : '';
      optionsHtml = `
        <div style="background: rgba(255,214,0,0.06); border: 1px solid rgba(255,214,0,0.25); border-radius: 8px; padding: 12px; text-align: center;">
          <span style="font-size: 1.1rem;">🔒</span>
          <div style="font-weight: 700; color: var(--color-warning); font-size: 0.9rem; margin-top: 4px;">Voting Locked by Admin</div>
          ${lockedVoteHtml}
        </div>
      `;
    } else {
      optionsHtml = `
        <div class="prediction-options">
          <button class="predict-btn ${isHomeSelected}" onclick="submitVote('${match.id}', 'home')">
            <span>${escapeHtml(match.homeTeam)} Win</span>
          </button>
          ${match.matchType === 'League' ? `
            <button class="predict-btn ${isDrawSelected}" onclick="submitVote('${match.id}', 'draw')">
              <span>Draw</span>
            </button>
          ` : ''}
          <button class="predict-btn ${isAwaySelected}" onclick="submitVote('${match.id}', 'away')">
            <span>${escapeHtml(match.awayTeam)} Win</span>
          </button>
        </div>
      `;
    }

    let badgeHtml = `<span class="match-type-badge">${match.matchNumber ? '#' + match.matchNumber + ' - ' : ''}${escapeHtml(match.group || match.matchType)}</span>`;
    
    let timerHtml;
    if (isLocked) {
      timerHtml = `<span class="match-timer locked">🔒 Locked</span>`;
    } else if (isExtended && match.votingExtendedUntil) {
      timerHtml = `<span class="match-countdown match-timer extension-timer" data-extension-until="${match.votingExtendedUntil}" style="color: #ff9800; border-color: #ff9800;">⏱ Calculating...</span>`;
    } else {
      timerHtml = `<span class="match-countdown match-timer" data-kickoff="${match.kickoff}">Calculating...</span>`;
    }

    const extensionBannerHtml = isExtended ? `
      <div style="background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.4); border-radius: 8px; padding: 8px 12px; text-align: center; margin-bottom: 10px; font-size: 0.82rem;">
        ⚡ <strong style="color: #ff9800;">Voting Extended by Admin</strong> — closes when timer hits zero!
      </div>
    ` : '';

    card.innerHTML = `
      <div class="match-meta">
        ${badgeHtml}
        ${timerHtml}
      </div>
      <div class="match-teams">
        <div class="team">
          <span class="team-flag">${getTeamFlag(match.homeTeam)}</span>
          <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
        </div>
        <div class="vs-divider">VS</div>
        <div class="team">
          <span class="team-flag">${getTeamFlag(match.awayTeam)}</span>
          <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
        </div>
      </div>
      <div class="match-meta" style="justify-content: center; font-size: 0.75rem;">
        📅 Kickoff: ${dateStr}
      </div>
      ${extensionBannerHtml}
      ${optionsHtml}
    `;

    matchesGrid.appendChild(card);
  });
  
  updateAllTimers();
}

// Render results table (Live & resolved matches, latest first)
function renderResults() {
  const tbody = document.getElementById('resultsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const now = new Date();

  // Filter only matches that have started or are resolved
  const filtered = matches.filter(match => {
    const isStarted = new Date(match.kickoff) <= now;
    return isStarted || match.status === 'resolved';
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-state">No live or completed matches to display.</td></tr>`;
    return;
  }

  // Sort by kickoff date desc (newest first / latest match at top)
  filtered.sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  filtered.forEach(match => {
    const isResolved = match.status === 'resolved';
    const kickoffTime = new Date(match.kickoff);
    const dateStr = kickoffTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const counts = match.voteCounts;
    const voters = match.voters || { home: [], away: [], draw: [] };

    const isWinnerHome = isResolved && match.outcome === 'home';
    const isWinnerAway = isResolved && match.outcome === 'away';
    const isWinnerDraw = isResolved && match.outcome === 'draw';

    // Result Outcome text
    let outcomeText = '';
    if (isResolved) {
      if (match.outcome === 'home') outcomeText = `${escapeHtml(match.homeTeam)} Win`;
      else if (match.outcome === 'away') outcomeText = `${escapeHtml(match.awayTeam)} Win`;
      else outcomeText = 'Draw';
    } else {
      outcomeText = '<span style="color: var(--color-warning); font-weight: bold;">Locked / Live</span>';
    }

    // Player prediction text & styling
    let pickText = '<span style="color: var(--text-muted);">No Vote</span>';
    let pickClass = '';
    if (match.myVote) {
      const pickTeam = match.myVote === 'home' ? match.homeTeam 
                     : match.myVote === 'away' ? match.awayTeam 
                     : 'Draw';
      
      if (isResolved) {
        const isCorrect = match.myVote === match.outcome;
        if (isCorrect) {
          const totalIncorrectVotes = (match.outcome === 'home' ? (counts.away + counts.draw) 
                                     : match.outcome === 'away' ? (counts.home + counts.draw)
                                     : (counts.home + counts.away));
          const pts = totalIncorrectVotes + 1;
          pickText = `🎉 ${escapeHtml(pickTeam)} (+${pts})`;
          pickClass = 'text-active'; // Neon Green
        } else {
          pickText = `❌ ${escapeHtml(pickTeam)}`;
          pickClass = 'error-text'; // Red
        }
      } else {
        pickText = `🔒 ${escapeHtml(pickTeam)}`;
      }
    }

    // Voters list formatting
    let distHtml = `
      <div style="font-size: 0.8rem; line-height: 1.4;">
        <span style="${isWinnerHome ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.homeTeam)} (${counts.home}):</span> 
        <span style="color: var(--text-muted);">${voters.home.map(escapeHtml).join(', ') || 'None'}</span>
        <br>
        ${match.matchType === 'League' ? `
          <span style="${isWinnerDraw ? 'color: var(--color-accent); font-weight: 700;' : ''}">Draw (${counts.draw}):</span> 
          <span style="color: var(--text-muted);">${voters.draw.map(escapeHtml).join(', ') || 'None'}</span>
          <br>
        ` : ''}
        <span style="${isWinnerAway ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.awayTeam)} (${counts.away}):</span> 
        <span style="color: var(--text-muted);">${voters.away.map(escapeHtml).join(', ') || 'None'}</span>
      </div>
    `;

    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
    row.innerHTML = `
      <td data-label="Match #" style="text-align: center; font-weight: 800; font-family: monospace; color: var(--color-accent); font-size: 1.05rem;">
        ${match.matchNumber ? '#' + match.matchNumber : '-'}
      </td>
      <td data-label="Group / Stage" style="font-weight: 600; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.5px;">
        ${escapeHtml(match.group || match.matchType)}
      </td>
      <td data-label="Matchup" style="font-weight: 700;">
        <span>${getTeamFlag(match.homeTeam)} ${escapeHtml(match.homeTeam)}</span>
        <span style="color: var(--text-muted); font-size: 0.75rem; padding: 0 4px; font-weight: normal;">vs</span>
        <span>${escapeHtml(match.awayTeam)} ${getTeamFlag(match.awayTeam)}</span>
      </td>
      <td data-label="Kickoff (Local)" style="color: var(--text-muted); font-size: 0.8rem;">
        ${dateStr}
      </td>
      <td data-label="Result" style="text-align: center; font-weight: 800;">
        ${outcomeText}
      </td>
      <td data-label="Your Pick" style="text-align: center; font-weight: 700;" class="${pickClass}">
        ${pickText}
      </td>
      <td data-label="Group Votes Distribution" style="padding-left: 20px;">
        ${distHtml}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function updateAllTimers() {
  const elements = document.querySelectorAll('.match-countdown');
  const now = new Date().getTime();

  elements.forEach(el => {
    // Extension timer — counts down to when extension expires
    if (el.classList.contains('extension-timer')) {
      const extUntil = new Date(el.getAttribute('data-extension-until')).getTime();
      const diff = extUntil - now;
      if (diff <= 0) {
        el.textContent = '⏱ Extension Ended';
        el.className = 'match-timer locked';
        loadDashboardData(); // refresh to remove from predictions
      } else {
        const minutes = Math.floor(diff / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        el.textContent = `⏱ Closes in ${minutes}m ${seconds}s`;
      }
      return;
    }

    // Regular countdown to kickoff
    const kickoffTime = new Date(el.getAttribute('data-kickoff')).getTime();
    const diff = kickoffTime - now;

    if (diff <= 0) {
      el.textContent = 'Live / Locked';
      el.className = 'match-timer locked';
      if (currentFilter === 'open') {
        loadDashboardData();
      }
    } else {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      let timerText = '';
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        timerText = `${days}d ${hours % 24}h`;
      } else {
        timerText = `${hours}h ${minutes}m ${seconds}s`;
        if (hours === 0) el.classList.add('soon');
      }
      el.textContent = timerText;
    }
  });
}

// Submit prediction — shows custom confirmation modal first
function submitVote(matchId, prediction) {
  const match = matches.find(m => m.id === matchId);
  if (!match || !currentUserSecret) return;

  // Populate modal
  const matchLabel = `#${match.matchNumber || '-'} · ${escapeHtml(match.group || match.matchType)}`;
  const matchup = `${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}`;
  const choiceText = prediction === 'home' ? `${escapeHtml(match.homeTeam)} Win`
                   : prediction === 'away' ? `${escapeHtml(match.awayTeam)} Win`
                   : 'Draw';

  document.getElementById('voteConfirmMatchLabel').textContent = matchLabel;
  document.getElementById('voteConfirmMatchup').textContent = matchup;
  document.getElementById('voteConfirmChoice').textContent = choiceText;

  // Store pending state
  pendingVoteMatchId = matchId;
  pendingVotePrediction = prediction;

  // Show modal
  document.getElementById('voteConfirmModal').style.display = 'flex';
}

// Close vote confirmation modal
function closeVoteModal() {
  document.getElementById('voteConfirmModal').style.display = 'none';
  pendingVoteMatchId = null;
  pendingVotePrediction = null;
}

// Actually submit after user confirms in modal
async function confirmVote() {
  if (!pendingVoteMatchId || !pendingVotePrediction || !currentUserSecret) return;

  const matchId = pendingVoteMatchId;
  const prediction = pendingVotePrediction;

  // Close modal and optimistically update UI immediately
  closeVoteModal();
  const match = matches.find(m => m.id === matchId);
  if (match) {
    match.myVote = prediction;
    renderMatches(); // instant highlight
  }

  try {
    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId, prediction })
    });

    if (!response.ok) {
      const data = await response.json();
      // Revert optimistic update on failure
      if (match) {
        match.myVote = null;
        renderMatches();
      }
      alert(`Voting error: ${data.error}`);
      return;
    }

    // Silently refresh data in background (don't re-render to avoid flicker)
    loadDashboardData();
  } catch (err) {
    console.error('Error submitting prediction:', err);
  }
}

// User passcode login handler
async function handleUserRegistration(event) {
  event.preventDefault();
  const passcode = usernameInput.value.trim().toUpperCase();
  if (!passcode) return;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ secret: passcode })
    });

    if (!response.ok) {
      const data = await response.json();
      alert(`Login failed: ${data.error}`);
      return;
    }

    const data = await response.json();
    currentUsername = data.name;
    currentUserSecret = data.secret;
    currentUserIsAdmin = !!data.isAdmin;
    localStorage.setItem('soccer_prediction_username', currentUsername);
    localStorage.setItem('soccer_prediction_secret', currentUserSecret);
    localStorage.setItem('soccer_prediction_is_admin', currentUserIsAdmin ? 'true' : 'false');
    
    usernameModal.style.display = 'none';
    currentUserNameDisplay.textContent = currentUsername;
    updateAdminTabVisibility();
    
    loadDashboardData();
  } catch (err) {
    console.error('Error logging in:', err);
    alert('Failed to connect to the server.');
  }
}


// =================== ADMIN CONTROL PANEL ===================

// Toggle collapse state of an admin panel card (mobile only — see CSS)
function toggleAdminCard(toggleEl) {
  const card = toggleEl.closest('.rules-card');
  if (card) card.classList.toggle('collapsed');
}

function checkAdminState() {
  if (adminPasscode) {
    adminAuthCard.style.display = 'none';
    adminWorkspace.style.display = 'block';
    loadAdminMatches();
    loadAdminPlayers();
    loadAdminHistory();
    loadAdminVotes();
    loadFixtures();
  } else {
    adminAuthCard.style.display = 'block';
    adminWorkspace.style.display = 'none';
    adminPasscodeInput.focus();
  }
}

async function verifyAdminPasscode() {
  const code = adminPasscodeInput.value.trim();
  if (!code) return;

  try {
    const response = await fetch('/api/admin/verify', {
      headers: {
        'x-admin-passcode': code,
        'x-user-secret': currentUserSecret
      }
    });

    if (response.ok) {
      adminPasscode = code;
      sessionStorage.setItem('admin_passcode', code);
      adminAuthMessage.textContent = '';
      checkAdminState();
    } else {
      adminAuthMessage.textContent = '❌ Invalid admin passcode or you do not have admin rights.';
      adminPasscodeInput.value = '';
      adminPasscodeInput.focus();
    }
  } catch (err) {
    console.error('Error verifying admin:', err);
    adminAuthMessage.textContent = '❌ Failed to connect to server.';
  }
}

// Load player list with passcodes in Admin interface
async function loadAdminPlayers() {
  const listEl = document.getElementById('adminPlayersList');
  listEl.innerHTML = '<tr><td colspan="4" class="loading-state" style="padding: 10px 0;">Loading players...</td></tr>';

  try {
    const response = await fetch('/api/admin/users', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });

    if (!response.ok) throw new Error('Failed to load players');
    const players = await response.json();

    listEl.innerHTML = '';
    if (players.length === 0) {
      listEl.innerHTML = '<tr><td colspan="4" class="loading-state" style="padding: 10px 0;">No players added yet.</td></tr>';
      return;
    }

    players.forEach(p => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
      const roleBadge = p.isAdmin 
        ? `<span class="badge" style="background: var(--color-accent); color: #000; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">Admin</span>`
        : `<span style="color: var(--text-muted); font-size: 0.85rem;">Player</span>`;
      
      const toggleBtnText = p.isAdmin ? 'Demote' : 'Promote';
      const toggleBtnClass = p.isAdmin ? 'btn-secondary' : 'btn-primary';

      row.innerHTML = `
        <td data-label="Name" style="padding: 8px 6px; font-weight: 600;">${escapeHtml(p.name)}</td>
        <td data-label="Passcode" style="padding: 8px 6px; text-align: center; font-family: monospace; color: var(--color-accent); font-weight: 700; letter-spacing: 1px;">${p.secret}</td>
        <td data-label="Role" style="padding: 8px 6px; text-align: center;">${roleBadge}</td>
        <td data-label="Action" style="padding: 8px 6px; text-align: right;">
          <button class="btn ${toggleBtnClass} btn-sm" style="padding: 3px 8px; font-size: 0.75rem; margin-right: 4px;" onclick="togglePlayerRole('${escapeHtml(p.name)}', ${!!p.isAdmin})">${toggleBtnText}</button>
          <button class="btn btn-danger btn-sm" style="padding: 3px 8px; font-size: 0.75rem;" onclick="deletePlayer('${escapeHtml(p.name)}')">Delete</button>
        </td>
      `;
      listEl.appendChild(row);
    });
  } catch (err) {
    console.error('Error listing players:', err);
    listEl.innerHTML = '<tr><td colspan="4" class="loading-state error-text">Failed to load players list.</td></tr>';
  }
}

// Add Player Form submission
async function handleCreatePlayer(event) {
  event.preventDefault();
  const nameInput = document.getElementById('playerNameInput');
  const name = nameInput.value.trim();
  const feedbackEl = document.getElementById('addPlayerMessage');
  
  if (!name) return;

  try {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (!response.ok) {
      showFeedback(feedbackEl, `❌ Error: ${data.error}`, 'error');
      return;
    }

    showFeedback(feedbackEl, `✅ Created ${name}! Passcode: ${data.user.secret}`, 'success');
    nameInput.value = '';
    
    loadAdminPlayers();
    loadLeaderboard();
  } catch (err) {
    console.error('Error creating player:', err);
    showFeedback(feedbackEl, '❌ Failed to connect to server.', 'error');
  }
}

// Delete Player profile
async function deletePlayer(name) {
  if (!confirm(`Are you sure you want to permanently delete user "${name}"? They will no longer be able to log in, but their historical votes will still display.`)) return;

  try {
    const response = await fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Error deleting player: ${data.error}`);
      return;
    }

    loadAdminPlayers();
    loadLeaderboard();
  } catch (err) {
    console.error('Error deleting player:', err);
  }
}

// Toggle Admin Role
async function togglePlayerRole(name, currentIsAdmin) {
  const targetIsAdmin = !currentIsAdmin;
  const actionText = targetIsAdmin ? 'promote' : 'demote';
  if (!confirm(`Are you sure you want to ${actionText} user "${name}"?`)) return;

  try {
    const response = await fetch('/api/admin/users/toggle-admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ name, isAdmin: targetIsAdmin })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Error toggling role: ${data.error}`);
      return;
    }

    // If active admin demoted themselves (should be blocked by backend anyway), handle session update
    if (name === currentUsername && !targetIsAdmin) {
      currentUserIsAdmin = false;
      localStorage.setItem('soccer_prediction_is_admin', 'false');
      updateAdminTabVisibility();
    }

    loadAdminPlayers();
  } catch (err) {
    console.error('Error toggling player role:', err);
  }
}

// Load admin matches
function loadAdminMatches() {
  adminMatchesList.innerHTML = '';
  
  if (matches.length === 0) {
    adminMatchesList.innerHTML = `<div class="loading-state">No matches added yet.</div>`;
    return;
  }

  const sorted = [...matches].sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  sorted.forEach(match => {
    const row = document.createElement('div');
    row.className = 'admin-match-row';
    
    const dateStr = new Date(match.kickoff).toLocaleString();
    const isResolved = match.status === 'resolved';
    const isVotingLocked = !!match.votingLocked;
    const now = new Date();
    const hasStarted = new Date(match.kickoff) <= now;
    const extensionActive = match.extensionActive;
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;

    let outcomeControls = '';
    if (isResolved) {
      const winnerName = match.outcome === 'home' ? match.homeTeam 
                       : match.outcome === 'away' ? match.awayTeam 
                       : 'Draw';
      outcomeControls = `<div class="outcome-badge">Outcome: <strong>${escapeHtml(winnerName).toUpperCase()}</strong> (Resolved)</div>`;
    } else {
      outcomeControls = `
        <div class="resolve-btn-group">
          <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'home')">${escapeHtml(match.homeTeam)}</button>
          ${match.matchType === 'League' ? `
            <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'draw')">Draw</button>
          ` : ''}
          <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'away')">${escapeHtml(match.awayTeam)}</button>
        </div>
      `;
    }

    // Lock/Unlock button (only for non-resolved matches)
    const lockBtn = !isResolved ? `
      <button class="btn btn-sm" 
        onclick="toggleVotingLock('${match.id}', ${!isVotingLocked})"
        style="background: ${isVotingLocked ? 'rgba(0,230,118,0.15); border: 1px solid var(--color-accent); color: var(--color-accent)' : 'rgba(255,214,0,0.1); border: 1px solid var(--color-warning); color: var(--color-warning)'}; font-size: 0.75rem; padding: 4px 10px;">
        ${isVotingLocked ? '🔓 Unlock Voting' : '🔒 Lock Voting'}
      </button>
    ` : '';

    // Reopen Voting button (only for started, non-resolved matches)
    const reopenBtnHtml = hasStarted && !isResolved ? `
      <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
        <input type="number" 
          id="extMin_${match.id}" 
          value="5" 
          min="1" 
          max="120" 
          style="width: 60px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; padding: 3px 6px; font-size: 0.78rem; text-align: center;"
          title="Extension duration in minutes"
        >
        <span style="font-size: 0.72rem; color: var(--text-muted);">min</span>
        <button class="btn btn-sm" 
          onclick="extendVoting('${match.id}')" 
          style="background: rgba(255,152,0,0.15); border: 1px solid #ff9800; color: #ff9800; font-size: 0.75rem; padding: 4px 10px;">
          ${extensionActive ? '⏱ Extend Again' : '🔓 Reopen Voting'}
        </button>
        ${extensionActive && extendedUntil ? `<span style="font-size: 0.7rem; color: #ff9800;">Until ${extendedUntil.toLocaleTimeString()}</span>` : ''}
      </div>
    ` : '';

    const statusBadge = isResolved ? 'Resolved'
      : extensionActive ? '<span style="color: #ff9800;">⏱ Extended</span>'
      : isVotingLocked ? '<span style="color: var(--color-warning);">🔒 Locked</span>'
      : hasStarted ? '<span style="color: var(--text-muted);">🔒 Live</span>'
      : '<span style="color: var(--color-accent);">✅ Open</span>';

    row.innerHTML = `
      <div class="admin-match-teams">
        <span>#${match.matchNumber || '-'} [${escapeHtml(match.group || match.matchType)}] : ${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">${statusBadge}</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted);">📅 Kickoff: ${dateStr}</div>
      <div class="admin-match-actions">
        ${outcomeControls}
        <div style="display:flex; gap:6px; align-items:center; flex-wrap: wrap;">
          ${lockBtn}
          ${isResolved ? `<button class="btn btn-secondary btn-sm" onclick="unresolveMatch('${match.id}')" style="background: var(--color-warning); color: #000; border: none;">Undo</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteMatch('${match.id}')">Delete</button>
        </div>
        ${reopenBtnHtml}
      </div>
    `;

    adminMatchesList.appendChild(row);
  });
}

// Add Match Form submission
async function handleCreateMatch(event) {
  event.preventDefault();
  const homeTeam = document.getElementById('homeTeamInput').value.trim();
  const awayTeam = document.getElementById('awayTeamInput').value.trim();
  const matchType = document.getElementById('matchTypeSelect').value;
  const kickoffStr = document.getElementById('kickoffInput').value;
  const matchNumber = document.getElementById('matchNumberInput').value.trim();
  const group = document.getElementById('groupInput').value.trim();

  if (!homeTeam || !awayTeam || !kickoffStr) return;

  const kickoffISO = new Date(kickoffStr).toISOString();

  try {
    const response = await fetch('/api/admin/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ homeTeam, awayTeam, matchType, kickoff: kickoffISO, matchNumber, group })
    });

    const data = await response.json();
    if (!response.ok) {
      showFeedback(addMatchMessage, `❌ Error: ${data.error}`, 'error');
      return;
    }

    showFeedback(addMatchMessage, `✅ Match ${homeTeam} vs ${awayTeam} created successfully!`, 'success');
    document.getElementById('addMatchForm').reset();
    initializeDefaultKickoff();
    
    loadDashboardData();
  } catch (err) {
    console.error('Error creating match:', err);
    showFeedback(addMatchMessage, '❌ Failed to communicate with server.', 'error');
  }
}

// Resolve Match
async function resolveMatch(matchId, outcome) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return;
  const outcomeText = outcome === 'home' ? match.homeTeam 
                    : outcome === 'away' ? match.awayTeam 
                    : 'Draw';
  if (!confirm(`Are you sure you want to resolve this match as '${outcomeText}'? This will calculate scores immediately.`)) return;

  try {
    const response = await fetch('/api/admin/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId, outcome })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Resolution error: ${data.error}`);
      return;
    }

    loadDashboardData();
  } catch (err) {
    console.error('Error resolving match:', err);
  }
}

// Undo Resolution (Unresolve Match)
async function unresolveMatch(matchId) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return;
  if (!confirm(`Are you sure you want to undo the resolution for Match #${match.matchNumber || '-'} (${match.homeTeam} vs ${match.awayTeam})? This will recalculate the leaderboard standings immediately.`)) return;

  try {
    const response = await fetch('/api/admin/unresolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Error undoing resolution: ${data.error}`);
      return;
    }

    loadDashboardData();
  } catch (err) {
    console.error('Error unresolving match:', err);
  }
}

// Delete Match
async function deleteMatch(matchId) {
  if (!confirm('Are you sure you want to permanently delete this match and all its predictions? This cannot be undone.')) return;

  try {
    const response = await fetch('/api/admin/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Deletion error: ${data.error}`);
      return;
    }

    loadDashboardData();
  } catch (err) {
    console.error('Error deleting match:', err);
  }
}

// Toggle Voting Lock (Admin Only)
async function toggleVotingLock(matchId, shouldLock) {
  try {
    const response = await fetch('/api/admin/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId, locked: shouldLock })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Lock toggle error: ${data.error}`);
      return;
    }

    loadDashboardData();
  } catch (err) {
    console.error('Error toggling vote lock:', err);
  }
}

// Extend Voting Window for a Started Match (Admin Only)
async function extendVoting(matchId) {
  const minutesInput = document.getElementById(`extMin_${matchId}`);
  const minutes = minutesInput ? parseInt(minutesInput.value, 10) : 5;

  if (!minutes || minutes < 1 || minutes > 120) {
    alert('Please enter a valid extension duration between 1 and 120 minutes.');
    return;
  }

  const match = matches.find(m => m.id === matchId);
  if (!match) return;

  const actionLabel = match.extensionActive ? `extend voting again by ${minutes} minute(s)` : `reopen voting for ${minutes} minute(s)`;
  if (!confirm(`Are you sure you want to ${actionLabel} for ${match.homeTeam} vs ${match.awayTeam}?`)) return;

  try {
    const response = await fetch('/api/admin/extend-voting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId, minutes })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`Voting extension error: ${data.error}`);
      return;
    }

    loadDashboardData();
  } catch (err) {
    console.error('Error extending voting window:', err);
  }
}

// Helper: Show feedback text
function showFeedback(element, message, type) {
  element.textContent = message;
  element.className = `feedback-message ${type}`;
  setTimeout(() => {
    element.textContent = '';
  }, 4000);
}

// Helper: Escape HTML string
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Helper: Initialize default kickoff input to tomorrow at 18:00 local time
function initializeDefaultKickoff() {
  const kickoffInput = document.getElementById('kickoffInput');
  if (kickoffInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const hours = String(tomorrow.getHours()).padStart(2, '0');
    const minutes = String(tomorrow.getMinutes()).padStart(2, '0');
    
    kickoffInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}

// Fetch and load System History
async function loadAdminHistory() {
  const listEl = document.getElementById('adminHistoryList');
  if (!listEl) return;

  try {
    const response = await fetch('/api/admin/history', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });

    if (!response.ok) throw new Error('Failed to load history');
    const history = await response.json();

    listEl.innerHTML = '';
    if (history.length === 0) {
      listEl.innerHTML = '<tr><td colspan="4" class="loading-state" style="padding: 10px 0;">No system actions recorded yet.</td></tr>';
      return;
    }

    // Sort by timestamp desc (newest first)
    const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sortedHistory.forEach(h => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
      const dateStr = new Date(h.timestamp).toLocaleString();
      
      let recoveryBtn = '';
      if (h.recoveryData) {
        recoveryBtn = `<button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.7rem;" onclick="copyRecoveryData(this, '${escapeHtml(h.recoveryData)}')">Copy JSON</button>`;
      } else {
        recoveryBtn = '<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>';
      }

      row.innerHTML = `
        <td style="padding: 8px; color: var(--text-muted);">${dateStr}</td>
        <td style="padding: 8px;"><span class="badge" style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; border: 1px solid rgba(255,255,255,0.1);">${escapeHtml(h.action)}</span></td>
        <td style="padding: 8px; font-weight: 500;">${escapeHtml(h.details)}</td>
        <td style="padding: 8px; text-align: right;">${recoveryBtn}</td>
      `;
      listEl.appendChild(row);
    });
  } catch (err) {
    console.error('Error listing history:', err);
    listEl.innerHTML = '<tr><td colspan="4" class="loading-state error-text">Failed to load history log.</td></tr>';
  }
}

// ===================== VOTE LOG =====================

// Global cache for vote log data
let _voteLogData = [];

// Fetch and load the Vote Log
async function loadAdminVotes() {
  const listEl = document.getElementById('adminVoteLogList');
  const filterEl = document.getElementById('voteLogMatchFilter');
  if (!listEl) return;

  try {
    const response = await fetch('/api/admin/votes', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });

    if (!response.ok) throw new Error('Failed to load vote log');
    _voteLogData = await response.json();

    // Populate match filter dropdown
    if (filterEl) {
      const currentFilter = filterEl.value;
      const matchOptions = new Map();
      _voteLogData.forEach(v => {
        if (!matchOptions.has(v.matchId)) {
          matchOptions.set(v.matchId, v.matchLabel);
        }
      });
      filterEl.innerHTML = '<option value="all">All Matches</option>';
      matchOptions.forEach((label, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = label;
        filterEl.appendChild(opt);
      });
      // Restore previous selection
      if (currentFilter && currentFilter !== 'all') {
        filterEl.value = currentFilter;
        if (!filterEl.value) filterEl.value = 'all';
      }
    }

    renderVoteLog(_voteLogData);
  } catch (err) {
    console.error('Error loading vote log:', err);
    if (listEl) listEl.innerHTML = '<tr><td colspan="5" class="loading-state error-text">Failed to load vote log.</td></tr>';
  }
}

// Filter vote log by selected match
function filterVoteLog() {
  const filterEl = document.getElementById('voteLogMatchFilter');
  if (!filterEl || !_voteLogData) return;
  const matchId = filterEl.value;
  const filtered = matchId === 'all' ? _voteLogData : _voteLogData.filter(v => v.matchId === matchId);
  renderVoteLog(filtered);
}

// Render vote log rows
function renderVoteLog(data) {
  const listEl = document.getElementById('adminVoteLogList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!data || data.length === 0) {
    listEl.innerHTML = '<tr><td colspan="5" class="loading-state" style="padding: 10px 0;">No votes recorded yet.</td></tr>';
    return;
  }

  data.forEach(v => {
    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid rgba(255,255,255,0.04)';

    // Dim changed (non-latest) votes
    if (!v.isLatest) {
      row.style.opacity = '0.45';
    }

    let dateStr;
    if (v.timestamp) {
      const d = new Date(v.timestamp);
      dateStr = `<span class="ts-full">${d.toLocaleString()}</span><span class="ts-stack">${d.toLocaleDateString()}<br>${d.toLocaleTimeString()}</span>`;
    } else {
      dateStr = '<span style="color: var(--text-muted); font-style: italic;">Legacy (no timestamp)</span>';
    }

    const voteColor = v.vote === 'home' ? 'var(--color-accent)'
                    : v.vote === 'away' ? '#64b5f6'
                    : 'var(--color-gold)';

    const voteLabel = `<span style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size: 0.78rem; color: ${voteColor};">${escapeHtml(v.voteText)}</span>`;

    const statusBadge = v.isLatest
      ? `<span class="status-full" style="color: var(--color-accent); font-size: 0.75rem; font-weight: 700;">✓ Current</span><span class="status-short" style="color: var(--color-accent); font-size: 0.75rem; font-weight: 700;">✓</span>`
      : `<span class="status-full" style="color: var(--text-muted); font-size: 0.75rem;">Changed</span><span class="status-short" style="color: var(--text-muted); font-size: 0.75rem;">Old</span>`;

    const resolvedBadge = v.matchStatus === 'resolved'
      ? `<span style="color: var(--color-gold); font-size: 0.7rem; margin-left: 4px;">(Resolved)</span>`
      : '';

    row.innerHTML = `
      <td style="padding: 8px; color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">${dateStr}</td>
      <td style="padding: 8px; font-weight: 700; color: var(--text-primary);">${escapeHtml(v.player)}</td>
      <td style="padding: 8px; font-size: 0.82rem;">${escapeHtml(v.matchLabel)}${resolvedBadge}</td>
      <td style="padding: 8px; text-align: center;">${voteLabel}</td>
      <td style="padding: 8px; text-align: center;">${statusBadge}</td>
    `;
    listEl.appendChild(row);
  });
}


function copyRecoveryData(btn, data) {
  navigator.clipboard.writeText(data).then(() => {
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--color-accent)';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  }).catch(err => {
    console.error('Could not copy text: ', err);
    alert('Recovery Data:\n' + data);
  });
}

// ===================== MATCH LOG (football-data.org fixtures) =====================

async function loadFixtures(forceRefresh = false) {
  const contentEl = document.getElementById('matchLogContent');
  if (!contentEl) return;
  contentEl.innerHTML = '<div class="loading-state">Loading fixtures from football-data.org…</div>';

  try {
    const url = forceRefresh ? '/api/admin/fixtures?refresh=true' : '/api/admin/fixtures';
    const response = await fetch(url, {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });
    const data = await response.json();
    if (!response.ok) {
      contentEl.innerHTML = `<div class="loading-state error-text">❌ ${escapeHtml(data.error || 'Failed to load fixtures.')}</div>`;
      return;
    }
    fixturesData = data;
    fixturesCurrentIndex = findCurrentFixtureIndex();
    renderMatchLog();
  } catch (err) {
    console.error('[FIXTURES] Error:', err);
    if (contentEl) contentEl.innerHTML = '<div class="loading-state error-text">❌ Failed to connect to server.</div>';
  }
}

function refreshFixtures() {
  const btn = document.getElementById('fixturesRefreshBtn');
  if (btn) {
    btn.disabled = true;
    let remaining = 30;
    btn.textContent = `↻ ${remaining}s`;
    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdown);
        btn.disabled = false;
        btn.textContent = '↻';
      } else {
        btn.textContent = `↻ ${remaining}s`;
      }
    }, 1000);
  }
  loadFixtures(true);
}

function findCurrentFixtureIndex() {
  if (!fixturesData.length) return 0;
  const now = new Date();
  const liveIdx = fixturesData.findIndex(f => f.status === 'IN_PLAY' || f.status === 'PAUSED');
  if (liveIdx >= 0) return liveIdx;
  const nextIdx = fixturesData.findIndex(f => (f.status === 'SCHEDULED' || f.status === 'TIMED') && new Date(f.kickoff) > now);
  if (nextIdx >= 0) return nextIdx;
  return fixturesData.length - 1;
}

function isFixtureAlreadyInDb(fixture) {
  if (!matches.length) return false;
  const kickoffDay = new Date(fixture.kickoff).toDateString();
  return matches.some(m =>
    m.homeTeam.toLowerCase() === fixture.homeTeam.toLowerCase() &&
    m.awayTeam.toLowerCase() === fixture.awayTeam.toLowerCase() &&
    new Date(m.kickoff).toDateString() === kickoffDay
  );
}

function renderMatchLog() {
  const contentEl = document.getElementById('matchLogContent');
  if (!contentEl || !fixturesData.length) return;

  const f = fixturesData[fixturesCurrentIndex];
  const total = fixturesData.length;

  const kickoffLocal = new Date(f.kickoff);
  const dateStr = kickoffLocal.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = kickoffLocal.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const isFinished = f.status === 'FINISHED';
  const isLive = f.status === 'IN_PLAY' || f.status === 'PAUSED';
  const isGroupStage = /^Group [A-Za-z]+$/.test(f.group || '');
  const isUpcoming = (f.status === 'SCHEDULED' || f.status === 'TIMED') && isGroupStage;
  const alreadyAdded = isFixtureAlreadyInDb(f);

  // Score block (finished or live)
  let scoreBadge = '';
  if (isFinished && f.scoreHome !== null) {
    scoreBadge = `
      <div style="text-align:center; margin:14px 0; background:rgba(0,230,118,0.08); border:1px solid rgba(0,230,118,0.2); border-radius:8px; padding:12px 0;">
        <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Full Time</div>
        <div style="font-size:1.6rem; font-weight:800; letter-spacing:6px; color:var(--color-accent);">${f.scoreHome} – ${f.scoreAway}</div>
      </div>`;
  } else if (isLive) {
    scoreBadge = `
      <div style="text-align:center; margin:14px 0; background:rgba(255,152,0,0.08); border:1px solid rgba(255,152,0,0.3); border-radius:8px; padding:12px 0;">
        <div style="font-size:0.72rem; color:#ff9800; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">🔴 Live</div>
        ${f.scoreHome !== null ? `<div style="font-size:1.6rem; font-weight:800; letter-spacing:6px; color:#ff9800;">${f.scoreHome} – ${f.scoreAway}</div>` : ''}
      </div>`;
  }

  // Status pill
  const statusStyles = {
    'FINISHED':  { bg:'rgba(0,230,118,0.1)',  border:'rgba(0,230,118,0.3)',  color:'var(--color-accent)', label:'Finished' },
    'IN_PLAY':   { bg:'rgba(255,152,0,0.1)',  border:'rgba(255,152,0,0.4)',  color:'#ff9800',             label:'🔴 Live' },
    'PAUSED':    { bg:'rgba(255,152,0,0.1)',  border:'rgba(255,152,0,0.4)',  color:'#ff9800',             label:'⏸ Half Time' },
    'SCHEDULED': { bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.12)', color:'var(--text-muted)', label:'Scheduled' },
    'TIMED':     { bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.12)', color:'var(--text-muted)', label:'Scheduled' },
    'POSTPONED': { bg:'rgba(255,60,60,0.1)',  border:'rgba(255,60,60,0.3)',  color:'#ff6060',             label:'Postponed' },
    'CANCELLED': { bg:'rgba(255,60,60,0.1)',  border:'rgba(255,60,60,0.3)',  color:'#ff6060',             label:'Cancelled' }
  };
  const s = statusStyles[f.status] || statusStyles['SCHEDULED'];
  const statusPill = `<span style="background:${s.bg}; border:1px solid ${s.border}; color:${s.color}; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:700;">${s.label}</span>`;

  // Create Match button or "already added" note
  let actionHtml = '';
  if (isUpcoming) {
    actionHtml = alreadyAdded
      ? `<div style="margin-top:14px; text-align:center; color:var(--color-accent); font-size:0.85rem; font-weight:600;">✅ Already in database</div>`
      : `<button class="btn btn-success btn-full" style="margin-top:14px;" onclick="createMatchFromFixture(${fixturesCurrentIndex})">➕ Create Match</button>`;
  }

  contentEl.innerHTML = `
    <div style="font-size:0.75rem; color:var(--text-muted); text-align:right; margin-bottom:12px;">
      Match ${fixturesCurrentIndex + 1} of ${total}
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Home Team</label>
        <div class="fixture-field">${getTeamFlag(f.homeTeam)} ${escapeHtml(f.homeTeam)}</div>
      </div>
      <div class="form-group">
        <label>Away Team</label>
        <div class="fixture-field">${getTeamFlag(f.awayTeam)} ${escapeHtml(f.awayTeam)}</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Match Number</label>
        <div class="fixture-field">${escapeHtml(f.matchNumber)}</div>
      </div>
      <div class="form-group">
        <label>Group / Stage</label>
        <div class="fixture-field">${escapeHtml(f.group)}</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Match Type</label>
        <div class="fixture-field">${f.matchType === 'League' ? 'League (3-way)' : 'Knockout (2-way)'}</div>
      </div>
      <div class="form-group">
        <label>Kickoff (Local)</label>
        <div class="fixture-field">📅 ${dateStr} · ${timeStr}</div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
      <span style="font-size:0.78rem; color:var(--text-muted);">Matchday ${f.matchday || '–'}</span>
      ${statusPill}
    </div>

    ${scoreBadge}
    ${actionHtml}
  `;
}

function matchLogPrev() {
  if (!fixturesData.length) return;
  fixturesCurrentIndex = Math.max(0, fixturesCurrentIndex - 1);
  renderMatchLog();
}

function matchLogNext() {
  if (!fixturesData.length) return;
  fixturesCurrentIndex = Math.min(fixturesData.length - 1, fixturesCurrentIndex + 1);
  renderMatchLog();
}

function matchLogJump() {
  const input = document.getElementById('matchLogJumpInput');
  if (!input || !fixturesData.length) return;
  const num = parseInt(input.value, 10);
  if (isNaN(num)) {
    fixturesCurrentIndex = findCurrentFixtureIndex();
  } else {
    const idx = fixturesData.findIndex(f => String(f.matchNumber) === String(num));
    fixturesCurrentIndex = idx >= 0 ? idx : Math.max(0, Math.min(fixturesData.length - 1, num - 1));
  }
  input.value = '';
  renderMatchLog();
}

async function createMatchFromFixture(index) {
  const f = fixturesData[index];
  if (!f) return;
  if (!confirm(`Create match: ${f.homeTeam} vs ${f.awayTeam}?\nKickoff: ${new Date(f.kickoff).toLocaleString()}`)) return;

  try {
    const response = await fetch('/api/admin/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        matchType: f.matchType,
        kickoff: f.kickoff,
        matchNumber: f.matchNumber,
        group: f.group
      })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(`❌ Error: ${data.error}`);
      return;
    }

    await loadDashboardData();
    renderMatchLog();
  } catch (err) {
    console.error('[FIXTURES] Error creating match:', err);
    alert('❌ Failed to connect to server.');
  }
}

// Download history logs as CSV file
async function downloadHistoryCSV() {
  try {
    const response = await fetch('/api/admin/history', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });

    if (!response.ok) throw new Error('Failed to fetch history');
    const history = await response.json();

    if (history.length === 0) {
      alert('No history records to download.');
      return;
    }

    const sorted = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    let csvContent = 'Timestamp,Action,Details,RecoveryData\n';

    const csvCell = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    sorted.forEach(h => {
      const dateStr = new Date(h.timestamp).toLocaleString();
      csvContent += `${csvCell(dateStr)},${csvCell(h.action)},${csvCell(h.details)},${csvCell(h.recoveryData)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `soccer_history_log_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Error downloading CSV:', err);
    alert('Failed to download CSV: ' + err.message);
  }
}
