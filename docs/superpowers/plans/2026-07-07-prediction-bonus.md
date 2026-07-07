# Prediction Bonus (Reg Time / Extra Time / Penalties) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bonus scoring mechanic for QF+/3rd-place matches: users pick how the match will be decided (Reg Time / Extra Time / Penalties), earning +5 for a correct pick or +10 total if the team pick is also correct, folded into the same points total as everything else.

**Architecture:** Two new fields on a match (`decidedBy` set by admin at resolve time, `bonusPicks` a `{username: choice}` map set by users at predict time). A new pure function `calculateBonusPointsForMatch` computes bonus points per user, summed into the existing team-pick total at the two places that build final standings. Frontend adds a mandatory 3-way segmented toggle to the existing vote-confirm modal, inline decidedBy buttons to the admin resolve row, and a new "Bonus" column + extended "Your Pick" text in the Past Results table.

**Tech Stack:** Node.js/Express (`server.js`, single file, no test framework), vanilla JS (`public/app.js`), HTML (`public/index.html`), CSS (`public/style.css`). No `module.exports` in `server.js` — it starts the Express server as a side effect of being loaded, so pure-function verification in this plan uses throwaway scratch scripts (copy just the function under test) rather than `require('../server.js')`.

## Global Constraints

- Bonus points are **never** multiplied by the booster — only the existing team-pick points get the ×2.
- Bonus applies only when `getMatchStageCode(match) === 'QF_SF_FINAL'` (Quarter-finals, Semi-finals, Final, and — after Task 1's fix — 3rd Place).
- The Reg Time / Extra Time / Penalties pick is **mandatory** whenever shown, defaulting to "Reg Time".
- Max bonus per match is 10 (a natural consequence of the formula, not a separate cap to implement).
- Bonus points fold into the same total as team-pick points everywhere a total is shown (leaderboard, live/provisional scoring) — no separate line item there. The only place bonus is broken out separately is the Past Results table ("Your Pick" text + new "Bonus" column).
- Per stored user preference: skip spinning up `npm run dev` / a local server for verification in this plan — verify server-side logic with throwaway `node` scripts against pure functions, and verify everything else by re-reading the diff. The user verifies UI behavior via their own deploy.

---

## File Map

| File | Change |
|------|--------|
| `server.js` | Stage-eligibility fix for `THIRD_PLACE`; new `decidedBy`/`bonusPicks` fields; `ensureMatchBonusData`; `calculateBonusPointsForMatch`; wire into `buildLeaderboardHistory` + `/api/leaderboard`; `bonusPick` handling in `POST /api/predict`; `decidedBy` handling in `POST /api/admin/resolve` + `/api/admin/unresolve`; `myBonusPick` in `GET /api/matches` |
| `public/index.html` | New bonus toggle section in `#voteConfirmModal`; new "Bonus" `<th>` in the Past Results table; colspan fix |
| `public/app.js` | Bonus toggle show/hide + selection in `submitVote`/`confirmVote`; inline decidedBy buttons in `loadAdminMatches`/`resolveMatch`; extended "Your Pick" text + new "Bonus" column cell in `renderResults` |
| `public/style.css` | `.bonus-toggle-btn` / `.bonus-toggle-btn.selected` styles (reuses existing `.resolve-mini-btn.active-outcome` for the admin buttons — no new admin-side CSS needed) |

---

## Task 1: Fix stage-eligibility gap — include 3rd Place in the `QF_SF_FINAL` bucket

**Files:**
- Modify: `server.js:1304-1310` (`BRACKET_ROUND_SIZES`)
- Modify: `server.js:1326-1349` (`getMatchStageCode`)

**Context:** `getMatchStageCode()` currently maps `bracketRound` values `QUARTER_FINALS`/`SEMI_FINALS`/`FINAL` (and matching group-text) to `'QF_SF_FINAL'`, the bucket used for both booster eligibility and (after this plan) bonus eligibility. `THIRD_PLACE` is missing from both the `bracketRound` include-list and the text-regex fallback, and `BRACKET_ROUND_SIZES` (which validates `bracketRound` on match creation) doesn't have a `THIRD_PLACE` entry at all — so admins can't even explicitly tag a match as `THIRD_PLACE` today. In practice most 3rd-place matches still get bucketed correctly today via the matchNumber-range fallback (`num >= 97 && num <= 104`), but that's fragile. This task makes 3rd place a first-class, explicit case.

- [ ] **Step 1: Write a scratch verification script for current (broken) behavior**

Create `/tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-stage-code.js`:

```js
// Throwaway copy of the relevant server.js functions for isolated verification.
// server.js can't be require()'d directly — loading it starts the Express server.

function normalizeStageText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function getMatchStageCode(match) {
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }

  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|third place|3rd place|qf\/sf\/final|qf sf final)\b/.test(stageText)) {
      return 'QF_SF_FINAL';
    }
  }

  const num = parseInt(match.matchNumber, 10);
  if (!Number.isFinite(num)) return null;
  if (num >= 73 && num <= 88) return 'LAST_32';
  if (num >= 89 && num <= 96) return 'LAST_16';
  if (num >= 97 && num <= 104) return 'QF_SF_FINAL';
  return null;
}

const assert = require('assert');

assert.strictEqual(getMatchStageCode({ bracketRound: 'THIRD_PLACE' }), 'QF_SF_FINAL', 'bracketRound THIRD_PLACE');
assert.strictEqual(getMatchStageCode({ group: 'Third Place Playoff' }), 'QF_SF_FINAL', 'text "Third Place Playoff"');
assert.strictEqual(getMatchStageCode({ group: '3rd Place' }), 'QF_SF_FINAL', 'text "3rd Place"');
assert.strictEqual(getMatchStageCode({ bracketRound: 'QUARTER_FINALS' }), 'QF_SF_FINAL', 'unchanged: QUARTER_FINALS');
assert.strictEqual(getMatchStageCode({ bracketRound: 'SEMI_FINALS' }), 'QF_SF_FINAL', 'unchanged: SEMI_FINALS');
assert.strictEqual(getMatchStageCode({ bracketRound: 'FINAL' }), 'QF_SF_FINAL', 'unchanged: FINAL');
assert.strictEqual(getMatchStageCode({ bracketRound: 'LAST_32' }), 'LAST_32', 'unchanged: LAST_32');
assert.strictEqual(getMatchStageCode({ matchNumber: '103' }), 'QF_SF_FINAL', 'unchanged: matchNumber heuristic');
assert.strictEqual(getMatchStageCode({ group: 'Group A' }), null, 'unchanged: group stage returns null');
assert.strictEqual(getMatchStageCode({}), null, 'unchanged: no data returns null');

console.log('All stage-code assertions passed.');
```

- [ ] **Step 2: Run it to confirm the target logic is correct in isolation**

Run: `node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-stage-code.js`
Expected: `All stage-code assertions passed.`

- [ ] **Step 3: Apply the fix to `server.js`**

Find (server.js:1304-1310):

```js
const BRACKET_ROUND_SIZES = {
  LAST_32: 16,
  LAST_16: 8,
  QUARTER_FINALS: 4,
  SEMI_FINALS: 2,
  FINAL: 1
};
```

Replace with:

```js
const BRACKET_ROUND_SIZES = {
  LAST_32: 16,
  LAST_16: 8,
  QUARTER_FINALS: 4,
  SEMI_FINALS: 2,
  THIRD_PLACE: 1,
  FINAL: 1
};
```

Find (server.js:1326-1341):

```js
function getMatchStageCode(match) {
  // Bracket round is the authoritative source for bracket-created matches
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }

  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|qf\/sf\/final|qf sf final)\b/.test(stageText)) {
      return 'QF_SF_FINAL';
    }
  }
```

Replace with:

```js
function getMatchStageCode(match) {
  // Bracket round is the authoritative source for bracket-created matches
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }

  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|third place|3rd place|qf\/sf\/final|qf sf final)\b/.test(stageText)) {
      return 'QF_SF_FINAL';
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "fix: include 3rd place match in QF_SF_FINAL stage bucket"
```

---

## Task 2: Data model — `decidedBy`, `bonusPicks`, `ensureMatchBonusData`, `BONUS_OPTIONS`

**Files:**
- Modify: `server.js:994-1013` (new match object literal)
- Modify: `server.js:1351-1362` (add new function after `ensureMatchBoosterData`)

**Interfaces:**
- Produces: `BONUS_OPTIONS` (array `['REGULAR', 'EXTRA_TIME', 'PENALTIES']`), `ensureMatchBonusData(match)` (mutates `match.bonusPicks` to a plain object if missing/malformed, `match.decidedBy` to `null` if `undefined`; returns `match`) — used by Tasks 3, 5, 7.

- [ ] **Step 1: Write a scratch verification script for `ensureMatchBonusData`**

Create `/tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-data.js`:

```js
const assert = require('assert');

const BONUS_OPTIONS = ['REGULAR', 'EXTRA_TIME', 'PENALTIES'];

function ensureMatchBonusData(match) {
  if (!match.bonusPicks || typeof match.bonusPicks !== 'object' || Array.isArray(match.bonusPicks)) {
    match.bonusPicks = {};
  }
  if (match.decidedBy === undefined) {
    match.decidedBy = null;
  }
  return match;
}

// Missing fields get initialized
let m1 = {};
ensureMatchBonusData(m1);
assert.deepStrictEqual(m1.bonusPicks, {}, 'missing bonusPicks initialized to {}');
assert.strictEqual(m1.decidedBy, null, 'missing decidedBy initialized to null');

// Malformed bonusPicks (array) gets reset
let m2 = { bonusPicks: ['oops'] };
ensureMatchBonusData(m2);
assert.deepStrictEqual(m2.bonusPicks, {}, 'array bonusPicks reset to {}');

// Existing valid data is preserved
let m3 = { bonusPicks: { Alice: 'EXTRA_TIME' }, decidedBy: 'PENALTIES' };
ensureMatchBonusData(m3);
assert.deepStrictEqual(m3.bonusPicks, { Alice: 'EXTRA_TIME' }, 'valid bonusPicks preserved');
assert.strictEqual(m3.decidedBy, 'PENALTIES', 'valid decidedBy preserved');

// Explicit null decidedBy stays null (not re-initialized, just confirming no crash)
let m4 = { decidedBy: null };
ensureMatchBonusData(m4);
assert.strictEqual(m4.decidedBy, null, 'explicit null decidedBy stays null');

assert.deepStrictEqual(BONUS_OPTIONS, ['REGULAR', 'EXTRA_TIME', 'PENALTIES'], 'BONUS_OPTIONS shape');

console.log('All ensureMatchBonusData assertions passed.');
```

- [ ] **Step 2: Run it**

Run: `node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-data.js`
Expected: `All ensureMatchBonusData assertions passed.`

- [ ] **Step 3: Add `BONUS_OPTIONS` and `ensureMatchBonusData` to `server.js`**

Find (server.js:1351-1362):

```js
function ensureMatchBoosterData(match) {
  if (!match.boosters || typeof match.boosters !== 'object') {
    match.boosters = { home: [], away: [], draw: [] };
  } else {
    match.boosters = {
      home: Array.isArray(match.boosters.home) ? match.boosters.home : [],
      away: Array.isArray(match.boosters.away) ? match.boosters.away : [],
      draw: Array.isArray(match.boosters.draw) ? match.boosters.draw : []
    };
  }
  return match;
}
```

Replace with:

```js
function ensureMatchBoosterData(match) {
  if (!match.boosters || typeof match.boosters !== 'object') {
    match.boosters = { home: [], away: [], draw: [] };
  } else {
    match.boosters = {
      home: Array.isArray(match.boosters.home) ? match.boosters.home : [],
      away: Array.isArray(match.boosters.away) ? match.boosters.away : [],
      draw: Array.isArray(match.boosters.draw) ? match.boosters.draw : []
    };
  }
  return match;
}

// Bonus prediction: which method (Reg Time / Extra Time / Penalties) a user
// thinks will decide a QF+/3rd-place match. Mandatory whenever the match is
// bonus-eligible (getMatchStageCode(match) === 'QF_SF_FINAL').
const BONUS_OPTIONS = ['REGULAR', 'EXTRA_TIME', 'PENALTIES'];

function ensureMatchBonusData(match) {
  if (!match.bonusPicks || typeof match.bonusPicks !== 'object' || Array.isArray(match.bonusPicks)) {
    match.bonusPicks = {};
  }
  if (match.decidedBy === undefined) {
    match.decidedBy = null;
  }
  return match;
}
```

- [ ] **Step 4: Initialize the new fields on match creation**

Find (server.js:994-1013):

```js
  const newMatch = {
    id: 'match_' + Date.now(),
    matchNumber: matchNumber ? String(matchNumber).trim() : String(db.matches.length + 1),
    group: group ? String(group).trim() : (matchType === 'KO' ? 'KO' : 'League'),
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    matchType,
    bracketRound: resolvedBracketRound,
    bracketSlot: resolvedBracketSlot,
    kickoff: kickoffDate.toISOString(),
    status: 'scheduled',
    votingLocked: false,
    outcome: null,
    voteLog: [],
    votes: {
      home: [],
      away: [],
      draw: []
    }
  };
```

Replace with:

```js
  const newMatch = {
    id: 'match_' + Date.now(),
    matchNumber: matchNumber ? String(matchNumber).trim() : String(db.matches.length + 1),
    group: group ? String(group).trim() : (matchType === 'KO' ? 'KO' : 'League'),
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    matchType,
    bracketRound: resolvedBracketRound,
    bracketSlot: resolvedBracketSlot,
    kickoff: kickoffDate.toISOString(),
    status: 'scheduled',
    votingLocked: false,
    outcome: null,
    decidedBy: null,
    voteLog: [],
    votes: {
      home: [],
      away: [],
      draw: []
    },
    bonusPicks: {}
  };
```

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add decidedBy/bonusPicks fields and ensureMatchBonusData helper"
```

---

## Task 3: `calculateBonusPointsForMatch`

**Files:**
- Modify: `server.js:306-337` (add new function directly after `calculatePointsForMatch`)

**Interfaces:**
- Consumes: `getMatchStageCode(match)` (Task 1), `BONUS_OPTIONS` (Task 2, not directly called but same vocabulary as `match.decidedBy`/`match.bonusPicks[user]` values)
- Produces: `calculateBonusPointsForMatch(match)` → `{ [username]: number }` (only usernames with a nonzero bonus are present) — used by Task 4.

- [ ] **Step 1: Write a scratch verification script against the spec's example table**

Create `/tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-points.js`:

```js
const assert = require('assert');

// Copies of Task 1's getMatchStageCode (unchanged logic, just needed here)
function normalizeStageText(value) {
  return String(value || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
}
function getMatchStageCode(match) {
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }
  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|third place|3rd place|qf\/sf\/final|qf sf final)\b/.test(stageText)) return 'QF_SF_FINAL';
  }
  const num = parseInt(match.matchNumber, 10);
  if (!Number.isFinite(num)) return null;
  if (num >= 73 && num <= 88) return 'LAST_32';
  if (num >= 89 && num <= 96) return 'LAST_16';
  if (num >= 97 && num <= 104) return 'QF_SF_FINAL';
  return null;
}

// Function under test
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

// Base match: User A picked England (home), Extra Time bonus.
// 7 England voters (incl A), 5 Mexico voters, QF stage.
function baseMatch(outcome, decidedBy) {
  return {
    bracketRound: 'QUARTER_FINALS',
    outcome,
    decidedBy,
    votes: {
      home: ['A', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], // England, 7 incl A
      away: ['m1', 'm2', 'm3', 'm4', 'm5'],             // Mexico, 5
      draw: []
    },
    bonusPicks: { A: 'EXTRA_TIME' }
  };
}

// Mexico wins in Reg Time or Penalties -> 0 (bonus wrong, team wrong)
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('away', 'REGULAR')), {}, 'Mexico/Reg Time -> no bonus');
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('away', 'PENALTIES')), {}, 'Mexico/Penalties -> no bonus');

// Mexico wins in Extra Time -> bonus right, team wrong -> +5
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('away', 'EXTRA_TIME')), { A: 5 }, 'Mexico/Extra Time -> +5');

// England wins in Reg Time or Penalties -> bonus wrong, team right -> +0 bonus
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('home', 'REGULAR')), {}, 'England/Reg Time -> no bonus');
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('home', 'PENALTIES')), {}, 'England/Penalties -> no bonus');

// England wins in Extra Time -> bonus right AND team right -> +10 (not +15)
assert.deepStrictEqual(calculateBonusPointsForMatch(baseMatch('home', 'EXTRA_TIME')), { A: 10 }, 'England/Extra Time -> +10');

// Non-eligible stage -> always {}
const groupStageMatch = { ...baseMatch('home', 'EXTRA_TIME'), bracketRound: null, group: 'Group A' };
assert.deepStrictEqual(calculateBonusPointsForMatch(groupStageMatch), {}, 'group stage -> no bonus regardless of decidedBy');

// Not yet resolved (decidedBy null) -> always {}
const unresolvedMatch = { ...baseMatch('home', null) };
assert.deepStrictEqual(calculateBonusPointsForMatch(unresolvedMatch), {}, 'unresolved -> no bonus');

console.log('All calculateBonusPointsForMatch assertions passed.');
```

- [ ] **Step 2: Run it to confirm the logic matches the spec's example table exactly**

Run: `node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-points.js`
Expected: `All calculateBonusPointsForMatch assertions passed.`

- [ ] **Step 3: Add the function to `server.js`**

Find (server.js:305-337, the end of `calculatePointsForMatch`):

```js
// Points Calculation Engine
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
    votersHome.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.home || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.away || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.draw || []).includes(v) ? 2 : 1);
    });
  }

  return pointsAllocated;
}
```

Replace with:

```js
// Points Calculation Engine
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
    votersHome.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.home || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.away || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.draw || []).includes(v) ? 2 : 1);
    });
  }

  return pointsAllocated;
}

// Bonus Points Calculation Engine — QF+/3rd-place matches only.
// +5 if the user's Reg Time/Extra Time/Penalties pick matches decidedBy.
// +10 total (not additive with the +5 case) if the team pick was also
// correct. Never multiplied by the booster — that's applied only inside
// calculatePointsForMatch above.
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
```

**Note:** `calculateBonusPointsForMatch` calls `getMatchStageCode`, which is defined later in the file (server.js:1326, after Task 1's fix). This is safe — both are `function` declarations (hoisted), and `calculateBonusPointsForMatch` is only ever *called* at request-time (inside route handlers), never at module-load time, so `getMatchStageCode` is always defined by the time it runs.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add calculateBonusPointsForMatch scoring function"
```

---

## Task 4: Wire bonus points into leaderboard totals

**Files:**
- Modify: `server.js:372-396` (`buildLeaderboardHistory`)
- Modify: `server.js:709-717` (`GET /api/leaderboard`)

**Context:** Bonus points fold into the same `points` total as team-pick points (per the approved design), but must **not** affect the `correct` counter — `correct` continues to mean "team pick was correct" (it feeds the Accuracy stat and a leaderboard tiebreaker, and a bonus-only correct pick isn't a correct team prediction). The live/provisional scoring path (server.js:742, inside `GET /api/leaderboard`) needs **no change**: it computes points from a *guessed* `provisionalOutcome` for matches that aren't resolved yet, and `match.decidedBy` is always `null` until an admin resolves the match — so `calculateBonusPointsForMatch` already returns `{}` there without any code change.

- [ ] **Step 1: Update `buildLeaderboardHistory`**

Find (server.js:372-384):

```js
  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
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
```

Replace with:

```js
  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const matchPoints = {};
    const involvedUsers = new Set([...Object.keys(pointsAllocated), ...Object.keys(bonusPoints)]);
    involvedUsers.forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0, correct: 0 };
      }
      const teamPts = pointsAllocated[user] || 0;
      const bonusPts = bonusPoints[user] || 0;
      if (teamPts > 0) {
        standings[user].correct += 1;
      }
      const total = teamPts + bonusPts;
      if (total > 0) {
        standings[user].points += total;
        matchPoints[user] = total;
      }
    });
```

- [ ] **Step 2: Update `GET /api/leaderboard`**

Find (server.js:709-716):

```js
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    Object.keys(pointsAllocated).forEach(user => {
      const pts = pointsAllocated[user];
      if (pts > 0) {
        ensureStanding(user).points += pts;
        ensureStanding(user).correct += 1;
      }
    });
```

Replace with:

```js
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const involvedUsers = new Set([...Object.keys(pointsAllocated), ...Object.keys(bonusPoints)]);
    involvedUsers.forEach(user => {
      const teamPts = pointsAllocated[user] || 0;
      const bonusPts = bonusPoints[user] || 0;
      if (teamPts > 0) {
        ensureStanding(user).correct += 1;
      }
      const total = teamPts + bonusPts;
      if (total > 0) {
        ensureStanding(user).points += total;
      }
    });
```

- [ ] **Step 3: Re-read both diffs and confirm by hand against the spec example**

Review the two edited blocks. Trace User A (team pick England/home, bonus pick Extra Time, booster used) through the England-wins-in-Extra-Time case: `pointsAllocated['A'] = 12` (from `calculatePointsForMatch`, unchanged by this task), `bonusPoints['A'] = 10` (from Task 3). `teamPts=12 > 0` → `correct += 1`. `total = 12 + 10 = 22` → `points += 22`. Matches the spec's expected total of 22.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: fold bonus points into leaderboard and history totals"
```

---

## Task 5: `POST /api/predict` — accept, require, and store `bonusPick`

**Files:**
- Modify: `server.js:564-660`

**Interfaces:**
- Consumes: `getMatchStageCode` (Task 1), `BONUS_OPTIONS`, `ensureMatchBonusData` (Task 2)

- [ ] **Step 1: Destructure `bonusPick` from the request body**

Find (server.js:564-567):

```js
app.post('/api/predict', authenticateSecret, (req, res) => {
  const username = req.username;
  const { matchId, prediction, useBooster } = req.body; // prediction: 'home', 'away', or 'draw'
  const useBoosterFlag = !!useBooster;
```

Replace with:

```js
app.post('/api/predict', authenticateSecret, (req, res) => {
  const username = req.username;
  const { matchId, prediction, useBooster, bonusPick } = req.body; // prediction: 'home', 'away', or 'draw'
  const useBoosterFlag = !!useBooster;
```

- [ ] **Step 2: Validate `bonusPick` when the match is bonus-eligible**

Find (server.js:606-622):

```js
  const stageCode = getMatchStageCode(match);
  const userBoosterStatus = getUserBoosterStatus(db, username);
  const alreadyBoostedHere = stageCode && match.boosters && (
    (match.boosters.home || []).includes(username) ||
    (match.boosters.away || []).includes(username) ||
    (match.boosters.draw || []).includes(username)
  );
  const stageAlreadyUsedElsewhere = stageCode && userBoosterStatus[stageCode] && !alreadyBoostedHere;

  if (useBoosterFlag) {
    if (match.matchType !== 'KO' || !stageCode) {
      return res.status(400).json({ error: 'Boosters are only available on knockout matches.' });
    }
    if (stageAlreadyUsedElsewhere) {
      return res.status(400).json({ error: 'You have already used your booster for this stage.' });
    }
  }
```

Replace with:

```js
  const stageCode = getMatchStageCode(match);
  const userBoosterStatus = getUserBoosterStatus(db, username);
  const alreadyBoostedHere = stageCode && match.boosters && (
    (match.boosters.home || []).includes(username) ||
    (match.boosters.away || []).includes(username) ||
    (match.boosters.draw || []).includes(username)
  );
  const stageAlreadyUsedElsewhere = stageCode && userBoosterStatus[stageCode] && !alreadyBoostedHere;

  if (useBoosterFlag) {
    if (match.matchType !== 'KO' || !stageCode) {
      return res.status(400).json({ error: 'Boosters are only available on knockout matches.' });
    }
    if (stageAlreadyUsedElsewhere) {
      return res.status(400).json({ error: 'You have already used your booster for this stage.' });
    }
  }

  const bonusEligible = stageCode === 'QF_SF_FINAL';
  if (bonusEligible && !BONUS_OPTIONS.includes(bonusPick)) {
    return res.status(400).json({ error: 'bonusPick must be one of REGULAR, EXTRA_TIME, PENALTIES for this match.' });
  }
```

- [ ] **Step 3: Store the bonus pick alongside the booster update**

Find (server.js:636-645):

```js
  ensureMatchBoosterData(match);
  match.boosters.home = match.boosters.home.filter(u => u !== username);
  match.boosters.away = match.boosters.away.filter(u => u !== username);
  match.boosters.draw = match.boosters.draw.filter(u => u !== username);

  // Add new prediction
  match.votes[prediction].push(username);
  if (useBoosterFlag) {
    match.boosters[prediction].push(username);
  }
```

Replace with:

```js
  ensureMatchBoosterData(match);
  match.boosters.home = match.boosters.home.filter(u => u !== username);
  match.boosters.away = match.boosters.away.filter(u => u !== username);
  match.boosters.draw = match.boosters.draw.filter(u => u !== username);

  // Add new prediction
  match.votes[prediction].push(username);
  if (useBoosterFlag) {
    match.boosters[prediction].push(username);
  }

  ensureMatchBonusData(match);
  if (bonusEligible) {
    match.bonusPicks[username] = bonusPick;
  }
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: accept and store bonusPick in POST /api/predict"
```

---

## Task 6: `POST /api/admin/resolve` + `/api/admin/unresolve` — `decidedBy`

**Files:**
- Modify: `server.js:1154-1185` (`POST /api/admin/resolve`)
- Modify: `server.js:1188-1208` (`POST /api/admin/unresolve`)

**Interfaces:**
- Consumes: `getMatchStageCode` (Task 1), `BONUS_OPTIONS` (Task 2)

- [ ] **Step 1: Update `POST /api/admin/resolve`**

Find (server.js:1154-1185):

```js
app.post('/api/admin/resolve', verifyAdmin, (req, res) => {
  const { matchId, outcome } = req.body; // outcome: 'home', 'away', or 'draw'
  if (!matchId || !outcome) {
    return res.status(400).json({ error: 'matchId and outcome are required.' });
  }

  if (!['home', 'away', 'draw'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be home, away, or draw.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  if (outcome === 'draw' && match.matchType === 'KO') {
    return res.status(400).json({ error: 'Draw outcomes are not allowed for Knockout matches.' });
  }

  match.status = 'resolved';
  match.outcome = outcome;

  const winnerText = outcome === 'home' ? match.homeTeam 
                   : outcome === 'away' ? match.awayTeam 
                   : 'Draw';
  logAuditAction(db, 'RESOLVE_MATCH', `Admin ${req.adminUsername} resolved Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam}) as ${winnerText.toUpperCase()}`);
  writeData(db);

  res.json({ success: true, match });
});
```

Replace with:

```js
app.post('/api/admin/resolve', verifyAdmin, (req, res) => {
  const { matchId, outcome, decidedBy } = req.body; // outcome: 'home', 'away', or 'draw'
  if (!matchId || !outcome) {
    return res.status(400).json({ error: 'matchId and outcome are required.' });
  }

  if (!['home', 'away', 'draw'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be home, away, or draw.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  if (outcome === 'draw' && match.matchType === 'KO') {
    return res.status(400).json({ error: 'Draw outcomes are not allowed for Knockout matches.' });
  }

  const bonusEligible = getMatchStageCode(match) === 'QF_SF_FINAL';
  if (bonusEligible && !BONUS_OPTIONS.includes(decidedBy)) {
    return res.status(400).json({ error: 'decidedBy must be one of REGULAR, EXTRA_TIME, PENALTIES for this match.' });
  }

  match.status = 'resolved';
  match.outcome = outcome;
  match.decidedBy = bonusEligible ? decidedBy : null;

  const winnerText = outcome === 'home' ? match.homeTeam 
                   : outcome === 'away' ? match.awayTeam 
                   : 'Draw';
  logAuditAction(db, 'RESOLVE_MATCH', `Admin ${req.adminUsername} resolved Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam}) as ${winnerText.toUpperCase()}${bonusEligible ? ` [decided by ${match.decidedBy}]` : ''}`);
  writeData(db);

  res.json({ success: true, match });
});
```

- [ ] **Step 2: Update `POST /api/admin/unresolve`**

Find (server.js:1188-1208):

```js
app.post('/api/admin/unresolve', verifyAdmin, (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId is required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  match.status = 'scheduled';
  match.outcome = null;

  logAuditAction(db, 'UNDO_RESOLUTION', `Admin ${req.adminUsername} undid resolution for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
  writeData(db);

  res.json({ success: true, match });
});
```

Replace with:

```js
app.post('/api/admin/unresolve', verifyAdmin, (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId is required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  match.status = 'scheduled';
  match.outcome = null;
  match.decidedBy = null;

  logAuditAction(db, 'UNDO_RESOLUTION', `Admin ${req.adminUsername} undid resolution for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
  writeData(db);

  res.json({ success: true, match });
});
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: accept decidedBy in resolve; clear it on unresolve"
```

---

## Task 7: Expose `myBonusPick` via `GET /api/matches`

**Files:**
- Modify: `server.js:463-561`

**Interfaces:**
- Consumes: `ensureMatchBonusData` (Task 2)
- Produces: `myBonusPick` field (`'REGULAR' | 'EXTRA_TIME' | 'PENALTIES' | null`) on every match object in the `GET /api/matches` response, in both the pre-kickoff and post-kickoff/resolved branches — used by Task 8 (modal prefill) and Task 10 (no new field needed there; `bonusPicks`/`decidedBy` are already present on resolved/started matches via the existing `...match` spread).

**Context:** `match.boosterStageCode` (already computed and returned in both branches, server.js:486-487/516-517/542-543) doubles as the bonus-eligibility flag on the frontend — no new field needed for that, since Task 1 made `'QF_SF_FINAL'` the correct bucket for bonus too.

- [ ] **Step 1: Normalize bonus data and compute `myBonusPick`**

Find (server.js:471-484):

```js
  const processedMatches = db.matches.map(match => {
    ensureMatchBoosterData(match);
    const kickoffTime = new Date(match.kickoff);
    const hasStarted = kickoffTime <= now;
    
    // Determine if a voting extension is currently active
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;
    const extensionActive = extendedUntil && extendedUntil > now;

    // Find what the current user voted
    let myVote = null;
    if (match.votes.home.includes(username)) myVote = 'home';
    else if (match.votes.away.includes(username)) myVote = 'away';
    else if (match.votes.draw && match.votes.draw.includes(username)) myVote = 'draw';
```

Replace with:

```js
  const processedMatches = db.matches.map(match => {
    ensureMatchBoosterData(match);
    ensureMatchBonusData(match);
    const kickoffTime = new Date(match.kickoff);
    const hasStarted = kickoffTime <= now;
    
    // Determine if a voting extension is currently active
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;
    const extensionActive = extendedUntil && extendedUntil > now;

    // Find what the current user voted
    let myVote = null;
    if (match.votes.home.includes(username)) myVote = 'home';
    else if (match.votes.away.includes(username)) myVote = 'away';
    else if (match.votes.draw && match.votes.draw.includes(username)) myVote = 'draw';

    const myBonusPick = match.bonusPicks[username] || null;
```

- [ ] **Step 2: Add `myBonusPick` to the hasStarted/resolved branch**

Find (server.js:499-522):

```js
    if (hasStarted || match.status === 'resolved') {
      // If started but extension is active, treat it like a pre-kickoff open match for voting
      return {
        ...match,
        hasStarted: true,
        extensionActive: !!extensionActive,
        votingExtendedUntil: match.votingExtendedUntil || null,
        myVote,
        voteCounts: {
          home: match.votes.home.length,
          away: match.votes.away.length,
          draw: match.votes.draw ? match.votes.draw.length : 0
        },
        voters: match.votes,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam),
        score: getMatchScore(match.homeTeam, match.awayTeam),
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed
      };
    } else {
```

Replace with:

```js
    if (hasStarted || match.status === 'resolved') {
      // If started but extension is active, treat it like a pre-kickoff open match for voting
      return {
        ...match,
        hasStarted: true,
        extensionActive: !!extensionActive,
        votingExtendedUntil: match.votingExtendedUntil || null,
        myVote,
        myBonusPick,
        voteCounts: {
          home: match.votes.home.length,
          away: match.votes.away.length,
          draw: match.votes.draw ? match.votes.draw.length : 0
        },
        voters: match.votes,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam),
        score: getMatchScore(match.homeTeam, match.awayTeam),
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed
      };
    } else {
```

- [ ] **Step 3: Add `myBonusPick` to the pre-kickoff branch**

Find (server.js:524-556):

```js
      // Hide details before kickoff
      return {
        id: match.id,
        matchNumber: match.matchNumber,
        group: match.group,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        matchType: match.matchType,
        bracketRound: match.bracketRound || null,
        bracketSlot: match.bracketSlot != null ? match.bracketSlot : null,
        kickoff: match.kickoff,
        status: match.status,
        outcome: match.outcome,
        votingLocked: !!match.votingLocked,
        hasStarted: false,
        extensionActive: false,
        votingExtendedUntil: null,
        myVote,
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed,
        voteCounts: {
          home: null,
          away: null,
          draw: null
        },
        voters: null,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam)
      };
    }
```

Replace with:

```js
      // Hide details before kickoff
      return {
        id: match.id,
        matchNumber: match.matchNumber,
        group: match.group,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        matchType: match.matchType,
        bracketRound: match.bracketRound || null,
        bracketSlot: match.bracketSlot != null ? match.bracketSlot : null,
        kickoff: match.kickoff,
        status: match.status,
        outcome: match.outcome,
        votingLocked: !!match.votingLocked,
        hasStarted: false,
        extensionActive: false,
        votingExtendedUntil: null,
        myVote,
        myBonusPick,
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed,
        voteCounts: {
          home: null,
          away: null,
          draw: null
        },
        voters: null,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam)
      };
    }
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: expose myBonusPick in GET /api/matches"
```

---

## Task 8: Vote confirm modal — mandatory 3-way bonus toggle

**Files:**
- Modify: `public/index.html:714-741` (`#voteConfirmModal`)
- Modify: `public/app.js:2161-2251` (`submitVote`, `confirmVote`)
- Modify: `public/style.css` (add `.bonus-toggle-btn` styles near `.predict-btn`)

**Interfaces:**
- Consumes: `match.boosterStageCode` (`'QF_SF_FINAL'` = bonus-eligible, Task 1/7), `match.myBonusPick` (Task 7)
- Produces: global `pendingBonusPick` variable and `selectBonusOption(value)` function, read by `confirmVote()`

- [ ] **Step 1: Add the bonus toggle section to the modal markup**

Find (`public/index.html:727-733`):

```html
        <div id="voteConfirmBoosterSection" style="display:none; background: rgba(60,120,255,0.08); border: 1px solid rgba(60,120,255,0.16); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <label style="display:flex; align-items:center; gap: 10px; font-weight: 700; cursor: pointer;">
            <input type="checkbox" id="voteConfirmUseBooster" style="transform: scale(1.1);" />
            Use knockout booster for this vote (2× points if correct)
          </label>
          <div id="voteConfirmBoosterInfo" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 8px;"></div>
        </div>
```

Replace with:

```html
        <div id="voteConfirmBoosterSection" style="display:none; background: rgba(60,120,255,0.08); border: 1px solid rgba(60,120,255,0.16); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <label style="display:flex; align-items:center; gap: 10px; font-weight: 700; cursor: pointer;">
            <input type="checkbox" id="voteConfirmUseBooster" style="transform: scale(1.1);" />
            Use knockout booster for this vote (2× points if correct)
          </label>
          <div id="voteConfirmBoosterInfo" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 8px;"></div>
        </div>
        <div id="voteConfirmBonusSection" style="display:none; background: rgba(255,152,0,0.08); border: 1px solid rgba(255,152,0,0.2); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <div style="font-weight: 700; margin-bottom: 10px;">How will this match be decided? <span style="color: var(--color-warning);">(required)</span></div>
          <div class="bonus-toggle-group" style="display:flex; gap: 8px;">
            <button type="button" class="bonus-toggle-btn" id="voteConfirmBonusRegular" onclick="selectBonusOption('REGULAR')" style="flex:1;">Reg Time</button>
            <button type="button" class="bonus-toggle-btn" id="voteConfirmBonusExtraTime" onclick="selectBonusOption('EXTRA_TIME')" style="flex:1;">Extra Time</button>
            <button type="button" class="bonus-toggle-btn" id="voteConfirmBonusPenalties" onclick="selectBonusOption('PENALTIES')" style="flex:1;">Penalties</button>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px;">+5 pts if right, +10 total if you also pick the winning team.</div>
        </div>
```

- [ ] **Step 2: Add `.bonus-toggle-btn` styles**

Find (`public/style.css:565-570`):

```css
.predict-btn.selected {
  background: rgba(0, 230, 118, 0.12);
  border-color: var(--color-accent);
  color: var(--color-accent);
  box-shadow: 0 0 12px rgba(0, 230, 118, 0.15);
}
```

Insert immediately after it:

```css

.bonus-toggle-btn {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 6px;
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-smooth);
}

.bonus-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.bonus-toggle-btn.selected {
  background: rgba(255, 152, 0, 0.15);
  border-color: var(--color-warning);
  color: var(--color-warning);
}
```

- [ ] **Step 3: Add `pendingBonusPick` state and `selectBonusOption`**

Find (`public/app.js:2161-2162`):

```js
// Submit prediction — shows custom confirmation modal first
function submitVote(matchId, prediction) {
```

Replace with:

```js
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
```

- [ ] **Step 4: Show/hide and prefill the bonus section in `submitVote`**

Find (`public/app.js:2177-2192`):

```js
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

  // Store pending state
  pendingVoteMatchId = matchId;
  pendingVotePrediction = prediction;
```

Replace with:

```js
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
```

- [ ] **Step 5: Send `bonusPick` in `confirmVote`**

Find (`public/app.js:2210-2233`):

```js
async function confirmVote() {
  if (!pendingVoteMatchId || !pendingVotePrediction || !currentUserSecret) return;

  const matchId = pendingVoteMatchId;
  const prediction = pendingVotePrediction;
  const useBooster = document.getElementById('voteConfirmUseBooster')?.checked || false;

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
      body: JSON.stringify({ matchId, prediction, useBooster })
    });
```

Replace with:

```js
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
```

- [ ] **Step 6: Reset `pendingBonusPick` in `closeVoteModal`**

Find (`public/app.js:2203-2207`):

```js
function closeVoteModal() {
  document.getElementById('voteConfirmModal').style.display = 'none';
  pendingVoteMatchId = null;
  pendingVotePrediction = null;
}
```

Replace with:

```js
function closeVoteModal() {
  document.getElementById('voteConfirmModal').style.display = 'none';
  pendingVoteMatchId = null;
  pendingVotePrediction = null;
  pendingBonusPick = 'REGULAR';
}
```

- [ ] **Step 7: Re-read the four edited regions and confirm consistency**

Confirm: `selectBonusOption` is defined before any code calls it (it's defined right above `submitVote`, and only invoked via inline `onclick` handlers after the modal is shown, or from within `submitVote` itself — both are runtime calls, safe since the whole file loads before any click can happen). Confirm `pendingBonusPick` always holds one of `'REGULAR' | 'EXTRA_TIME' | 'PENALTIES'` (initialized to `'REGULAR'`, only ever set by `selectBonusOption` with one of the three literals from the onclick handlers).

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add mandatory Reg/Extra Time/Penalties toggle to vote confirm modal"
```

---

## Task 9: Admin resolve — inline `decidedBy` buttons

**Files:**
- Modify: `public/app.js:2554-2722` (`loadAdminMatches` row markup, `resolveMatch`)

**Interfaces:**
- Consumes: `match.boosterStageCode` (bonus-eligibility check), existing `.resolve-mini-btn` / `.resolve-mini-btn.active-outcome` CSS classes (`public/style.css:1593-1613`, no new CSS needed)
- Produces: global `_pendingDecidedBy` map and `selectDecidedBy(matchId, value, btnEl)` function

**Context:** `loadAdminMatches()` re-runs on every dashboard poll (there's a `setInterval(..., loadDashboardData)` at `public/app.js:180-182` that re-fetches and re-renders whenever the admin tab is active), which rebuilds this row's HTML from scratch each time. If the row always hardcoded "Reg Time" as the visually-active button, an admin who clicks "Extra Time" and then waits past the next poll tick (before clicking resolve) would see the button revert to "Reg Time" while `_pendingDecidedBy` still held "Extra Time" underneath — a mismatch between what's displayed and what gets submitted. Step 1 below avoids this by deriving the active button from `_pendingDecidedBy` on every render, not hardcoding it.

- [ ] **Step 1: Add the inline decidedBy buttons to the (unresolved) outcome controls, deriving the active button from `_pendingDecidedBy`**

Find (`public/app.js:2572-2582`):

```js
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
```

Replace with:

```js
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
```

Note: this reads `_pendingDecidedBy` (declared in Step 2, further down in the file) inside a function (`loadAdminMatches`) that is only ever *called* later, via async data loads and event handlers — never during initial script parse. By the time it runs, the whole script (including Step 2's `const _pendingDecidedBy = {}`) has already executed, so there's no temporal-dead-zone issue despite the declaration appearing later in the file.

- [ ] **Step 2: Add `_pendingDecidedBy` state and `selectDecidedBy` above `resolveMatch`**

Find (`public/app.js:2692-2693`):

```js
// Resolve Match
async function resolveMatch(matchId, outcome) {
```

Replace with:

```js
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
```

- [ ] **Step 3: Include `decidedBy` in the resolve request when bonus-eligible**

Find (`public/app.js:2693-2710`):

```js
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
```

Replace with:

```js
async function resolveMatch(matchId, outcome) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return;
  const outcomeText = outcome === 'home' ? match.homeTeam 
                    : outcome === 'away' ? match.awayTeam 
                    : 'Draw';
  if (!confirm(`Are you sure you want to resolve this match as '${outcomeText}'? This will calculate scores immediately.`)) return;

  const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
  const decidedBy = bonusEligible ? (_pendingDecidedBy[matchId] || 'REGULAR') : undefined;

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
```

- [ ] **Step 4: Re-read the edited regions and confirm consistency**

Confirm `currentDecidedBy` (Step 1) and `decidedBy` (Step 3) use the exact same fallback expression shape — `_pendingDecidedBy[<id>] || 'REGULAR'` — so the visually-active button always matches what `resolveMatch` will actually submit. Confirm a poll-driven re-render (admin never touches the buttons) still renders "Reg Time" active and still submits `'REGULAR'`, since `_pendingDecidedBy[match.id]` is `undefined` in that case and both call sites fall back to `'REGULAR'`.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add inline decidedBy buttons to admin resolve UI"
```

---

## Task 10: Past Results — extended "Your Pick" text + new "Bonus" column

**Files:**
- Modify: `public/index.html:117` (new `<th>`), `public/index.html:122` (colspan fix)
- Modify: `public/app.js:1995` (colspan fix), `public/app.js:2031-2110` (`renderResults`)

**Interfaces:**
- Consumes: `match.boosterStageCode`, `match.decidedBy`, `match.bonusPicks` (all already present on hasStarted/resolved matches via Tasks 1, 6, 7's existing `...match` spread — no further backend change needed)

- [ ] **Step 1: Add the "Bonus" column header**

Find (`public/index.html:111-117`):

```html
                  <th class="col-mno" style="width: 100px; text-align: center;">Match #</th>
                  <th class="col-grp" style="width: 140px;">Group / Stage</th>
                  <th class="col-matchup" style="font-weight: 700;">Matchup</th>
                  <th class="col-kickoff" style="color: var(--text-muted); font-size: 0.85rem;">Kickoff (Local)</th>
                  <th class="col-outcome" style="text-align: center; font-weight: 700;">Result</th>
                  <th class="col-pick" style="text-align: center; font-weight: 700;">Your Pick</th>
                  <th class="col-votes" style="padding-left: 20px; font-weight: 600;">Group Votes Distribution</th>
```

Replace with:

```html
                  <th class="col-mno" style="width: 100px; text-align: center;">Match #</th>
                  <th class="col-grp" style="width: 140px;">Group / Stage</th>
                  <th class="col-matchup" style="font-weight: 700;">Matchup</th>
                  <th class="col-kickoff" style="color: var(--text-muted); font-size: 0.85rem;">Kickoff (Local)</th>
                  <th class="col-outcome" style="text-align: center; font-weight: 700;">Result</th>
                  <th class="col-pick" style="text-align: center; font-weight: 700;">Your Pick</th>
                  <th class="col-votes" style="padding-left: 20px; font-weight: 600;">Group Votes Distribution</th>
                  <th class="col-bonus" style="padding-left: 20px; font-weight: 600;">Bonus</th>
```

- [ ] **Step 2: Bump the loading-state colspan from 7 to 8**

Find (`public/index.html:122`):

```html
                  <td colspan="7" class="loading-state">Loading past results...</td>
```

Replace with:

```html
                  <td colspan="8" class="loading-state">Loading past results...</td>
```

- [ ] **Step 3: Bump the empty-state colspan in `renderResults`**

Find (`public/app.js:1995`):

```js
    tbody.innerHTML = `<tr><td colspan="7" class="loading-state">No live or completed matches to display.</td></tr>`;
```

Replace with:

```js
    tbody.innerHTML = `<tr><td colspan="8" class="loading-state">No live or completed matches to display.</td></tr>`;
```

- [ ] **Step 4: Extend the "Your Pick" text with the bonus contribution**

Find (`public/app.js:2031-2059`):

```js
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
          const basePts = totalIncorrectVotes + 1;
          const boosterMultiplier = match.myBooster ? 2 : 1;
          const pts = basePts * boosterMultiplier;
          pickText = match.myBooster
            ? `🎉 ${escapeHtml(pickTeam)} (+${pts} · booster x2)`
            : `🎉 ${escapeHtml(pickTeam)} (+${pts})`;
          pickClass = 'text-active'; // Neon Green
        } else {
          pickText = `❌ ${escapeHtml(pickTeam)}`;
          pickClass = 'error-text'; // Red
        }
      } else {
        pickText = `🔒 ${escapeHtml(pickTeam)}`;
      }
    }
```

Replace with:

```js
    // Player prediction text & styling
    const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
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
    }
```

- [ ] **Step 5: Build the "Bonus" column distribution HTML**

Find (`public/app.js:2061-2079`, right before the voters-list formatting block):

```js
    // Voters list formatting
    const boosters = match.boosters || { home: [], away: [], draw: [] };
    const tagVoter = (name, boostedList) =>
      escapeHtml(name) + (boostedList.includes(name) ? ' ⚡' : '');

    let distHtml = `
      <div style="font-size: 0.8rem; line-height: 1.4;">
        <span style="${isWinnerHome ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.homeTeam)} (${counts.home}):</span>
        <span style="color: var(--text-muted);">${voters.home.map(v => tagVoter(v, boosters.home)).join(', ') || 'None'}</span>
        <br>
        ${match.matchType === 'League' ? `
          <span style="${isWinnerDraw ? 'color: var(--color-accent); font-weight: 700;' : ''}">Draw (${counts.draw}):</span>
          <span style="color: var(--text-muted);">${voters.draw.map(v => tagVoter(v, boosters.draw)).join(', ') || 'None'}</span>
          <br>
        ` : ''}
        <span style="${isWinnerAway ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.awayTeam)} (${counts.away}):</span>
        <span style="color: var(--text-muted);">${voters.away.map(v => tagVoter(v, boosters.away)).join(', ') || 'None'}</span>
      </div>
    `;
```

Replace with:

```js
    // Voters list formatting
    const boosters = match.boosters || { home: [], away: [], draw: [] };
    const tagVoter = (name, boostedList) =>
      escapeHtml(name) + (boostedList.includes(name) ? ' ⚡' : '');

    let distHtml = `
      <div style="font-size: 0.8rem; line-height: 1.4;">
        <span style="${isWinnerHome ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.homeTeam)} (${counts.home}):</span>
        <span style="color: var(--text-muted);">${voters.home.map(v => tagVoter(v, boosters.home)).join(', ') || 'None'}</span>
        <br>
        ${match.matchType === 'League' ? `
          <span style="${isWinnerDraw ? 'color: var(--color-accent); font-weight: 700;' : ''}">Draw (${counts.draw}):</span>
          <span style="color: var(--text-muted);">${voters.draw.map(v => tagVoter(v, boosters.draw)).join(', ') || 'None'}</span>
          <br>
        ` : ''}
        <span style="${isWinnerAway ? 'color: var(--color-accent); font-weight: 700;' : ''}">${escapeHtml(match.awayTeam)} (${counts.away}):</span>
        <span style="color: var(--text-muted);">${voters.away.map(v => tagVoter(v, boosters.away)).join(', ') || 'None'}</span>
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
      const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };
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
```

- [ ] **Step 6: Add the "Bonus" `<td>` to the row**

Find (`public/app.js:2098-2107`):

```js
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
```

Replace with:

```js
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
```

- [ ] **Step 7: Re-read the full `renderResults` function and confirm consistency**

Confirm `bonusEligible` and `myBonusCorrect`/`myBonusPts` (declared in Step 4) are in scope when `bonusColHtml` (Step 5) and the new `<td>` (Step 6) reference them — all three edits are inside the same `filtered.forEach(match => { ... })` callback, so they share scope. Confirm the two colspan bumps (Steps 2, 3) are the *only* `colspan="7"` occurrences tied to this specific table — the other `colspan="7"` instances in the codebase (leaderboard, comparison tables) are unrelated and must stay untouched (verified during planning: only `index.html:122` and `app.js:1995` are the Past Results table's colspans).

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: show bonus split in Your Pick and add Bonus column to Past Results"
```

---

## Task 11: End-to-end review pass

No local server spin-up (per stored preference — the user verifies via their own deploy). This task is a final structured code-review pass over the whole feature before handing off.

- [ ] **Step 1: Re-run both scratch verification scripts**

```bash
node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-stage-code.js
node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-data.js
node /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-points.js
```

Expected: all three print their "All ... assertions passed." line.

- [ ] **Step 2: Diff review — `server.js`**

Run `git diff main -- server.js` (or `git log -p` over this branch's commits touching `server.js`) and confirm:
- `BONUS_OPTIONS` and `ensureMatchBonusData` are defined before first use (Task 2 places them right after `ensureMatchBoosterData`, and all call sites are in route handlers that execute after module load — fine either way since these are `function`/`const` at module scope evaluated top-to-bottom, and `BONUS_OPTIONS`/`ensureMatchBonusData` are referenced only inside handler bodies, not at module-evaluation time).
- `calculateBonusPointsForMatch` is never multiplied by any booster value anywhere it's used (Task 4).
- `bonusPick`/`decidedBy` validation (Tasks 5, 6) rejects invalid/missing values only when `getMatchStageCode(match) === 'QF_SF_FINAL'`, and silently ignores/nulls them otherwise.

- [ ] **Step 3: Diff review — frontend**

Run `git diff main -- public/index.html public/app.js public/style.css` and confirm:
- The bonus toggle in the vote confirm modal always has exactly one `.selected` button (defaults to Reg Time, per Task 8).
- The admin decidedBy buttons only render for bonus-eligible, unresolved matches (Task 9).
- The new "Bonus" column and extended "Your Pick" text only activate when `match.boosterStageCode === 'QF_SF_FINAL'` (Task 10).

- [ ] **Step 4: Manually trace the full spec example one more time through the final code**

Using the exact diffed code (not the scratch copies), trace: User A picks England (home) + Extra Time bonus, with booster, in a QF match with 7 home voters (incl. A) and 5 away voters. Confirm all four spec rows: Mexico/Reg-or-Pens → 0, Mexico/Extra Time → 5, England/Reg-or-Pens → 12, England/Extra Time → 22.

- [ ] **Step 5: Clean up scratch files (optional)**

```bash
rm -f /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-stage-code.js \
      /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-data.js \
      /tmp/claude-1000/-mnt-c-Pradep-Github-fifa-fun-prediction/79d728d6-49f1-4e73-bbe6-26caec7a78b6/scratchpad/verify-bonus-points.js
```

These were scratchpad-only verification aids, never committed to the repo, so there's nothing to commit here.
