// app.js

// State variables
let currentUsername = localStorage.getItem('soccer_prediction_username') || '';
let currentUserSecret = localStorage.getItem('soccer_prediction_secret') || '';
let currentUserIsAdmin = localStorage.getItem('soccer_prediction_is_admin') === 'true';
let adminPasscode = sessionStorage.getItem('admin_passcode') || '';
let matches = [];
let reportCardData = null;
let currentFilter = 'open'; // 'open' or 'past'
let activeTab = 'bracket';
let countdownInterval = null;
let pollInterval = null;

// Pending vote confirmation state
let pendingVoteMatchId = null;
let pendingVotePrediction = null;

// Match Log (football-data.org fixtures)
let fixturesData = [];
let fixturesCurrentIndex = 0;

// Tournament stages currently open for "Create Match" (admin-configurable)
let openMatchStages = ['GROUP_STAGE'];
let availableStages = [];

let globalRankings = {};

// Racing leaderboard chart state
let raceFrames = [];
let raceCurrentFrame = 0;
let racePlaying = false;
let raceIntervalHandle = null;
let raceMaxPoints = 1;
let raceRowsByName = new Map();
let raceScoringMatches = new Map();
const RACE_FRAME_DURATION_MS = 700;
const SEGMENT_PALETTE_SIZE = 10;
const MIN_SEGMENT_LABEL_FRACTION = 0.04;

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
const leaderboardCompareView = document.getElementById('leaderboardCompareView');
const leaderboardClimbView = document.getElementById('leaderboardClimbView');
const leaderboardReportsView = document.getElementById('leaderboardReportsView');
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
  loadEnvBadge();
  fetchRankings();

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

// Fetch environment info and show a STAGING/REVIEW pill in the header (no-op on prod)
function loadEnvBadge() {
  fetch('/api/env')
    .then(res => res.json())
    .then(data => {
      const pill = document.getElementById('envPill');
      if (!pill || !data) return;

      if (data.env === 'staging') {
        pill.textContent = 'STAGING';
        pill.classList.add('env-pill--staging');
      } else if (data.env === 'review') {
        pill.textContent = data.pr ? `REVIEW · PR #${data.pr}` : 'REVIEW';
        pill.classList.add('env-pill--review');
      } else {
        return; // prod (or unknown) — leave hidden
      }

      pill.style.display = 'inline-flex';
    })
    .catch(() => {}); // fetch failure is treated the same as prod — pill stays hidden
}

// Setup User Identification
function setupUser() {
  if (!currentUserSecret) {
    usernameModal.style.display = 'flex';
  } else {
    usernameModal.style.display = 'none';
    currentUserNameDisplay.textContent = currentUsername;
    updateAdminTabVisibility();
    const fantasyBtn = document.getElementById('fantasyBracketBtn');
    if (fantasyBtn) fantasyBtn.style.display = 'inline-flex';

    // Set lock badge on login without requiring the modal to be opened
    fetch('/api/fantasy-bracket', { headers: { 'x-user-secret': currentUserSecret } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const lockBadge = document.getElementById('fantasyLockBadge');
        if (lockBadge) lockBadge.style.display = data.locked ? 'inline' : 'none';
      })
      .catch(() => {});

    loadStages();
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
        switchTab('bracket');
      }
    }
  }
}

// Fetch which tournament stages are currently open (player-level read,
// no admin auth required) and update Predictions-tab visibility.
async function loadStages() {
  if (!currentUserSecret) return;
  try {
    const response = await fetch('/api/stages', {
      headers: { 'x-user-secret': currentUserSecret }
    });
    if (!response.ok) return;
    const data = await response.json();
    openMatchStages = data.openMatchStages || [];
    updatePredictionsTabVisibility();
  } catch (err) {
    console.error('Error loading stage settings:', err);
  }
}

function updatePredictionsTabVisibility() {
  // Tab visibility managed manually — no auto-hide logic.
}

// Start polling and timer updates
function startIntervals() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateAllTimers, 1000);

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (currentUserSecret) {
      loadDashboardData();
      loadStages();
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
  } else if (tabName === 'bracket') {
    renderBracketTab();
  } else if (tabName === 'results') {
    renderResults();
  } else if (tabName === 'leaderboard') {
    loadLeaderboard();
  } else if (tabName === 'admin') {
    checkAdminState();
    initializeDefaultKickoff();
  } else if (tabName === 'reportCard') {
    initReportCardTab();
  }
}

let reportCardTotalPlayers = 0;

async function initReportCardTab() {
  const select = document.getElementById('reportCardPlayerSelect');
  if (select.dataset.loaded !== 'true') {
    try {
      // /api/leaderboard is public (no auth gate) and always contains every
      // db.users entry — a complete, always-available player list for any
      // logged-in user, unlike the admin-only /api/admin/users route.
      const response = await fetch('/api/leaderboard', {
        headers: { 'x-user-secret': currentUserSecret }
      });
      if (!response.ok) throw new Error('Failed to load player list');
      const leaderboard = await response.json();
      const names = leaderboard.map(row => row.name).sort((a, b) => a.localeCompare(b));
      reportCardTotalPlayers = names.length;
      select.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      select.value = names.includes(currentUsername) ? currentUsername : names[0];
      select.dataset.loaded = 'true';
    } catch (err) {
      console.error('Failed to load player list:', err);
    }
  }
  loadReportCard(select.value || currentUsername);
}

async function loadReportCard(name) {
  if (!name) return;
  const list = document.getElementById('reportCardTableBody');
  list.innerHTML = `<div class="panini-back-empty">Loading ${escapeHtml(name)}'s card…</div>`;
  try {
    const response = await fetch(`/api/report-card/${encodeURIComponent(name)}`, {
      headers: { 'x-user-secret': currentUserSecret }
    });
    if (!response.ok) throw new Error('Failed to load report card');
    reportCardData = await response.json();
    renderReportCard(reportCardData);
  } catch (err) {
    console.error('Error loading report card:', err);
    list.innerHTML = `<div class="panini-back-empty">Failed to load report card.</div>`;
  }
}

// FUT-style rarity tier, derived from current rank (not a per-player hash).
// Top 3 are always "legend" (near-black faceted card) with a medal accent
// matching their exact rank; everyone else is bucketed into gold/silver/
// bronze by percentile among the remaining players, with the sharper slice
// of gold/silver getting a foil finish. Cutoffs are illustrative, not exact
// FUT thresholds — easy to retune if the group's size/shape changes a lot.
function reportCardTierForRank(rank, totalPlayers) {
  if (rank == null) return { tier: 'bronze', foil: false, medal: null };
  if (rank <= 3) {
    return { tier: 'legend', foil: false, medal: rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze' };
  }
  const pool = Math.max(totalPlayers - 3, 1);
  const pct = (rank - 3) / pool;
  if (pct <= 0.2) return { tier: 'gold', foil: true, medal: null };
  if (pct <= 0.45) return { tier: 'gold', foil: false, medal: null };
  if (pct <= 0.65) return { tier: 'silver', foil: true, medal: null };
  if (pct <= 0.85) return { tier: 'silver', foil: false, medal: null };
  return { tier: 'bronze', foil: false, medal: null };
}

const REPORT_CARD_TIER_ACCENTS = { gold: '#caa000', silver: '#909090', bronze: '#8a4b1f' };
const REPORT_CARD_MEDAL_ACCENTS = { gold: '#d4af37', silver: '#b7b7b7', bronze: '#b06a35' };

function renderReportCard(data) {
  const s = data.stats;
  const { tier, foil, medal } = reportCardTierForRank(s.currentRank, reportCardTotalPlayers);

  const front = document.getElementById('reportCardFront');
  front.classList.remove('tier-gold', 'tier-silver', 'tier-bronze', 'tier-legend', 'tier-foil');
  front.classList.add(`tier-${tier}`);
  if (foil) front.classList.add('tier-foil');

  // tier-legend is mirrored onto the shell too — that's where --card-clip
  // (the shape polygon) lives now, since the glow layer is a sibling of
  // .panini-front and needs the same shape from a common ancestor. The
  // medal glow itself also lives on the shell's .panini-front-glow child.
  const shell = document.getElementById('reportCardFrontShell');
  shell.classList.remove('tier-legend', 'medal-gold', 'medal-silver', 'medal-bronze');
  if (tier === 'legend') shell.classList.add('tier-legend');
  if (medal) shell.classList.add(`medal-${medal}`);

  // Set on the shared stage wrapper — both the front and back cards inherit
  // this, so the back card's accent matches the front's tier.
  const stage = document.getElementById('reportCardStage');
  stage.style.setProperty('--panini-border', medal ? REPORT_CARD_MEDAL_ACCENTS[medal] : REPORT_CARD_TIER_ACCENTS[tier]);

  const photo = document.getElementById('reportCardPhoto');
  const placeholder = document.getElementById('reportCardPhotoPlaceholder');
  if (data.photoUrl) {
    photo.src = data.photoUrl;
    photo.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    photo.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  // FUT-style rating block: current rank as the headline number ("#N"),
  // total points as the sub-label — swapped so rank (the number people
  // actually care about first) gets the big slot.
  document.getElementById('reportCardOVR').textContent = s.currentRank != null ? `#${s.currentRank}` : '—';
  document.getElementById('reportCardPos').textContent = `${s.totalPoints} PTS`;

  document.getElementById('reportCardName').textContent = data.name;

  const statCell = (label, value) => `
    <div class="fut-stat">
      <div class="fut-stat-label">${label}</div>
      <div class="fut-stat-value">${value}</div>
    </div>
  `;
  document.getElementById('reportCardStatsRow').innerHTML = [
    statCell('ACC', `${s.accuracy}%`),
    statCell('PRK', s.highestRank ?? '—'),
    statCell('CST', s.currentStreak),
    statCell('BST', s.bestStreak)
  ].join('');

  const titleEl = document.getElementById('reportCardTitle');
  titleEl.textContent = data.title ? `🎖️ ${data.title}` : 'Title pending…';
  titleEl.title = data.titleReason || '';

  const bestRankDateStr = s.highestRankDate
    ? new Date(s.highestRankDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const bestRankPill = s.highestRank != null
    ? `🏆 Best Rank <strong>#${s.highestRank}</strong> — ${bestRankDateStr} · held ${s.gamesAtHighestRank} game${s.gamesAtHighestRank === 1 ? '' : 's'}`
    : `🏆 Best Rank <strong>—</strong> not ranked yet`;
  const bestStreakRangeStr = (s.bestStreak > 0 && s.bestStreakStartMatch != null)
    ? (s.bestStreakStartMatch === s.bestStreakEndMatch
        ? `Match #${s.bestStreakStartMatch}`
        : `Match #${s.bestStreakStartMatch} → #${s.bestStreakEndMatch}`)
    : null;
  const bestStreakPill = s.bestStreak > 0
    ? `⚡ Best Streak <strong>${s.bestStreak}</strong> — ${bestStreakRangeStr}`
    : `⚡ Best Streak <strong>0</strong> — none yet`;

  document.getElementById('reportCardSupplement').innerHTML = `
    <div class="panini-supplement-pill">${bestRankPill}</div>
    <div class="panini-supplement-pill">${bestStreakPill}</div>
  `;

  const uploadSection = document.getElementById('reportCardUploadSection');
  uploadSection.style.display = (data.name === currentUsername) ? 'block' : 'none';

  renderReportCardTable(data.matches);
}

// Back of the card: top 5 highest-point-scoring games for this player
// (chronological ties broken by Array.sort's stability, earlier game first),
// rendered as compact stat rows rather than a table — a 300px-wide sticker
// has no room for a 6-column table.
function renderReportCardTable(rawMatches) {
  const list = document.getElementById('reportCardTableBody');
  const rows = rawMatches.slice().sort((a, b) => b.points - a.points).slice(0, 5);

  if (rows.length === 0) {
    list.innerHTML = `<div class="panini-back-empty">No matches yet.</div>`;
    return;
  }

  const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };

  list.innerHTML = rows.map(m => {
    const isResolved = m.status === 'resolved';

    const subParts = [];
    if (!isResolved) {
      subParts.push('Locked / Live');
    } else {
      subParts.push(m.pick ? (m.points > 0 ? 'Hit' : 'Miss') : 'No pick');
    }
    if (m.pick) {
      const pickTeam = m.pick === 'home' ? m.homeTeam : m.pick === 'away' ? m.awayTeam : 'Draw';
      subParts.push(escapeHtml(pickTeam) + (m.boosted ? ' ⚡' : ''));
    }
    if (m.bonusPick) subParts.push(bonusLabels[m.bonusPick] || m.bonusPick);

    const pointsClass = isResolved ? (m.points > 0 ? 'text-active' : 'error-text') : '';

    return `
      <div class="panini-back-row">
        <div class="panini-back-row-top">
          <span class="panini-back-match">${m.matchNumber ? '#' + m.matchNumber : '-'}</span>
          <span class="panini-back-matchup">${escapeHtml(m.homeTeam)} vs ${escapeHtml(m.awayTeam)}</span>
          <span class="panini-back-points ${pointsClass}">${isResolved ? '+' + m.points : '—'}</span>
        </div>
        <div class="panini-back-row-sub">${subParts.join(' · ')}</div>
      </div>
    `;
  }).join('');
}

// Downscales an image file client-side and re-encodes it as JPEG before
// upload, so a full-resolution phone photo (often 5-15MB) doesn't hit the
// server's 5MB limit. The photo only ever displays as a small circular
// avatar (and a 2x-scaled export), so 800px on the long edge is plenty.
function resizeImageFile(file, maxDimension = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the image file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load the image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          } else {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('Failed to process the image.'));
          const jpegName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], jpegName, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadReportCardPhoto() {
  const input = document.getElementById('reportCardPhotoInput');
  const messageEl = document.getElementById('reportCardUploadMessage');
  messageEl.textContent = '';
  messageEl.className = 'feedback-message';

  if (!input.files || input.files.length === 0) {
    messageEl.textContent = 'Choose a photo first.';
    messageEl.className = 'feedback-message error';
    return;
  }

  try {
    messageEl.textContent = 'Processing photo…';
    const resizedFile = await resizeImageFile(input.files[0]);
    const formData = new FormData();
    formData.append('photo', resizedFile);

    const response = await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { 'x-user-secret': currentUserSecret },
      body: formData
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');

    messageEl.textContent = 'Photo updated!';
    messageEl.className = 'feedback-message success';
    input.value = '';
    loadReportCard(currentUsername);
  } catch (err) {
    console.error('Error uploading photo:', err);
    messageEl.textContent = 'Failed to upload: ' + err.message;
    messageEl.className = 'feedback-message error';
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

function getCachedRankString(teamName) {
  if (!teamName) return '#-';
  const safeKey = teamName.toLowerCase().trim();
  const rank = globalRankings[safeKey];
  return rank ? `#${rank}` : '#-';
}

async function fetchRankings() {
  try {
    const response = await fetch('/api/ranking');
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    globalRankings = data || {};
    // persist for faster next-load
    try { localStorage.setItem('fifa_rankings', JSON.stringify(globalRankings)); } catch (_) {}
  } catch (error) {
    console.error('Error fetching rankings from Node backend:', error);
    globalRankings = (await getFallbackRankingData()) || {};
    // also try to load cached rankings from localStorage
    try {
      const cached = localStorage.getItem('fifa_rankings');
      if (cached) globalRankings = JSON.parse(cached);
    } catch (_) {}
  } finally {
    // update DOM without re-rendering all matches
    updateRankDisplays();
  }
}

function updateRankDisplays() {
  document.querySelectorAll('.team-rank,.bracket-rank').forEach(el => {
    const team = el.dataset.team;
    if (!team) return;
    el.textContent = getCachedRankString(team);
  });
}

async function getFallbackRankingData() {
  return {
    'argentina': 1, 'france': 2, 'brazil': 5, 'germany': 12,
    'spain': 3, 'italy': 15, 'england': 4, 'usa': 17, 'united states': 14,
    'portugal': 8, 'belgium': 10, 'netherlands': 7, 'uruguay': 18,
    'mexico': 9, 'canada': 31, 'croatia': 13, 'morocco': 6,
    'japan': 17, 'senegal': 19, 'switzerland': 16, 'denmark': 20,
    'colombia': 11, 'iran': 21, 'türkiye': 32, 'turkey': 22, 'australia': 26,
    'ecuador': 24, 'austria': 23, 'south korea': 30, 'nigeria': 25,
    'algeria': 28, 'egypt': 27, 'ukraine': 33, 'norway': 22,
    'ivory coast': 29, 'panama': 42, 'russia': 34, 'poland': 35,
    'wales': 38, 'sweden': 36, 'hungary': 39, 'czechia': 48,
    'paraguay': 37, 'scotland': 41, 'serbia': 40, 'cameroon': 43,
    'tunisia': 59, 'dr congo': 46, 'congo dr': 46, 'slovakia': 44, 'greece': 45,
    'qatar': 61, 'iraq': 60, 'south africa': 54,
    'saudi arabia': 58, 'jordan': 63, 'bosnia & herzegovina': 64, 'bosnia-herzegovina': 62,
    'cape verde': 67, 'cape verde islands': 64, 'curaçao': 82, 'ghana': 65, 'haiti': 88,
    'new zealand': 84, 'uzbekistan': 50
  };
}

function getTeamCountryCode(teamName) {
  const codes = {
    'argentina': 'ar', 'france': 'fr', 'brazil': 'br', 'germany': 'de',
    'spain': 'es', 'italy': 'it', 'england': 'gb-eng', 'usa': 'us', 'united states': 'us',
    'portugal': 'pt', 'belgium': 'be', 'netherlands': 'nl', 'uruguay': 'uy',
    'mexico': 'mx', 'canada': 'ca', 'croatia': 'hr', 'morocco': 'ma',
    'japan': 'jp', 'senegal': 'sn', 'switzerland': 'ch', 'denmark': 'dk',
    'colombia': 'co', 'iran': 'ir', 'türkiye': 'tr', 'turkey': 'tr', 'australia': 'au',
    'ecuador': 'ec', 'austria': 'at', 'south korea': 'kr', 'nigeria': 'ng',
    'algeria': 'dz', 'egypt': 'eg', 'ukraine': 'ua', 'norway': 'no',
    'ivory coast': 'ci', 'panama': 'pa', 'russia': 'ru', 'poland': 'pl',
    'wales': 'gb-wls', 'sweden': 'se', 'hungary': 'hu', 'czechia': 'cz',
    'paraguay': 'py', 'scotland': 'gb-sct', 'serbia': 'rs', 'cameroon': 'cm',
    'tunisia': 'tn', 'dr congo': 'cd', 'congo dr': 'cd', 'slovakia': 'sk', 'greece': 'gr',
    'qatar': 'qa', 'iraq': 'iq', 'south africa': 'za',
    'saudi arabia': 'sa', 'jordan': 'jo', 'bosnia & herzegovina': 'ba', 'bosnia-herzegovina': 'ba',
    'cape verde': 'cv', 'cape verde islands': 'cv', 'curaçao': 'cw', 'ghana': 'gh', 'haiti': 'ht',
    'new zealand': 'nz', 'uzbekistan': 'uz'
  };
  return codes[teamName.toLowerCase().trim()] || null;
}

// Fetch matches (requires passcode header)
const BOOSTER_STAGE_LABELS = {
  LAST_32:     'R32 Booster',
  LAST_16:     'R16 Booster',
  QF_SF_FINAL: 'QF/SF/Final Booster',
};

function updateBoosterDisplay() {
  const el = document.getElementById('boosterStatusDisplay');
  if (!el) return;

  const used = { LAST_32: false, LAST_16: false, QF_SF_FINAL: false };
  matches.forEach(match => {
    if (match.boosterStageCode && match.boosterStageUsed) {
      used[match.boosterStageCode] = true;
    }
  });

  el.innerHTML = Object.keys(BOOSTER_STAGE_LABELS).map(code =>
    `<span title="${BOOSTER_STAGE_LABELS[code]}" style="${used[code] ? 'opacity:0.25; filter:grayscale(1);' : ''}">⚡</span>`
  ).join('');
  el.style.display = 'inline-flex';
  el.style.alignItems = 'center';
}

function renderBoosterCell(stage, status) {
  if (!status) return '';
  const label = BOOSTER_STAGE_LABELS[stage] || 'Booster';
  if (status === 'used') {
    return `<span title="${label} — Used" style="opacity:0.25; filter:grayscale(1);">⚡</span>`;
  }
  return `<span title="${label} — Available">⚡</span>`;
}

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
    updateBoosterDisplay();

    if (activeTab === 'predictions') {
      renderMatches();
    } else if (activeTab === 'bracket') {
      renderBracketTab();
    } else if (activeTab === 'results') {
      renderResults();
    }
    
    if (activeTab === 'admin' && adminPasscode) {
      loadAdminMatches();
      loadAdminHistory();
      loadAdminVotes();
    }

    if (activeTab === 'leaderboard') {
      loadLeaderboard();
    }
    loadLiveMatches();
    // fetchRankings();
  } catch (err) {
    console.error('Error getting match data:', err);
  }
}

// Fetch and render the live match info panel above the leaderboard table
async function loadLiveMatches() {
  const panel = document.getElementById('liveMatchesPanel');
  if (!panel) return;
  try {
    const res = await fetch('/api/live-matches');
    if (!res.ok) { panel.style.display = 'none'; return; }
    const liveMatches = await res.json();
    if (liveMatches.length === 0) { panel.style.display = 'none'; return; }

    const statusTag = (status) => {
      if (status === 'IN_PLAY' || status === 'LIVE') return '<span class="live-match-status in-play"><span class="live-dot"></span>LIVE</span>';
      if (status === 'PAUSED')  return '<span class="live-match-status paused">HT</span>';
      return '<span class="live-match-status finished">FT</span>';
    };

    panel.style.display = '';
    panel.innerHTML = liveMatches.map(m => `
      <div class="live-match-card">
        <svg class="chase-border-svg" aria-hidden="true">
          <rect class="chase-rect" x="1" y="1" rx="7"/>
        </svg>
        <div class="live-match-inner">
          ${statusTag(m.status)}
          <div class="live-match-teams">
            <span>${buildFlagSpan(m.homeTeam, 'result-flag')} ${escapeHtml(m.homeTeam)}</span>
            <span class="live-match-score">${(() => {
              if (m.duration === 'PENALTY_SHOOTOUT' && m.regularTimeHome != null) {
                return `${m.regularTimeHome}(${m.scoreHome}) &mdash; ${m.regularTimeAway}(${m.scoreAway})`;
              }
              return `${m.scoreHome ?? '&ndash;'} &mdash; ${m.scoreAway ?? '&ndash;'}`;
            })()}</span>
            <span>${escapeHtml(m.awayTeam)} ${buildFlagSpan(m.awayTeam, 'result-flag')}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (_) {
    panel.style.display = 'none';
  }
}

// Fetch standings (includes provisional livePoints when matches are live)
async function loadLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    if (!response.ok) throw new Error('Failed to load leaderboard');
    const leaderboard = await response.json();

    const isLiveMode = leaderboard.some(p => (p.provisionalDelta || 0) > 0);

    // In live mode sort by livePoints; otherwise use the server-sorted order
    const sorted = isLiveMode
      ? [...leaderboard].sort((a, b) => {
          if (b.livePoints !== a.livePoints) return b.livePoints - a.livePoints;
          if (b.correct !== a.correct)       return b.correct - a.correct;
          return a.name.localeCompare(b.name);
        })
      : leaderboard;

    // Toggle live-mode styling on the table card
    const card = document.getElementById('leaderboardTableView');
    if (card) card.classList.toggle('live-mode', isLiveMode);

    // Update column header
    const ptsHeader = document.querySelector('#leaderboardTable th.col-points');
    if (ptsHeader) {
      ptsHeader.innerHTML = isLiveMode
        ? `<span class="th-full">Points (Live)</span><span class="th-short">Pts</span>`
        : `<span class="th-full">Total Points</span><span class="th-short">Pts</span>`;
    }

    leaderboardBody.innerHTML = '';

    if (sorted.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="8" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }

    // Baseline rank: sorted purely by points (no live delta), used in live mode
    // to compute how many spots each player has provisionally moved.
    const baseRanks = new Map(
      [...leaderboard].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.correct !== a.correct) return b.correct - a.correct;
        return a.name.localeCompare(b.name);
      }).map((p, i) => [p.name, i + 1])
    );

    sorted.forEach((player, index) => {
      const rank = index + 1;
      let rankClass = 'rank-other';
      if (rank === 1) rankClass = 'rank-1';
      else if (rank === 2) rankClass = 'rank-2';
      else if (rank === 3) rankClass = 'rank-3';

      const total    = player.totalPredictions || 0;
      const correct  = player.correct || 0;
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
      const pending  = player.liveNotVoted || 0;
      const pendingCell = pending > 0
        ? `<span class="pending-badge">${pending}</span>`
        : `<span class="pending-none">0</span>`;

      const delta      = player.provisionalDelta || 0;
      const displayPts = isLiveMode ? (player.livePoints ?? player.points) : player.points;
      const liveBadge  = isLiveMode && delta > 0
        ? `<span class="live-pts-badge">+${delta}&#9889;</span>`
        : '';

      let deltaRank;
      if (isLiveMode) {
        const baseRank = baseRanks.get(player.name);
        deltaRank = baseRank != null ? baseRank - (index + 1) : null;
      } else {
        deltaRank = player.prevRank != null ? player.prevRank - rank : null;
      }

      let movedText, movedClass;
      if (deltaRank === null)     { movedText = 'NEW';                      movedClass = 'move-new'; }
      else if (deltaRank > 0)     { movedText = `&#9650; ${deltaRank}`;     movedClass = 'move-up'; }
      else if (deltaRank < 0)     { movedText = `&#9660; ${Math.abs(deltaRank)}`; movedClass = 'move-down'; }
      else                        { movedText = '&#8212;';                  movedClass = 'move-same'; }

      const movedCell = `<span class="${movedClass}">${movedText}</span>`;

      const boosterCell = renderBoosterCell(player.boosterStage, player.boosterStatus);

      const row = document.createElement('tr');
      row.className = rankClass;
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-booster">${boosterCell}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-moved">${movedCell}</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${delta > 0 ? `<span class="pts-cell-inner">${liveBadge}<span class="pts-live">${displayPts}</span></span>` : displayPts}<span class="unit-label"> pts</span></td>
      `;
      leaderboardBody.appendChild(row);
    });
  } catch (err) {
    console.error('Error getting leaderboard:', err);
    leaderboardBody.innerHTML = `<tr><td colspan="8" class="loading-state error-text">Error loading standings.</td></tr>`;
  }
}

// Toggle between the Table and Race views in the Leaderboard tab
function switchLeaderboardView(view) {
  document.getElementById('leaderboardViewTableBtn').classList.toggle('active', view === 'table');
  document.getElementById('leaderboardViewRaceBtn').classList.toggle('active', view === 'race');
  document.getElementById('leaderboardViewCompareBtn').classList.toggle('active', view === 'compare');
  document.getElementById('leaderboardViewClimbBtn').classList.toggle('active', view === 'climb');
  document.getElementById('leaderboardViewReportsBtn').classList.toggle('active', view === 'reports');

  // Hide every view first, then show the chosen one
  leaderboardTableView.style.display = 'none';
  leaderboardRaceView.style.display = 'none';
  leaderboardCompareView.style.display = 'none';
  leaderboardClimbView.style.display = 'none';
  leaderboardReportsView.style.display = 'none';
  pauseRacePlayback();
  pauseClimbPlayback();

  if (view === 'table') {
    leaderboardTableView.style.display = '';
  } else if (view === 'race') {
    leaderboardRaceView.style.display = '';
    if (raceFrames.length === 0) {
      loadLeaderboardHistory();
    }
  } else if (view === 'compare') {
    leaderboardCompareView.style.display = '';
    loadRankingComparison();
  } else if (view === 'climb') {
    leaderboardClimbView.style.display = '';
    loadClimb();
  } else if (view === 'reports') {
    leaderboardReportsView.style.display = '';
    loadReports();
  }
}

// ===================== DAILY REPORT (latest match day · by stage · overall) =====================
let reportsFrames = [];

async function loadReports() {
  try {
    if (reportsFrames.length === 0) {
      const res = await fetch('/api/leaderboard/history');
      if (!res.ok) throw new Error('Failed to load leaderboard history');
      reportsFrames = await res.json();
    }
    renderReports();
    renderJourney();
    renderStreaks();
    renderDailyWinners();
    const stamp = `Sports Unlimited · FIFA 2026 Fun Prediction · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
    document.querySelectorAll('.snap-footer').forEach(f => { f.textContent = stamp; });
  } catch (err) {
    console.error('Error loading reports:', err);
  }
}

// Top 10 longest winning streaks (consecutive matches a player scored on / predicted correctly)
function renderStreaks() {
  const frames = reportsFrames;
  const el = document.getElementById('streaksBody');
  if (!frames || frames.length < 2) { el.innerHTML = '<div class="stage-upcoming">No matches resolved yet.</div>'; return; }

  const maps = frames.map(f => { const m = {}; if (f) f.standings.forEach(s => { m[s.name] = s.points; }); return m; });
  const names = new Set();
  frames.forEach(f => f.standings.forEach(s => names.add(s.name)));

  const results = [];
  names.forEach(name => {
    let cur = 0, curStart = null, best = 0, bestStart = null, bestEnd = null;
    for (let i = 1; i < frames.length; i++) {
      const scored = (maps[i][name] || 0) > (maps[i - 1][name] || 0); // gained points => correct pick
      if (scored) {
        if (cur === 0) curStart = frames[i].matchNumber;
        cur++;
        if (cur > best) { best = cur; bestStart = curStart; bestEnd = frames[i].matchNumber; }
      } else { cur = 0; }
    }
    results.push({ name, streak: best, from: bestStart, to: bestEnd });
  });
  results.sort((a, b) => (b.streak - a.streak) || a.name.localeCompare(b.name));
  const top = results.filter(r => r.streak > 0).slice(0, 10);

  document.getElementById('streaksIntro').textContent = 'Longest runs of consecutive correct predictions (in match order). Top 10.';
  if (top.length === 0) { el.innerHTML = '<div class="stage-upcoming">No streaks yet.</div>'; return; }
  el.innerHTML = top.map((r, idx) => `<div class="streak-row${idx === 0 ? ' top1' : ''}"><span class="streak-rank">${idx + 1}</span><span class="streak-name">${escapeHtml(r.name)}</span><span class="streak-len">🔥 ${r.streak} in a row</span><span class="streak-range">#${r.from}–#${r.to}</span></div>`).join('');
}

// Switch between the Reports sub-tabs (Hall of Fame / Journey)
function switchReportSub(sub) {
  document.getElementById('reportSubHofBtn').classList.toggle('active', sub === 'hof');
  document.getElementById('reportSubJourneyBtn').classList.toggle('active', sub === 'journey');
  document.getElementById('reportSubStreaksBtn').classList.toggle('active', sub === 'streaks');
  document.getElementById('reportSubDailyBtn').classList.toggle('active', sub === 'daily');
  document.getElementById('reportHofView').style.display = sub === 'hof' ? '' : 'none';
  document.getElementById('reportJourneyView').style.display = sub === 'journey' ? '' : 'none';
  document.getElementById('reportStreaksView').style.display = sub === 'streaks' ? '' : 'none';
  document.getElementById('reportDailyView').style.display = sub === 'daily' ? '' : 'none';
}

// Daily Winners: top 3 point gainers for each completed match day
function renderDailyWinners() {
  const allFrames = reportsFrames;
  const el = document.getElementById('dailyWinnersBody');
  const intro = document.getElementById('dailyIntro');
  if (!allFrames || allFrames.length === 0) {
    intro.textContent = 'Daily winners will appear once matches start resolving.';
    el.innerHTML = '<tr><td colspan="4" class="stage-upcoming">No matches resolved yet.</td></tr>';
    return;
  }

  const validFrames = allFrames.filter(f => f.matchNumber != null).slice().sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  if (validFrames.length === 0) {
    intro.textContent = 'Daily winners will appear once matches start resolving.';
    el.innerHTML = '<tr><td colspan="4" class="stage-upcoming">No matches resolved yet.</td></tr>';
    return;
  }

  const dayKey = (when) => {
    const DAY_START_HOUR = 6;
    const d = new Date(new Date(when).getTime() - DAY_START_HOUR * 3600 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayLabel = (day) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const mapOf = (f) => { const m = {}; if (f) f.standings.forEach(s => { m[s.name] = s.points; }); return m; };

  const grouped = {};
  validFrames.forEach((frame) => {
    const key = dayKey(frame.kickoff);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(frame);
  });

  const dayKeys = Object.keys(grouped).sort().reverse();
  const rows = [];

  const formatPlace = (group) => {
    if (!group || group.players.length === 0) return '—';
    const names = group.players.map(escapeHtml).join(', ');
    return `${names} (${group.pts} pts)`;
  };

  const tally = (group, counts) => {
    if (!group || group.players.length === 0) return;
    group.players.forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
  };

  const placeCounts = [{}, {}, {}];

  dayKeys.forEach((day) => {
    const framesForDay = grouped[day];
    const firstFrame = framesForDay[0];
    const lastFrame = framesForDay[framesForDay.length - 1];
    const firstIndex = validFrames.indexOf(firstFrame);
    const prevMap = firstIndex > 0 ? mapOf(validFrames[firstIndex - 1]) : {};
    const dayMap = mapOf(lastFrame);
    const gains = Object.entries(dayMap).map(([name, pts]) => ({ name, pts: pts - (prevMap[name] || 0) }));
    const ranked = gains
      .filter(r => r.pts > 0)
      .sort((a, b) => (b.pts - a.pts) || a.name.localeCompare(b.name));

    const groups = [];
    ranked.forEach((entry) => {
      if (!groups.length || groups[groups.length - 1].pts !== entry.pts) {
        if (groups.length < 3) {
          groups.push({ pts: entry.pts, players: [entry.name] });
        }
      } else {
        groups[groups.length - 1].players.push(entry.name);
      }
    });

    const place1 = groups[0] || null;
    const place2 = groups[1] || null;
    const place3 = groups[2] || null;

    tally(place1, placeCounts[0]);
    tally(place2, placeCounts[1]);
    tally(place3, placeCounts[2]);

    rows.push(`
      <tr>
        <td>${dayLabel(day)}</td>
        <td>${formatPlace(place1)}</td>
        <td>${formatPlace(place2)}</td>
        <td>${formatPlace(place3)}</td>
      </tr>
    `);
  });

  const formatTopCount = (counts) => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return { names: 'None yet.', count: 0 };
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = entries[0][1];
    const winners = entries.filter(([, cnt]) => cnt === top).map(([name]) => escapeHtml(name));
    return { names: winners.join(', '), count: top };
  };

  const renderAggregateCards = (placeCounts) => {
    const places = [
      { title: 'Most 1sts', rank: '1st Place', icon: '🥇', style: 'p1', data: formatTopCount(placeCounts[0]) },
      { title: 'Most 2nds', rank: '2nd Place', icon: '🥈', style: 'p2', data: formatTopCount(placeCounts[1]) },
      { title: 'Most 3rds', rank: '3rd Place', icon: '🥉', style: 'p3', data: formatTopCount(placeCounts[2]) }
    ];

    return places.map(place => {
      const countText = place.data.count ? `${place.data.count} ${place.data.count === 1 ? 'day' : 'days'}` : 'No days yet';
      return `
        <div class="podium-card ${place.style}">
          <div class="podium-medal">${place.icon}</div>
          <div class="podium-rank">${place.rank}</div>
          <div class="podium-name">${place.title}</div>
          <div class="podium-name" style="margin-top: 6px; font-size: 0.95rem; color: var(--text-muted);">${place.data.names}</div>
          <div class="podium-pts">${countText}</div>
        </div>
      `;
    }).join('');
  };

  const aggregateEl = document.getElementById('dailyAggregate');
  aggregateEl.innerHTML = renderAggregateCards(placeCounts);

  intro.textContent = 'Daily top gainers by completed match day. One row per day with the top three ranks in separate columns.';
  if (rows.length === 0) {
    el.innerHTML = '<tr><td colspan="4" class="stage-upcoming">No winning days yet.</td></tr>';
  } else {
    el.innerHTML = rows.join('');
  }
}

// Journey: who was FIRST to reach each points milestone (50, 100, 150, …)
function renderJourney() {
  const frames = reportsFrames;
  const el = document.getElementById('journeyTimeline');
  if (!frames || frames.length === 0) { el.innerHTML = ''; return; }
  const mapOf = (f) => { const m = {}; if (f) f.standings.forEach(s => { m[s.name] = s.points; }); return m; };

  const STEP = 50;
  const maxPts = Object.values(mapOf(frames[frames.length - 1])).reduce((a, b) => Math.max(a, b), 0);
  const milestones = [];
  for (let t = STEP; t <= maxPts + STEP; t += STEP) milestones.push(t); // reached ones + the next (upcoming)

  // First THREE players to cross each threshold, in the order they did it.
  const achieved = {};
  milestones.forEach(t => { achieved[t] = []; });
  for (let i = 1; i < frames.length; i++) {
    const before = mapOf(frames[i - 1]), after = mapOf(frames[i]);
    Object.keys(after).forEach(name => {
      const b = before[name] || 0, a = after[name];
      milestones.forEach(t => {
        if (b < t && a >= t && achieved[t].length < 3) achieved[t].push({ name, matchNumber: frames[i].matchNumber, kickoff: frames[i].kickoff });
      });
    });
  }

  document.getElementById('journeyIntro').textContent = `The first three players to reach each ${STEP}-point milestone — and when.`;
  const medals = ['🥇', '🥈', '🥉'];
  el.innerHTML = '';
  milestones.forEach(t => {
    const crossers = achieved[t];
    const item = document.createElement('div');
    item.className = 'journey-item' + (crossers.length ? '' : ' journey-upcoming');
    if (crossers.length) {
      const list = crossers.map((c, idx) => {
        const date = c.kickoff ? new Date(c.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        return `<div class="journey-crosser"><span class="jc-medal">${medals[idx]}</span><span class="jc-name">${escapeHtml(c.name)}</span><span class="jc-meta">Match #${c.matchNumber}${date ? ' · ' + date : ''}</span></div>`;
      }).join('');
      item.innerHTML = `<div class="journey-dot">🏁</div><div class="journey-body"><div class="journey-ms">${t} pts</div>${list}</div>`;
    } else {
      item.innerHTML = `<div class="journey-dot">⏳</div><div class="journey-body"><div class="journey-ms">${t} pts</div><div class="journey-pending">Not reached yet</div></div>`;
    }
    el.appendChild(item);
  });
}

function renderReports() {
  const allFrames = reportsFrames;
  if (!allFrames || allFrames.length === 0) return;

  const mapOf = (f) => { const m = {}; if (f) f.standings.forEach(s => { m[s.name] = s.points; }); return m; };

  // A "match day" runs 6 AM -> 6 AM (local), so late-night / just-after-midnight
  // games count toward the night before. Kickoffs are stored in UTC; shifting by
  // the local-time -6h and reading the local date handles both tz and the cutoff.
  const DAY_START_HOUR = 6;
  const dayKey = (when) => { const d = new Date(new Date(when).getTime() - DAY_START_HOUR * 3600 * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayOf = (f) => dayKey(f.kickoff);

  // "Previous day" = the most recent match day strictly before today's match day.
  const todayKey = dayKey(new Date());
  const matchDays = [...new Set(allFrames.filter(f => f.matchNumber != null).map(dayOf))].sort();
  const previousDay = [...matchDays].reverse().find(d => d < todayKey) || (matchDays.length ? matchDays[matchDays.length - 1] : null);

  // Freeze the board "as of the previous day": ignore any current-day matches,
  // so it doesn't change as today's games come in.
  const frames = allFrames.filter(f => f.matchNumber == null || dayOf(f) <= previousDay);

  const cumAfter = (n) => { let last = null; for (const f of frames) { if (f.matchNumber != null && parseInt(f.matchNumber, 10) <= n) last = f; } return mapOf(last); };

  // Dense ranking: tied points share a rank; the next distinct score is the next
  // rank (e.g. 12,12,10 -> ranks 1,1,2). Keep entries up to maxRank.
  const rankedTop = (map, maxRank) => {
    const arr = Object.entries(map).map(([name, pts]) => ({ name, pts })).sort((a, b) => (b.pts - a.pts) || a.name.localeCompare(b.name));
    const out = []; let rank = 0, prev = null;
    for (const e of arr) { if (e.pts !== prev) { rank++; prev = e.pts; } if (rank > maxRank) break; out.push({ name: e.name, pts: e.pts, rank }); }
    return out;
  };
  // Group tied players (same rank) into one entry: { rank, pts, names: [...] }
  const groupedTop = (map, maxRank) => {
    const byRank = {};
    rankedTop(map, maxRank).forEach(e => { if (!byRank[e.rank]) byRank[e.rank] = { rank: e.rank, pts: e.pts, names: [] }; byRank[e.rank].names.push(e.name); });
    return Object.values(byRank).sort((a, b) => a.rank - b.rank);
  };

  // ---- Overall (as of previous day) ----
  renderPodium('reportOverall', groupedTop(mapOf(frames[frames.length - 1]), 3));

  // ---- Previous day ----
  const pd = {};
  if (previousDay) {
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].matchNumber != null && dayOf(frames[i]) === previousDay) {
        const cur = mapOf(frames[i]), prev = mapOf(frames[i - 1]);
        Object.keys(cur).forEach(k => { pd[k] = (pd[k] || 0) + (cur[k] - (prev[k] || 0)); });
      }
    }
  }
  document.getElementById('reportPrevDate').textContent = previousDay
    ? '· ' + new Date(previousDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
  renderPodium('reportPrevDay', groupedTop(pd, 3));

  // ---- Intro context line ----
  const lastN = frames.length ? frames[frames.length - 1].matchNumber : null;
  document.getElementById('reportIntro').textContent =
    `Standings as of the previous day's completed matches${lastN ? ' — through Match #' + lastN : ''}. Current-day matches are not counted until the day is over.`;

  // ---- By stage (as of previous day) ----
  const stages = [
    { label: 'League — Round 1', sub: 'Matches 1–24', lo: 1, hi: 24 },
    { label: 'League — Round 2', sub: 'Matches 25–48', lo: 25, hi: 48 },
    { label: 'League — Round 3', sub: 'Matches 49–72', lo: 49, hi: 72 },
    { label: 'Round of 32', sub: 'Matches 73–88', lo: 73, hi: 88 },
    { label: 'Round of 16', sub: 'Matches 89–96', lo: 89, hi: 96 },
    { label: 'QF to Finals', sub: 'Matches 97–104', lo: 97, hi: 104 },
  ];
  const wrap = document.getElementById('reportStages');
  wrap.innerHTML = '';
  stages.forEach(st => {
    const block = document.createElement('div');
    block.className = 'stage-block';
    const resolvedCount = frames.filter(f => f.matchNumber != null && parseInt(f.matchNumber, 10) >= st.lo && parseInt(f.matchNumber, 10) <= st.hi).length;
    const expected = st.hi - st.lo + 1;
    let badge, rows = '';
    if (resolvedCount === 0) {
      badge = '<span class="stage-state state-upcoming">⏳ Upcoming</span>';
    } else {
      const hiM = cumAfter(st.hi), loM = cumAfter(st.lo - 1);
      const delta = {};
      Object.keys(hiM).forEach(k => { delta[k] = hiM[k] - (loM[k] || 0); });
      rows = groupedTop(delta, 3).map(g => `<div class="stage-row"><span class="stage-rank r${g.rank}">${g.rank}</span><span class="stage-name">${escapeHtml(g.names.join(', '))}</span><span class="stage-pts">${g.pts} pts</span></div>`).join('');
      badge = resolvedCount >= expected
        ? '<span class="stage-state state-done">✓ Complete</span>'
        : `<span class="stage-state state-live">🔄 In progress (${resolvedCount}/${expected})</span>`;
    }
    block.innerHTML = `<div class="stage-title">${st.label} <span class="stage-sub">${st.sub}</span></div>${badge}${rows}`;
    wrap.appendChild(block);
  });
}

function renderPodium(elId, groups) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (!groups || groups.length === 0) { el.innerHTML = '<div class="stage-upcoming">No points yet</div>'; return; }
  const medals = ['🥇', '🥈', '🥉'];
  groups.forEach(g => {
    const c = document.createElement('div');
    c.className = 'podium-card p' + g.rank;
    c.innerHTML = `<div class="podium-medal">${medals[g.rank - 1] || '🎖️'}</div><div class="podium-rank">Rank ${g.rank}</div><div class="podium-name">${escapeHtml(g.names.join(', '))}</div><div class="podium-pts">${g.pts} pts</div>`;
    el.appendChild(c);
  });
}

// Export the currently-visible leaderboard view (table / chart / compare) as a PNG
async function saveLeaderboardImage() {
  let el, name;
  if (leaderboardCompareView.style.display !== 'none') { el = leaderboardCompareView; name = 'comparison'; }
  else if (leaderboardRaceView.style.display !== 'none') { el = leaderboardRaceView; name = 'race-chart'; }
  else if (leaderboardClimbView.style.display !== 'none') { el = leaderboardClimbView; name = 'climb'; }
  else if (leaderboardReportsView.style.display !== 'none') {
    // Capture only the active sub-view (so the sub-tab bar / other tab isn't in the image)
    const journeyView = document.getElementById('reportJourneyView');
    const streaksView = document.getElementById('reportStreaksView');
    if (journeyView.style.display !== 'none') { el = journeyView; name = 'journey'; }
    else if (streaksView.style.display !== 'none') { el = streaksView; name = 'streaks'; }
    else { el = document.getElementById('reportHofView'); name = 'hall-of-fame'; }
  }
  else { el = leaderboardTableView; name = 'standings'; }

  if (typeof html2canvas !== 'function') {
    alert('Image tool is still loading — please try again in a moment.');
    return;
  }

  const btn = document.getElementById('leaderboardSaveImgBtn');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const canvas = await html2canvas(el, { backgroundColor: '#07130b', scale: 2, useCORS: true });
    const link = document.createElement('a');
    link.download = `fifa-${name}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Image export failed:', err);
    alert('Sorry, could not create the image.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ===================== MOUNTAIN CLIMB (animated standings over time) =====================
let climbFrames = [];
let climbCurrent = 0;
let climbMaxPoints = 1;
let climbPlaying = false;
let climbTimer = null;
let climbByName = new Map();
let climbSelected = new Set(); // when non-empty, only these climbers are shown (head-to-head)

// Stable colour + initials generated from a player's name (no uploads needed)
function climberColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 55%)`;
}
function climberInitials(name) {
  const parts = name.trim().split(/\s+/);
  const a = parts[0] ? parts[0][0] : '';
  const b = parts[1] ? parts[1][0] : '';
  return (a + b).toUpperCase();
}

async function loadClimb() {
  try {
    const res = await fetch('/api/leaderboard/history');
    if (!res.ok) throw new Error('Failed to load leaderboard history');
    climbFrames = await res.json();

    climbMaxPoints = 1;
    climbFrames.forEach(f => f.standings.forEach(p => { if (p.points > climbMaxPoints) climbMaxPoints = p.points; }));

    const scrubber = document.getElementById('climbScrubber');
    const hasMatches = climbFrames.length > 1;
    document.getElementById('climbEmptyState').style.display = hasMatches ? 'none' : '';
    document.getElementById('climbPlayPauseBtn').disabled = !hasMatches;
    scrubber.disabled = !hasMatches;
    scrubber.max = String(Math.max(climbFrames.length - 1, 0));

    buildClimbPicker();
    buildClimbers();
    climbCurrent = climbFrames.length - 1;
    scrubber.value = String(climbCurrent);
    renderClimbFrame(climbCurrent);
  } catch (err) {
    console.error('Error loading climb:', err);
  }
}

// Build the selectable name chips so users can compare just a few climbers head-to-head
function buildClimbPicker() {
  const picker = document.getElementById('climbPicker');
  if (!picker) return;
  picker.innerHTML = '';
  const latest = climbFrames[climbFrames.length - 1];
  if (!latest) return;

  const allChip = document.createElement('button');
  allChip.className = 'climb-chip' + (climbSelected.size === 0 ? ' active' : '');
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => { climbSelected.clear(); refreshClimb(); });
  picker.appendChild(allChip);

  latest.standings.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'climb-chip' + (climbSelected.has(p.name) ? ' active' : '');
    chip.textContent = p.name;
    chip.addEventListener('click', () => {
      if (climbSelected.has(p.name)) climbSelected.delete(p.name);
      else climbSelected.add(p.name);
      refreshClimb();
    });
    picker.appendChild(chip);
  });
}

// Rebuild the chips + climbers after a selection change
function refreshClimb() {
  buildClimbPicker();
  buildClimbers();
  renderClimbFrame(climbCurrent);
}

// Create one climber per player, using the start frame for stable horizontal lanes
function buildClimbers() {
  const mountain = document.getElementById('climbMountain');
  mountain.querySelectorAll('.climber').forEach(el => el.remove());
  climbByName = new Map();

  const start = climbFrames[0];
  if (!start) return;

  let lane;
  if (climbSelected.size > 0) {
    // User picked specific climbers to compare head-to-head
    lane = start.standings.filter(p => climbSelected.has(p.name));
  } else if (window.matchMedia('(max-width: 600px)').matches) {
    // Narrow screen: show only the top 10 (by latest standings) to avoid crowding
    const latest = climbFrames[climbFrames.length - 1];
    const allowed = new Set(latest.standings.slice(0, 10).map(p => p.name));
    lane = start.standings.filter(p => allowed.has(p.name));
  } else {
    lane = start.standings;
  }

  const n = lane.length;
  lane.forEach((p, i) => {
    const left = n > 1 ? (8 + (i / (n - 1)) * 84) : 50;
    const el = document.createElement('div');
    el.className = 'climber';
    el.style.left = left + '%';
    el.style.bottom = '5%';
    el.innerHTML = `
      <div class="climber-avatar" style="background:${climberColor(p.name)}">${escapeHtml(climberInitials(p.name))}</div>
      <div class="climber-name">${escapeHtml(p.name)}</div>
    `;
    mountain.appendChild(el);
    climbByName.set(p.name, el);
  });
}

// Re-flow the climbers if the screen crosses the mobile/desktop breakpoint (e.g. rotation)
let climbResizeTimer = null;
window.addEventListener('resize', () => {
  if (leaderboardClimbView && leaderboardClimbView.style.display !== 'none' && climbFrames.length) {
    clearTimeout(climbResizeTimer);
    climbResizeTimer = setTimeout(() => { buildClimbers(); renderClimbFrame(climbCurrent); }, 250);
  }
});

// Position each climber for a given frame; the CSS transition animates the climb
function renderClimbFrame(index) {
  const frame = climbFrames[index];
  if (!frame) return;
  document.getElementById('climbFrameLabel').textContent = frame.matchNumber
    ? `Match ${frame.matchNumber}: ${frame.homeTeam} vs ${frame.awayTeam}`
    : 'Start';
  document.getElementById('climbDateLabel').textContent = frame.kickoff
    ? new Date(frame.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  document.getElementById('climbScrubber').value = String(index);

  frame.standings.forEach(p => {
    const el = climbByName.get(p.name);
    if (!el) return;
    const pct = 5 + (p.points / climbMaxPoints) * 80;
    el.style.bottom = pct + '%';
    el.title = `${p.name} — ${p.points} pts`;
  });
}

function toggleClimbPlayback() {
  if (climbPlaying) { pauseClimbPlayback(); return; }
  if (climbCurrent >= climbFrames.length - 1) { climbCurrent = 0; renderClimbFrame(0); }
  climbPlaying = true;
  document.getElementById('climbPlayPauseBtn').innerHTML = '&#10074;&#10074;';
  climbTimer = setInterval(() => {
    if (climbCurrent >= climbFrames.length - 1) { pauseClimbPlayback(); return; }
    climbCurrent++;
    renderClimbFrame(climbCurrent);
  }, 1100);
}

function pauseClimbPlayback() {
  climbPlaying = false;
  if (climbTimer) { clearInterval(climbTimer); climbTimer = null; }
  const btn = document.getElementById('climbPlayPauseBtn');
  if (btn) btn.innerHTML = '&#9654;';
}

function onClimbScrubberInput() {
  pauseClimbPlayback();
  climbCurrent = parseInt(document.getElementById('climbScrubber').value, 10) || 0;
  renderClimbFrame(climbCurrent);
}

// ===================== RANKING COMPARISON (pick any two matches) =====================
// Uses the same history feed as the race chart. Defaults to the immediate
// previous match vs the current one, but the user can compare any two snapshots.
let compareFrames = [];

// Friendly label for a history frame ("Start" or "Match 5: A vs B")
function compareFrameLabel(frame) {
  return frame.matchNumber
    ? `Match ${frame.matchNumber}: ${frame.homeTeam} vs ${frame.awayTeam}`
    : 'Start';
}

async function loadRankingComparison() {
  const header = document.getElementById('compareHeader');
  const container = document.getElementById('compareBody');
  const controls = document.getElementById('compareControls');
  container.innerHTML = '<p class="loading-state">Loading comparison...</p>';

  try {
    const response = await fetch('/api/leaderboard/history');
    if (!response.ok) throw new Error('Failed to load leaderboard history');
    compareFrames = await response.json();

    // frames[0] is the "Start" snapshot; need two snapshots to compare.
    if (compareFrames.length < 2) {
      header.textContent = '';
      controls.style.display = 'none';
      container.innerHTML = '<tr><td colspan="7" class="loading-state">Not enough resolved matches yet to compare rankings.</td></tr>';
      return;
    }

    // Populate both pickers with one option per frame
    const opts = compareFrames
      .map((f, i) => `<option value="${i}">${escapeHtml(compareFrameLabel(f))}</option>`)
      .join('');
    const fromSel = document.getElementById('compareFrom');
    const toSel = document.getElementById('compareTo');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;

    // Default: immediate previous -> current
    fromSel.value = String(compareFrames.length - 2);
    toSel.value = String(compareFrames.length - 1);
    controls.style.display = '';

    renderComparison();
  } catch (err) {
    console.error('Error loading ranking comparison:', err);
    container.innerHTML = '<p class="loading-state error-text">Error loading comparison.</p>';
  }
}

// Sort state for the comparison table
let compareSortKey = 'currRank';
let compareSortDir = 1; // 1 = ascending, -1 = descending

// Header click: toggle direction if same column, else pick a sensible default
function sortComparison(key) {
  if (compareSortKey === key) {
    compareSortDir = -compareSortDir;
  } else {
    compareSortKey = key;
    // ranks read low->high; points & changes read high->low by default
    compareSortDir = (key === 'name' || key === 'prevRank' || key === 'currRank') ? 1 : -1;
  }
  renderComparison();
}

// Render the movement between the two currently-selected frames as a sortable table
function renderComparison() {
  const header = document.getElementById('compareHeader');
  const body = document.getElementById('compareBody');
  let fromIdx = parseInt(document.getElementById('compareFrom').value, 10);
  let toIdx = parseInt(document.getElementById('compareTo').value, 10);
  if (isNaN(fromIdx) || isNaN(toIdx)) return;

  // Always read earlier -> later, regardless of which box the user set
  if (fromIdx > toIdx) { const t = fromIdx; fromIdx = toIdx; toIdx = t; }
  if (fromIdx === toIdx) {
    header.innerHTML = 'Pick two different matches to see the movement between them.';
    body.innerHTML = '<tr><td colspan="7" class="loading-state">—</td></tr>';
    return;
  }

  const from = compareFrames[fromIdx];
  const to = compareFrames[toIdx];

  // standings are already sorted best-first, so the array index gives the rank
  const fromMap = new Map();
  from.standings.forEach((p, i) => fromMap.set(p.name, { rank: i + 1, points: p.points }));

  const labelOf = (frame) => frame.matchNumber
    ? `Match ${frame.matchNumber} (${escapeHtml(frame.homeTeam)} vs ${escapeHtml(frame.awayTeam)})`
    : 'the start';
  header.innerHTML = `Movement from <strong>${labelOf(from)}</strong> to <strong>${labelOf(to)}</strong>`;

  // Build one row of data per player
  const rows = to.standings.map((p, i) => {
    const prev = fromMap.get(p.name);
    const prevRank = prev ? prev.rank : null;
    const prevPoints = prev ? prev.points : 0;
    const currRank = i + 1;
    return {
      name: p.name,
      prevRank, prevPoints,
      currRank, currPoints: p.points,
      deltaPts: p.points - prevPoints,
      deltaRank: prevRank == null ? null : (prevRank - currRank) // positive = climbed
    };
  });

  // Sort by the chosen column (new players with no previous rank sink to the bottom)
  rows.sort((a, b) => {
    if (compareSortKey === 'name') return compareSortDir * a.name.localeCompare(b.name);
    let av = a[compareSortKey], bv = b[compareSortKey];
    if (av == null) av = -Infinity;
    if (bv == null) bv = -Infinity;
    return compareSortDir * (av - bv);
  });

  body.innerHTML = '';
  rows.forEach(r => {
    let move, moveClass;
    if (r.deltaRank == null) { move = 'NEW'; moveClass = 'move-new'; }
    else if (r.deltaRank > 0) { move = `▲ ${r.deltaRank}`; moveClass = 'move-up'; }
    else if (r.deltaRank < 0) { move = `▼ ${Math.abs(r.deltaRank)}`; moveClass = 'move-down'; }
    else { move = '—'; moveClass = 'move-same'; }

    const gainClass = r.deltaPts > 0 ? 'move-up' : (r.deltaPts < 0 ? 'move-down' : 'move-same');
    const gainText = r.deltaPts > 0 ? `+${r.deltaPts}` : String(r.deltaPts);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="compare-name">${escapeHtml(r.name)}</td>
      <td class="sort-num">${r.prevRank == null ? '—' : r.prevRank}</td>
      <td class="sort-num">${r.prevPoints}</td>
      <td class="sort-num"><strong>${r.currRank}</strong></td>
      <td class="sort-num">${r.currPoints}</td>
      <td class="sort-num ${gainClass}">${gainText}</td>
      <td class="sort-num compare-move ${moveClass}">${move}</td>
    `;
    body.appendChild(tr);
  });
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

    raceScoringMatches = buildRaceScoringMatches(raceFrames);

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

// Turn leaderboard history frames into a per-player ordered list of
// "scoring matches" — the matches that earned that player points, in
// chronological (frame) order. Drives the stacked bar segments below.
function buildRaceScoringMatches(frames) {
  const result = new Map();
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    const matchPoints = frame.matchPoints || {};
    Object.keys(matchPoints).forEach(playerName => {
      if (!result.has(playerName)) result.set(playerName, []);
      result.get(playerName).push({
        frameIndex,
        matchNumber: frame.matchNumber,
        homeTeam: frame.homeTeam,
        awayTeam: frame.awayTeam,
        kickoff: frame.kickoff,
        outcome: frame.outcome,
        score: frame.score,
        points: matchPoints[playerName]
      });
    });
  }
  return result;
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
      <span class="race-row-chevron">&#9656;</span>
      <div class="race-row-stage-panel" style="display:none;"></div>
    `;
    row.onclick = (e) => onRaceRowClick(e, row, player.name);
    raceBars.appendChild(row);
    raceRowsByName.set(player.name, row);
  });
}

// Build the colored, per-match <div> segments for one player's stage bar:
// every scoring match within [stage.lo, stage.hi], up to (and including)
// the given frame index, with each segment's label-visibility threshold
// evaluated against that player's own total for the stage (not the
// all-time raceMaxPoints, and not other players' totals) — the bar is
// always filled to 100% width, so a segment's share of stageTotalPoints
// is exactly its share of the bar's width.
function buildStageSegmentsHtml(playerName, frameIndex, stage, stageTotalPoints) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  return scoringMatches
    .filter(m => m.frameIndex <= frameIndex)
    .filter(m => {
      const n = parseInt(m.matchNumber, 10);
      return n >= stage.lo && n <= stage.hi;
    })
    .map(m => {
      const colorIndex = parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE;
      const showLabel = stageTotalPoints > 0 && (m.points / stageTotalPoints) >= MIN_SEGMENT_LABEL_FRACTION;
      const player = escapeHtml(playerName);
      const matchNum = escapeHtml(String(m.matchNumber));
      return `
        <div class="race-bar-segment" style="flex-grow: ${m.points}; background: var(--seg-${colorIndex});"
             onmouseenter="onSegmentMouseEnter(this, '${player}', '${matchNum}')"
             onmouseleave="onSegmentMouseLeave()"
             onclick="onSegmentClick(this, '${player}', '${matchNum}')">${showLabel ? m.points : ''}</div>
      `;
    })
    .join('');
}

// Build the colored stage segments for one player's *main* (collapsed) bar:
// one segment per RACE_STAGE_GROUPS stage the player has scored in, up to
// (and including) the given frame index, colored by stage index using the
// pastel --stage-pastel-* palette (deliberately distinct from the vivid
// --seg-* palette used by the per-match segments inside the expanded
// stage-breakdown panel). Segment widths are relative within the bar via
// flex-grow, same mechanism as the per-match segments; the label threshold
// is evaluated against raceMaxPoints, consistent with how the main bar's
// overall width is scaled.
function buildMainBarStageSegmentsHtml(playerName, frameIndex) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  return RACE_STAGE_GROUPS.map((stage, stageIndex) => {
    const points = scoringMatches
      .filter(m => m.frameIndex <= frameIndex)
      .filter(m => {
        const n = parseInt(m.matchNumber, 10);
        return n >= stage.lo && n <= stage.hi;
      })
      .reduce((sum, m) => sum + m.points, 0);
    if (points <= 0) return '';
    const showLabel = (points / raceMaxPoints) >= MIN_SEGMENT_LABEL_FRACTION;
    return `<div class="race-bar-segment" style="flex-grow: ${points}; background: var(--stage-pastel-${stageIndex});">${showLabel ? points : ''}</div>`;
  }).join('');
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

  frame.standings.forEach(player => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    const fill = row.querySelector('.race-bar-fill');
    fill.style.width = `${pct}%`;
    fill.style.background = '';
    fill.innerHTML = buildMainBarStageSegmentsHtml(player.name, frameIndex);
    row.querySelector('.race-points').textContent = `${player.points} pts`;

    const panel = row.querySelector('.race-row-stage-panel');
    if (panel && panel.style.display !== 'none') {
      renderStagePanel(panel, player.name);
    }

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

// Tapping/clicking a row toggles its stage-breakdown panel open/closed, at
// every screen width. Multiple rows may be open at once. Clicks that
// originate inside an already-open panel (e.g. clicking a segment for its
// tooltip) don't toggle the row.
function onRaceRowClick(e, row, playerName) {
  if (e.target.closest('.race-row-stage-panel')) return;
  const panel = row.querySelector('.race-row-stage-panel');
  const chevron = row.querySelector('.race-row-chevron');
  if (!panel) return;

  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    if (chevron) chevron.textContent = '▸';
    row.classList.remove('race-row-expanded');
  } else {
    panel.style.display = 'flex';
    if (chevron) chevron.textContent = '▾';
    renderStagePanel(panel, playerName);
    row.classList.add('race-row-expanded');
  }
}

// Fixed tournament-stage buckets for the Race chart's stage-breakdown
// panel, as inclusive matchNumber ranges (48-team World Cup format: 12
// groups x 3 matchdays x 24 matches, then 16+8+4+2+1+1 knockout matches).
const RACE_STAGE_GROUPS = [
  { label: 'M1',    lo: 1,  hi: 24 },
  { label: 'M2',    lo: 25, hi: 48 },
  { label: 'M3',    lo: 49, hi: 72 },
  { label: 'R32',   lo: 73, hi: 88 },
  { label: 'R16',   lo: 89, hi: 96 },
  { label: 'QF->F', lo: 97, hi: 104 }
];

// For each stage that has at least one resolved match (frames[1..frameIndex])
// within its range, compute every player's point total in that stage so far
// and the highest such total (used to scale that stage's bar width).
// Unstarted stages are omitted from the result entirely.
function computeStageBreakdown(scoringMatchesMap, playerNames, frames, frameIndex, stages) {
  const startedIndexes = new Set();
  for (let i = 1; i <= frameIndex; i++) {
    const frame = frames[i];
    if (!frame || frame.matchNumber == null) continue;
    const n = parseInt(frame.matchNumber, 10);
    stages.forEach((stage, idx) => {
      if (n >= stage.lo && n <= stage.hi) startedIndexes.add(idx);
    });
  }

  const result = [];
  stages.forEach((stage, idx) => {
    if (!startedIndexes.has(idx)) return;
    const players = new Map();
    let maxPoints = 0;
    playerNames.forEach(name => {
      const matches = scoringMatchesMap.get(name) || [];
      const points = matches
        .filter(m => m.frameIndex <= frameIndex)
        .filter(m => {
          const n = parseInt(m.matchNumber, 10);
          return n >= stage.lo && n <= stage.hi;
        })
        .reduce((sum, m) => sum + m.points, 0);
      players.set(name, points);
      if (points > maxPoints) maxPoints = points;
    });
    result.push({ label: stage.label, lo: stage.lo, hi: stage.hi, maxPoints, players });
  });
  return result;
}

// Build the stage-breakdown panel's content for one player: one
// .race-stage-row per started stage, each a mini stacked bar of that
// player's per-match segments within that stage, scaled to the stage's
// own leading scorer. Called both when a panel is first opened and again
// on every subsequent frame tick while it stays open (see renderRaceFrame),
// so it stays live-synced with Play/scrub.
function renderStagePanel(panel, playerName) {
  const playerNames = Array.from(raceRowsByName.keys());
  const breakdown = computeStageBreakdown(raceScoringMatches, playerNames, raceFrames, raceCurrentFrame, RACE_STAGE_GROUPS);

  panel.innerHTML = breakdown.map(stageEntry => {
    const stagePoints = stageEntry.players.get(playerName) || 0;
    const segmentsHtml = buildStageSegmentsHtml(playerName, raceCurrentFrame, stageEntry, stagePoints);
    return `
      <div class="race-stage-row">
        <span class="race-stage-label">${escapeHtml(stageEntry.label)}</span>
        <div class="race-stage-bar-track"><div class="race-stage-bar-fill" style="width: 100%;">${segmentsHtml}</div></div>
        <span class="race-stage-points">${stagePoints} pts</span>
      </div>
    `;
  }).join('');
}

// Play/Pause button handler
function toggleRacePlayback() {
  if (racePlaying) {
    pauseRacePlayback();
    return;
  }

  // Resume from wherever playback was paused/scrubbed to; only restart
  // from the beginning if playback had already reached the end.
  if (raceCurrentFrame >= raceFrames.length - 1) {
    raceCurrentFrame = 0;
    raceScrubber.value = '0';
    renderRaceFrame(0, false);
  }

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

function buildFlagSpan(teamName, extraClass) {
  const code = getTeamCountryCode(teamName);
  const fiClass = code ? `fi fi-${code}` : '';
  return `<span class="${extraClass} ${fiClass}" data-team="${escapeHtml(teamName)}"></span>`;
}

// Capability check: true on devices with real hover (mouse/trackpad),
// false on touch-only devices. Drives whether segments react to
// hover or to tap.
const supportsHoverForSegments = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function getSegmentTooltip() {
  let tip = document.getElementById('race-segment-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'race-segment-tooltip';
    tip.className = 'race-segment-tooltip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
  }
  return tip;
}

// Show the race chart's match-result tooltip for the segment a user
// hovered or tapped, positioned just above it.
function showSegmentTooltip(segmentEl, playerName, matchNumber) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  const matchInfo = scoringMatches.find(m => String(m.matchNumber) === String(matchNumber));
  if (!matchInfo) return;

  const isDraw = matchInfo.outcome === 'draw';
  const scoreMid = matchInfo.score
    ? `${matchInfo.score.scoreHome}-${matchInfo.score.scoreAway}`
    : (isDraw ? 'Draw' : 'Win');

  const tip = getSegmentTooltip();
  tip.innerHTML = `
    <span style="display:inline-flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap;">
      ${buildFlagSpan(matchInfo.homeTeam, 'result-flag')}
      <span class="form-score">${escapeHtml(scoreMid)}</span>
      ${buildFlagSpan(matchInfo.awayTeam, 'result-flag')}
    </span>
    <div class="race-segment-tooltip-points">+${matchInfo.points} pts</div>
  `;
  tip.dataset.forSegment = `${playerName}|${matchNumber}`;
  tip.style.display = 'block';

  const rect = segmentEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  const top = rect.top - tipRect.height - 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideSegmentTooltip() {
  const tip = document.getElementById('race-segment-tooltip');
  if (tip) tip.style.display = 'none';
}

function onSegmentMouseEnter(el, playerName, matchNumber) {
  if (!supportsHoverForSegments) return;
  showSegmentTooltip(el, playerName, matchNumber);
}

function onSegmentMouseLeave() {
  if (!supportsHoverForSegments) return;
  hideSegmentTooltip();
}

function onSegmentClick(el, playerName, matchNumber) {
  if (supportsHoverForSegments) return;
  const tip = getSegmentTooltip();
  const key = `${playerName}|${matchNumber}`;
  const wasShowingForThis = tip.style.display === 'block' && tip.dataset.forSegment === key;
  hideSegmentTooltip();
  if (!wasShowingForThis) {
    showSegmentTooltip(el, playerName, matchNumber);
  }
}

// Tapping anywhere outside a segment or the tooltip itself dismisses it
// (mobile/touch only — desktop relies on mouseleave instead).
document.addEventListener('click', (e) => {
  if (supportsHoverForSegments) return;
  if (e.target.closest('.race-bar-segment') || e.target.closest('#race-segment-tooltip')) return;
  hideSegmentTooltip();
});

function buildTeamFormHtml(teamName, apiForm) {
  let rows;
  if (apiForm && apiForm.length > 0) {
    rows = apiForm.map(f => ({
      opponent: f.opponent,
      middle: `${f.scoreFor}-${f.scoreAgainst}`,
      result: f.result
    }));
  } else {
    const local = getRecentResolvedMatchesForTeam(teamName, 3);
    rows = local.map(r => {
      const result = r.result === 'Win' ? 'W' : r.result === 'Lost' ? 'L' : 'D';
      return { opponent: r.opponent, middle: result, result };
    });
  }
  if (rows.length === 0) return '';
  const resultClass = { W: 'form-score-win', L: 'form-score-loss', D: 'form-score-draw' };
  const rowsHtml = rows.map(r => `
    <div class="team-form-row">
      ${buildFlagSpan(teamName, 'flag-circle form-flag')}
      <span class="form-score ${resultClass[r.result] || ''}">${escapeHtml(r.middle)}</span>
      ${buildFlagSpan(r.opponent, 'flag-circle form-flag')}
    </div>
  `).join('');
  return `<div class="team-form">${rowsHtml}</div>`;
}

function renderMatches() {
  matchesGrid.innerHTML = '';
  const now = new Date();

  // Count live, open matches the user hasn't voted on yet (drives the alert banner).
  // Same definition as the leaderboard "Not Yet Voted" column: not resolved, not
  // admin-locked, still before kickoff (or extension active), and no vote cast.
  const notVotedCount = matches.filter(match => {
    if (match.matchType !== 'League') return false;
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
    if (match.matchType !== 'League') return false;
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

    const koOutcomeNote = match.matchType === 'KO' ? `
      <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 10px;">
        ⚠️ Knockout matches are 2-way only: Home Win or Away Win.
      </div>
    ` : '';

    const boosterCalloutHtml = match.matchType === 'KO' ? (
      match.boosterEligible ?
        `<div style="background: rgba(60,120,255,0.08); border: 1px solid rgba(60,120,255,0.24); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.84rem; color: #d5e8ff;">⚡ <strong>Knockout booster available</strong> for ${escapeHtml(match.boosterStageLabel || 'this stage')} — 2× points when correct.</div>` :
      match.myBooster ?
        `<div style="background: rgba(0,230,118,0.08); border: 1px solid rgba(0,230,118,0.24); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.84rem; color: #b8ffcc;">⚡ <strong>Booster active</strong> on your current pick.</div>` :
      match.boosterStageUsed ?
        `<div style="background: rgba(255,214,0,0.08); border: 1px solid rgba(255,214,0,0.24); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.84rem; color: #fff5cc;">⚡ Stage booster already used for ${escapeHtml(match.boosterStageLabel || 'this stage')}.</div>` :
        ''
    ) : '';

    card.innerHTML = `
      <div class="match-meta">
        ${badgeHtml}
        ${timerHtml}
      </div>
      <div class="match-teams">
        <div class="team">
          ${buildFlagSpan(match.homeTeam, 'team-flag')}
          <span style="display:flex; align-items:center; gap:6px;">
            <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
            <span class="team-rank" data-team="${escapeHtml(match.homeTeam)}">${getCachedRankString(match.homeTeam)}</span>
          </span>
          ${buildTeamFormHtml(match.homeTeam, match.homeTeamForm)}
        </div>
        <div class="vs-divider">VS</div>
        <div class="team">
          ${buildFlagSpan(match.awayTeam, 'team-flag')}
          <span style="display:flex; align-items:center; gap:6px;">
            <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
            <span class="team-rank" data-team="${escapeHtml(match.awayTeam)}">${getCachedRankString(match.awayTeam)}</span>
          </span>
          ${buildTeamFormHtml(match.awayTeam, match.awayTeamForm)}
        </div>
      </div>
      <div class="match-meta" style="justify-content: center; font-size: 0.75rem;">
        📅 Kickoff: ${dateStr}
      </div>
      ${extensionBannerHtml}
      ${koOutcomeNote}
      ${boosterCalloutHtml}
      ${optionsHtml}
    `;

    matchesGrid.appendChild(card);
  });

  updateAllTimers();
}

// Renders the Bracket tab (knockout stage). Reuses submitVote/confirmVote
// for the actual voting flow — clicking a bracket row is equivalent to
// clicking a predict-btn in the old flat list.
function computeNextDayToHighlight(rounds) {
  const allMatches = rounds.flatMap(r => r.slots.map(s => s.match)).filter(m => m && m.kickoff);

  // Don't highlight anything until at least one game has kicked off
  if (!allMatches.some(m => m.hasStarted)) return null;

  // Highlight the first day that still has not-yet-started matches.
  // This naturally covers two cases:
  //   - Some games today have started but others haven't → highlight today's remaining games
  //   - All today's games have started → highlight tomorrow's games
  const nextDays = [...new Set(
    allMatches.filter(m => !m.hasStarted).map(m => new Date(m.kickoff).toDateString())
  )].sort((a, b) => new Date(a) - new Date(b));

  return nextDays[0] ?? null;
}

function renderBracketTab() {
  const container = document.getElementById('bracketContainer');
  if (!container) return;
  const rounds = buildBracketRounds(matches, BRACKET_ROUNDS);
  const highlightDay = computeNextDayToHighlight(rounds);
  renderBracket(container, rounds, (match, side) => submitVote(match.id, side), highlightDay);
  updateAllTimers();
}

// ── Fantasy Bracket ───────────────────────────────────────────────

let _fantasyData = null;

async function openFantasyBracket() {
  const modal = document.getElementById('fantasyBracketModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch('/api/fantasy-bracket', {
      headers: { 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) throw new Error('Failed to load fantasy bracket.');
    _fantasyData = await res.json();
    renderFantasyBracketModal(_fantasyData);
  } catch (e) {
    console.error('Fantasy bracket load error:', e);
    const progress = document.getElementById('fantasyProgress');
    if (progress) progress.textContent = 'Failed to load — please try again.';
  }
}

function renderFantasyBracketModal(data) {
  const { locked, picks, r32Matches } = data;
  const pickCount = Object.keys(picks).length;

  document.getElementById('fantasyProgress').textContent = locked
    ? `${pickCount} / 31 complete 🔒`
    : `${pickCount} / 31 picks made`;

  const lockBadge = document.getElementById('fantasyLockBadge');
  if (lockBadge) lockBadge.style.display = locked ? 'inline' : 'none';

  const container = document.getElementById('fantasyBracketContainer');
  const rounds = buildFantasyBracketRounds(r32Matches, picks, BRACKET_ROUNDS);
  renderFantasyBracket(container, rounds, picks, locked, saveFantasyPick);
}

async function saveFantasyPick(roundCode, slot, side) {
  if (!_fantasyData || _fantasyData.locked) return;
  try {
    const res = await fetch('/api/fantasy-bracket/pick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ roundCode, slot, side })
    });
    if (!res.ok) throw new Error('Failed to save fantasy pick.');
    const data = await res.json();
    _fantasyData.picks = data.picks;
    renderFantasyBracketModal(_fantasyData);
  } catch (e) {
    console.error('Fantasy pick save error:', e);
  }
}

function closeFantasyBracket() {
  document.getElementById('fantasyBracketModal').style.display = 'none';
  document.body.style.overflow = '';
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
    tbody.innerHTML = `<tr><td colspan="8" class="loading-state">No live or completed matches to display.</td></tr>`;
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

    const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
    const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };

    // Result Outcome text
    let outcomeText = '';
    if (isResolved) {
      const homeFlagClass = isWinnerHome ? 'result-flag result-flag-winner' : 'result-flag';
      const awayFlagClass = isWinnerAway ? 'result-flag result-flag-winner' : 'result-flag';
      const scoreMid = (() => {
        if (!match.score) return isWinnerDraw ? 'Draw' : 'Win';
        const s = match.score;
        if (s.duration === 'PENALTY_SHOOTOUT' && s.regularTimeHome != null) {
          return `${s.regularTimeHome}(${s.scoreHome})-${s.regularTimeAway}(${s.scoreAway})`;
        }
        return `${s.scoreHome}-${s.scoreAway}`;
      })();
      const decidedByText = bonusEligible && match.decidedBy
        ? `<br><span style="font-size: 0.72rem; color: var(--text-muted);">${bonusLabels[match.decidedBy]}</span>`
        : '';
      outcomeText = `
        <span style="display:inline-flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap;">
          ${buildFlagSpan(match.homeTeam, homeFlagClass)}
          <span class="form-score">${escapeHtml(scoreMid)}</span>
          ${buildFlagSpan(match.awayTeam, awayFlagClass)}
        </span>
        ${decidedByText}
      `;
    } else {
      outcomeText = '<span style="color: var(--color-warning); font-weight: bold;">Locked / Live</span>';
    }

    // Player prediction text & styling
    const myBonusCorrect = isResolved && bonusEligible && match.decidedBy && match.myBonusPick === match.decidedBy;
    const myBonusPts = myBonusCorrect ? (match.myVote === match.outcome ? 10 : 5) : 0;

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
          const basePts = totalIncorrectVotes + 1;
          const boosterMultiplier = match.myBooster ? 2 : 1;
          const pts = basePts * boosterMultiplier;
          const bonusSuffix = myBonusCorrect ? `, +${myBonusPts} bonus` : '';
          pickText = match.myBooster
            ? `🎉 ${escapeHtml(pickTeam)} (+${pts} · booster x2${bonusSuffix})`
            : `🎉 ${escapeHtml(pickTeam)} (+${pts}${bonusSuffix})`;
          pickClass = 'text-active'; // Neon Green
        } else if (myBonusCorrect) {
          pickText = `❌ ${escapeHtml(pickTeam)} (+${myBonusPts} bonus)`;
          pickClass = 'error-text'; // Red
        } else {
          pickText = `❌ ${escapeHtml(pickTeam)}`;
          pickClass = 'error-text'; // Red
        }
      } else {
        pickText = `🔒 ${escapeHtml(pickTeam)}`;
      }

      if (bonusEligible && match.myBonusPick) {
        pickText += ` · ${bonusLabels[match.myBonusPick]}`;
      }
    }

    // Voters list formatting
    const boosters = match.boosters || { home: [], away: [], draw: [] };
    const tagVoter = (name, boostedList) =>
      escapeHtml(name) + (boostedList.includes(name) ? ' ⚡' : '');

    let distHtml = `
      <div style="font-size: 0.8rem; line-height: 1.4;">
        <span style="${isWinnerHome ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.homeTeam)} (${counts.home}):</span>
        <span style="color: var(--text-muted);">${[...voters.home].sort((a, b) => a.localeCompare(b)).map(v => tagVoter(v, boosters.home)).join(', ') || 'None'}</span>
        <br>
        ${match.matchType === 'League' ? `
          <span style="${isWinnerDraw ? 'color: var(--color-accent); font-weight: 700;' : ''}">Draw (${counts.draw}):</span>
          <span style="color: var(--text-muted);">${[...voters.draw].sort((a, b) => a.localeCompare(b)).map(v => tagVoter(v, boosters.draw)).join(', ') || 'None'}</span>
          <br>
        ` : ''}
        <span style="${isWinnerAway ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.awayTeam)} (${counts.away}):</span>
        <span style="color: var(--text-muted);">${[...voters.away].sort((a, b) => a.localeCompare(b)).map(v => tagVoter(v, boosters.away)).join(', ') || 'None'}</span>
      </div>
    `;

    // Bonus (Reg Time / Extra Time / Penalties) distribution — QF+/3rd-place only
    let bonusColHtml = '<span style="color: var(--text-muted);">&mdash;</span>';
    if (bonusEligible) {
      const bonusPicks = match.bonusPicks || {};
      const bonusGroups = { REGULAR: [], EXTRA_TIME: [], PENALTIES: [] };
      Object.keys(bonusPicks).forEach(name => {
        if (bonusGroups[bonusPicks[name]]) bonusGroups[bonusPicks[name]].push(name);
      });
      bonusColHtml = `
        <div style="font-size: 0.8rem; line-height: 1.4;">
          ${['REGULAR', 'EXTRA_TIME', 'PENALTIES'].map(key => `
            <span style="${isResolved && match.decidedBy === key ? 'color: var(--color-accent); font-weight: 700;' : ''}">${bonusLabels[key]} (${bonusGroups[key].length}):</span>
            <span style="color: var(--text-muted);">${bonusGroups[key].map(escapeHtml).join(', ') || 'None'}</span>
            <br>
          `).join('')}
        </div>
      `;
    }

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
        <span>${buildFlagSpan(match.homeTeam, 'result-flag')} ${escapeHtml(match.homeTeam)}</span>
        <span style="color: var(--text-muted); font-size: 0.75rem; padding: 0 4px; font-weight: normal;">vs</span>
        <span>${escapeHtml(match.awayTeam)} ${buildFlagSpan(match.awayTeam, 'result-flag')}</span>
      </td>
      <td data-label="Kickoff (Local)" style="color: var(--text-muted); font-size: 0.8rem;">
        ${dateStr}
      </td>
      <td data-label="Result" style="text-align: center;">
        ${outcomeText}
      </td>
      <td data-label="Your Pick" style="text-align: center; font-weight: 700;" class="${pickClass}">
        ${pickText}
      </td>
      <td data-label="Group Votes Distribution" style="padding-left: 20px;">
        ${distHtml}
      </td>
      <td data-label="Bonus" style="padding-left: 20px;">
        ${bonusColHtml}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function updateAllTimers() {
  const now = new Date().getTime();

  // Bracket slot countdowns
  document.querySelectorAll('.bracket-slot-countdown').forEach(el => {
    const kickoffTime = new Date(el.dataset.kickoff).getTime();
    const diff = kickoffTime - now;
    if (diff <= 0) {
      el.textContent = '';
      el.classList.remove('bracket-slot-countdown--soon');
    } else {
      const hours   = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      const soon = diff <= 3 * 3600000;
      el.classList.toggle('bracket-slot-countdown--soon', soon);
      if (!soon) {
        if (hours >= 24) {
          const days = Math.floor(hours / 24);
          el.textContent = `${days}d ${hours % 24}h`;
        } else {
          el.textContent = `${hours}h ${minutes}m`;
        }
      } else {
        if (hours > 0) {
          el.textContent = `${hours}h ${minutes}m ${seconds}s`;
        } else {
          el.textContent = `${minutes}m ${seconds}s`;
        }
      }
    }
  });

  const elements = document.querySelectorAll('.match-countdown');


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
let pendingBonusPick = 'REGULAR';

function selectBonusOption(value) {
  pendingBonusPick = value;
  ['Regular', 'ExtraTime', 'Penalties'].forEach(suffix => {
    const btn = document.getElementById(`voteConfirmBonus${suffix}`);
    if (!btn) return;
    const btnValue = suffix === 'Regular' ? 'REGULAR' : suffix === 'ExtraTime' ? 'EXTRA_TIME' : 'PENALTIES';
    btn.classList.toggle('selected', btnValue === value);
  });
}

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

  const boosterSection = document.getElementById('voteConfirmBoosterSection');
  const boosterCheckbox = document.getElementById('voteConfirmUseBooster');
  const boosterInfo = document.getElementById('voteConfirmBoosterInfo');
  if (boosterSection && boosterCheckbox && boosterInfo) {
    const showBooster = match.matchType === 'KO' && (match.boosterEligible || match.myMatchBooster);
    if (showBooster) {
      boosterSection.style.display = 'block';
      boosterCheckbox.checked = match.myBooster && match.myVote === prediction;
      boosterInfo.textContent = match.boosterEligible
        ? `Use your one knockout booster for ${match.boosterStageLabel || 'this stage'} to double points on a correct pick.`
        : `Boost this prediction on your current knockout match. If you switch picks, the booster will move with your selection.`;
    } else {
      boosterSection.style.display = 'none';
      boosterCheckbox.checked = false;
    }
  }

  const bonusSection = document.getElementById('voteConfirmBonusSection');
  if (bonusSection) {
    const showBonus = match.boosterStageCode === 'QF_SF_FINAL';
    bonusSection.style.display = showBonus ? 'block' : 'none';
    if (showBonus) {
      selectBonusOption(match.myBonusPick || 'REGULAR');
    }
  }

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
  pendingBonusPick = 'REGULAR';
}

// Actually submit after user confirms in modal
async function confirmVote() {
  if (!pendingVoteMatchId || !pendingVotePrediction || !currentUserSecret) return;

  const matchId = pendingVoteMatchId;
  const prediction = pendingVotePrediction;
  const useBooster = document.getElementById('voteConfirmUseBooster')?.checked || false;
  const bonusPick = pendingBonusPick;

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
      body: JSON.stringify({ matchId, prediction, useBooster, bonusPick })
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

async function checkAdminState() {
  let sessionExpired = false;

  if (adminPasscode) {
    // Re-verify the stored passcode — it may be stale if the server's
    // admin passcode changed since it was saved to sessionStorage.
    try {
      const response = await fetch('/api/admin/verify', {
        headers: {
          'x-admin-passcode': adminPasscode,
          'x-user-secret': currentUserSecret
        }
      });
      if (!response.ok) {
        adminPasscode = '';
        sessionStorage.removeItem('admin_passcode');
        sessionExpired = true;
      }
    } catch (err) {
      console.error('Error verifying admin:', err);
    }
  }

  if (adminPasscode) {
    adminAuthCard.style.display = 'none';
    adminWorkspace.style.display = 'block';
    loadAdminMatches();
    loadAdminPlayers();
    loadAdminHistory();
    loadAdminVotes();
    loadAdminSettings();
    loadFixtures(true);
    loadAdminFantasyStatus();
  } else {
    adminAuthCard.style.display = 'block';
    adminWorkspace.style.display = 'none';
    if (sessionExpired) {
      adminAuthMessage.textContent = '⚠️ Your admin session expired. Please re-enter the admin passcode.';
    }
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

  // Filter (default: only matches still needing resolution) + sort
  const filterEl = document.getElementById('adminMatchFilter');
  const filter = filterEl ? filterEl.value : 'open';
  let list = [...matches];
  if (filter === 'open') list = list.filter(m => m.status !== 'resolved');
  else if (filter === 'resolved') list = list.filter(m => m.status === 'resolved');

  // Unresolved group first; within it show soonest kickoff at the top
  // (chronological, reads top-to-bottom). Resolved group shows most-recent first.
  list.sort((a, b) => {
    const ar = a.status === 'resolved' ? 1 : 0;
    const br = b.status === 'resolved' ? 1 : 0;
    if (ar !== br) return ar - br;
    if (ar === 0) return new Date(a.kickoff) - new Date(b.kickoff); // open: soonest first
    return new Date(b.kickoff) - new Date(a.kickoff);                // resolved: latest first
  });

  if (list.length === 0) {
    adminMatchesList.innerHTML = `<div class="loading-state">No matches to show for this filter.</div>`;
    return;
  }

  list.forEach(match => {
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
      const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
      const currentDecidedBy = bonusEligible ? (_pendingDecidedBy[match.id] || 'REGULAR') : null;
      const decidedByOptions = [
        ['REGULAR', 'Reg Time'],
        ['EXTRA_TIME', 'Extra Time'],
        ['PENALTIES', 'Penalties']
      ];
      const decidedByControls = bonusEligible ? `
        <div class="resolve-btn-group" style="margin-top: 6px;">
          ${decidedByOptions.map(([value, label]) => `
            <button class="resolve-mini-btn decided-by-btn${currentDecidedBy === value ? ' active-outcome' : ''}" data-value="${value}" onclick="selectDecidedBy('${match.id}', '${value}', this)">${label}</button>
          `).join('')}
        </div>
      ` : '';
      outcomeControls = `
        <div class="resolve-btn-group">
          <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'home')">${escapeHtml(match.homeTeam)}</button>
          ${match.matchType === 'League' ? `
            <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'draw')">Draw</button>
          ` : ''}
          <button class="resolve-mini-btn" onclick="resolveMatch('${match.id}', 'away')">${escapeHtml(match.awayTeam)}</button>
        </div>
        ${decidedByControls}
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
function toggleBracketFieldsRow() {
  const matchType = document.getElementById('matchTypeSelect').value;
  document.getElementById('bracketFieldsRow').style.display = matchType === 'KO' ? 'flex' : 'none';
}

async function handleCreateMatch(event) {
  event.preventDefault();
  const homeTeam = document.getElementById('homeTeamInput').value.trim();
  const awayTeam = document.getElementById('awayTeamInput').value.trim();
  const matchType = document.getElementById('matchTypeSelect').value;
  const kickoffStr = document.getElementById('kickoffInput').value;
  const matchNumber = document.getElementById('matchNumberInput').value.trim();
  const group = document.getElementById('groupInput').value.trim();
  const bracketRound = document.getElementById('bracketRoundSelect').value || undefined;
  const bracketSlotRaw = document.getElementById('bracketSlotInput').value;
  const bracketSlot = bracketSlotRaw !== '' ? Number(bracketSlotRaw) : undefined;

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
      body: JSON.stringify({ homeTeam, awayTeam, matchType, kickoff: kickoffISO, matchNumber, group, bracketRound, bracketSlot })
    });

    const data = await response.json();
    if (!response.ok) {
      showFeedback(addMatchMessage, `❌ Error: ${data.error}`, 'error');
      return;
    }

    showFeedback(addMatchMessage, `✅ Match ${homeTeam} vs ${awayTeam} created successfully!`, 'success');
    document.getElementById('addMatchForm').reset();
    initializeDefaultKickoff();
    toggleBracketFieldsRow();

    loadDashboardData();
  } catch (err) {
    console.error('Error creating match:', err);
    showFeedback(addMatchMessage, '❌ Failed to communicate with server.', 'error');
  }
}

// Tracks the currently-selected decidedBy segment per match (admin resolve UI).
// loadAdminMatches reads this on every render (including poll-driven re-renders)
// to decide which button is visually active, so a selection survives a
// background refresh instead of silently reverting to REGULAR.
const _pendingDecidedBy = {};

function selectDecidedBy(matchId, value, btnEl) {
  _pendingDecidedBy[matchId] = value;
  const group = btnEl.closest('.resolve-btn-group');
  if (!group) return;
  group.querySelectorAll('.decided-by-btn').forEach(btn => {
    btn.classList.toggle('active-outcome', btn === btnEl);
  });
}

// Resolve Match
async function resolveMatch(matchId, outcome) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return;
  const outcomeText = outcome === 'home' ? match.homeTeam
                    : outcome === 'away' ? match.awayTeam
                    : 'Draw';

  const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
  const decidedBy = bonusEligible ? (_pendingDecidedBy[matchId] || 'REGULAR') : undefined;
  const decidedByLabel = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' }[decidedBy];
  const bonusConfirmNote = bonusEligible ? ` Bonus will be scored as decided by ${decidedByLabel}.` : '';

  if (!confirm(`Are you sure you want to resolve this match as '${outcomeText}'? This will calculate scores immediately.${bonusConfirmNote}`)) return;

  try {
    const response = await fetch('/api/admin/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId, outcome, decidedBy })
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

// ===================== FANTASY BRACKET ADMIN =====================

async function loadAdminFantasyStatus() {
  try {
    const res = await fetch('/api/admin/fantasy-status', {
      headers: { 'x-admin-passcode': adminPasscode, 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) return;
    const data = await res.json();
    const r32El = document.getElementById('fantasyAdminR32Count');
    const playerEl = document.getElementById('fantasyAdminPlayerCount');
    const undoBtn = document.getElementById('adminFantasyUndoBtn');
    const lockBtn = document.getElementById('adminFantasyLockBtn');
    const unlockBtn = document.getElementById('adminFantasyUnlockBtn');
    const lockStatus = document.getElementById('adminFantasyLockStatus');
    const msg = document.getElementById('adminFantasyMsg');
    if (r32El) r32El.textContent = `${data.r32Real} / ${data.r32Count} with teams`;
    if (playerEl) playerEl.textContent = data.playerCount;
    if (lockBtn) lockBtn.style.display = data.locked ? 'none' : 'inline-flex';
    if (unlockBtn) unlockBtn.style.display = data.locked ? 'inline-flex' : 'none';
    if (lockStatus) lockStatus.textContent = data.locked ? '🔒 Locked — picks frozen' : '🔓 Open — picks allowed';
    if (undoBtn) {
      undoBtn.style.display = data.hasBackup ? 'inline-flex' : 'none';
      if (data.hasBackup) {
        const ts = new Date(data.backupTimestamp).toLocaleString();
        undoBtn.title = `Restore backup from ${ts} (${data.backupR32Count} R32 slots, ${data.backupPlayerCount} players)`;
      }
    }
    if (msg && data.hasBackup) {
      const ts = new Date(data.backupTimestamp).toLocaleString();
      msg.textContent = `Backup available from ${ts} — ${data.backupPlayerCount} player bracket(s) saved.`;
    } else if (msg) {
      msg.textContent = '';
    }
    const breakdownEl = document.getElementById('adminFantasyPickBreakdown');
    if (breakdownEl && Array.isArray(data.playerBreakdown) && data.playerBreakdown.length > 0) {
      const full = data.playerBreakdown.filter(p => p.full);
      const partial = data.playerBreakdown.filter(p => !p.full);
      const renderPills = (players) => players.map(p =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.07);border-radius:6px;padding:3px 9px;font-size:0.8rem;">` +
        `${p.name}<span style="color:var(--text-muted);font-size:0.75rem;">${p.picks}/31</span></span>`
      ).join('');
      breakdownEl.innerHTML =
        `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">` +
        `<strong style="color:#4ade80;">✓ Full (${full.length})</strong> ` +
        (full.length ? renderPills(full) : '<span style="opacity:0.5;">none yet</span>') +
        `</div>` +
        `<div style="font-size:0.8rem;color:var(--text-muted);">` +
        `<strong style="color:#facc15;">⏳ Incomplete (${partial.length})</strong> ` +
        (partial.length ? renderPills(partial) : '<span style="opacity:0.5;">—</span>') +
        `</div>`;
    } else if (breakdownEl) {
      breakdownEl.innerHTML = '';
    }
  } catch (e) {
    console.error('Fantasy status load error:', e);
  }
}

async function adminFantasyLock() {
  if (!confirm('Lock the fantasy bracket? Players will no longer be able to change their picks.')) return;
  try {
    const res = await fetch('/api/admin/fantasy-lock', {
      method: 'POST',
      headers: { 'x-admin-passcode': adminPasscode, 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) { alert('Lock failed.'); return; }
    await loadAdminFantasyStatus();
  } catch (e) { alert('Request failed.'); }
}

async function adminFantasyUnlock() {
  if (!confirm('Unlock the fantasy bracket? Players will be able to change their picks again.')) return;
  try {
    const res = await fetch('/api/admin/fantasy-unlock', {
      method: 'POST',
      headers: { 'x-admin-passcode': adminPasscode, 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) { alert('Unlock failed.'); return; }
    await loadAdminFantasyStatus();
  } catch (e) { alert('Request failed.'); }
}

async function adminFantasyReset() {
  if (!confirm(
    'Reset the entire fantasy bracket?\n\n' +
    'This will:\n' +
    '  • Clear all R32 fixture data\n' +
    '  • Delete all player picks\n' +
    '  • Immediately re-fetch R32 fixtures from the API\n\n' +
    'A backup will be saved so you can undo this.'
  )) return;

  const msg = document.getElementById('adminFantasyMsg');
  if (msg) msg.textContent = 'Resetting…';
  try {
    const res = await fetch('/api/admin/fantasy-reset', {
      method: 'POST',
      headers: { 'x-admin-passcode': adminPasscode, 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) {
      const err = await res.json();
      if (msg) msg.textContent = 'Error: ' + (err.error || res.status);
      return;
    }
    if (msg) msg.textContent = 'Reset complete. R32 data will repopulate from the API within a minute.';
    await loadAdminFantasyStatus();
  } catch (e) {
    if (msg) msg.textContent = 'Request failed — check server logs.';
  }
}

async function adminFantasyUndo() {
  const undoBtn = document.getElementById('adminFantasyUndoBtn');
  const backupDesc = undoBtn ? undoBtn.title : 'the last backup';
  if (!confirm(`Undo the reset and restore ${backupDesc}?\n\nThis will overwrite the current fantasy data.`)) return;

  const msg = document.getElementById('adminFantasyMsg');
  if (msg) msg.textContent = 'Restoring…';
  try {
    const res = await fetch('/api/admin/fantasy-undo', {
      method: 'POST',
      headers: { 'x-admin-passcode': adminPasscode, 'x-user-secret': currentUserSecret }
    });
    if (!res.ok) {
      const err = await res.json();
      if (msg) msg.textContent = 'Error: ' + (err.error || res.status);
      return;
    }
    if (msg) msg.textContent = 'Restored successfully.';
    await loadAdminFantasyStatus();
  } catch (e) {
    if (msg) msg.textContent = 'Request failed — check server logs.';
  }
}

// ===================== MATCH STAGE SETTINGS (which stages allow "Create Match") =====================

async function loadAdminSettings() {
  try {
    const response = await fetch('/api/admin/settings', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });
    if (!response.ok) throw new Error('Failed to load settings');
    const data = await response.json();
    openMatchStages = data.openMatchStages || [];
    availableStages = data.availableStages || [];
    renderStageToggles();
    if (fixturesData.length) renderMatchLog();
  } catch (err) {
    console.error('Error loading admin settings:', err);
  }
}

function renderStageToggles() {
  const container = document.getElementById('matchStageToggles');
  if (!container) return;

  container.innerHTML = availableStages.map(stage => {
    const active = openMatchStages.includes(stage.code);
    return `<button class="stage-toggle ${active ? 'active' : ''}" onclick="toggleMatchStage('${stage.code}')">${escapeHtml(stage.label)}</button>`;
  }).join('');
}

async function toggleMatchStage(stageCode) {
  const next = openMatchStages.includes(stageCode)
    ? openMatchStages.filter(s => s !== stageCode)
    : [...openMatchStages, stageCode];

  try {
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ openMatchStages: next })
    });
    if (!response.ok) throw new Error('Failed to update settings');
    const data = await response.json();
    openMatchStages = data.openMatchStages || [];
    availableStages = data.availableStages || availableStages;
    renderStageToggles();
    if (fixturesData.length) renderMatchLog();
  } catch (err) {
    console.error('Error updating match stage settings:', err);
  }
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
  const liveIdx = fixturesData.findIndex(f => f.status === 'IN_PLAY' || f.status === 'LIVE' || f.status === 'PAUSED');
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
  const isLive = f.status === 'IN_PLAY' || f.status === 'LIVE' || f.status === 'PAUSED';
  const isStageOpen = openMatchStages.includes(f.stage);
  const isUpcoming = (f.status === 'SCHEDULED' || f.status === 'TIMED') && isStageOpen;
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
    'LIVE':      { bg:'rgba(255,152,0,0.1)',  border:'rgba(255,152,0,0.4)',  color:'#ff9800',             label:'🔴 Live' },
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
    if (alreadyAdded) {
      const undoBtn = f.matchType === 'KO'
        ? `<button class="btn btn-secondary btn-sm" onclick="undoMatchFromFixture(${fixturesCurrentIndex})" style="font-size:0.8rem;">↩ Undo</button>`
        : '';
      actionHtml = `<div style="margin-top:14px; display:flex; gap:8px; align-items:center; justify-content:center;">${undoBtn}<span style="color:var(--color-accent); font-size:0.85rem; font-weight:600;">✅ Already in database</span></div>`;
    } else {
      actionHtml = `<button class="btn btn-success btn-full" style="margin-top:14px;" onclick="createMatchFromFixture(${fixturesCurrentIndex})">➕ Create Match</button>`;
    }
  }

  contentEl.innerHTML = `
    <div style="font-size:0.75rem; color:var(--text-muted); text-align:right; margin-bottom:12px;">
      Match #${escapeHtml(f.matchNumber)} &nbsp;·&nbsp; ${fixturesCurrentIndex + 1} of ${total}
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

    ${f.matchType === 'KO' && f.bracketSlot !== undefined ? `
    <div class="form-row">
      <div class="form-group">
        <label for="matchLogBracketSlotInput">Bracket Slot &nbsp;<span style="font-weight:400; color:var(--text-muted);">(${f.stage})</span></label>
        <input type="number" id="matchLogBracketSlotInput" class="form-control" min="0" step="1" value="${f.bracketSlot}" onchange="updateFixtureBracketSlot(${fixturesCurrentIndex}, this.value)">
      </div>
    </div>` : ''}

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

function updateFixtureBracketSlot(index, rawValue) {
  const f = fixturesData[index];
  if (!f) return;

  const num = parseInt(rawValue, 10);
  if (isNaN(num) || num < 0) {
    alert('Bracket slot must be a non-negative integer.');
    renderMatchLog();
    return;
  }

  f.bracketSlot = num;
}

async function createMatchFromFixture(index) {
  const f = fixturesData[index];
  if (!f) return;
  if (f.matchType === 'KO' && f.bracketSlot === undefined) {
    alert('Bracket slot data not loaded. Click ↻ Refresh in the match log, then try again.');
    return;
  }
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
        group: f.group,
        ...(f.matchType === 'KO' && {
          bracketRound: f.stage,
          bracketSlot: f.bracketSlot
        })
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

async function undoMatchFromFixture(index) {
  const f = fixturesData[index];
  if (!f) return;

  const kickoffDay = new Date(f.kickoff).toDateString();
  const match = matches.find(m =>
    m.homeTeam.toLowerCase() === f.homeTeam.toLowerCase() &&
    m.awayTeam.toLowerCase() === f.awayTeam.toLowerCase() &&
    new Date(m.kickoff).toDateString() === kickoffDay
  );

  if (!match) { alert('Match not found in database.'); return; }
  if (!confirm(`Remove match: ${f.homeTeam} vs ${f.awayTeam}?`)) return;

  try {
    const response = await fetch('/api/admin/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify({ matchId: match.id })
    });
    const data = await response.json();
    if (!response.ok) { alert(`❌ Error: ${data.error}`); return; }
    await loadDashboardData();
    renderMatchLog();
  } catch (err) {
    console.error('[FIXTURES] Error removing match:', err);
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

async function exportReportCardStats() {
  try {
    const response = await fetch('/api/admin/report-card-stats-export', {
      headers: {
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      }
    });
    if (!response.ok) throw new Error('Failed to fetch report card stats');
    const stats = await response.json();

    const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `report_card_stats_${new Date().toISOString().slice(0, 10)}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Error exporting report card stats:', err);
    alert('Failed to export stats: ' + err.message);
  }
}

async function importReportCardTitles() {
  const input = document.getElementById('titlesImportInput');
  const messageEl = document.getElementById('titlesImportMessage');
  messageEl.textContent = '';
  messageEl.className = 'feedback-message';

  if (!input.files || input.files.length === 0) {
    messageEl.textContent = 'Choose a titles JSON file first.';
    messageEl.className = 'feedback-message error';
    return;
  }

  try {
    const text = await input.files[0].text();
    const payload = JSON.parse(text);

    const response = await fetch('/api/admin/titles/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-passcode': adminPasscode,
        'x-user-secret': currentUserSecret
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Import failed');

    messageEl.textContent = `Imported titles for ${result.updated} player(s).`;
    messageEl.className = 'feedback-message success';
    input.value = '';
  } catch (err) {
    console.error('Error importing titles:', err);
    messageEl.textContent = 'Failed to import: ' + err.message;
    messageEl.className = 'feedback-message error';
  }
}

// Return recent resolved matches for a team (most recent first)
function getRecentResolvedMatchesForTeam(teamName, limit = 5) {
  if (!teamName) return [];
  const nameLower = teamName.toLowerCase().trim();
  const recent = matches
    .filter(m => m && m.status === 'resolved' && (m.homeTeam || m.awayTeam))
    .filter(m => (String(m.homeTeam).toLowerCase().trim() === nameLower) || (String(m.awayTeam).toLowerCase().trim() === nameLower))
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, limit)
    .map(m => {
      const isHome = String(m.homeTeam).toLowerCase().trim() === nameLower;
      const opponent = isHome ? m.awayTeam : m.homeTeam;
      let result = 'Draw';
      if (m.outcome === 'home') result = isHome ? 'Win' : 'Lost';
      else if (m.outcome === 'away') result = isHome ? 'Lost' : 'Win';
      else if (m.outcome === 'draw') result = 'Draw';
      return { opponent, result, kickoff: m.kickoff, raw: m };
    });
  return recent;
}

function getFlagNameLabel() {
  let label = document.getElementById('flag-name-label');
  if (!label) {
    label = document.createElement('div');
    label.id = 'flag-name-label';
    label.className = 'flag-name-label';
    label.style.display = 'none';
    document.body.appendChild(label);
  }
  return label;
}

function showFlagNameLabel(flagEl, teamName) {
  const label = getFlagNameLabel();
  label.textContent = teamName;
  const rect = flagEl.getBoundingClientRect();
  label.style.left = `${Math.round(rect.left)}px`;
  label.style.top = `${Math.round(rect.bottom + 6)}px`;
  label.style.display = 'block';
  label.dataset.forFlag = teamName;
}

function hideFlagNameLabel() {
  const label = document.getElementById('flag-name-label');
  if (label) label.style.display = 'none';
}

document.addEventListener('click', (e) => {
  const flag = e.target.closest('[data-team]');
  const label = document.getElementById('flag-name-label');
  const wasShowingForThisFlag = flag && label && label.style.display === 'block' && label.dataset.forFlag === flag.dataset.team;
  hideFlagNameLabel();
  if (flag && !wasShowingForThisFlag) {
    showFlagNameLabel(flag, flag.dataset.team);
  }
});
