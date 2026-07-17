# Player Report Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-player "Report Card" — a new top-level tab showing any player's full 104-match history (pick, points, sortable), current/highest rank, streaks, accuracy, an optional self-uploaded photo, an optional offline-generated AI title, and a downloadable summary image.

**Architecture:** Pure additions to the existing single-file Express server (`server.js`) and single-file frontend (`public/app.js` + `public/index.html` + `public/style.css`) — no new services, no database, no live AI API calls. Rank/streak computation is new server-side logic built on the existing `buildLeaderboardHistory()` replay mechanism. Photos are uploaded via `multer` and stored either on local disk (dev) or in the existing GCS bucket (prod), mirroring how `data.json` itself already switches between the two. AI titles are generated **offline** in a separate Claude conversation from an exported stats JSON, then imported back through an admin-only endpoint — the running app never calls Anthropic.

**Tech Stack:** Node.js/Express, vanilla JS frontend, `data.json` flat-file persistence (local disk or GCS bucket), `multer` (new dependency) for multipart photo uploads, `html2canvas` (already vendored) for the shareable image export.

## Global Constraints

- No local dev server spin-up for verification — verify via code review, diff inspection, and the project's existing standalone `verify_*.js` script convention (see `verify_points.js`, `verify_leaderboard_history.js`). The user tests via deploys.
- Report cards are visible to **any** logged-in user for **any** player — no privacy toggle (matches the app's existing full vote-log transparency).
- No Anthropic/Claude SDK or API key in the running app. Titles are imported as static data only.
- No new heavy dependencies beyond `multer`. No image-resizing library (`sharp`, etc.) — photos are stored as uploaded and constrained via CSS at display time.
- Photo uploads: `image/jpeg`, `image/png`, `image/webp` only, max 5MB.
- A user may only upload their own photo — the target name is always derived from the authenticated `x-user-secret`, never from a request parameter.
- Follow existing code conventions exactly: `db.users` is an **array** of `{name, secret, isAdmin}` objects (not a map) — always use `db.users.find(u => u.name === x)`.

---

## File Structure

**Modify:**
- `server.js` — new helper functions (`computePlayerReportStats`, `buildTitlingExport`, photo storage helpers), new routes (`GET /api/report-card/:name`, `POST /api/profile/photo`, `GET /photos/:file`, `GET /api/admin/report-card-stats-export`, `POST /api/admin/titles/import`).
- `package.json` — add `multer` dependency.
- `.gitignore` — ignore locally-uploaded photos.
- `public/index.html` — new top-level "Report Card" tab button + section; new "Report Card Titles" admin card.
- `public/app.js` — new `switchTab` branch, `renderReportCard()` and friends, photo upload handler, admin export/import handlers, image download handler.
- `public/style.css` — small set of new classes for the report card header/photo/title badge.

**Create:**
- `verify_report_card_stats.js` — standalone script (same convention as `verify_leaderboard_history.js`) testing the new rank/streak/accuracy computation.

---

### Task 1: `computePlayerReportStats` — rank, streak, accuracy logic

**Files:**
- Create: `verify_report_card_stats.js`
- Modify: `server.js` (add function after `buildLeaderboardHistory`, currently ending at line 426)

**Interfaces:**
- Produces: `computePlayerReportStats(db, name) -> { totalPoints, correct, totalPredictions, accuracy, currentRank, highestRank, currentStreak, bestStreak }` — `db` is the full data object (`{ users: [...], matches: [...] }`), `name` is the exact player name string. `accuracy` is a number 0-100 (rounded to 1 decimal), or `0` if `totalPredictions` is 0. `currentRank`/`highestRank` are 1-based integers, or `null` if the player has no resolved-match involvement yet.

This function is built on top of the **existing** `calculatePointsForMatch`, `calculateBonusPointsForMatch`, and `buildLeaderboardHistory` (server.js:306-426) — do not duplicate their logic inside `server.js`, only inside the standalone verify script (per this repo's established testing convention, since `server.js` has no module exports and can't be safely `require()`'d without starting the whole app).

- [ ] **Step 1: Write the standalone verify script with a stub implementation**

Create `verify_report_card_stats.js`:

```js
// verify_report_card_stats.js
// Test script to verify the per-player report card stats logic
// (rank, highest rank, current/best streak, accuracy).

function calculatePointsForMatch(votes, outcome, matchType, boosters = {}) {
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
    votersHome.forEach(v => { pointsAllocated[v] = pts * ((boosters.home || []).includes(v) ? 2 : 1); });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => { pointsAllocated[v] = pts * ((boosters.away || []).includes(v) ? 2 : 1); });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => { pointsAllocated[v] = pts * ((boosters.draw || []).includes(v) ? 2 : 1); });
  }
  return pointsAllocated;
}

function getMatchStageCode(match) {
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }
  return null;
}

function calculateBonusPointsForMatch(match) {
  const bonusPoints = {};
  if (getMatchStageCode(match) !== 'QF_SF_FINAL' || !match.decidedBy) return bonusPoints;
  const bonusPicks = match.bonusPicks || {};
  Object.keys(bonusPicks).forEach(username => {
    const correctBonus = bonusPicks[username] === match.decidedBy;
    if (!correctBonus) return;
    const correctTeam = !!(match.outcome && (match.votes[match.outcome] || []).includes(username));
    bonusPoints[username] = correctTeam ? 10 : 5;
  });
  return bonusPoints;
}

function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => { standings[user.name] = { name: user.name, points: 0, correct: 0 }; });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points, correct: s.correct }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });

  const frames = [{ matchNumber: null, standings: snapshot() }];

  const resolvedMatches = db.matches
    .filter(m => m.status === 'resolved')
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.kickoff) - new Date(b.kickoff);
      if (diff !== 0) return diff;
      return String(a.matchNumber).localeCompare(String(b.matchNumber));
    });

  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const involvedUsers = new Set([...Object.keys(pointsAllocated), ...Object.keys(bonusPoints)]);
    involvedUsers.forEach(user => {
      if (!standings[user]) standings[user] = { name: user, points: 0, correct: 0 };
      const teamPts = pointsAllocated[user] || 0;
      const bonusPts = bonusPoints[user] || 0;
      if (teamPts > 0) standings[user].correct += 1;
      const total = teamPts + bonusPts;
      if (total > 0) standings[user].points += total;
    });
    frames.push({ matchNumber: match.matchNumber, standings: snapshot() });
  });

  return frames;
}

// STUB — not implemented yet, will fail every assertion below.
function computePlayerReportStats(db, name) {
  throw new Error('not implemented');
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

console.log("=== RUNNING REPORT CARD STATS TESTS ===");

// Test #1: rank climbs then a loss knocks it back down; totalPredictions/accuracy count only resolved matches voted on
console.log("\nTest #1: rank + streak across 3 resolved matches");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League', kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Alice'], away: ['Bob', 'Carol'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League', kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'away', votes: { home: ['Alice', 'Bob'], away: ['Carol'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '3', homeTeam: 'E', awayTeam: 'F', matchType: 'League', kickoff: '2026-06-03T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Alice'], away: [], draw: ['Bob', 'Carol'] }, boosters: {}, bonusPicks: {} }
    ]
  };
  // Match 1: Alice picks home (correct, +3). Bob/Carol pick away (wrong).
  //   -> standings after M1: Alice 3, Bob 0, Carol 0. Alice rank 1.
  // Match 2: Alice+Bob pick home (wrong), Carol picks away (correct, +3).
  //   -> standings after M2: Carol 3, Alice 3, Bob 0. Tie Alice/Carol by points -> tiebreak by correct(1 each) -> alphabetical: Alice rank 1, Carol rank 2.
  //   Alice's points did NOT increase (stayed at 3) -> streak breaks.
  // Match 3: Alice picks home (correct, +1 since 0 away/0 draw... wait draw voters=2 -> pts = 0+2+1=3).
  //   -> standings after M3: Alice 6, Carol 3, Bob 0. Alice rank 1 again, streak resumes at 1.
  const stats = computePlayerReportStats(db, 'Alice');
  assertDeepEqual(stats.totalPoints, 6, 'Alice totalPoints');
  assertDeepEqual(stats.correct, 2, 'Alice correct');
  assertDeepEqual(stats.totalPredictions, 3, 'Alice totalPredictions');
  assertDeepEqual(stats.accuracy, 66.7, 'Alice accuracy');
  assertDeepEqual(stats.currentRank, 1, 'Alice currentRank');
  assertDeepEqual(stats.highestRank, 1, 'Alice highestRank');
  assertDeepEqual(stats.currentStreak, 1, 'Alice currentStreak (broke at M2, resumed at M3)');
  assertDeepEqual(stats.bestStreak, 1, 'Alice bestStreak (never had 2 in a row)');
}

// Test #2: a player who never scores has null ranks and a 0 streak
console.log("\nTest #2: player with zero points across all resolved matches");
{
  const db = {
    users: [{ name: 'Dave' }, { name: 'Eve' }],
    matches: [
      { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'KO', kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Eve'], away: ['Dave'], draw: [] }, boosters: {}, bonusPicks: {} }
    ]
  };
  const stats = computePlayerReportStats(db, 'Dave');
  assertDeepEqual(stats.totalPoints, 0, 'Dave totalPoints');
  assertDeepEqual(stats.totalPredictions, 1, 'Dave totalPredictions (voted, even though wrong)');
  assertDeepEqual(stats.accuracy, 0, 'Dave accuracy');
  assertDeepEqual(stats.currentStreak, 0, 'Dave currentStreak');
  assertDeepEqual(stats.bestStreak, 0, 'Dave bestStreak');
}

// Test #3: a player with zero resolved matches at all -> null ranks, zero everything
console.log("\nTest #3: player with no resolved matches involvement");
{
  const db = { users: [{ name: 'Frank' }], matches: [] };
  const stats = computePlayerReportStats(db, 'Frank');
  assertDeepEqual(stats.totalPoints, 0, 'Frank totalPoints');
  assertDeepEqual(stats.totalPredictions, 0, 'Frank totalPredictions');
  assertDeepEqual(stats.accuracy, 0, 'Frank accuracy');
  assertDeepEqual(stats.currentRank, null, 'Frank currentRank');
  assertDeepEqual(stats.highestRank, null, 'Frank highestRank');
  assertDeepEqual(stats.currentStreak, 0, 'Frank currentStreak');
  assertDeepEqual(stats.bestStreak, 0, 'Frank bestStreak');
}

if (failed) {
  console.error("\n=== SOME TESTS FAILED ===");
  process.exit(1);
} else {
  console.log("\n=== ALL TESTS PASSED ===");
}
```

- [ ] **Step 2: Run the script to verify it fails**

Run: `node verify_report_card_stats.js`
Expected: throws `Error: not implemented` (uncaught), non-zero exit code.

- [ ] **Step 3: Implement `computePlayerReportStats` in the verify script**

Replace the stub in `verify_report_card_stats.js` with:

```js
function computePlayerReportStats(db, name) {
  const frames = buildLeaderboardHistory(db);
  const matchFrames = frames.slice(1); // drop the initial all-zero frame

  let currentRank = null;
  let highestRank = null;
  let runningStreak = 0;
  let bestStreak = 0;
  let prevPoints = 0;
  let sawAnyFrame = false;

  matchFrames.forEach(frame => {
    const idx = frame.standings.findIndex(s => s.name === name);
    if (idx !== -1) {
      sawAnyFrame = true;
      const rank = idx + 1;
      currentRank = rank;
      if (highestRank === null || rank < highestRank) highestRank = rank;
    }
    const entry = idx !== -1 ? frame.standings[idx] : null;
    const points = entry ? entry.points : prevPoints;
    if (points > prevPoints) {
      runningStreak += 1;
    } else {
      runningStreak = 0;
    }
    if (runningStreak > bestStreak) bestStreak = runningStreak;
    prevPoints = points;
  });

  if (!sawAnyFrame) {
    currentRank = null;
    highestRank = null;
  }

  // totalPredictions/correct: count resolved matches this player voted in,
  // same definition GET /api/leaderboard already uses.
  let totalPredictions = 0;
  let correct = 0;
  let totalPoints = 0;
  db.matches.forEach(match => {
    if (match.status !== 'resolved') return;
    const voted = (match.votes.home || []).includes(name)
      || (match.votes.away || []).includes(name)
      || (match.votes.draw || []).includes(name);
    if (voted) totalPredictions += 1;

    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const teamPts = pointsAllocated[name] || 0;
    const bonusPts = bonusPoints[name] || 0;
    if (teamPts > 0) correct += 1;
    totalPoints += teamPts + bonusPts;
  });

  const accuracy = totalPredictions > 0 ? Math.round((correct / totalPredictions) * 1000) / 10 : 0;

  return {
    totalPoints,
    correct,
    totalPredictions,
    accuracy,
    currentRank,
    highestRank,
    currentStreak: runningStreak,
    bestStreak
  };
}
```

- [ ] **Step 4: Run the script to verify it passes**

Run: `node verify_report_card_stats.js`
Expected: `=== ALL TESTS PASSED ===`, exit code 0.

- [ ] **Step 5: Copy the finalized function into `server.js`**

In `server.js`, immediately after the closing `}` of `buildLeaderboardHistory` (currently ends at line 426, right before the `// Middleware: Authenticate user secret and get username` comment), insert:

```js

// Per-player report card stats: rank (current + highest ever) and prediction
// streak (current + best), derived from the same buildLeaderboardHistory replay
// used by the racing chart and comparison view, so numbers never disagree
// across views. totalPredictions/correct/accuracy mirror GET /api/leaderboard's
// counting rules exactly.
function computePlayerReportStats(db, name) {
  const frames = buildLeaderboardHistory(db);
  const matchFrames = frames.slice(1);

  let currentRank = null;
  let highestRank = null;
  let runningStreak = 0;
  let bestStreak = 0;
  let prevPoints = 0;
  let sawAnyFrame = false;

  matchFrames.forEach(frame => {
    const idx = frame.standings.findIndex(s => s.name === name);
    if (idx !== -1) {
      sawAnyFrame = true;
      const rank = idx + 1;
      currentRank = rank;
      if (highestRank === null || rank < highestRank) highestRank = rank;
    }
    const entry = idx !== -1 ? frame.standings[idx] : null;
    const points = entry ? entry.points : prevPoints;
    if (points > prevPoints) {
      runningStreak += 1;
    } else {
      runningStreak = 0;
    }
    if (runningStreak > bestStreak) bestStreak = runningStreak;
    prevPoints = points;
  });

  if (!sawAnyFrame) {
    currentRank = null;
    highestRank = null;
  }

  let totalPredictions = 0;
  let correct = 0;
  let totalPoints = 0;
  db.matches.forEach(match => {
    if (match.status !== 'resolved') return;
    const voted = (match.votes.home || []).includes(name)
      || (match.votes.away || []).includes(name)
      || (match.votes.draw || []).includes(name);
    if (voted) totalPredictions += 1;

    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const teamPts = pointsAllocated[name] || 0;
    const bonusPts = bonusPoints[name] || 0;
    if (teamPts > 0) correct += 1;
    totalPoints += teamPts + bonusPts;
  });

  const accuracy = totalPredictions > 0 ? Math.round((correct / totalPredictions) * 1000) / 10 : 0;

  return {
    totalPoints,
    correct,
    totalPredictions,
    accuracy,
    currentRank,
    highestRank,
    currentStreak: runningStreak,
    bestStreak
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add server.js verify_report_card_stats.js
git commit -m "feat: add computePlayerReportStats (rank, streak, accuracy)"
```

---

### Task 2: `GET /api/report-card/:name` endpoint

**Files:**
- Modify: `server.js` (add route after `GET /api/leaderboard/history`, currently server.js:862-865)

**Interfaces:**
- Consumes: `computePlayerReportStats(db, name)` from Task 1; existing `calculatePointsForMatch`, `calculateBonusPointsForMatch`, `getMatchStageCode`, `ensureMatchBoosterData`, `ensureMatchBonusData`, `authenticateSecret` (all already in `server.js`).
- Produces: `GET /api/report-card/:name` response shape used by Task 6 (frontend):
  ```
  {
    name, photoUrl (string|null), title (string|null), titleReason (string|null),
    stats: { totalPoints, correct, totalPredictions, accuracy, currentRank, highestRank, currentStreak, bestStreak },
    matches: [ { matchNumber, group, stage, homeTeam, awayTeam, kickoff, status, outcome, decidedBy, pick, boosted, bonusPick, points }, ... ]
  }
  ```
  `matches` is chronological ascending by kickoff. `pick` is `'home'|'away'|'draw'|null`. `stage` is the `getMatchStageCode` result (`null|'LAST_32'|'LAST_16'|'QF_SF_FINAL'`). `points` is `0` for unresolved matches.

- [ ] **Step 1: Add the route**

In `server.js`, immediately after the `GET /api/leaderboard/history` route (currently lines 862-865):

```js

// Report Card: one player's full match history (pick + points) plus their
// rank/streak/accuracy stats. Any authenticated user may view any player's
// card — report cards are intentionally public within the group.
app.get('/api/report-card/:name', authenticateSecret, (req, res) => {
  const db = readData();
  const targetName = req.params.name;
  const user = db.users.find(u => u.name === targetName);
  if (!user) {
    return res.status(404).json({ error: 'Player not found.' });
  }

  const matches = db.matches
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .map(match => {
      ensureMatchBoosterData(match);
      ensureMatchBonusData(match);
      const isResolved = match.status === 'resolved';

      let pick = null;
      if ((match.votes.home || []).includes(targetName)) pick = 'home';
      else if ((match.votes.away || []).includes(targetName)) pick = 'away';
      else if ((match.votes.draw || []).includes(targetName)) pick = 'draw';

      const boosted = !!(pick && match.boosters[pick] && match.boosters[pick].includes(targetName));
      const bonusPick = match.bonusPicks[targetName] || null;

      let points = 0;
      if (isResolved) {
        const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
        const bonusPoints = calculateBonusPointsForMatch(match);
        points = (pointsAllocated[targetName] || 0) + (bonusPoints[targetName] || 0);
      }

      return {
        matchNumber: match.matchNumber,
        group: match.group,
        stage: getMatchStageCode(match),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoff: match.kickoff,
        status: match.status,
        outcome: match.outcome,
        decidedBy: match.decidedBy || null,
        pick,
        boosted,
        bonusPick,
        points
      };
    });

  const stats = computePlayerReportStats(db, targetName);

  res.json({
    name: user.name,
    photoUrl: user.photoUrl || null,
    title: user.title || null,
    titleReason: user.titleReason || null,
    stats,
    matches
  });
});
```

- [ ] **Step 2: Manual trace verification**

Per this project's convention (no local server spin-up — code review + diff checks): pick one player from the live `data.json` (e.g. `RAAG`), and by hand:
1. Sum the `points` field across the returned `matches` array and confirm it equals `stats.totalPoints`.
2. Confirm `stats.totalPoints` matches that same player's `points` entry from a manual trace of `GET /api/leaderboard`'s logic (same underlying `calculatePointsForMatch`/`calculateBonusPointsForMatch` calls) — they must agree since both call the same two functions.
3. Confirm a match where the player didn't vote shows `pick: null, points: 0`, and an unresolved match shows `points: 0` regardless of pick.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add GET /api/report-card/:name endpoint"
```

---

### Task 3: Photo upload + storage + serving

**Files:**
- Modify: `package.json` (add `multer`)
- Modify: `server.js` (photo storage helpers + `POST /api/profile/photo` + `GET /photos/:file`)
- Modify: `.gitignore` (ignore local upload dir)

**Interfaces:**
- Produces: `POST /api/profile/photo` (multipart form field `photo`, header `x-user-secret`) → `{ success: true, photoUrl }`. `GET /photos/:file` → streams the image (404 if missing, 400 if `:file` doesn't match the expected filename pattern).
- Consumes: `authenticateSecret` (existing), `gcsBucket`/`GCS_BUCKET_NAME` (existing, server.js:8-20), `readData`/`writeData` (existing).

- [ ] **Step 1: Add the `multer` dependency**

```bash
npm install multer
```

Verify `package.json` now lists it:
```json
    "multer": "^1.4.5-lts.1",
```

- [ ] **Step 2: Ignore local photo uploads in git**

In `.gitignore`, after the `# Runtime data...` block (the `data.*-backup-*.json` line), add:

```

# Locally-uploaded profile photos (dev mode only — prod stores these in GCS)
public/uploads/
```

- [ ] **Step 3: Add photo storage helpers and routes to `server.js`**

Near the top of `server.js`, right after the existing `const app = express();` / `const PORT = ...` / `const DATA_FILE = ...` block (currently lines 23-25), add:

```js
const multer = require('multer');
const PHOTOS_DIR = path.join(__dirname, 'public', 'uploads', 'photos');
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WebP images are allowed.'));
    }
    cb(null, true);
  }
});

function extFromMimetype(mimetype) {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
}

function mimeFromExt(filename) {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// A player's own name, lowercased and stripped to [a-z0-9], used as the
// photo filename stem. Existing player names in this app are unique and
// distinct enough after stripping that collisions aren't a practical concern
// for a small friend-group deployment.
function safePhotoStem(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'player';
}
```

Then, immediately after the leaderboard/report-card routes (after the `GET /api/report-card/:name` route added in Task 2), add:

```js

// Self-service profile photo upload. The target user is always the
// authenticated caller — there is no path to overwrite someone else's photo.
app.post('/api/profile/photo', authenticateSecret, (req, res) => {
  photoUpload.single('photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided.' });
    }

    const ext = extFromMimetype(req.file.mimetype);
    const fileName = `${safePhotoStem(req.username)}.${ext}`;

    try {
      if (gcsBucket) {
        await gcsBucket.file(`photos/${fileName}`).save(req.file.buffer, { contentType: req.file.mimetype });
      } else {
        fs.mkdirSync(PHOTOS_DIR, { recursive: true });
        fs.writeFileSync(path.join(PHOTOS_DIR, fileName), req.file.buffer);
      }
    } catch (saveErr) {
      console.error('Failed to save photo:', saveErr);
      return res.status(500).json({ error: 'Failed to save photo.' });
    }

    const db = readData();
    const user = db.users.find(u => u.name === req.username);
    user.photoUrl = `/photos/${fileName}?v=${Date.now()}`;
    writeData(db);

    res.json({ success: true, photoUrl: user.photoUrl });
  });
});

// Serve a photo regardless of storage backend (GCS in prod, local disk in dev).
app.get('/photos/:file', async (req, res) => {
  const file = req.params.file;
  if (!/^[a-z0-9]+\.(jpg|jpeg|png|webp)$/i.test(file)) {
    return res.status(400).send('Invalid file name.');
  }

  if (gcsBucket) {
    try {
      const gcsFile = gcsBucket.file(`photos/${file}`);
      const [exists] = await gcsFile.exists();
      if (!exists) return res.status(404).send('Not found.');
      res.setHeader('Content-Type', mimeFromExt(file));
      gcsFile.createReadStream()
        .on('error', (streamErr) => {
          console.error('[GCS] Failed to stream photo:', streamErr);
          if (!res.headersSent) res.status(500).send('Failed to load photo.');
        })
        .pipe(res);
    } catch (err) {
      console.error('[GCS] Failed to load photo:', err);
      res.status(500).send('Failed to load photo.');
    }
  } else {
    const localPath = path.join(PHOTOS_DIR, file);
    if (!fs.existsSync(localPath)) return res.status(404).send('Not found.');
    res.sendFile(localPath);
  }
});
```

- [ ] **Step 4: Manual trace verification**

Code review / diff check (no server spin-up):
1. Confirm `photoUpload.single('photo')` is invoked as middleware inside the handler (not via `app.post(path, photoUpload.single('photo'), handler)`) — this is deliberate so multer's error (e.g. wrong file type, oversized file) is caught and returned as JSON `400` instead of crashing/producing an HTML error page.
2. Confirm `:file` regex in `GET /photos/:file` rejects path-traversal-style input (e.g. `../../etc/passwd`, `a/b.jpg`) — the pattern `^[a-z0-9]+\.(jpg|jpeg|png|webp)$` has no `/` or `.` other than the extension separator, so `require('path').join` can't escape `PHOTOS_DIR`.
3. Confirm `req.username` (set by `authenticateSecret`, server.js:429-442) — not any request body/param — is the sole source of the filename, so a user cannot upload as another user.

- [ ] **Step 5: Commit**

```bash
git add server.js package.json package-lock.json .gitignore
git commit -m "feat: add self-service profile photo upload and serving"
```

---

### Task 4: Offline AI titling — admin export/import endpoints

**Files:**
- Modify: `server.js` (add `buildTitlingExport` helper + two admin routes)

**Interfaces:**
- Consumes: `computePlayerReportStats` (Task 1), `verifyAdmin` (existing, server.js:447-468).
- Produces: `GET /api/admin/report-card-stats-export` → JSON array `[{ name, totalPoints, accuracy, currentRank, highestRank, currentStreak, bestStreak }, ...]`. `POST /api/admin/titles/import` (body: `{ "PlayerName": { "title": "...", "reason": "..." }, ... }`) → `{ success: true, updated: <count> }`.

- [ ] **Step 1: Add the helper and routes**

In `server.js`, immediately after `computePlayerReportStats` (added in Task 1), add:

```js

// Builds the JSON an admin downloads to paste into an offline Claude
// conversation for generating fun per-player titles. No API key/SDK lives
// in this app — titles are written back via POST /api/admin/titles/import.
function buildTitlingExport(db) {
  return db.users.map(user => {
    const stats = computePlayerReportStats(db, user.name);
    return {
      name: user.name,
      totalPoints: stats.totalPoints,
      accuracy: stats.accuracy,
      currentRank: stats.currentRank,
      highestRank: stats.highestRank,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak
    };
  });
}
```

Then, near the other `verifyAdmin`-protected routes (e.g. right after `GET /api/admin/history`, currently server.js:990-995), add:

```js

app.get('/api/admin/report-card-stats-export', verifyAdmin, (req, res) => {
  const db = readData();
  res.json(buildTitlingExport(db));
});

app.post('/api/admin/titles/import', verifyAdmin, (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Body must be a JSON object mapping player name -> {title, reason}.' });
  }

  const db = readData();
  let updated = 0;
  Object.keys(payload).forEach(name => {
    const user = db.users.find(u => u.name === name);
    if (!user) return;
    const entry = payload[name] || {};
    if (typeof entry.title === 'string' && entry.title.trim()) {
      user.title = entry.title.trim();
      user.titleReason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
      updated += 1;
    }
  });
  writeData(db);

  res.json({ success: true, updated });
});
```

- [ ] **Step 2: Manual trace verification**

Code review / diff check:
1. Confirm names in the import payload that don't match any `db.users[].name` are silently skipped (not an error) — a partial/typo'd import shouldn't 500.
2. Confirm re-importing a payload that omits a previously-titled player leaves that player's existing `title`/`titleReason` untouched (the loop only ever writes keys present in `payload`).
3. Confirm `buildTitlingExport` reuses `computePlayerReportStats` rather than re-deriving rank/streak — no duplicated math.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add admin export/import endpoints for offline report card titling"
```

---

### Task 5: Admin panel UI — "Report Card Titles" card

**Files:**
- Modify: `public/index.html` (new admin card)
- Modify: `public/app.js` (export/import handlers)

**Interfaces:**
- Consumes: `GET /api/admin/report-card-stats-export`, `POST /api/admin/titles/import` (Task 4); existing globals `adminPasscode`, `currentUserSecret` (used by every other admin fetch, e.g. `downloadHistoryCSV`, app.js:3738-3782).
- Produces: `exportReportCardStats()`, `importReportCardTitles(event)` — wired to new buttons/inputs in `index.html`.

- [ ] **Step 1: Add the admin card markup**

In `public/index.html`, inside `.admin-grid` (opens at line 427), add a new card. Insert it right before the closing of the grid — i.e. immediately after the "System History & Audit Log" card block that contains the `downloadHistoryCSV()` button (server.js exploration found this at index.html:641-642; insert the new card as a sibling `.rules-card` div right after that card's closing `</div></div>`):

```html
            <!-- Report Card Titles Card -->
            <div class="rules-card">
              <h3 class="card-toggle" onclick="toggleAdminCard(this)">🎖️ Report Card Titles <span class="collapse-chevron">▾</span></h3>
              <div class="card-body">
                <p class="small-desc">Export player stats to generate fun titles (e.g. "Risk Taker") offline in a Claude conversation, then import the result back in.</p>
                <div class="form-group inline-form" style="margin-bottom: 10px;">
                  <button class="btn btn-primary btn-sm" onclick="exportReportCardStats()">Export Stats for Titling</button>
                </div>
                <div class="form-group inline-form">
                  <input type="file" id="titlesImportInput" accept="application/json" class="form-control">
                  <button class="btn btn-success btn-sm" onclick="importReportCardTitles()">Import Titles</button>
                </div>
                <div id="titlesImportMessage" class="feedback-message"></div>
              </div>
            </div>
```

- [ ] **Step 2: Add the JS handlers**

In `public/app.js`, immediately after `downloadHistoryCSV` (ends at line 3782), add:

```js

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
    messageEl.className = 'feedback-message error-text';
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
    messageEl.className = 'feedback-message success-text';
    input.value = '';
  } catch (err) {
    console.error('Error importing titles:', err);
    messageEl.textContent = 'Failed to import: ' + err.message;
    messageEl.className = 'feedback-message error-text';
  }
}
```

- [ ] **Step 3: Manual trace verification**

Code review / diff check: confirm `exportReportCardStats`/`importReportCardTitles` send the same two headers (`x-admin-passcode`, `x-user-secret`) every other admin action already sends (matches `downloadHistoryCSV`, `togglePlayerRole`), and that `feedback-message`/`success-text`/`error-text` classes already exist in `style.css` (used elsewhere, e.g. `addPlayerMessage`) rather than being invented here.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: add admin UI for exporting/importing report card titles"
```

---

### Task 6: Report Card tab — markup and styles

**Files:**
- Modify: `public/index.html` (new top-level tab button + section)
- Modify: `public/style.css` (new classes for header/photo/title)

**Interfaces:**
- Produces: DOM structure Task 7's JS renders into — ids: `tabBtnReportCard`, `tabContentReportCard`, `reportCardPlayerSelect`, `reportCardHeader`, `reportCardPhoto`, `reportCardName`, `reportCardTitle`, `reportCardStats`, `reportCardSortToggle`, `reportCardTableBody`, `reportCardPhotoInput`, `reportCardUploadBtn`, `reportCardUploadSection`, `reportCardDownloadBtn`.

- [ ] **Step 1: Add the nav tab button**

In `public/index.html`, inside `<nav class="tab-nav">` (opens at line 51), add a new button right after the Leaderboard tab button (currently lines 61-63):

```html
        <button class="tab-btn" id="tabBtnReportCard" onclick="switchTab('reportCard')">
          <span class="tab-icon">🪪</span> <span class="tab-label">Report Card</span>
        </button>
```

- [ ] **Step 2: Add the section markup**

Immediately after the `tabContentLeaderboard` section closes (the Leaderboard section runs from line 132; find its closing `</section>` — it's the one right before `<section id="tabContentRules"` at line 332) and before `tabContentRules`, insert:

```html
      <section id="tabContentReportCard" class="tab-content">
        <div class="section-header">
          <h2>Report Card</h2>
          <p class="section-description">Every prediction, every point. Pick a player to see their full tournament.</p>
        </div>

        <div class="filter-bar">
          <select id="reportCardPlayerSelect" class="form-control" onchange="loadReportCard(this.value)" style="max-width: 220px;"></select>
          <button class="filter-btn" id="reportCardSortToggle" onclick="toggleReportCardSort()">Sort: Chronological</button>
          <button class="filter-btn save-img-btn" id="reportCardDownloadBtn" onclick="downloadReportCardImage()">&#128247; Download Card</button>
        </div>

        <div class="leaderboard-card report-card-header" id="reportCardHeader">
          <div class="report-card-photo-wrap">
            <img id="reportCardPhoto" class="report-card-photo" style="display:none;" alt="Player photo">
            <div id="reportCardPhotoPlaceholder" class="report-card-photo report-card-photo-placeholder">?</div>
          </div>
          <div class="report-card-identity">
            <div class="report-card-name" id="reportCardName">&nbsp;</div>
            <div class="report-card-title" id="reportCardTitle"></div>
            <div class="report-card-stats" id="reportCardStats"></div>
          </div>
        </div>

        <div class="leaderboard-card" id="reportCardUploadSection" style="display:none; padding: 14px 18px;">
          <div class="form-group inline-form">
            <input type="file" id="reportCardPhotoInput" accept="image/jpeg,image/png,image/webp" class="form-control">
            <button class="btn btn-primary btn-sm" id="reportCardUploadBtn" onclick="uploadReportCardPhoto()">Upload Photo</button>
          </div>
          <div id="reportCardUploadMessage" class="feedback-message"></div>
        </div>

        <div class="leaderboard-card">
          <div class="table-responsive">
            <table class="leaderboard-table">
              <thead>
                <tr>
                  <th>Match #</th>
                  <th>Matchup</th>
                  <th>Stage</th>
                  <th>Kickoff</th>
                  <th>Result</th>
                  <th>Pick</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody id="reportCardTableBody">
                <tr><td colspan="7" class="loading-state">Select a player…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
```

- [ ] **Step 3: Add CSS**

In `public/style.css`, after the `.leaderboard-card` rule (currently lines 682-689), add:

```css
.report-card-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
}

.report-card-photo-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  flex-shrink: 0;
}

.report-card-photo {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border-color);
}

.report-card-photo-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  color: var(--color-accent);
  font-size: 2.5rem;
  font-weight: 800;
}

.report-card-identity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.report-card-name {
  font-size: 1.4rem;
  font-weight: 800;
}

.report-card-title {
  color: var(--color-gold);
  font-weight: 700;
  font-size: 0.95rem;
}

.report-card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.report-card-stats strong {
  color: var(--text-primary);
}
```

- [ ] **Step 4: Manual trace verification**

Code review / diff check: confirm `id`s here exactly match the ones Task 7 will query (`reportCardPlayerSelect`, `reportCardHeader`, `reportCardPhoto`, `reportCardPhotoPlaceholder`, `reportCardName`, `reportCardTitle`, `reportCardStats`, `reportCardSortToggle`, `reportCardTableBody`, `reportCardUploadSection`, `reportCardPhotoInput`, `reportCardDownloadBtn`) — a typo here silently breaks Task 7's rendering with no console error (since these are looked up via `document.getElementById`, which returns `null` rather than throwing).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add Report Card tab markup and styles"
```

---

### Task 7: Report Card rendering, sorting, photo upload, and image export

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/report-card/:name`, `POST /api/profile/photo` (Tasks 2-3); DOM ids from Task 6; existing globals `currentUsername`, `currentUserSecret`, `matches` (already-loaded array of all matches, used to populate the player picker's option list is instead sourced from `db.users` via a lightweight new fetch — see Step 1); existing helpers `escapeHtml` (app.js:3028-3036), `buildFlagSpan` (app.js:1654-1658); existing `switchTab` (app.js:189-216); existing `saveLeaderboardImage` pattern (app.js:942-969) for the `html2canvas` call.
- Produces: `switchTab('reportCard')` branch, `loadReportCard(name)`, `renderReportCard(data)`, `toggleReportCardSort()`, `uploadReportCardPhoto()`, `downloadReportCardImage()`. Module-level state: `reportCardData` (last-fetched payload), `reportCardSortMode` (`'chronological'|'points'`).

- [ ] **Step 1: Wire the new tab into `switchTab` and add module state**

In `public/app.js`, near the top where other module-level state is declared (alongside `currentUsername` etc., lines 4-6), add:

```js
let reportCardData = null;
let reportCardSortMode = 'chronological';
```

In `switchTab` (app.js:189-216), add a branch — change:
```js
  } else if (tabName === 'admin') {
    checkAdminState();
    initializeDefaultKickoff();
  }
}
```
to:
```js
  } else if (tabName === 'admin') {
    checkAdminState();
    initializeDefaultKickoff();
  } else if (tabName === 'reportCard') {
    initReportCardTab();
  }
}
```

- [ ] **Step 2: Add the init + fetch + render functions**

Immediately after `switchTab` (which now ends around line 218), add:

```js

async function initReportCardTab() {
  const select = document.getElementById('reportCardPlayerSelect');
  if (select.dataset.loaded !== 'true') {
    try {
      const response = await fetch('/api/admin/users', {
        headers: { 'x-user-secret': currentUserSecret, 'x-admin-passcode': adminPasscode }
      });
      // Non-admins can't call /api/admin/users — fall back to deriving the
      // player list from already-loaded match vote data instead.
      let names;
      if (response.ok) {
        const users = await response.json();
        names = users.map(u => u.name);
      } else {
        const nameSet = new Set();
        (matches || []).forEach(m => {
          (m.voters ? [...(m.voters.home || []), ...(m.voters.away || []), ...(m.voters.draw || [])] : []).forEach(n => nameSet.add(n));
        });
        nameSet.add(currentUsername);
        names = [...nameSet];
      }
      names.sort((a, b) => a.localeCompare(b));
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
  const tbody = document.getElementById('reportCardTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="loading-state">Loading ${escapeHtml(name)}'s report card…</td></tr>`;
  try {
    const response = await fetch(`/api/report-card/${encodeURIComponent(name)}`, {
      headers: { 'x-user-secret': currentUserSecret }
    });
    if (!response.ok) throw new Error('Failed to load report card');
    reportCardData = await response.json();
    reportCardSortMode = 'chronological';
    document.getElementById('reportCardSortToggle').textContent = 'Sort: Chronological';
    renderReportCard(reportCardData);
  } catch (err) {
    console.error('Error loading report card:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="loading-state">Failed to load report card.</td></tr>`;
  }
}

function renderReportCard(data) {
  const photo = document.getElementById('reportCardPhoto');
  const placeholder = document.getElementById('reportCardPhotoPlaceholder');
  if (data.photoUrl) {
    photo.src = data.photoUrl;
    photo.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    photo.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = data.name.charAt(0).toUpperCase();
  }

  document.getElementById('reportCardName').textContent = data.name;
  const titleEl = document.getElementById('reportCardTitle');
  titleEl.textContent = data.title || '';
  titleEl.title = data.titleReason || '';

  const s = data.stats;
  document.getElementById('reportCardStats').innerHTML = `
    <span><strong>${s.totalPoints}</strong> pts</span>
    <span><strong>${s.accuracy}%</strong> accuracy (${s.correct}/${s.totalPredictions})</span>
    <span>Rank <strong>${s.currentRank ?? '—'}</strong></span>
    <span>Best Rank <strong>${s.highestRank ?? '—'}</strong></span>
    <span>Streak <strong>${s.currentStreak}</strong></span>
    <span>Best Streak <strong>${s.bestStreak}</strong></span>
  `;

  const uploadSection = document.getElementById('reportCardUploadSection');
  uploadSection.style.display = (data.name === currentUsername) ? 'block' : 'none';

  renderReportCardTable(data.matches);
}

function renderReportCardTable(rawMatches) {
  const tbody = document.getElementById('reportCardTableBody');
  const rows = rawMatches.slice();
  if (reportCardSortMode === 'points') {
    rows.sort((a, b) => b.points - a.points);
  } else {
    rows.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  }

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-state">No matches yet.</td></tr>`;
    return;
  }

  const stageLabels = { LAST_32: 'Round of 32', LAST_16: 'Round of 16', QF_SF_FINAL: 'QF/SF/Final' };
  const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };

  tbody.innerHTML = rows.map(m => {
    const isResolved = m.status === 'resolved';
    const kickoffStr = new Date(m.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    let resultText = '<span style="color: var(--color-warning);">Locked / Live</span>';
    if (isResolved) {
      const winnerTeam = m.outcome === 'home' ? m.homeTeam : m.outcome === 'away' ? m.awayTeam : 'Draw';
      resultText = escapeHtml(winnerTeam);
      if (m.decidedBy) resultText += ` <span style="color: var(--text-muted); font-size: 0.75rem;">(${bonusLabels[m.decidedBy]})</span>`;
    }

    let pickText = '<span style="color: var(--text-muted);">No Vote</span>';
    let pickClass = '';
    if (m.pick) {
      const pickTeam = m.pick === 'home' ? m.homeTeam : m.pick === 'away' ? m.awayTeam : 'Draw';
      pickText = escapeHtml(pickTeam) + (m.boosted ? ' ⚡' : '');
      if (m.bonusPick) pickText += ` · ${bonusLabels[m.bonusPick]}`;
      if (isResolved) pickClass = m.points > 0 ? 'text-active' : 'error-text';
    }

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="text-align:center; font-family: monospace; color: var(--color-accent);">${m.matchNumber ? '#' + m.matchNumber : '-'}</td>
        <td>${escapeHtml(m.homeTeam)} vs ${escapeHtml(m.awayTeam)}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${m.stage ? stageLabels[m.stage] : escapeHtml(m.group || '')}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${kickoffStr}</td>
        <td>${resultText}</td>
        <td class="${pickClass}">${pickText}</td>
        <td style="text-align:center; font-weight:700;">${isResolved ? m.points : '—'}</td>
      </tr>
    `;
  }).join('');
}

function toggleReportCardSort() {
  reportCardSortMode = reportCardSortMode === 'chronological' ? 'points' : 'chronological';
  document.getElementById('reportCardSortToggle').textContent =
    reportCardSortMode === 'points' ? 'Sort: Highest Points' : 'Sort: Chronological';
  if (reportCardData) renderReportCardTable(reportCardData.matches);
}
```

- [ ] **Step 3: Add photo upload and image download handlers**

Immediately after `toggleReportCardSort`, add:

```js

async function uploadReportCardPhoto() {
  const input = document.getElementById('reportCardPhotoInput');
  const messageEl = document.getElementById('reportCardUploadMessage');
  messageEl.textContent = '';
  messageEl.className = 'feedback-message';

  if (!input.files || input.files.length === 0) {
    messageEl.textContent = 'Choose a photo first.';
    messageEl.className = 'feedback-message error-text';
    return;
  }

  const formData = new FormData();
  formData.append('photo', input.files[0]);

  try {
    const response = await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { 'x-user-secret': currentUserSecret },
      body: formData
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');

    messageEl.textContent = 'Photo updated!';
    messageEl.className = 'feedback-message success-text';
    input.value = '';
    loadReportCard(currentUsername);
  } catch (err) {
    console.error('Error uploading photo:', err);
    messageEl.textContent = 'Failed to upload: ' + err.message;
    messageEl.className = 'feedback-message error-text';
  }
}

async function downloadReportCardImage() {
  if (typeof html2canvas !== 'function') {
    alert('Image tool is still loading — please try again in a moment.');
    return;
  }
  const el = document.getElementById('reportCardHeader');
  const btn = document.getElementById('reportCardDownloadBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const canvas = await html2canvas(el, { backgroundColor: '#07130b', scale: 2, useCORS: true });
    const link = document.createElement('a');
    const name = reportCardData ? reportCardData.name : 'player';
    link.download = `report-card-${name}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Error saving report card image:', err);
    alert('Failed to save image: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
```

- [ ] **Step 4: Manual trace verification**

Code review / diff check (no local server spin-up per project convention):
1. Confirm `initReportCardTab`'s admin-list fallback path is reachable for non-admin users (`/api/admin/users` requires `verifyAdmin`, which non-admins will fail with 401/403 — the `!response.ok` branch then derives names from `matches`/`voters`, which is already-loaded data for any logged-in user via the Predictions/Results tabs).
2. Confirm `renderReportCardTable`'s `pickClass`/`pickText` logic reads only fields the Task 2 endpoint actually returns (`pick`, `boosted`, `bonusPick`, `points`, `status`) — cross-check against the exact response shape documented in Task 2's Interfaces block.
3. Confirm `downloadReportCardImage` targets `#reportCardHeader` only (not the table), matching the approved condensed-image design decision.
4. Confirm the upload-section visibility check (`data.name === currentUsername`) correctly hides the upload control when viewing someone else's card.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add Report Card rendering, sorting, photo upload, and image export"
```

---

## Post-Plan Manual Steps (not code — flagging for the user)

1. After Task 3 ships, on the actual deploy environment, confirm whether `GCS_BUCKET_NAME` is set (prod) so photo uploads land in the bucket, or unset (local/dev) so they land in `public/uploads/photos/`.
2. To generate titles: as admin, click "Export Stats for Titling" in the Admin panel, paste the downloaded JSON into a Claude conversation asking for a short title + one-line reason per player, save the returned `{ name: { title, reason } }` JSON to a file, then use "Import Titles" to upload it.
