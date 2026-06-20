# Live Leaderboard Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll football-data.org every 60 s from the backend, compute provisional leaderboard standings from live/finished-but-unresolved match scores, and surface them in the leaderboard table with a live match info panel and per-player point delta badge.

**Architecture:** A background `setInterval` in `startServer()` fills an in-memory `_liveScoresCache`. The existing `/api/leaderboard` endpoint is enriched with two new per-player fields (`livePoints`, `provisionalDelta`) computed by running the existing `calculatePointsForMatch` against provisional outcomes from live scores. A new public `/api/live-matches` endpoint returns only the matched live matches. The frontend renders a live panel above the table and sorts/badges the table when any delta is non-zero.

**Tech Stack:** Node.js/Express (server.js), Vanilla JS (public/app.js), HTML (public/index.html), CSS (public/style.css), football-data.org v4 API.

---

## File Map

| File | Change |
|---|---|
| `server.js` | Add `_liveScoresCache`, `pollLiveScores()`, wire into `startServer()`, enrich `/api/leaderboard`, add `/api/live-matches` |
| `public/index.html` | Add `#liveMatchesPanel` div inside leaderboard tab |
| `public/style.css` | Styles for live panel, LIVE banner, pulsing dot, amber badge |
| `public/app.js` | Add `loadLiveMatches()`, update `loadLeaderboard()`, update `loadDashboardData()` and `switchTab()` |

---

## Task 1: Backend — live score cache + poller

**Files:**
- Modify: `server.js` (three insertion points)

### Step 1.1 — Add `_liveScoresCache` module-level variable

Open `server.js`. Find the existing `_fixturesCache` block around line 986:

```js
let _fixturesCache = null;
let _fixturesCacheTime = 0;
const FIXTURES_CACHE_TTL = 5 * 60 * 1000;
```

Add the live cache variable **after** that block:

```js
let _liveScoresCache = [];
```

### Step 1.2 — Add `pollLiveScores()` function

Find the `STAGE_LABELS` definition block (around line 1004). Add the following function **immediately after** the `ensureSettings` function (around line 1018) and **before** the `app.get('/api/admin/settings', ...)` route:

```js
async function pollLiveScores() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': apiKey }
    });
    if (!res.ok) {
      console.warn(`[LIVE] Poll returned ${res.status}`);
      return;
    }
    const data = await res.json();
    const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);
    _liveScoresCache = (data.matches || [])
      .filter(m => LIVE_STATUSES.has(m.status))
      .map(m => {
        const ft = (m.score || {}).fullTime || {};
        return {
          homeTeam: m.homeTeam?.name || '',
          awayTeam: m.awayTeam?.name || '',
          scoreHome: ft.home ?? null,
          scoreAway: ft.away ?? null,
          status: m.status
        };
      });
    console.log(`[LIVE] Cache updated: ${_liveScoresCache.length} live/finished match(es)`);
  } catch (err) {
    console.error('[LIVE] Poll failed:', err.message);
  }
}
```

### Step 1.3 — Wire polling into `startServer()`

Find the `app.listen(PORT, () => {` block near the end of `server.js`. After the `console.log` lines inside the callback but still **inside** the callback, add:

```js
    pollLiveScores();
    setInterval(pollLiveScores, 60 * 1000);
```

The complete callback should look like:

```js
  app.listen(PORT, () => {
    console.log(`FIFA Predictions Server running on http://localhost:${PORT}`);
    if (GCS_BUCKET_NAME) {
      console.log(`[GCS] Persistence enabled: gs://${GCS_BUCKET_NAME}/${GCS_OBJECT_NAME}`);
    }
    pollLiveScores();
    setInterval(pollLiveScores, 60 * 1000);
  });
```

### Step 1.4 — Manual verify: server starts and polls

Start the server:
```
node server.js
```

Expected console output within 5 seconds (if `FOOTBALL_DATA_API_KEY` is set):
```
FIFA Predictions Server running on http://localhost:3000
[LIVE] Cache updated: N live/finished match(es)
```

If the key is not set, no `[LIVE]` line appears — that is correct (silent no-op).

- [ ] Step 1.1 — Add `_liveScoresCache` variable
- [ ] Step 1.2 — Add `pollLiveScores()` function
- [ ] Step 1.3 — Wire polling into `startServer()`
- [ ] Step 1.4 — Manual verify: server starts and logs live cache update

### Step 1.5 — Commit

```bash
git add server.js
git commit -m "feat: add live score background poller (football-data.org, 60s interval)"
```

- [ ] Step 1.5 — Commit

---

## Task 2: Backend — enrich `/api/leaderboard` with provisional points

**Files:**
- Modify: `server.js` (lines ~609–628, inside the `/api/leaderboard` handler)

### Step 2.1 — Insert provisional points computation

In `server.js`, inside the `/api/leaderboard` handler, find the block that ends the standings computation:

```js
  // Count how many currently-live matches each player has NOT voted on yet.
  Object.keys(standings).forEach(name => {
    standings[name].liveNotVoted = liveMatches.reduce(
      (count, match) => count + (votedIn(match, name) ? 0 : 1), 0
    );
  });

  // Convert map to list and sort
  const leaderboard = Object.values(standings).sort((a, b) => {
```

Insert the following block **between** the `liveNotVoted` loop and the `// Convert map to list` comment:

```js
  // Provisional points from live/finished-unresolved matches
  db.matches.forEach(match => {
    if (match.status === 'resolved') return;
    const homeNorm = match.homeTeam.trim().toLowerCase();
    const awayNorm = match.awayTeam.trim().toLowerCase();
    const liveEntry = _liveScoresCache.find(c =>
      c.homeTeam.trim().toLowerCase() === homeNorm &&
      c.awayTeam.trim().toLowerCase() === awayNorm
    );
    if (!liveEntry || liveEntry.scoreHome === null || liveEntry.scoreAway === null) return;

    let provisionalOutcome;
    if (liveEntry.scoreHome > liveEntry.scoreAway) provisionalOutcome = 'home';
    else if (liveEntry.scoreAway > liveEntry.scoreHome) provisionalOutcome = 'away';
    else provisionalOutcome = 'draw';

    const pts = calculatePointsForMatch(match.votes, provisionalOutcome, match.matchType);
    Object.keys(pts).forEach(user => {
      if (!standings[user]) ensureStanding(user);
      standings[user].provisionalDelta = (standings[user].provisionalDelta || 0) + pts[user];
    });
  });

  // Finalize livePoints for all standings (provisionalDelta defaults to 0)
  Object.values(standings).forEach(s => {
    s.provisionalDelta = s.provisionalDelta || 0;
    s.livePoints = s.points + s.provisionalDelta;
  });
```

### Step 2.2 — Manual verify: leaderboard response includes new fields

With server running, open a terminal:
```bash
curl http://localhost:3000/api/leaderboard | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.stringify(JSON.parse(d)[0], null, 2))"
```

Expected output shape (values will vary):
```json
{
  "name": "Alice",
  "points": 12,
  "correct": 4,
  "totalPredictions": 6,
  "liveNotVoted": 0,
  "provisionalDelta": 3,
  "livePoints": 15
}
```

When no matches are live, `provisionalDelta` and `livePoints` both equal `points`.

- [ ] Step 2.1 — Insert provisional points computation block
- [ ] Step 2.2 — Manual verify: leaderboard response has `livePoints` and `provisionalDelta`

### Step 2.3 — Commit

```bash
git add server.js
git commit -m "feat: enrich /api/leaderboard with provisional live points"
```

- [ ] Step 2.3 — Commit

---

## Task 3: Backend — `/api/live-matches` endpoint

**Files:**
- Modify: `server.js` (insert after `/api/leaderboard/history` handler, around line 634)

### Step 3.1 — Add the endpoint

Find the `/api/leaderboard/history` handler:

```js
app.get('/api/leaderboard/history', (req, res) => {
  const db = readData();
  res.json(buildLeaderboardHistory(db));
});
```

Add the following **immediately after** it:

```js
// Public endpoint: live matches that are currently affecting the provisional leaderboard
app.get('/api/live-matches', (req, res) => {
  const db = readData();
  const unresolvedMatches = db.matches.filter(m => m.status !== 'resolved');

  const matched = _liveScoresCache.filter(live => {
    const liveHome = live.homeTeam.trim().toLowerCase();
    const liveAway = live.awayTeam.trim().toLowerCase();
    return unresolvedMatches.some(m =>
      m.homeTeam.trim().toLowerCase() === liveHome &&
      m.awayTeam.trim().toLowerCase() === liveAway
    );
  });

  res.json(matched);
});
```

### Step 3.2 — Manual verify: endpoint responds

```bash
curl http://localhost:3000/api/live-matches
```

Expected: `[]` when no matches are live, or an array of objects like:
```json
[
  {
    "homeTeam": "England",
    "awayTeam": "France",
    "scoreHome": 2,
    "scoreAway": 1,
    "status": "IN_PLAY"
  }
]
```

- [ ] Step 3.1 — Add `/api/live-matches` endpoint
- [ ] Step 3.2 — Manual verify: endpoint responds with `[]` or live match data

### Step 3.3 — Commit

```bash
git add server.js
git commit -m "feat: add /api/live-matches public endpoint"
```

- [ ] Step 3.3 — Commit

---

## Task 4: Frontend HTML — live match panel container

**Files:**
- Modify: `public/index.html`

### Step 4.1 — Add panel div

In `public/index.html`, find the filter bar followed by the leaderboard card:

```html
        <div class="filter-bar">
          <button class="filter-btn active" id="leaderboardViewTableBtn" onclick="switchLeaderboardView('table')">Table</button>
```

Add a new div **between** the closing `</div>` of the filter bar and the `<div class="leaderboard-card" id="leaderboardTableView">`:

```html
        <div id="liveMatchesPanel" style="display: none;"></div>

        <div class="leaderboard-card" id="leaderboardTableView">
```

The surrounding context should look like:

```html
        <div class="filter-bar">
          <button class="filter-btn active" id="leaderboardViewTableBtn" onclick="switchLeaderboardView('table')">Table</button>
          <button class="filter-btn" id="leaderboardViewRaceBtn" onclick="switchLeaderboardView('race')">Chart</button>
          <button class="filter-btn" id="leaderboardViewCompareBtn" onclick="switchLeaderboardView('compare')">Compare</button>
          <button class="filter-btn" id="leaderboardViewClimbBtn" onclick="switchLeaderboardView('climb')">&#127956; Climb</button>
          <button class="filter-btn save-img-btn" id="leaderboardSaveImgBtn" onclick="saveLeaderboardImage()">&#128247; Save image</button>
        </div>

        <div id="liveMatchesPanel" style="display: none;"></div>

        <div class="leaderboard-card" id="leaderboardTableView">
```

- [ ] Step 4.1 — Add `#liveMatchesPanel` div

### Step 4.2 — Commit

```bash
git add public/index.html
git commit -m "feat: add live match panel container to leaderboard tab"
```

- [ ] Step 4.2 — Commit

---

## Task 5: Frontend CSS — live panel, banner, badge styles

**Files:**
- Modify: `public/style.css` (append to end of file)

### Step 5.1 — Add styles

Append the following to the **end** of `public/style.css`:

```css
/* ── Live leaderboard panel ──────────────────────────────────────────────── */

.live-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 8px;
  margin-bottom: 10px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #92400e;
}

.live-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  animation: pulse-live 1.5s ease-in-out infinite;
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.35; transform: scale(0.65); }
}

.live-match-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 0.88rem;
}

.live-match-status {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 99px;
}

.live-match-status.in-play,
.live-match-status.paused {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.live-match-status.finished {
  background: rgba(107, 114, 128, 0.1);
  color: #6b7280;
}

.live-match-teams {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-weight: 500;
}

.live-match-score {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-primary, #111827);
}

.live-pts-badge {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  color: #92400e;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 99px;
  padding: 1px 7px;
  margin-left: 5px;
  vertical-align: middle;
  white-space: nowrap;
}

/* Amber outline on the leaderboard card when in live mode */
.leaderboard-card.live-mode {
  border-color: rgba(245, 158, 11, 0.45);
}
```

- [ ] Step 5.1 — Append CSS to `public/style.css`

### Step 5.2 — Commit

```bash
git add public/style.css
git commit -m "feat: add live leaderboard panel and badge styles"
```

- [ ] Step 5.2 — Commit

---

## Task 6: Frontend JS — live match panel + live-mode leaderboard

**Files:**
- Modify: `public/app.js`

### Step 6.1 — Add `loadLiveMatches()` function

In `public/app.js`, find the `loadLeaderboard` function (line 239). Insert the following **immediately before** it:

```js
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
      if (status === 'IN_PLAY') return '<span class="live-match-status in-play">In Play</span>';
      if (status === 'PAUSED')  return '<span class="live-match-status paused">Paused</span>';
      return '<span class="live-match-status finished">Finished · awaiting resolution</span>';
    };

    panel.style.display = '';
    panel.innerHTML = `
      <div class="live-banner">
        <span class="live-dot"></span>
        LIVE &middot; provisional standings &middot; may change as matches progress
      </div>
      ${liveMatches.map(m => `
        <div class="live-match-card">
          ${statusTag(m.status)}
          <div class="live-match-teams">
            <span>${escapeHtml(m.homeTeam)}</span>
            <span class="live-match-score">${m.scoreHome ?? '–'} &mdash; ${m.scoreAway ?? '–'}</span>
            <span>${escapeHtml(m.awayTeam)}</span>
          </div>
        </div>
      `).join('')}
    `;
  } catch (_) {
    panel.style.display = 'none';
  }
}

```

### Step 6.2 — Replace `loadLeaderboard()` with live-mode version

Find the entire existing `loadLeaderboard` function (lines 239–283) and replace it with the following:

```js
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
      leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }

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
      const displayPts = isLiveMode ? player.livePoints : player.points;
      const liveBadge  = isLiveMode && delta > 0
        ? `<span class="live-pts-badge">+${delta}&#9889;</span>`
        : '';

      const row = document.createElement('tr');
      row.className = rankClass;
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${displayPts}<span class="unit-label"> pts</span>${liveBadge}</td>
      `;
      leaderboardBody.appendChild(row);
    });
  } catch (err) {
    console.error('Error getting leaderboard:', err);
    leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state error-text">Error loading standings.</td></tr>`;
  }
}
```

### Step 6.3 — Call `loadLiveMatches()` alongside `loadLeaderboard()` in `switchTab`

Find this block in `switchTab` (around line 141):

```js
  } else if (tabName === 'leaderboard') {
    loadLeaderboard();
```

Replace with:

```js
  } else if (tabName === 'leaderboard') {
    loadLeaderboard();
    loadLiveMatches();
```

### Step 6.4 — Add leaderboard refresh to `loadDashboardData` poll

Find the end of the `loadDashboardData` function. The function body currently ends with:

```js
    if (activeTab === 'admin' && adminPasscode) {
      loadAdminMatches();
      loadAdminHistory();
      loadAdminVotes();
    }
  } catch (err) {
    console.error('Error getting match data:', err);
  }
}
```

Add a leaderboard refresh check **immediately after** the admin block, still inside the `try`:

```js
    if (activeTab === 'admin' && adminPasscode) {
      loadAdminMatches();
      loadAdminHistory();
      loadAdminVotes();
    }

    if (activeTab === 'leaderboard') {
      loadLeaderboard();
      loadLiveMatches();
    }
  } catch (err) {
    console.error('Error getting match data:', err);
  }
}
```

- [ ] Step 6.1 — Add `loadLiveMatches()` function before `loadLeaderboard`
- [ ] Step 6.2 — Replace `loadLeaderboard()` with live-mode version
- [ ] Step 6.3 — Add `loadLiveMatches()` call in `switchTab`
- [ ] Step 6.4 — Add leaderboard+live refresh in `loadDashboardData` poll

### Step 6.5 — Manual end-to-end verify

1. Start the server: `node server.js`
2. Open `http://localhost:3000` in a browser
3. Switch to the Leaderboard tab
4. **When no matches are live:** Panel is hidden, table renders exactly as before, no badge visible
5. **Simulating live mode (test in browser console):**
   - To simulate without a real live match, temporarily set `_liveScoresCache` in `server.js` to a hardcoded test value matching one of your internal matches and restart
   - Expected: LIVE banner appears above the table, live match card shows score, affected players show `+N⚡` badge, table sorts by `livePoints`

- [ ] Step 6.5 — Manual end-to-end verify

### Step 6.6 — Commit

```bash
git add public/app.js
git commit -m "feat: show live match panel and provisional points in leaderboard"
```

- [ ] Step 6.6 — Commit

---

## Self-Review Checklist (completed)

| Spec requirement | Covered by |
|---|---|
| Backend polls football-data.org every 60 s | Task 1 |
| Rate limit: 1 req/min, free tier safe | Task 1 (noted in step 1.4) |
| Uses `IN_PLAY`, `PAUSED`, `FINISHED` statuses | Task 1, step 1.2 |
| Graceful degradation if API fails | Task 1, step 1.2 (cache preserved on error) |
| Match matching by normalized team name | Task 2, step 2.1 |
| Provisional outcome from score | Task 2, step 2.1 |
| `calculatePointsForMatch` reused unchanged | Task 2, step 2.1 |
| `livePoints` + `provisionalDelta` in leaderboard response | Task 2 |
| `/api/live-matches` public endpoint | Task 3 |
| HTML panel container | Task 4 |
| Live banner + pulsing dot styles | Task 5 |
| Live match card styles (IN_PLAY vs FINISHED) | Task 5 |
| Amber `+N⚡` badge style | Task 5 |
| `loadLiveMatches()` fetches and renders panel | Task 6, step 6.1 |
| Table sorts by `livePoints` in live mode | Task 6, step 6.2 |
| Column header changes to "Points (Live)" | Task 6, step 6.2 |
| `live-mode` class on card (amber border) | Task 6, step 6.2 |
| Panel called on tab switch | Task 6, step 6.3 |
| Panel refreshes on 10 s poll while on tab | Task 6, step 6.4 |
| No change to race/compare/climb views | Not touched in any task |
| No change when no matches are live | Task 6, step 6.2 (isLiveMode guard) |
