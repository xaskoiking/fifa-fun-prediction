# Knockout Bracket Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace knockout-stage (`matchType: "KO"`) matches in the flat `matchesGrid` list with a dedicated, swipeable bracket-tree "Bracket" tab, while the existing Predictions tab narrows to group-stage matches only and hides itself once `LAST_32` opens.

**Architecture:** Two new pure functions (`computeBracketPositions`, `buildBracketRounds`) drive a DOM renderer (`renderBracket`) added in a new `public/bracket.js` file. The renderer reuses the existing `submitVote`/`confirmVote` flow for picking a winner — no new voting code path. Bracket team names are derived live from `matches` data (resolved `outcome` of the previous round's matches), not from any new persisted "propagation" state. A new tiny `GET /api/stages` endpoint lets any logged-in player (not just admin) learn whether `LAST_32` is open, driving Predictions-tab visibility.

**Tech Stack:** Vanilla JS (no framework, no build step, no bundler — confirmed via `package.json`), Express backend (`server.js`), `data.json` flat-file store, plain `<script>` tags. Tests follow this repo's existing convention of standalone `verify_*.js` Node scripts at the project root containing a local copy of the pure function under test (see `verify_race_stage_breakdown.js` for the pattern) — there is no test framework (no Jest/Mocha) and no test coverage of Express route handlers anywhere in the repo, so route-handler changes are verified with `curl`, and DOM-rendering changes are verified by hand in a browser, matching how the rest of the codebase is verified today.

## Global Constraints

- No draws in knockout matches — already enforced server-side (`server.js:542`, `server.js:1006`); do not touch that logic.
- No new admin UI control for tab gating — reuse `db.settings.openMatchStages` exactly as it exists today.
- No scoring changes of any kind in this plan.
- Bracket and Predictions tabs must both keep working with zero KO matches in `data.json` (today's actual state) — the bracket renders a full TBD skeleton in that case.
- This plan does **not** include the "Bracket Challenge" speculative tab — that is a separate, follow-on plan that will reuse `renderBracket`/`computeBracketPositions` from this plan.
- Connector lines redraw instantly rather than animating alongside the boxes (same as the approved brainstorming prototype) — this stays as a known, deferred polish item in this plan, not something Task 5 attempts to fix. Revisit only if it's noticeably distracting in practice.

---

## Task 1: Backend — `bracketRound`/`bracketSlot` fields on match create + matches API

**Files:**
- Modify: `server.js:814-855` (`POST /api/admin/match`)
- Modify: `server.js:476-502` (`GET /api/matches`, pre-kickoff branch)

**Interfaces:**
- Produces: every match object (from both `/api/admin/match` and `/api/matches`) may now carry `bracketRound: string|null` (one of `'LAST_32'|'LAST_16'|'QUARTER_FINALS'|'SEMI_FINALS'|'FINAL'`) and `bracketSlot: number|null`. Later tasks (3, 4, 9) read these two fields by exact name.

- [ ] **Step 1: Add a `BRACKET_ROUNDS` constant and validation helper**

In `server.js`, immediately after the existing `TOURNAMENT_STAGES` constant (ends at `server.js:1104`), add:

```js
// Knockout bracket structure: code -> number of slots in that round.
// Used to validate bracketSlot on match creation and (by the frontend,
// mirrored in public/bracket.js) to lay out the bracket tree.
const BRACKET_ROUND_SIZES = {
  LAST_32: 16,
  LAST_16: 8,
  QUARTER_FINALS: 4,
  SEMI_FINALS: 2,
  FINAL: 1
};
```

- [ ] **Step 2: Accept and validate the two new fields in `POST /api/admin/match`**

In `server.js`, replace the body of the route (lines 814-855) with:

```js
app.post('/api/admin/match', verifyAdmin, (req, res) => {
  const { homeTeam, awayTeam, matchType, kickoff, matchNumber, group, bracketRound, bracketSlot } = req.body;
  if (!homeTeam || !awayTeam || !matchType || !kickoff) {
    return res.status(400).json({ error: 'homeTeam, awayTeam, matchType, and kickoff are required.' });
  }

  if (!['League', 'KO'].includes(matchType)) {
    return res.status(400).json({ error: 'matchType must be League or KO.' });
  }

  const kickoffDate = new Date(kickoff);
  if (isNaN(kickoffDate.getTime())) {
    return res.status(400).json({ error: 'Invalid kickoff date.' });
  }

  let resolvedBracketRound = null;
  let resolvedBracketSlot = null;
  if (bracketRound !== undefined && bracketRound !== null && bracketRound !== '') {
    if (!Object.prototype.hasOwnProperty.call(BRACKET_ROUND_SIZES, bracketRound)) {
      return res.status(400).json({ error: `bracketRound must be one of: ${Object.keys(BRACKET_ROUND_SIZES).join(', ')}` });
    }
    const slotNum = Number(bracketSlot);
    if (!Number.isInteger(slotNum) || slotNum < 0 || slotNum >= BRACKET_ROUND_SIZES[bracketRound]) {
      return res.status(400).json({ error: `bracketSlot must be an integer between 0 and ${BRACKET_ROUND_SIZES[bracketRound] - 1} for ${bracketRound}.` });
    }
    resolvedBracketRound = bracketRound;
    resolvedBracketSlot = slotNum;
  }

  const db = readData();

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

  logAuditAction(db, 'CREATE_MATCH', `Admin ${req.adminUsername} created Match #${newMatch.matchNumber} [${newMatch.group}]: ${newMatch.homeTeam} vs ${newMatch.awayTeam}`);
  db.matches.push(newMatch);
  writeData(db);

  res.json({ success: true, match: newMatch });
});
```

- [ ] **Step 3: Include the two fields in the pre-kickoff privacy branch of `GET /api/matches`**

In `server.js`, in the `else` branch of the `processedMatches` map (lines 478-501), add two lines right after `matchType: match.matchType,` (line 484):

```js
        matchType: match.matchType,
        bracketRound: match.bracketRound || null,
        bracketSlot: match.bracketSlot != null ? match.bracketSlot : null,
        kickoff: match.kickoff,
```

(The `if (hasStarted || match.status === 'resolved')` branch above it already spreads `...match`, so it already includes these fields — only the pre-kickoff branch was missing them.)

- [ ] **Step 4: Verify manually with curl**

Start the server (`npm start` in one terminal), then in another:

```bash
# Replace ADMIN_PASS / USER_SECRET with real values from your data.json
curl -s -X POST http://localhost:8080/api/admin/match \
  -H "Content-Type: application/json" \
  -H "x-admin-passcode: ADMIN_PASS" \
  -H "x-user-secret: USER_SECRET" \
  -d '{"homeTeam":"Germany","awayTeam":"Paraguay","matchType":"KO","kickoff":"2026-06-28T15:00:00.000Z","bracketRound":"LAST_32","bracketSlot":0}'
```

Expected: `{"success":true,"match":{... "bracketRound":"LAST_32","bracketSlot":0 ...}}`.

Then:

```bash
curl -s http://localhost:8080/api/matches -H "x-user-secret: USER_SECRET" | grep -o '"bracketRound":"LAST_32"'
```

Expected: at least one match. Also confirm a bad slot is rejected:

```bash
curl -s -X POST http://localhost:8080/api/admin/match \
  -H "Content-Type: application/json" \
  -H "x-admin-passcode: ADMIN_PASS" \
  -H "x-user-secret: USER_SECRET" \
  -d '{"homeTeam":"A","awayTeam":"B","matchType":"KO","kickoff":"2026-06-28T15:00:00.000Z","bracketRound":"FINAL","bracketSlot":1}'
```

Expected: `400` with `"bracketSlot must be an integer between 0 and 0 for FINAL."`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add bracketRound/bracketSlot fields to KO match creation"
```

---

## Task 2: Backend — `GET /api/stages` public endpoint

**Files:**
- Modify: `server.js:1212` (insert new route right after the existing `POST /api/admin/settings` handler, before `GET /api/admin/fixtures` at line 1214)

**Interfaces:**
- Consumes: `authenticateSecret` middleware (`server.js:376`), `ensureSettings(db)` (`server.js:1112`), `TOURNAMENT_STAGES` (`server.js:1096`).
- Produces: `GET /api/stages` → `{ openMatchStages: string[] }`, reachable by any logged-in player (not just admin). Task 8 calls this exact path and reads this exact field name.

- [ ] **Step 1: Add the route**

In `server.js`, insert immediately after line 1212 (the closing `});` of `POST /api/admin/settings`), before `app.get('/api/admin/fixtures', ...)`:

```js
// Public (player-level) read of which stages are open — used by the
// frontend to decide whether to show the legacy flat Predictions tab.
app.get('/api/stages', authenticateSecret, (req, res) => {
  const db = readData();
  const settings = ensureSettings(db);
  res.json({ openMatchStages: settings.openMatchStages });
});
```

- [ ] **Step 2: Verify manually with curl**

```bash
curl -s http://localhost:8080/api/stages -H "x-user-secret: USER_SECRET"
```

Expected: `{"openMatchStages":["GROUP_STAGE"]}` (or whatever the admin currently has set) — and crucially this works with a **player** secret, not an admin passcode.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add public GET /api/stages endpoint"
```

---

## Task 3: Pure function — `computeBracketPositions`

**Files:**
- Create: `verify_bracket_layout.js` (project root)

**Interfaces:**
- Produces: `computeBracketPositions(roundSizes: number[], focusedIdx: number, rowHeight: number) -> (number[]|undefined)[]`. Task 5 ports this verified implementation verbatim into `public/bracket.js`.

- [ ] **Step 1: Write the verify script with the function and its tests**

Create `verify_bracket_layout.js`:

```js
// verify_bracket_layout.js
// Test script for the pure bracket-tree layout math used by the Bracket
// tab. Mirrors the existing standalone-test pattern used by
// verify_race_stage_breakdown.js: a local copy of the pure function,
// runnable under plain Node (no DOM needed for this math). The real copy
// lives in public/bracket.js.

function computeBracketPositions(roundSizes, focusedIdx, rowHeight) {
  const positions = [];
  positions[focusedIdx] = Array.from({ length: roundSizes[focusedIdx] }, (_, i) => i * rowHeight);
  for (let r = focusedIdx + 1; r < roundSizes.length; r++) {
    const prev = positions[r - 1];
    const n = roundSizes[r];
    positions[r] = Array.from({ length: n }, (_, i) => (prev[i * 2] + prev[i * 2 + 1]) / 2);
  }
  return positions;
}

let failed = false;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING BRACKET LAYOUT TESTS ===");

const ROUND_SIZES = [4, 2, 1]; // small tree: 4 -> 2 -> 1, same shape as LAST_32..FINAL

console.log("\nTest #1: focused = 0 (first round) — tight stack at rowHeight intervals");
{
  const positions = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(positions[0][0], 0, 'round 0 slot 0 sits at y=0');
  assertEqual(positions[0][1], 80, 'round 0 slot 1 sits at y=80 (one rowHeight down)');
  assertEqual(positions[0][2], 160, 'round 0 slot 2 sits at y=160');
  assertEqual(positions[0][3], 240, 'round 0 slot 3 sits at y=240');
}

console.log("\nTest #2: later rounds are the midpoint of their two parents");
{
  const positions = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(positions[1][0], 40, 'round 1 slot 0 is midpoint of round 0 slots 0 (y=0) and 1 (y=80)');
  assertEqual(positions[1][1], 200, 'round 1 slot 1 is midpoint of round 0 slots 2 (y=160) and 3 (y=240)');
  assertEqual(positions[2][0], 120, 'round 2 (final) slot 0 is midpoint of round 1 slots 0 (y=40) and 1 (y=200)');
}

console.log("\nTest #3: rounds before focusedIdx are left unset (not rendered)");
{
  const positions = computeBracketPositions(ROUND_SIZES, 1, 80);
  assertEqual(positions[0], undefined, 'round 0 has no computed position when focus starts at round 1');
  assertEqual(positions[1][0], 0, 'the now-focused round 1 slot 0 tight-stacks at y=0');
  assertEqual(positions[1][1], 80, 'the now-focused round 1 slot 1 tight-stacks at y=80');
}

console.log("\nTest #4: cascade — focusing a later round re-tightens it and ripples forward");
{
  const beforeFocus = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(beforeFocus[1][0], 40, 'before compaction, round 1 slot 0 sits at the sparser midpoint y=40');

  const afterFocus = computeBracketPositions(ROUND_SIZES, 1, 80);
  assertEqual(afterFocus[1][0], 0, 'after round 1 becomes focused, it compacts to the tight y=0');
  assertEqual(afterFocus[2][0], 40, 'round 2 (final) cascades to the midpoint of round 1\'s NEW positions (0 and 80) = 40, not the old 120');
}

console.log("\nTest #5: single-round tree (FINAL only, focused) has exactly one position");
{
  const positions = computeBracketPositions([1], 0, 80);
  assertEqual(positions[0].length, 1, 'exactly one slot');
  assertEqual(positions[0][0], 0, 'sits at y=0');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll bracket layout tests PASSED successfully!");
}
```

- [ ] **Step 2: Run it and confirm it passes**

```bash
node verify_bracket_layout.js
```

Expected: every line prints `PASS:` and the script ends with `All bracket layout tests PASSED successfully!` and exit code `0`. If anything prints `FAIL:`, fix `computeBracketPositions` (not the test) until it passes — the test cases above encode the exact cascade behavior validated in the brainstorming prototype.

- [ ] **Step 3: Commit**

```bash
git add verify_bracket_layout.js
git commit -m "test: add verify script for bracket layout cascade math"
```

---

## Task 4: Pure function — `buildBracketRounds`

**Files:**
- Modify: `verify_bracket_layout.js` (append to the same file — this repo's convention groups related pure-function tests in one verify script, e.g. `verify_race_stage_breakdown.js` tests multiple cases of one concern)

**Interfaces:**
- Consumes: match objects shaped like `{ matchType, bracketRound, bracketSlot, homeTeam, awayTeam, status, outcome, myVote, votingLocked }` (all fields already present on real match objects after Task 1).
- Produces: `buildBracketRounds(matches: Match[], roundDefs: {code, label, size}[]) -> { code, label, size, slots: { slot, match, homeTeam, awayTeam }[] }[]`. Task 5 ports this verbatim into `public/bracket.js` and Task 6/7 consume its return shape by these exact field names.

- [ ] **Step 1: Add the function and its tests to `verify_bracket_layout.js`**

Insert this above the `let failed = false;` line (so it's defined before the test runner code, alongside `computeBracketPositions`):

```js
function buildBracketRounds(matches, roundDefs) {
  const byRoundSlot = new Map();
  matches.forEach(m => {
    if (m.matchType !== 'KO' || !m.bracketRound) return;
    byRoundSlot.set(`${m.bracketRound}:${m.bracketSlot}`, m);
  });

  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      const match = byRoundSlot.get(`${roundDef.code}:${i}`) || null;
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (match) {
        homeTeam = match.homeTeam;
        awayTeam = match.awayTeam;
      } else if (r > 0) {
        const prevCode = roundDefs[r - 1].code;
        const parentA = byRoundSlot.get(`${prevCode}:${i * 2}`);
        const parentB = byRoundSlot.get(`${prevCode}:${i * 2 + 1}`);
        if (parentA && parentA.status === 'resolved') {
          homeTeam = parentA.outcome === 'home' ? parentA.homeTeam : parentA.awayTeam;
        }
        if (parentB && parentB.status === 'resolved') {
          awayTeam = parentB.outcome === 'home' ? parentB.homeTeam : parentB.awayTeam;
        }
      }
      slots.push({ slot: i, match, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}
```

Then append these test blocks right before the final `if (failed) { ... }` block:

```js
console.log("\n=== RUNNING BRACKET ROUNDS DERIVATION TESTS ===");

const ROUND_DEFS = [
  { code: 'LAST_32', label: 'Round of 32', size: 4 },
  { code: 'LAST_16', label: 'Round of 16', size: 2 },
  { code: 'FINAL', label: 'Final', size: 1 }
];

console.log("\nTest #6: no matches at all — full TBD skeleton");
{
  const rounds = buildBracketRounds([], ROUND_DEFS);
  assertEqual(rounds.length, 3, 'three rounds in the skeleton');
  assertEqual(rounds[0].slots.length, 4, 'LAST_32 has 4 slots');
  assertEqual(rounds[0].slots[0].homeTeam, 'TBD', 'LAST_32 slot 0 home is TBD with no matches');
  assertEqual(rounds[1].slots[0].homeTeam, 'TBD', 'LAST_16 slot 0 home is TBD with no matches');
  assertEqual(rounds[2].slots[0].homeTeam, 'TBD', 'FINAL slot 0 home is TBD with no matches');
}

console.log("\nTest #7: an unresolved LAST_32 match shows its real teams in round 0 only");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'scheduled', outcome: null }
  ];
  const rounds = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[0].slots[0].homeTeam, 'Germany', 'round 0 slot 0 shows the real home team');
  assertEqual(rounds[0].slots[0].awayTeam, 'Paraguay', 'round 0 slot 0 shows the real away team');
  assertEqual(rounds[1].slots[0].homeTeam, 'TBD', 'LAST_16 slot 0 home stays TBD — parent A not resolved yet');
}

console.log("\nTest #8: resolving one parent fills only that half of the next round's slot");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'scheduled', outcome: null }
  ];
  const rounds = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 home fills with the resolved winner (Germany)');
  assertEqual(rounds[1].slots[0].awayTeam, 'TBD', 'LAST_16 slot 0 away stays TBD — sibling match (slot 1) not resolved yet');
}

console.log("\nTest #9: resolving both parents fills both halves of the next round's slot");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'resolved', outcome: 'away' }
  ];
  const rounds = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 home is the LAST_32 slot-0 winner');
  assertEqual(rounds[1].slots[0].awayTeam, 'Sweden', 'LAST_16 slot 0 away is the LAST_32 slot-1 winner (away won)');
}

console.log("\nTest #10: an explicit next-round match record takes priority over derivation");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'resolved', outcome: 'away' },
    { matchType: 'KO', bracketRound: 'LAST_16', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Sweden', status: 'scheduled', outcome: null }
  ];
  const rounds = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].match.id, undefined, 'sanity: fixture objects in this test have no id field');
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 uses the real match record\'s home team');
  assertEqual(rounds[1].slots[0].awayTeam, 'Sweden', 'LAST_16 slot 0 uses the real match record\'s away team');
}
```

- [ ] **Step 2: Run it and confirm it passes**

```bash
node verify_bracket_layout.js
```

Expected: all 10 tests (5 layout + 5 derivation) print `PASS:`, ending in `All bracket layout tests PASSED successfully!` (note: the final summary line/exit-code logic from Task 3 covers both test groups since they share one `failed` flag).

- [ ] **Step 3: Commit**

```bash
git add verify_bracket_layout.js
git commit -m "test: add verify script coverage for bracket rounds derivation"
```

---

## Task 5: `public/bracket.js` — port verified logic + DOM renderer + CSS

**Files:**
- Create: `public/bracket.js`
- Modify: `public/style.css` (append new section at end of file)
- Modify: `public/index.html:655` (add `<script src="bracket.js"></script>` before `<script src="app.js"></script>`)

**Interfaces:**
- Produces: `BRACKET_ROUNDS` (array constant), `renderBracket(rootEl: HTMLElement, rounds: ReturnType<buildBracketRounds>, onPick: (match, side) => void)`. Task 6/7 call `renderBracket` by this exact name and signature.
- Consumes: `computeBracketPositions`/`buildBracketRounds` as verified in Tasks 3-4 (ported verbatim, not re-derived).

This task has no automated test — DOM rendering and drag/scroll wiring aren't unit-tested anywhere in this codebase (e.g. `renderMatches()` has none either); verification is manual in a browser in Step 4.

- [ ] **Step 1: Create `public/bracket.js`**

```js
// bracket.js
// Bracket-tree renderer for the knockout stage (Round of 32 -> Final).
// computeBracketPositions/buildBracketRounds are verified in
// verify_bracket_layout.js (a standalone Node script with its own copy of
// this logic, per this repo's testing convention) — keep them in sync if
// either changes.

const BRACKET_ROUNDS = [
  { code: 'LAST_32', label: 'Round of 32', size: 16 },
  { code: 'LAST_16', label: 'Round of 16', size: 8 },
  { code: 'QUARTER_FINALS', label: 'Quarter-finals', size: 4 },
  { code: 'SEMI_FINALS', label: 'Semi-finals', size: 2 },
  { code: 'FINAL', label: 'Final', size: 1 }
];

const BRACKET_CARD_W = 168;
const BRACKET_CARD_H = 60;
const BRACKET_GAP = 16;
const BRACKET_ROW_H = BRACKET_CARD_H + BRACKET_GAP;
const BRACKET_COL_GAP = 56;
const BRACKET_COL_PITCH = BRACKET_CARD_W + BRACKET_COL_GAP;

function computeBracketPositions(roundSizes, focusedIdx, rowHeight) {
  const positions = [];
  positions[focusedIdx] = Array.from({ length: roundSizes[focusedIdx] }, (_, i) => i * rowHeight);
  for (let r = focusedIdx + 1; r < roundSizes.length; r++) {
    const prev = positions[r - 1];
    const n = roundSizes[r];
    positions[r] = Array.from({ length: n }, (_, i) => (prev[i * 2] + prev[i * 2 + 1]) / 2);
  }
  return positions;
}

function buildBracketRounds(matches, roundDefs) {
  const byRoundSlot = new Map();
  matches.forEach(m => {
    if (m.matchType !== 'KO' || !m.bracketRound) return;
    byRoundSlot.set(`${m.bracketRound}:${m.bracketSlot}`, m);
  });

  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      const match = byRoundSlot.get(`${roundDef.code}:${i}`) || null;
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (match) {
        homeTeam = match.homeTeam;
        awayTeam = match.awayTeam;
      } else if (r > 0) {
        const prevCode = roundDefs[r - 1].code;
        const parentA = byRoundSlot.get(`${prevCode}:${i * 2}`);
        const parentB = byRoundSlot.get(`${prevCode}:${i * 2 + 1}`);
        if (parentA && parentA.status === 'resolved') {
          homeTeam = parentA.outcome === 'home' ? parentA.homeTeam : parentA.awayTeam;
        }
        if (parentB && parentB.status === 'resolved') {
          awayTeam = parentB.outcome === 'home' ? parentB.homeTeam : parentB.awayTeam;
        }
      }
      slots.push({ slot: i, match, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}

// --- DOM rendering ---

let _bracketFocused = 0;
let _bracketPositions = [];
let _bracketOnPick = null;

function renderBracket(rootEl, rounds, onPick) {
  _bracketOnPick = onPick;
  const roundSizes = rounds.map(r => r.size);

  rootEl.innerHTML = `
    <div class="bracket-tabs" id="bracketTabs"></div>
    <div class="bracket-scrollwrap" id="bracketScrollwrap">
      <div class="bracket-track" id="bracketTrack">
        <svg class="bracket-connectors" id="bracketSvg"></svg>
      </div>
    </div>
  `;

  const tabsEl = rootEl.querySelector('#bracketTabs');
  const scrollwrap = rootEl.querySelector('#bracketScrollwrap');
  const track = rootEl.querySelector('#bracketTrack');
  const svg = rootEl.querySelector('#bracketSvg');

  rounds.forEach((round, i) => {
    const t = document.createElement('div');
    t.className = 'bracket-tab' + (i === 0 ? ' active' : '');
    t.textContent = round.label;
    t.onclick = () => goToBracketRound(i, rounds, roundSizes, track, svg, scrollwrap, tabsEl);
    tabsEl.appendChild(t);
  });

  const trackWidth = rounds.length * BRACKET_COL_PITCH + 240;
  track.style.width = trackWidth + 'px';
  svg.setAttribute('width', trackWidth);

  _bracketFocused = 0;
  _bracketPositions = computeBracketPositions(roundSizes, 0, BRACKET_ROW_H);

  buildBracketCards(track, rounds);
  applyBracketPositions(rounds, track, svg);

  scrollwrap.onscroll = debounceBracketScroll(() => {
    const idx = Math.round(scrollwrap.scrollLeft / BRACKET_COL_PITCH);
    if (idx !== _bracketFocused && idx >= 0 && idx < rounds.length) {
      goToBracketRound(idx, rounds, roundSizes, track, svg, scrollwrap, tabsEl);
    }
  });

  wireBracketDrag(scrollwrap);
}

function debounceBracketScroll(fn) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, 140);
  };
}

function wireBracketDrag(scrollwrap) {
  let isDown = false, startX, scrollStart;
  scrollwrap.onmousedown = e => {
    isDown = true;
    startX = e.pageX;
    scrollStart = scrollwrap.scrollLeft;
    scrollwrap.style.cursor = 'grabbing';
  };
  window.addEventListener('mouseup', () => { isDown = false; scrollwrap.style.cursor = 'grab'; });
  window.addEventListener('mousemove', e => {
    if (!isDown) return;
    scrollwrap.scrollLeft = scrollStart - (e.pageX - startX);
  });
}

function buildBracketCards(track, rounds) {
  track.querySelectorAll('.bracket-card').forEach(el => el.remove());
  rounds.forEach((round, r) => {
    const xOffset = r * BRACKET_COL_PITCH;
    round.slots.forEach((slotData, i) => {
      const card = document.createElement('div');
      card.className = 'bracket-card' + (round.code === 'FINAL' ? ' final' : '');
      card.style.left = xOffset + 'px';
      card.dataset.round = r;
      card.dataset.slot = i;
      card.appendChild(buildBracketRow(slotData, 'home'));
      card.appendChild(buildBracketRow(slotData, 'away'));
      track.appendChild(card);
    });
  });
}

function buildBracketRow(slotData, side) {
  const row = document.createElement('div');
  const team = side === 'home' ? slotData.homeTeam : slotData.awayTeam;
  const isTbd = team === 'TBD';
  const match = slotData.match;
  const myVote = match ? match.myVote : null;
  const isPick = myVote === side;
  const votable = !!match && match.status !== 'resolved' && !match.votingLocked;

  row.className = 'bracket-row' + (isTbd ? ' tbd' : '') + (isPick ? ' pick' : '');
  row.textContent = team;
  if (votable && !isTbd) {
    row.classList.add('votable');
    row.onclick = () => _bracketOnPick(match, side);
  }
  return row;
}

function applyBracketPositions(rounds, track, svg) {
  rounds.forEach((round, r) => {
    if (!_bracketPositions[r]) return;
    round.slots.forEach((_, i) => {
      const card = track.querySelector(`.bracket-card[data-round="${r}"][data-slot="${i}"]`);
      if (card) card.style.top = _bracketPositions[r][i] + 'px';
    });
  });
  drawBracketConnectors(rounds, svg);
}

function drawBracketConnectors(rounds, svg) {
  svg.innerHTML = '';
  let maxY = 0;
  for (let r = _bracketFocused; r < rounds.length - 1; r++) {
    const positions = _bracketPositions[r];
    if (!positions) continue;
    const xOffset = r * BRACKET_COL_PITCH;
    const childX = (r + 1) * BRACKET_COL_PITCH;
    positions.forEach((y, i) => {
      const pairIdx = Math.floor(i / 2);
      const childY = _bracketPositions[r + 1][pairIdx] + BRACKET_CARD_H / 2;
      const startX = xOffset + BRACKET_CARD_W;
      const startY = y + BRACKET_CARD_H / 2;
      const midX = startX + BRACKET_COL_GAP / 2;
      maxY = Math.max(maxY, y, childY);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} H ${midX} V ${childY} H ${childX}`);
      svg.appendChild(path);
    });
  }
  svg.setAttribute('height', Math.max(maxY + BRACKET_CARD_H + 60, 600));
}

function goToBracketRound(idx, rounds, roundSizes, track, svg, scrollwrap, tabsEl) {
  scrollwrap.scrollTo({ left: idx * BRACKET_COL_PITCH, behavior: 'smooth' });
  if (idx === _bracketFocused) return;
  _bracketFocused = idx;
  _bracketPositions = computeBracketPositions(roundSizes, idx, BRACKET_ROW_H);
  applyBracketPositions(rounds, track, svg);
  tabsEl.querySelectorAll('.bracket-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
}
```

> **Note on the brainstorming prototype:** two fixes versus the validated mockup (`.superpowers/brainstorm/mockups/bracket-paged-v3-cascade.html`), both required because the real Round of 32 has 16 matches (the mockup sample used 4-8): (1) `.bracket-scrollwrap` below scrolls on **both** axes (`overflow: auto`, not `overflow-y: hidden`) so a 16-card column (≈1200px tall) is actually reachable instead of clipped, with `scroll-snap-type` constrained to the `x` axis only so vertical scroll stays free; (2) the mockup's floating per-column `.col-label` is dropped — the round tabs already serve that purpose and stay fixed at the top, so a second, redundant label was removed rather than fixed for stickiness.

- [ ] **Step 2: Append bracket CSS to `public/style.css`**

Add at the end of the file:

```css
/* ===== Bracket tab (knockout stage) ===== */
.bracket-tabs {
  display: flex;
  gap: 6px;
  padding: 4px 4px 14px;
  overflow-x: auto;
  flex-wrap: wrap;
}

.bracket-tab {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: var(--transition-smooth);
  user-select: none;
}

.bracket-tab.active {
  background: rgba(0, 230, 118, 0.14);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.bracket-scrollwrap {
  overflow: auto;
  scroll-snap-type: x mandatory;
  position: relative;
  cursor: grab;
  max-height: 70vh;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.bracket-track {
  position: relative;
  min-height: 100%;
  padding: 20px 0;
}

.bracket-connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.bracket-connectors path {
  stroke: var(--border-color);
  stroke-width: 2;
  fill: none;
}

.bracket-card {
  position: absolute;
  left: 0;
  width: 168px;
  height: 60px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: top 0.5s cubic-bezier(.22, .85, .25, 1);
}

.bracket-card.final {
  border-color: var(--color-gold);
}

.bracket-row {
  padding: 8px 10px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  height: 50%;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color);
}

.bracket-card .bracket-row:last-child {
  border-bottom: none;
}

.bracket-row.tbd {
  color: var(--text-muted);
  font-style: italic;
  font-weight: 500;
}

.bracket-row.pick {
  color: var(--color-accent);
  background: rgba(0, 230, 118, 0.08);
}

.bracket-row.votable {
  cursor: pointer;
}

.bracket-row.votable:hover {
  background: rgba(255, 255, 255, 0.06);
}

@media (max-width: 600px) {
  .bracket-card { width: 150px; }
  .bracket-row { font-size: 0.76rem; padding: 6px 8px; }
}
```

- [ ] **Step 3: Load the new script in `index.html`**

In `public/index.html`, change line 655 from:

```html
  <script src="app.js"></script>
```

to:

```html
  <script src="bracket.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 4: Manual browser verification**

Start the server, log in as any player, open the browser console, and run:

```js
buildBracketRounds([], BRACKET_ROUNDS).length === 5
```

Expected: `true`. Then manually mount it to confirm rendering (this element doesn't exist in the DOM yet — Task 6 wires it into a real tab — for now just confirm no exceptions):

```js
const probe = document.createElement('div');
document.body.appendChild(probe);
renderBracket(probe, buildBracketRounds([], BRACKET_ROUNDS), () => {});
probe.querySelectorAll('.bracket-card').length === 31 // 16+8+4+2+1
probe.remove();
```

Expected: `31`, and 5 pill tabs visible briefly in the corner of the page with "TBD" rows, all in the app's dark theme. Drag inside `.bracket-scrollwrap` left/right — tabs should switch and boxes should re-animate.

- [ ] **Step 5: Commit**

```bash
git add public/bracket.js public/style.css public/index.html
git commit -m "feat: add bracket-tree renderer (public/bracket.js) and styles"
```

---

## Task 6: New "Bracket" tab — HTML + nav wiring

**Files:**
- Modify: `public/index.html:48-50` (tab nav — add a new button after the Predictions button)
- Modify: `public/index.html:81` (insert a new `<section>` right after the Predictions section closes)

**Interfaces:**
- Produces: `#tabBtnBracket`, `#tabContentBracket`, `#bracketContainer` — Task 7's `renderBracketTab()` targets `#bracketContainer` by this exact id.

- [ ] **Step 1: Add the tab button**

In `public/index.html`, after line 50 (the closing `</button>` of the Predictions tab button) and before line 51 (`<button class="tab-btn" id="tabBtnResults"...`), insert:

```html
        <button class="tab-btn" id="tabBtnBracket" onclick="switchTab('bracket')">
          <span class="tab-icon">🎯</span> <span class="tab-label">Bracket</span>
        </button>
```

- [ ] **Step 2: Add the tab content section**

In `public/index.html`, after line 81 (the `</section>` closing the Predictions tab) and before line 83 (the `<!-- ================= PAST RESULTS TAB ================= -->` comment), insert:

```html
      <!-- ================= BRACKET TAB ================= -->
      <section id="tabContentBracket" class="tab-content">
        <div class="section-header">
          <h2>🎯 Knockout Bracket</h2>
          <p class="section-description">Round of 32 onward. Drag/swipe between rounds — your picks light up green as you go.</p>
        </div>
        <div id="bracketContainer"></div>
      </section>
```

- [ ] **Step 3: Manual browser verification**

Reload the app in a browser, log in, and click the new "🎯 Bracket" tab button. Expected: the tab switches (button highlights, section becomes visible per the existing `switchTab` class-toggle logic), but `#bracketContainer` is empty — that's expected, since `renderBracketTab()` doesn't exist until Task 7.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add Bracket tab nav button and content container"
```

---

## Task 7: Wire the Bracket tab into `app.js`, narrow Predictions to League-only

**Files:**
- Modify: `public/app.js:150-175` (`switchTab`)
- Modify: `public/app.js:248-291` (`loadDashboardData`)
- Modify: `public/app.js:1656-1673` (`renderMatches`, two filters)
- Modify: `public/app.js` (add a new `renderBracketTab` function near `renderMatches`)

**Interfaces:**
- Consumes: `BRACKET_ROUNDS`, `buildBracketRounds`, `renderBracket` (Task 5); `matches` (global, already populated by `loadDashboardData`); `submitVote(matchId, prediction)` (existing, `public/app.js:1955`).
- Produces: `renderBracketTab()` — Task 8 does not call this directly, but it must exist and be callable with no arguments.

- [ ] **Step 1: Add `renderBracketTab()`**

In `public/app.js`, add this new function directly after `renderMatches()`'s closing `}` at line 1780:

```js
// Renders the Bracket tab (knockout stage). Reuses submitVote/confirmVote
// for the actual voting flow — clicking a bracket row is equivalent to
// clicking a predict-btn in the old flat list.
function renderBracketTab() {
  const container = document.getElementById('bracketContainer');
  if (!container) return;
  const rounds = buildBracketRounds(matches, BRACKET_ROUNDS);
  renderBracket(container, rounds, (match, side) => submitVote(match.id, side));
}
```

- [ ] **Step 2: Wire it into `switchTab`**

In `public/app.js`, in `switchTab` (lines 165-174), change:

```js
  if (tabName === 'predictions') {
    renderMatches();
  } else if (tabName === 'results') {
```

to:

```js
  if (tabName === 'predictions') {
    renderMatches();
  } else if (tabName === 'bracket') {
    renderBracketTab();
  } else if (tabName === 'results') {
```

- [ ] **Step 3: Wire it into `loadDashboardData`**

In `public/app.js`, in `loadDashboardData` (around line 265, right after `matches = await response.json();`), change:

```js
    matches = await response.json();
    
    if (activeTab === 'predictions') {
      renderMatches();
    } else if (activeTab === 'results') {
```

to:

```js
    matches = await response.json();
    
    if (activeTab === 'predictions') {
      renderMatches();
    } else if (activeTab === 'bracket') {
      renderBracketTab();
    } else if (activeTab === 'results') {
```

- [ ] **Step 4: Narrow `renderMatches()` to League (group-stage) matches only**

In `public/app.js`, in `renderMatches()`, change the `notVotedCount` filter (lines 1656-1662):

```js
  const notVotedCount = matches.filter(match => {
    if (match.matchType !== 'League') return false;
    if (match.status === 'resolved') return false;
    if (match.votingLocked) return false;
    const started = new Date(match.kickoff) <= now;
    const open = !started || match.extensionActive;
    return open && !match.myVote;
  }).length;
```

and the main `filtered` (lines 1667-1673):

```js
  const filtered = matches.filter(match => {
    if (match.matchType !== 'League') return false;
    const isStarted = new Date(match.kickoff) <= now;
    if (!isStarted && match.status === 'scheduled') return true;
    if (isStarted && match.status !== 'resolved' && match.extensionActive) return true;
    return false;
  });
```

- [ ] **Step 5: Manual browser verification**

Using the curl commands from Task 1 (or the admin "Add Match" form), create one KO match with `bracketRound: 'LAST_32', bracketSlot: 0`. Reload the app, log in:
- The Predictions tab should **not** show this KO match (only League matches, if any exist).
- The Bracket tab should show it as the first card in the "Round of 32" column, with two clickable rows (the real team names), and 15 more `TBD vs TBD` cards filling out the rest of Round of 32, plus full TBD skeletons for Round of 16 through Final.
- Click one of the two team rows. It should trigger the existing vote-confirmation modal (same one used by the flat list) with the correct matchup/choice text. Confirm it — the row should highlight green (`.bracket-row.pick`) after the page re-renders.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: wire Bracket tab into app.js, narrow Predictions to League matches"
```

---

## Task 8: Hide the Predictions tab once `LAST_32` opens

**Files:**
- Modify: `public/app.js:110-119` (`setupUser`)
- Modify: `public/app.js:121-134` (add a sibling function right after `updateAdminTabVisibility`)
- Modify: `public/app.js:137-147` (`startIntervals`, the `pollInterval` callback)

**Interfaces:**
- Consumes: `openMatchStages` (existing global, `public/app.js:23`), `GET /api/stages` (Task 2).
- Produces: `updatePredictionsTabVisibility()` — called from `setupUser()` and from the existing poll interval; no other task depends on calling it directly.

- [ ] **Step 1: Add `loadStages()` and `updatePredictionsTabVisibility()`**

In `public/app.js`, immediately after `updateAdminTabVisibility()` (which ends at line 134), add:

```js
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

// Once Round of 32 opens, the flat-list Predictions tab has nothing left
// to do — group-stage voting is done, and KO matches live in the Bracket
// tab exclusively. Hide it and bounce off it if it's currently active.
function updatePredictionsTabVisibility() {
  const predictionsBtn = document.getElementById('tabBtnPredictions');
  if (!predictionsBtn) return;
  const last32Open = openMatchStages.includes('LAST_32');
  if (last32Open) {
    predictionsBtn.style.display = 'none';
    if (activeTab === 'predictions') {
      switchTab('bracket');
    }
  } else {
    predictionsBtn.style.display = 'inline-flex';
  }
}
```

- [ ] **Step 2: Call it on login**

In `public/app.js`, in `setupUser()` (lines 110-119), change:

```js
    updateAdminTabVisibility();
    loadDashboardData();
```

to:

```js
    updateAdminTabVisibility();
    loadStages();
    loadDashboardData();
```

- [ ] **Step 3: Call it on the existing poll interval**

In `public/app.js`, in `startIntervals()` (lines 137-147), change:

```js
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (currentUserSecret) {
      loadDashboardData();
    }
  }, 10000);
```

to:

```js
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (currentUserSecret) {
      loadDashboardData();
      loadStages();
    }
  }, 10000);
```

- [ ] **Step 4: Manual browser verification**

Log in as admin, go to the Admin tab, and toggle `LAST_32` into "open stages" (existing UI, `/api/admin/settings`). Within 10 seconds (the poll interval), or immediately on a fresh page load, the "🔮 Predictions" tab button should disappear from the nav for **every** logged-in player (not just admin) — confirm by opening the app in a second, non-admin player session. Toggle `LAST_32` back off; the tab should reappear within 10 seconds.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: hide Predictions tab once LAST_32 opens, for all players"
```

---

## Task 9: Admin "Create Match" form — bracketRound/bracketSlot fields

**Files:**
- Modify: `public/index.html:467-479` (the matchType/kickoff form row)
- Modify: `public/app.js:2416-2455` (`handleCreateMatch`)

**Interfaces:**
- Consumes: `BRACKET_ROUNDS` (Task 5, already loaded globally by the time `app.js` runs since `bracket.js` is included first).
- Produces: none consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Add the form fields**

In `public/index.html`, after line 479 (the closing `</div>` of the matchType/kickoff `form-row`) and before line 480 (the submit button), insert:

```html
                  <div class="form-row" id="bracketFieldsRow" style="display: none;">
                    <div class="form-group">
                      <label for="bracketRoundSelect">Bracket Round</label>
                      <select id="bracketRoundSelect" class="form-control">
                        <option value="">— none —</option>
                        <option value="LAST_32">Round of 32</option>
                        <option value="LAST_16">Round of 16</option>
                        <option value="QUARTER_FINALS">Quarter-finals</option>
                        <option value="SEMI_FINALS">Semi-finals</option>
                        <option value="FINAL">Final</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label for="bracketSlotInput">Bracket Slot (0-indexed)</label>
                      <input type="number" id="bracketSlotInput" min="0" placeholder="e.g. 0" class="form-control">
                    </div>
                  </div>
```

Also, on the existing `matchTypeSelect` (`public/index.html:470`), add an `onchange` handler so the new row only shows for KO matches. Change:

```html
                      <select id="matchTypeSelect" class="form-control">
```

to:

```html
                      <select id="matchTypeSelect" class="form-control" onchange="toggleBracketFieldsRow()">
```

- [ ] **Step 2: Add `toggleBracketFieldsRow()` and wire the two fields into `handleCreateMatch`**

In `public/app.js`, add this new function directly above `handleCreateMatch` (line 2416):

```js
function toggleBracketFieldsRow() {
  const matchType = document.getElementById('matchTypeSelect').value;
  document.getElementById('bracketFieldsRow').style.display = matchType === 'KO' ? 'flex' : 'none';
}
```

Then in `handleCreateMatch` (lines 2416-2438), change:

```js
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
```

to:

```js
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
```

Also reset the row visibility after a successful create — in the same function, change:

```js
    document.getElementById('addMatchForm').reset();
    initializeDefaultKickoff();
```

to:

```js
    document.getElementById('addMatchForm').reset();
    initializeDefaultKickoff();
    toggleBracketFieldsRow();
```

- [ ] **Step 3: Manual browser verification**

In the Admin tab's "Add New Match" form, switch Match Type to "Knockout Match (2-way)" — the two new fields should appear. Fill in a round/slot, submit, and confirm via `curl -s http://localhost:8080/api/matches -H "x-user-secret: USER_SECRET"` (or the Bracket tab itself) that the created match carries the chosen `bracketRound`/`bracketSlot`. Switch Match Type back to "League" — the row should hide again.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: add bracketRound/bracketSlot fields to admin Create Match form"
```

---

## Task 10: End-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full skeleton with zero KO matches**

With `data.json` in its current real state (zero KO matches), open the Bracket tab. Expected: full 16/8/4/2/1 TBD skeleton renders without errors, all rows non-clickable (no `votable` class anywhere).

- [ ] **Step 2: Create and vote through one full bracket path**

Using the admin form, create 16 `LAST_32` matches (slots 0-15) with real team names and near-future kickoffs. Vote on all of them as a non-admin player from the Bracket tab. Confirm personal picks highlight green and persist after a page reload (re-fetch from `/api/matches`).

- [ ] **Step 3: Resolve and confirm propagation**

As admin, resolve `LAST_32` slot 0 and slot 1 via the existing Admin tab "Resolve" controls (`/api/admin/resolve` — unchanged by this plan). Reload the Bracket tab as a player: `LAST_16` slot 0 should now show both real winning team names (no longer TBD), independent of whether a `LAST_16` match record exists yet for that slot.

- [ ] **Step 4: Admin creates the real next-round match**

Still as admin, create the actual `LAST_16` slot-0 match (same two team names just confirmed in Step 3) via the Create Match form with `bracketRound: LAST_16, bracketSlot: 0`. Reload as a player: that slot's rows should now be clickable (votable) — confirm a vote can be cast and the existing vote-confirmation modal flow completes normally.

- [ ] **Step 5: Stage-gated tab hiding**

As admin, add `LAST_32` to "open stages" in the Admin tab settings. Within 10 seconds, confirm the Predictions tab disappears for a separate non-admin player session that's already logged in (no refresh needed — the poll interval should pick it up). Remove `LAST_32` from open stages; confirm the tab reappears.

- [ ] **Step 6: Mobile/narrow-viewport check**

Resize the browser to ~375px wide (or open dev tools device emulation). Confirm: two full bracket columns plus a sliver of a third remain visible, dragging horizontally pages between rounds with the tabs updating in sync, and scrolling vertically reaches all 16 Round-of-32 cards without anything being clipped.

- [ ] **Step 7: Wide-viewport check**

Widen the browser to ≥1400px. Confirm the bracket track (5 columns × ~224px + buffer ≈ 1360px) fits without any horizontal scrollbar, i.e. the full tree (all 5 rounds, Round of 32 through Final) is visible simultaneously with no paging needed — this should require no separate code path, just the natural result of the track fitting inside the viewport.
