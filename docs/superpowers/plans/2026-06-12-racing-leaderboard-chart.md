# Racing Leaderboard Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable "Race" view to the Leaderboard tab that animates how standings evolved match-by-match, with play/pause and a scrubber slider.

**Architecture:** A new `GET /api/leaderboard/history` endpoint (server.js) returns cumulative standings snapshots ("frames"), one per resolved match in chronological order, reusing the existing `calculatePointsForMatch` logic. The frontend (vanilla JS/CSS, no new dependencies) adds a Table/Race toggle to the Leaderboard tab; the Race view renders one horizontal bar per player and animates bar width + row order changes between frames using the FLIP technique.

**Tech Stack:** Express (existing), vanilla JS/CSS (existing), no new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-12-racing-leaderboard-chart-design.md`

---

### Task 1: Backend — `buildLeaderboardHistory` logic + standalone test

**Files:**
- Create: `verify_leaderboard_history.js`

This task develops and verifies the cumulative-standings-snapshot logic in isolation, following the same self-contained style as the existing `verify_points.js`.

- [ ] **Step 1: Write the test file with test cases calling a not-yet-defined function**

Create `verify_leaderboard_history.js`:

```javascript
// verify_leaderboard_history.js
// Test script to verify the leaderboard history (racing chart frames) logic.

function calculatePointsForMatch(votes, outcome, matchType) {
  const votersHome = votes.home || [];
  const votersAway = votes.away || [];
  const votersDraw = votes.draw || [];

  const countHome = votersHome.length;
  const countAway = votersAway.length;
  const countDraw = matchType === 'League' ? votersDraw.length : 0;

  const pointsAllocated = {};

  if (!outcome) return pointsAllocated;

  if (outcome === 'home') {
    const pts = countAway + countDraw + 1;
    votersHome.forEach(v => { pointsAllocated[v] = pts; });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => { pointsAllocated[v] = pts; });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => { pointsAllocated[v] = pts; });
  }

  return pointsAllocated;
}

let failed = false;

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING LEADERBOARD HISTORY TESTS ===");

// Test 1: basic cumulative accumulation across two resolved matches, in kickoff order
console.log("\nTest #1: basic cumulative accumulation");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Alice'], away: ['Bob'], draw: [] }
      },
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'draw',
        votes: { home: ['Bob'], away: [], draw: ['Alice', 'Carol'] }
      },
      {
        matchNumber: '3', homeTeam: 'E', awayTeam: 'F', matchType: 'KO',
        kickoff: '2026-06-03T00:00:00.000Z', status: 'scheduled', outcome: null,
        votes: { home: ['Alice'], away: ['Bob'], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames.length, 3, 'three frames (start + 2 resolved matches, scheduled match ignored)');
  assertDeepEqual(frames[0], {
    matchNumber: null, homeTeam: null, awayTeam: null,
    standings: [{ name: 'Alice', points: 0 }, { name: 'Bob', points: 0 }, { name: 'Carol', points: 0 }]
  }, 'frame 0 is the start frame, all zero, alphabetical');
  assertDeepEqual(frames[1], {
    matchNumber: '1', homeTeam: 'A', awayTeam: 'B',
    standings: [{ name: 'Alice', points: 2 }, { name: 'Bob', points: 0 }, { name: 'Carol', points: 0 }]
  }, 'frame 1 reflects match 1 (Alice wins home pick)');
  assertDeepEqual(frames[2], {
    matchNumber: '2', homeTeam: 'C', awayTeam: 'D',
    standings: [{ name: 'Alice', points: 4 }, { name: 'Carol', points: 2 }, { name: 'Bob', points: 0 }]
  }, 'frame 2 accumulates match 2 (Alice + Carol picked draw)');
}

// Test 2: frames are ordered by kickoff, not by array order
console.log("\nTest #2: frames ordered by kickoff regardless of array order");
{
  const db = {
    users: [{ name: 'X' }, { name: 'Y' }],
    matches: [
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Y'], away: ['X'], draw: [] }
      },
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['X'], away: ['Y'], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[1].matchNumber, '1', 'earlier kickoff (match 1) becomes frame 1');
  assertDeepEqual(frames[2].matchNumber, '2', 'later kickoff (match 2) becomes frame 2');
  assertDeepEqual(frames[2].standings, [{ name: 'X', points: 2 }, { name: 'Y', points: 2 }],
    'tied points break alphabetically (X before Y)');
}

// Test 3: voter not in registered users is added dynamically (legacy voter)
console.log("\nTest #3: unregistered voter is added dynamically");
{
  const db = {
    users: [{ name: 'Alice' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'away',
        votes: { home: [], away: ['Ghost'], draw: ['Alice'] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[1].standings, [{ name: 'Ghost', points: 2 }, { name: 'Alice', points: 0 }],
    'Ghost (unregistered voter) appears with earned points, ranked above Alice');
}

// Test 4: no resolved matches -> only the start frame
console.log("\nTest #4: no resolved matches yields only the start frame");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'scheduled', outcome: null,
        votes: { home: [], away: [], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames.length, 1, 'only the start frame exists');
  assertDeepEqual(frames[0].standings, [{ name: 'Alice', points: 0 }, { name: 'Bob', points: 0 }],
    'start frame lists all registered users at zero');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll leaderboard history tests PASSED successfully!");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node verify_leaderboard_history.js`
Expected: `ReferenceError: buildLeaderboardHistory is not defined`

- [ ] **Step 3: Add the `buildLeaderboardHistory` implementation to the test file**

Insert this function into `verify_leaderboard_history.js`, directly below `calculatePointsForMatch`:

```javascript
function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, standings: snapshot() }
  ];

  const resolvedMatches = db.matches
    .filter(m => m.status === 'resolved')
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.kickoff) - new Date(b.kickoff);
      if (diff !== 0) return diff;
      return String(a.matchNumber).localeCompare(String(b.matchNumber));
    });

  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType);
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0 };
      }
      standings[user].points += pointsAllocated[user];
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      standings: snapshot()
    });
  });

  return frames;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node verify_leaderboard_history.js`
Expected: `All leaderboard history tests PASSED successfully!` with all `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add verify_leaderboard_history.js
git commit -m "Add leaderboard history (racing chart frames) logic with tests"
```

---

### Task 2: Backend — wire `buildLeaderboardHistory` into the server

**Files:**
- Modify: `server.js:301` (after `calculatePointsForMatch`)
- Modify: `server.js:561` (after the `/api/leaderboard` endpoint)

- [ ] **Step 1: Add `buildLeaderboardHistory` to `server.js`**

In `server.js`, immediately after the closing brace of `calculatePointsForMatch` (line 301), add the same function verified in Task 1:

```javascript

// Build cumulative leaderboard snapshots after each resolved match, in
// chronological order (for the racing leaderboard chart)
function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, standings: snapshot() }
  ];

  const resolvedMatches = db.matches
    .filter(m => m.status === 'resolved')
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.kickoff) - new Date(b.kickoff);
      if (diff !== 0) return diff;
      return String(a.matchNumber).localeCompare(String(b.matchNumber));
    });

  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType);
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0 };
      }
      standings[user].points += pointsAllocated[user];
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      standings: snapshot()
    });
  });

  return frames;
}
```

- [ ] **Step 2: Add the `/api/leaderboard/history` endpoint**

In `server.js`, immediately after the closing `});` of the `/api/leaderboard` endpoint (line 561), add:

```javascript

// Leaderboard history (cumulative standings after each resolved match, for the racing chart)
app.get('/api/leaderboard/history', (req, res) => {
  const db = readData();
  res.json(buildLeaderboardHistory(db));
});
```

- [ ] **Step 3: Start the dev server and verify the endpoint manually**

Run: `npm run dev`
Expected output includes: `FIFA Predictions Server running on http://localhost:3000`

In a separate terminal, run:
```bash
curl -s http://localhost:3000/api/leaderboard/history
```

Expected (matches current `data.json`, which has no resolved matches and users `ADMIN` and `Prad`):
```json
[{"matchNumber":null,"homeTeam":null,"awayTeam":null,"standings":[{"name":"ADMIN","points":0},{"name":"Prad","points":0}]}]
```

Stop the dev server (Ctrl+C) when done.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add /api/leaderboard/history endpoint for racing chart frames"
```

---

### Task 3: Frontend — Table/Race toggle + Race view markup

**Files:**
- Modify: `public/index.html:104-132`

- [ ] **Step 1: Replace the Leaderboard tab section**

Replace the existing Leaderboard tab section (lines 104-132):

```html
      <!-- ================= LEADERBOARD TAB ================= -->
      <section id="tabContentLeaderboard" class="tab-content">
        <div class="section-header">
          <h2>Group Standings</h2>
          <p class="section-description">Rankings update automatically when matches are resolved by the administrator.</p>
        </div>

        <div class="leaderboard-card">
          <div class="table-responsive">
            <table class="leaderboard-table" id="leaderboardTable">
              <thead>
                <tr>
                  <th class="col-rank">Rank</th>
                  <th class="col-name">Player</th>
                  <th class="col-predictions">Predictions (Correct/Total)</th>
                  <th class="col-accuracy">Accuracy</th>
                  <th class="col-points">Total Points</th>
                </tr>
              </thead>
              <tbody id="leaderboardBody">
                <!-- Leaderboard rows will be dynamically inserted here -->
                <tr>
                  <td colspan="5" class="loading-state">Loading standings...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
```

with:

```html
      <!-- ================= LEADERBOARD TAB ================= -->
      <section id="tabContentLeaderboard" class="tab-content">
        <div class="section-header">
          <h2>Group Standings</h2>
          <p class="section-description">Rankings update automatically when matches are resolved by the administrator.</p>
        </div>

        <div class="filter-bar">
          <button class="filter-btn active" id="leaderboardViewTableBtn" onclick="switchLeaderboardView('table')">Table</button>
          <button class="filter-btn" id="leaderboardViewRaceBtn" onclick="switchLeaderboardView('race')">Race</button>
        </div>

        <div class="leaderboard-card" id="leaderboardTableView">
          <div class="table-responsive">
            <table class="leaderboard-table" id="leaderboardTable">
              <thead>
                <tr>
                  <th class="col-rank">Rank</th>
                  <th class="col-name">Player</th>
                  <th class="col-predictions">Predictions (Correct/Total)</th>
                  <th class="col-accuracy">Accuracy</th>
                  <th class="col-points">Total Points</th>
                </tr>
              </thead>
              <tbody id="leaderboardBody">
                <!-- Leaderboard rows will be dynamically inserted here -->
                <tr>
                  <td colspan="5" class="loading-state">Loading standings...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="leaderboard-card race-card" id="leaderboardRaceView" style="display: none;">
          <div class="race-frame-label" id="raceFrameLabel">Start</div>
          <div class="race-bars" id="raceBars">
            <!-- Race rows will be dynamically inserted here -->
          </div>
          <p class="loading-state" id="raceEmptyState" style="display: none;">No matches resolved yet.</p>
          <div class="race-controls">
            <button class="btn btn-secondary btn-sm" id="racePlayPauseBtn" onclick="toggleRacePlayback()">&#9654;</button>
            <input type="range" class="race-scrubber" id="raceScrubber" min="0" max="0" value="0" step="1" oninput="onRaceScrubberInput()">
          </div>
        </div>
      </section>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "Add Table/Race toggle markup to the leaderboard tab"
```

---

### Task 4: Frontend — Race view styles

**Files:**
- Modify: `public/style.css` (after line 567, before the "Rules Section Styles" comment at line 569)

- [ ] **Step 1: Insert race view CSS**

In `public/style.css`, after this existing block (ends at line 567):

```css
.rank-1 .col-name {
  color: var(--color-gold);
}
```

and before:

```css
/* Rules Section Styles */
```

insert:

```css

/* Racing Leaderboard Chart */
.race-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.race-frame-label {
  text-align: center;
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text-muted);
  min-height: 1.2em;
}

.race-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.race-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.race-name {
  width: 90px;
  flex-shrink: 0;
  font-weight: 700;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.race-bar-track {
  flex: 1;
  height: 28px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.race-bar-fill {
  height: 100%;
  width: 0%;
  background: var(--color-accent);
  border-radius: var(--radius-sm);
  transition: width 700ms ease;
}

.race-row-leader .race-bar-fill {
  background: var(--color-gold);
}

.race-points {
  width: 70px;
  flex-shrink: 0;
  text-align: right;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--color-accent);
}

.race-row-leader .race-points {
  color: var(--color-gold);
}

.race-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.race-scrubber {
  flex: 1;
  accent-color: var(--color-accent);
}

@media (max-width: 480px) {
  .race-name {
    width: 64px;
    font-size: 0.85rem;
  }

  .race-points {
    width: 56px;
    font-size: 0.85rem;
  }

  .race-bar-track {
    height: 22px;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "Add styles for racing leaderboard chart"
```

---

### Task 5: Frontend — Race view behavior (data loading, rendering, FLIP animation, controls)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add state variables and DOM references**

In `public/app.js`, after line 20 (`let fixturesCurrentIndex = 0;`), add:

```javascript

// Racing leaderboard chart state
let raceFrames = [];
let raceCurrentFrame = 0;
let racePlaying = false;
let raceIntervalHandle = null;
let raceMaxPoints = 1;
let raceRowsByName = new Map();
const RACE_FRAME_DURATION_MS = 700;
```

Then, after line 29 (`const leaderboardBody = document.getElementById('leaderboardBody');`), add:

```javascript
const leaderboardTableView = document.getElementById('leaderboardTableView');
const leaderboardRaceView = document.getElementById('leaderboardRaceView');
const raceFrameLabel = document.getElementById('raceFrameLabel');
const raceBars = document.getElementById('raceBars');
const raceEmptyState = document.getElementById('raceEmptyState');
const racePlayPauseBtn = document.getElementById('racePlayPauseBtn');
const raceScrubber = document.getElementById('raceScrubber');
```

- [ ] **Step 2: Add the view toggle function**

In `public/app.js`, immediately after the `loadLeaderboard` function (after its closing `}` around line 229), add:

```javascript

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
```

- [ ] **Step 3: Add the data loading function**

Immediately after `switchLeaderboardView`, add:

```javascript

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

    raceCurrentFrame = 0;
    raceScrubber.max = String(Math.max(raceFrames.length - 1, 0));
    raceScrubber.value = '0';

    const hasMatches = raceFrames.length > 1;
    raceEmptyState.style.display = hasMatches ? 'none' : '';
    racePlayPauseBtn.disabled = !hasMatches;
    raceScrubber.disabled = !hasMatches;

    initRaceBars();
    renderRaceFrame(0, false);
  } catch (err) {
    console.error('Error loading leaderboard history:', err);
    raceBars.innerHTML = `<p class="loading-state error-text">Error loading race data.</p>`;
  }
}
```

- [ ] **Step 4: Add the bar row initializer**

Immediately after `loadLeaderboardHistory`, add:

```javascript

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
```

- [ ] **Step 5: Add the FLIP frame renderer**

Immediately after `initRaceBars`, add:

```javascript

// Render a given frame, animating bar width and row order changes (FLIP technique)
function renderRaceFrame(frameIndex, animate) {
  const frame = raceFrames[frameIndex];
  if (!frame) return;

  raceFrameLabel.textContent = frame.matchNumber
    ? `Match ${frame.matchNumber}: ${frame.homeTeam} vs ${frame.awayTeam}`
    : 'Start';

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
```

- [ ] **Step 6: Add playback controls**

Immediately after `renderRaceFrame`, add:

```javascript

// Play/Pause button handler
function toggleRacePlayback() {
  if (racePlaying) {
    pauseRacePlayback();
    return;
  }

  if (raceCurrentFrame >= raceFrames.length - 1) {
    raceCurrentFrame = 0;
    raceScrubber.value = '0';
    renderRaceFrame(0, true);
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
```

- [ ] **Step 7: Pause playback if the user navigates away from the Leaderboard tab**

In `switchTab` (around line 99-120), at the very start of the function body (before `activeTab = tabName;`), add:

```javascript
  if (tabName !== 'leaderboard' && racePlaying) {
    pauseRacePlayback();
  }

```

So the start of `switchTab` reads:

```javascript
function switchTab(tabName) {
  if (tabName !== 'leaderboard' && racePlaying) {
    pauseRacePlayback();
  }

  activeTab = tabName;
```

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "Add racing leaderboard chart behavior (data load, FLIP animation, controls)"
```

---

### Task 6: End-to-end manual verification

**Files:** none (manual browser testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `FIFA Predictions Server running on http://localhost:3000`

- [ ] **Step 2: Verify the Table view still works**

Open `http://localhost:3000` in a browser, log in (use secret `G594` for player `Prad`, from `data.json`), go to the **Leaderboard** tab.
Expected: The "Table | Race" toggle appears, "Table" is active by default, and the standings table renders as before (ADMIN and Prad at 0 pts).

- [ ] **Step 3: Verify the empty Race state**

Click **Race**.
Expected: The race rows for ADMIN and Prad appear at 0 pts/0-width bars, the message "No matches resolved yet." is shown, and the Play button + scrubber are disabled (since `data.json` currently has no resolved matches).

- [ ] **Step 4: Verify Race playback with resolved-match data**

Temporarily resolve the existing scheduled match to generate race frames:
```bash
curl -s -X POST http://localhost:3000/api/admin/resolve \
  -H "Content-Type: application/json" \
  -H "x-user-secret: ADMN" \
  -H "x-admin-passcode: CHANGE_ME" \
  -d '{"matchId": "match_1781237230621", "outcome": "home"}'
```
Expected: `{"success":true, ...}`

Reload the Leaderboard tab's Race view (switch to Table then back to Race, or reload the page and click Race).
Expected:
- The empty-state message is gone; Play and the scrubber are enabled.
- The frame label shows "Start" initially.
- Clicking **Play** animates through frame 1 ("Match 3: Canada vs Bosnia-Herzegovina") — bars resize and rows reorder smoothly (FLIP slide), then playback auto-stops at the last frame and the button returns to the play icon.
- Dragging the **scrubber** jumps instantly (no animation) between frames and pauses playback.
- Clicking **Play** again while at the last frame restarts from frame 0.

- [ ] **Step 5: Verify mobile layout**

Using the browser's responsive device toolbar, set the viewport to ~375px width.
Expected: Race rows stay on one line (name truncates with ellipsis if needed, bar and points value remain visible, no horizontal overflow of the page).

- [ ] **Step 6: Revert the temporary match resolution**

```bash
curl -s -X POST http://localhost:3000/api/admin/unresolve \
  -H "Content-Type: application/json" \
  -H "x-user-secret: ADMN" \
  -H "x-admin-passcode: CHANGE_ME" \
  -d '{"matchId": "match_1781237230621"}'
```
Expected: `{"success":true, ...}`

Run `git status` and confirm `data.json` shows no diff (or revert it with `git checkout -- data.json` if it does).

- [ ] **Step 7: Stop the dev server**

Stop the server (Ctrl+C).
