# Stacked Race Bar Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Leaderboard tab's Race view bars from single-color blocks into stacked, per-match colored segments (with point values shown inside when there's room), where clicking a segment opens a small popup showing that match's flag-score-flag result.

**Architecture:** Backend enriches the existing `/api/leaderboard/history` frames with per-match point breakdowns (`matchPoints`), outcome, and score — no new endpoint. Frontend precomputes each player's ordered list of "scoring matches" once on load, then renders each player's bar as a flex container of colored `.race-bar-segment` children (one per scoring match up to the current playback frame) instead of one solid fill. A click on a segment opens a small modal (reusing the existing `.modal-overlay`/`.modal-card` pattern) showing the match's flags, score, and points earned.

**Tech Stack:** Vanilla JS/CSS/HTML (no frameworks, no chart library), Express backend (`server.js`), single `public/app.js` frontend file.

## Global Constraints

- No new dependencies (vanilla JS/CSS only, per existing codebase convention).
- No local server spin-up for verification — per project convention, rely on code review, diffing, and Node syntax checks; the user verifies visually via deploy.
- Follow existing code conventions exactly: inline `onclick="..."` handlers (not `addEventListener`), `escapeHtml()` for any user-controlled string interpolated into HTML/`onclick` attributes, function declarations (not arrow functions) for top-level handlers, template-literal HTML building (consistent with the rest of `app.js`).
- Segment color palette is fixed at 10 cycling colors (`--seg-0` … `--seg-9`), keyed by `matchNumber % 10`, so a given match is the same color in every player's bar.
- Point-value text inside a segment is shown only when that match's points are at least 4% of `raceMaxPoints` (`MIN_SEGMENT_LABEL_FRACTION = 0.04`); otherwise the segment renders with no text but stays colored and clickable.
- The leader-highlight treatment (`race-row-leader` gold override) is removed entirely — no special styling for 1st place in the Race view.

---

### Task 1: Backend — enrich leaderboard history frames with per-match points, outcome, and score

**Files:**
- Modify: `server.js:313-364` (`buildLeaderboardHistory`)
- Test: `verify_leaderboard_history.js`

**Interfaces:**
- Consumes: existing `calculatePointsForMatch(votes, outcome, matchType)` (`server.js:286`), existing `getMatchScore(homeTeam, awayTeam)` (`server.js:1165`) — both unchanged.
- Produces: each frame returned by `buildLeaderboardHistory(db)` / served by `GET /api/leaderboard/history` now also has:
  - `outcome: 'home' | 'away' | 'draw' | null`
  - `score: { scoreHome: number, scoreAway: number } | null`
  - `matchPoints: { [playerName: string]: number }` (only entries `> 0`)
  These are consumed by Task 4's `buildRaceScoringMatches(frames)` on the frontend.

- [ ] **Step 1: Write the failing test**

Add to `verify_leaderboard_history.js`, replacing the local `buildLeaderboardHistory` copy (lines 31-76) with the enriched version, and add a stubbed `getMatchScore` plus a new Test 5. Full replacement of the top of the file from the `buildLeaderboardHistory` function through the start of the test runner:

```javascript
// Stub: the real getMatchScore reads from the live external-API cache, which
// isn't available in this standalone script. Tests control scores directly.
function getMatchScore(homeTeam, awayTeam) {
  return _scoreStub[`${homeTeam}|${awayTeam}`] || null;
}
let _scoreStub = {};

function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0, correct: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points, correct: s.correct }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    {
      matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null,
      outcome: null, score: null, matchPoints: {},
      standings: snapshot()
    }
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
    const matchPoints = {};
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0, correct: 0 };
      }
      if (pointsAllocated[user] > 0) {
        standings[user].points += pointsAllocated[user];
        standings[user].correct += 1;
        matchPoints[user] = pointsAllocated[user];
      }
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      outcome: match.outcome,
      score: getMatchScore(match.homeTeam, match.awayTeam),
      matchPoints,
      standings: snapshot()
    });
  });

  return frames;
}
```

Then add this new test block right before the final `if (failed) { ... }` block at the end of the file:

```javascript
// Test 5: frames carry matchPoints/outcome/score enrichment
console.log("\nTest #5: frames carry per-match points, outcome, and score");
{
  _scoreStub = { 'A|B': { scoreHome: 2, scoreAway: 1 } };

  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Alice'], away: ['Bob'], draw: ['Carol'] }
      },
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'draw',
        votes: { home: [], away: [], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[0].outcome, null, 'start frame has null outcome');
  assertDeepEqual(frames[0].score, null, 'start frame has null score');
  assertDeepEqual(frames[0].matchPoints, {}, 'start frame has empty matchPoints');

  assertDeepEqual(frames[1].outcome, 'home', 'frame 1 carries match outcome');
  assertDeepEqual(frames[1].score, { scoreHome: 2, scoreAway: 1 }, 'frame 1 carries looked-up score');
  assertDeepEqual(frames[1].matchPoints, { Alice: 2 },
    'frame 1 matchPoints only includes the scoring voter (Alice), not Bob/Carol who picked wrong');

  assertDeepEqual(frames[2].outcome, 'draw', 'frame 2 carries match outcome even with no voters');
  assertDeepEqual(frames[2].score, null, 'frame 2 has null score when no stub entry exists for that matchup');
  assertDeepEqual(frames[2].matchPoints, {}, 'frame 2 matchPoints is empty when nobody scored');

  _scoreStub = {};
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify_leaderboard_history.js`
Expected: FAIL on Test #5 assertions (`outcome`/`score`/`matchPoints` are `undefined` since the old copy in the file doesn't produce them yet) — confirms the test is exercising the new fields before they're wired up. (At this point you've only edited the test file's local copy of `buildLeaderboardHistory`, which already includes the new fields, so this step is really verifying the test file's own internal consistency — if Step 1's replacement already includes the enriched function, this step should actually PASS. If so, skip ahead; the real failing-test gate is server.js not having the fields yet, verified informally by inspecting `server.js:313-364` still lacking them before Step 3.)

- [ ] **Step 3: Apply the same enrichment to `server.js`**

In `server.js`, replace the `buildLeaderboardHistory` function (currently lines 313-364):

```javascript
// Build cumulative leaderboard snapshots after each resolved match, in
// chronological order (for the racing leaderboard chart)
function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0, correct: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points, correct: s.correct }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    {
      matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null,
      outcome: null, score: null, matchPoints: {},
      standings: snapshot()
    }
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
    const matchPoints = {};
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0, correct: 0 };
      }
      if (pointsAllocated[user] > 0) {
        standings[user].points += pointsAllocated[user];
        standings[user].correct += 1;
        matchPoints[user] = pointsAllocated[user];
      }
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      outcome: match.outcome,
      score: getMatchScore(match.homeTeam, match.awayTeam),
      matchPoints,
      standings: snapshot()
    });
  });

  return frames;
}
```

(Note: `getMatchScore` is defined later in the file at `server.js:1165`, but since it's a hoisted function declaration this call is valid.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify_leaderboard_history.js`
Expected:
```
All leaderboard history tests PASSED successfully!
```

- [ ] **Step 5: Syntax-check server.js**

Run: `node --check server.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add server.js verify_leaderboard_history.js
git commit -m "feat: enrich leaderboard history frames with per-match points, outcome, score"
```

---

### Task 2: CSS — segment palette, stacked-bar layout, remove leader highlight

**Files:**
- Modify: `public/style.css:18-24` (root color variables)
- Modify: `public/style.css:786-809` (`.race-bar-fill`, `.race-points`, `.race-row-leader` rules)

**Interfaces:**
- Produces: CSS custom properties `--seg-0` through `--seg-9` (consumed by Task 5's inline `background: var(--seg-N)` on `.race-bar-segment` elements) and a `.race-bar-segment` class (flex child, `flex-grow` set inline per segment by Task 5).

- [ ] **Step 1: Add the segment color palette variables**

In `public/style.css`, after line 24 (`--color-review: #7c4dff;`) and before the blank line + `/* Shading */` comment, insert:

```css
  --color-review: #7c4dff;

  /* Race chart per-match segment palette (cycles by matchNumber % 10) */
  --seg-0: #00e676;
  --seg-1: #29b6f6;
  --seg-2: #ffb300;
  --seg-3: #ff5252;
  --seg-4: #7c4dff;
  --seg-5: #ff9100;
  --seg-6: #ec407a;
  --seg-7: #26c6da;
  --seg-8: #d4e157;
  --seg-9: #8d6e63;
```

(This replaces just the single existing `--color-review: #7c4dff;` line with itself plus the 10 new lines after it.)

- [ ] **Step 2: Replace `.race-bar-fill` and remove leader-highlight rules**

Replace this block (currently `public/style.css:786-809`):

```css
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
```

with:

```css
.race-bar-fill {
  height: 100%;
  width: 0%;
  display: flex;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: width 700ms ease;
}

.race-bar-segment {
  height: 100%;
  flex-shrink: 0;
  flex-basis: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 800;
  color: rgba(0, 0, 0, 0.75);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
}

.race-points {
  width: 70px;
  flex-shrink: 0;
  text-align: right;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--color-accent);
}
```

(This drops `background: var(--color-accent)` from `.race-bar-fill` since color now comes from each `.race-bar-segment`, and removes both `.race-row-leader` overrides per the "no special leader treatment" decision.)

- [ ] **Step 3: Visually confirm no other selector still references `.race-row-leader`**

Run: `grep -n "race-row-leader" public/style.css public/app.js`
Expected (before Task 5 removes the JS-side toggle): one remaining match in `public/app.js` (the `classList.toggle` call) — confirms CSS side is fully cleaned up; the JS side will be removed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "style: add per-match segment palette, stacked race-bar layout"
```

---

### Task 3: HTML — match popup modal markup

**Files:**
- Modify: `public/index.html` (insert after the `voteConfirmModal` block, currently ending at line 651)

**Interfaces:**
- Produces: DOM elements `#matchPopupModal`, `#matchPopupLabel`, `#matchPopupBody`, `#matchPopupPoints` — consumed by Task 6's `openMatchPopup`/`closeMatchPopup`.

- [ ] **Step 1: Insert the modal markup**

In `public/index.html`, after the closing `</div>` of the `voteConfirmModal` block (currently line 651) and before the `<!-- General Script -->` comment (currently line 653), insert:

```html

  <!-- Race Chart: Match Result Popup -->
  <div class="modal-overlay" id="matchPopupModal" style="display: none;">
    <div class="modal-card" style="max-width: 320px;">
      <div class="modal-header" style="padding: 20px 24px;">
        <h2 style="font-size: 1.1rem;" id="matchPopupLabel">Match</h2>
      </div>
      <div class="modal-body" style="padding: 20px 24px; text-align: center;">
        <div id="matchPopupBody" style="margin-bottom: 14px;"></div>
        <div id="matchPopupPoints" style="font-weight: 800; color: var(--color-accent); font-size: 1.1rem; margin-bottom: 18px;"></div>
        <button class="btn btn-secondary btn-full" onclick="closeMatchPopup()">Close</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Verify the file is still well-formed**

Run: `grep -c "<div" public/index.html` and `grep -c "</div>" public/index.html`
Expected: the two counts match (same as before this edit, plus the 4 new opening/closing div pairs added above — sanity check no stray tag).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add match result popup modal markup for race chart"
```

---

### Task 4: JS — precompute each player's scoring-match list

**Files:**
- Modify: `public/app.js:26-33` (race chart state) and `public/app.js:1175-1203` (`loadLeaderboardHistory`)
- Test: `verify_race_scoring_matches.js` (new)

**Interfaces:**
- Consumes: `raceFrames` array as returned by `GET /api/leaderboard/history` (now including `outcome`/`score`/`matchPoints` per Task 1).
- Produces: `buildRaceScoringMatches(frames)` — pure function, `(frames: Frame[]) => Map<string, ScoringMatch[]>` where
  `ScoringMatch = { frameIndex: number, matchNumber: string, homeTeam: string, awayTeam: string, kickoff: string, outcome: string, score: {scoreHome,scoreAway}|null, points: number }`,
  ordered by `frameIndex` ascending. Also sets the global `raceScoringMatches` map, consumed by Task 5 (`buildRaceSegmentsHtml`) and Task 6 (`openMatchPopup`).

- [ ] **Step 1: Write the failing test**

Create `verify_race_scoring_matches.js`:

```javascript
// verify_race_scoring_matches.js
// Test script for the pure frontend helper that turns leaderboard history
// frames into a per-player ordered list of "scoring matches" (used to build
// the race chart's stacked bar segments).

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

console.log("=== RUNNING RACE SCORING MATCHES TESTS ===");

// Test 1: builds an ordered per-player list across multiple frames
console.log("\nTest #1: builds ordered per-player scoring match list");
{
  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null, outcome: null, score: null, matchPoints: {} },
    { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z', outcome: 'home', score: { scoreHome: 2, scoreAway: 0 }, matchPoints: { Alice: 2 } },
    { matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, matchPoints: { Alice: 3, Bob: 3 } }
  ];

  const result = buildRaceScoringMatches(frames);

  assertDeepEqual(Array.from(result.keys()).sort(), ['Alice', 'Bob'], 'only players who ever scored appear as keys');
  assertDeepEqual(result.get('Alice'), [
    { frameIndex: 1, matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z', outcome: 'home', score: { scoreHome: 2, scoreAway: 0 }, points: 2 },
    { frameIndex: 2, matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, points: 3 }
  ], 'Alice has two ordered scoring matches');
  assertDeepEqual(result.get('Bob'), [
    { frameIndex: 2, matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, points: 3 }
  ], 'Bob only has the match he scored in');
}

// Test 2: no resolved matches yields an empty map
console.log("\nTest #2: no resolved matches yields an empty map");
{
  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null, outcome: null, score: null, matchPoints: {} }
  ];

  const result = buildRaceScoringMatches(frames);

  assertDeepEqual(result.size, 0, 'empty map when only the start frame exists');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll race scoring matches tests PASSED successfully!");
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node verify_race_scoring_matches.js`
Expected:
```
All race scoring matches tests PASSED successfully!
```

(This test file defines its own copy of `buildRaceScoringMatches` so it can run standalone under plain Node, the same pattern `verify_leaderboard_history.js` already uses for `buildLeaderboardHistory`. Step 3 copies the now-verified function into `app.js` itself.)

- [ ] **Step 3: Add the function and wire it into `app.js`**

In `public/app.js`, add a new global next to the other race chart state (after line 32, `let raceRowsByName = new Map();`):

```javascript
let raceScoringMatches = new Map();
```

Add the pure function itself near the other race-chart functions, immediately before `initRaceBars()` (currently `public/app.js:1205`):

```javascript
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
```

In `loadLeaderboardHistory()` (`public/app.js:1175-1203`), after the `raceMaxPoints` computation loop (currently ending at line 1186, right before `raceCurrentFrame = raceFrames.length - 1;` on line 1188), add:

```javascript
    raceScoringMatches = buildRaceScoringMatches(raceFrames);
```

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/app.js verify_race_scoring_matches.js
git commit -m "feat: precompute per-player scoring-match list for race chart"
```

---

### Task 5: JS — render bars as per-match segments, remove leader highlight

**Files:**
- Modify: `public/app.js:33` (add constants), `public/app.js:1225-1270` (`renderRaceFrame`)

**Interfaces:**
- Consumes: `raceScoringMatches` (Task 4), `raceMaxPoints` (existing global).
- Produces: `buildRaceSegmentsHtml(playerName, frameIndex)` — `(string, number) => string` (HTML string of `.race-bar-segment` divs), called from `renderRaceFrame`. Each segment's `onclick` calls `openMatchPopup(playerName, matchNumber)` (Task 6 will define that function — until Task 6 lands, clicking a segment will throw a `ReferenceError` in the browser console, which is expected and resolved by Task 6; this task's own verification only checks markup/HTML shape, not click behavior).

- [ ] **Step 1: Add constants**

In `public/app.js`, after line 33 (`const RACE_FRAME_DURATION_MS = 700;`), add:

```javascript
const SEGMENT_PALETTE_SIZE = 10;
const MIN_SEGMENT_LABEL_FRACTION = 0.04;
```

- [ ] **Step 2: Add `buildRaceSegmentsHtml`**

Add this function immediately before `renderRaceFrame` (currently `public/app.js:1225`):

```javascript
// Build the colored, per-match <div> segments for one player's bar, up to
// (and including) the given frame index.
function buildRaceSegmentsHtml(playerName, frameIndex) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  return scoringMatches
    .filter(m => m.frameIndex <= frameIndex)
    .map(m => {
      const colorIndex = parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE;
      const showLabel = (m.points / raceMaxPoints) >= MIN_SEGMENT_LABEL_FRACTION;
      return `
        <div class="race-bar-segment" style="flex-grow: ${m.points}; background: var(--seg-${colorIndex});"
             onclick="openMatchPopup('${escapeHtml(playerName)}', '${escapeHtml(String(m.matchNumber))}')">${showLabel ? m.points : ''}</div>
      `;
    })
    .join('');
}
```

- [ ] **Step 3: Update `renderRaceFrame` to render segments and drop the leader toggle**

Replace the `frame.standings.forEach` block inside `renderRaceFrame` (currently `public/app.js:1243-1253`):

```javascript
  frame.standings.forEach((player, index) => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    row.querySelector('.race-bar-fill').style.width = `${pct}%`;
    row.querySelector('.race-points').textContent = `${player.points} pts`;
    row.classList.toggle('race-row-leader', index === 0 && player.points > 0);

    raceBars.appendChild(row);
  });
```

with:

```javascript
  frame.standings.forEach(player => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    const fill = row.querySelector('.race-bar-fill');
    fill.style.width = `${pct}%`;
    fill.innerHTML = buildRaceSegmentsHtml(player.name, frameIndex);
    row.querySelector('.race-points').textContent = `${player.points} pts`;

    raceBars.appendChild(row);
  });
```

- [ ] **Step 4: Confirm the leader class is no longer referenced anywhere**

Run: `grep -n "race-row-leader" public/app.js public/style.css`
Expected: no matches (Task 2 already removed the CSS rules; this step removes the last JS reference).

- [ ] **Step 5: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: render race chart bars as per-match stacked segments"
```

---

### Task 6: JS — match popup open/close, wired to segment clicks

**Files:**
- Modify: `public/app.js` (add `openMatchPopup`/`closeMatchPopup`, near `buildFlagSpan` at line 1337)

**Interfaces:**
- Consumes: `raceScoringMatches` (Task 4), DOM elements `#matchPopupModal`/`#matchPopupLabel`/`#matchPopupBody`/`#matchPopupPoints` (Task 3), `buildFlagSpan(teamName, extraClass)` (existing, `public/app.js:1337`), `escapeHtml` (existing, `public/app.js:2340`).
- Produces: `openMatchPopup(playerName: string, matchNumber: string)` and `closeMatchPopup()` — the two functions referenced by the `onclick` handlers Task 5 already emits and Task 3's `Close` button.

- [ ] **Step 1: Add the two functions**

In `public/app.js`, immediately after `buildFlagSpan` (currently lines 1337-1341):

```javascript
function buildFlagSpan(teamName, extraClass) {
  const code = getTeamCountryCode(teamName);
  const fiClass = code ? `fi fi-${code}` : '';
  return `<span class="${extraClass} ${fiClass}" data-team="${escapeHtml(teamName)}"></span>`;
}

// Open the race chart's match-result popup for the segment a user clicked.
function openMatchPopup(playerName, matchNumber) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  const matchInfo = scoringMatches.find(m => String(m.matchNumber) === String(matchNumber));
  if (!matchInfo) return;

  const dateStr = matchInfo.kickoff
    ? new Date(matchInfo.kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  document.getElementById('matchPopupLabel').textContent =
    `Match ${matchInfo.matchNumber}${dateStr ? ' · ' + dateStr : ''}`;

  const isDraw = matchInfo.outcome === 'draw';
  const scoreMid = matchInfo.score
    ? `${matchInfo.score.scoreHome}-${matchInfo.score.scoreAway}`
    : (isDraw ? 'Draw' : 'Win');

  document.getElementById('matchPopupBody').innerHTML = `
    <span style="display:inline-flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap;">
      ${buildFlagSpan(matchInfo.homeTeam, 'result-flag')}
      <span class="form-score">${escapeHtml(scoreMid)}</span>
      ${buildFlagSpan(matchInfo.awayTeam, 'result-flag')}
    </span>
  `;
  document.getElementById('matchPopupPoints').textContent = `+${matchInfo.points} pts`;

  document.getElementById('matchPopupModal').style.display = 'flex';
}

function closeMatchPopup() {
  document.getElementById('matchPopupModal').style.display = 'none';
}
```

- [ ] **Step 2: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Code-review trace through one end-to-end scenario**

With no local server, verify the wiring by reading the code path: a resolved match (`matchNumber: '7'`, `homeTeam: 'France'`, `awayTeam: 'Brazil'`) where `Alice` earned 5 points produces, via Task 4's `buildRaceScoringMatches`, an entry `{ frameIndex: 7, matchNumber: '7', homeTeam: 'France', awayTeam: 'Brazil', ..., points: 5 }` in `raceScoringMatches.get('Alice')`. Task 5's `buildRaceSegmentsHtml('Alice', frameIndex)` includes this once `frameIndex >= 7`, rendering `<div class="race-bar-segment" ... onclick="openMatchPopup('Alice', '7')">5</div>` (label shown since `5/raceMaxPoints` is assumed `>= 0.04` for a typical max). Clicking it calls `openMatchPopup('Alice', '7')`, which re-finds that same entry and populates the modal with France/Brazil flags, the score or Win/Draw fallback, and `+5 pts`. Confirm this chain holds by re-reading Tasks 3-6's code together — no missing piece.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add click-to-view match result popup for race chart segments"
```

---

## Final Verification

- [ ] Run all standalone test scripts: `node verify_leaderboard_history.js && node verify_race_scoring_matches.js && node verify_points.js`
- [ ] Run `node --check server.js && node --check public/app.js`
- [ ] `grep -n "race-row-leader" server.js public/app.js public/style.css` returns nothing.
- [ ] Read through `public/index.html`'s new modal block once more to confirm it's inside `<body>` and balanced (Task 3, Step 2).
- [ ] Per project convention, no local server spin-up — the user verifies the Race view visually after deploying.
