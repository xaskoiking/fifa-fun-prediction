# Fantasy Bracket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user fantasy bracket (pick the full KO tree once before R32 locks) alongside the unchanged prediction bracket, with server-side storage, automatic time-based locking, and a full-screen modal UI launched from a new header button.

**Architecture:** New `db.fantasyBrackets` top-level key stores per-user picks keyed as `"roundCode:slot" → "home"|"away"`. Two new API endpoints handle reads and writes with server-side cascade clear. `public/fantasy-bracket.js` contains pure data-build and DOM-render functions that share layout constants already loaded globally from `bracket.js`. `app.js` wires the modal open/close and pick-save flow.

**Tech Stack:** Node.js/Express (server), vanilla JS (client), JSON file persistence via `readData()`/`writeData()`, CSS in `style.css`, no new dependencies.

## Global Constraints

- Mobile breakpoint ≤600px, desktop ≥601px — matches existing `style.css` convention
- Lock condition: `db.matches.some(m => m.bracketRound === 'LAST_32' && new Date(m.kickoff) <= new Date())`
- Full bracket = 31 picks: 16 (LAST_32) + 8 (LAST_16) + 4 (QUARTER_FINALS) + 2 (SEMI_FINALS) + 1 (FINAL)
- Round order constant: `['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL']`
- User auth in new routes: `authenticateSecret` middleware — sets `req.username`; already used on `/api/matches` and `/api/predict`
- DB read/write: `const db = readData();` then `writeData(db);` — matches existing route pattern
- `BRACKET_ROUND_SIZES` already defined in `server.js` at line ~1127 — reuse for slot validation
- Fantasy bracket is unscored — never compute points from it
- Server port: 3000 (local dev)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server.js` | Modify | `ensureFantasyBrackets`, `isFantasyLocked`, `GET /api/fantasy-bracket`, `POST /api/fantasy-bracket/pick` |
| `verify_fantasy_bracket.js` | Create | Standalone node test for `buildFantasyBracketRounds` + cascade clear logic |
| `public/fantasy-bracket.js` | Create | `buildFantasyBracketRounds`, `renderFantasyBracket`, all fantasy render sub-functions |
| `public/index.html` | Modify | Fantasy button in `header-main`, modal overlay HTML, `<script>` tag for fantasy-bracket.js |
| `public/style.css` | Modify | Button styles (responsive), modal overlay, `.fantasy-pick` amber accent, `.bracket-card--fantasy` |
| `public/app.js` | Modify | `openFantasyBracket`, `saveFantasyPick`, `closeFantasyBracket`, button show/hide in `setupUser` |

---

### Task 1: Server — fantasy bracket API

**Files:**
- Modify: `server.js`

**Interfaces:**
- Produces:
  - `GET /api/fantasy-bracket` → `{ locked: bool, picks: { [key: string]: "home"|"away" }, r32Matches: Array<{ bracketSlot: number, homeTeam: string, awayTeam: string, kickoff: string }> }`
  - `POST /api/fantasy-bracket/pick` → `{ ok: true, picks: { [key: string]: "home"|"away" } }`

- [ ] **Step 1: Write a failing curl test for the GET endpoint**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/fantasy-bracket \
  -H "x-user-secret: YOUR_SECRET_HERE"
```
Expected: `404` (route doesn't exist yet)

- [ ] **Step 2: Add `ensureFantasyBrackets` and `isFantasyLocked` helper functions to `server.js`**

Add these two functions directly after the `ensureSettings` function (around line 1149 in `server.js`):

```javascript
function ensureFantasyBrackets(db) {
  if (!db.fantasyBrackets || typeof db.fantasyBrackets !== 'object') {
    db.fantasyBrackets = {};
  }
  return db.fantasyBrackets;
}

function isFantasyLocked(db) {
  return db.matches.some(
    m => m.bracketRound === 'LAST_32' && new Date(m.kickoff) <= new Date()
  );
}
```

- [ ] **Step 3: Add `GET /api/fantasy-bracket` route to `server.js`**

Add after the `/api/stages` route (around line 1250 in `server.js`):

```javascript
app.get('/api/fantasy-bracket', authenticateSecret, (req, res) => {
  const db = readData();
  ensureFantasyBrackets(db);
  const username = req.username;
  const locked = isFantasyLocked(db);
  const userBracket = db.fantasyBrackets[username] || { picks: {} };
  const r32Matches = db.matches
    .filter(m => m.bracketRound === 'LAST_32')
    .sort((a, b) => a.bracketSlot - b.bracketSlot)
    .map(m => ({
      bracketSlot: m.bracketSlot,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      kickoff: m.kickoff
    }));
  res.json({ locked, picks: userBracket.picks, r32Matches });
});
```

- [ ] **Step 4: Run curl test to verify GET returns correct structure**

Run (replace `YOUR_SECRET_HERE` with an actual user secret from `data.json`):
```bash
curl -s http://localhost:3000/api/fantasy-bracket \
  -H "x-user-secret: YOUR_SECRET_HERE" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('locked:', d.locked);
console.log('picks keys:', Object.keys(d.picks).length);
console.log('r32Matches:', d.r32Matches.length);
"
```
Expected: `locked: false` (or true if any R32 kickoff has passed), `picks keys: 0`, `r32Matches: <number of LAST_32 matches in db>`

- [ ] **Step 5: Add `POST /api/fantasy-bracket/pick` route to `server.js`**

Add directly after the GET route from Step 3:

```javascript
app.post('/api/fantasy-bracket/pick', authenticateSecret, (req, res) => {
  const db = readData();
  ensureFantasyBrackets(db);
  const username = req.username;

  if (isFantasyLocked(db)) {
    return res.status(403).json({ error: 'Fantasy bracket is locked.' });
  }

  const { roundCode, slot, side } = req.body;

  if (!Object.prototype.hasOwnProperty.call(BRACKET_ROUND_SIZES, roundCode)) {
    return res.status(400).json({ error: `Invalid roundCode. Must be one of: ${Object.keys(BRACKET_ROUND_SIZES).join(', ')}` });
  }
  const slotNum = Number(slot);
  if (!Number.isInteger(slotNum) || slotNum < 0 || slotNum >= BRACKET_ROUND_SIZES[roundCode]) {
    return res.status(400).json({ error: `Invalid slot for ${roundCode}.` });
  }
  if (side !== 'home' && side !== 'away') {
    return res.status(400).json({ error: 'side must be "home" or "away".' });
  }

  if (!db.fantasyBrackets[username]) {
    db.fantasyBrackets[username] = { picks: {} };
  }
  const picks = db.fantasyBrackets[username].picks;

  picks[`${roundCode}:${slotNum}`] = side;

  // Cascade clear: wipe all downstream picks that depended on this slot
  const FANTASY_ROUND_ORDER = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'];
  const startIdx = FANTASY_ROUND_ORDER.indexOf(roundCode);
  let currentSlot = slotNum;
  for (let i = startIdx + 1; i < FANTASY_ROUND_ORDER.length; i++) {
    currentSlot = Math.floor(currentSlot / 2);
    delete picks[`${FANTASY_ROUND_ORDER[i]}:${currentSlot}`];
  }

  logAuditAction(db, 'FANTASY_PICK', `${username} picked "${side}" for ${roundCode} slot ${slotNum}`);
  writeData(db);
  res.json({ ok: true, picks });
});
```

- [ ] **Step 6: Run curl tests to verify POST saves picks and cascade-clears**

Test saving a pick:
```bash
curl -s -X POST http://localhost:3000/api/fantasy-bracket/pick \
  -H "x-user-secret: YOUR_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"roundCode":"LAST_32","slot":0,"side":"home"}' | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('ok:', d.ok);
console.log('LAST_32:0 =', d.picks['LAST_32:0']);
"
```
Expected: `ok: true`, `LAST_32:0 = home`

Test cascade clear (first pick R32:0 and LAST_16:0, then change R32:0):
```bash
# Pick LAST_32:0
curl -s -X POST http://localhost:3000/api/fantasy-bracket/pick \
  -H "x-user-secret: YOUR_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"roundCode":"LAST_32","slot":0,"side":"home"}' > /dev/null

# Pick LAST_16:0
curl -s -X POST http://localhost:3000/api/fantasy-bracket/pick \
  -H "x-user-secret: YOUR_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"roundCode":"LAST_16","slot":0,"side":"home"}' > /dev/null

# Change LAST_32:0 — should wipe LAST_16:0
curl -s -X POST http://localhost:3000/api/fantasy-bracket/pick \
  -H "x-user-secret: YOUR_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"roundCode":"LAST_32","slot":0,"side":"away"}' | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('LAST_32:0 =', d.picks['LAST_32:0']);  // expect: away
console.log('LAST_16:0 =', d.picks['LAST_16:0']);  // expect: undefined (cleared)
"
```
Expected: `LAST_32:0 = away`, `LAST_16:0 = undefined`

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: add fantasy bracket server API with cascade clear"
```

---

### Task 2: `verify_fantasy_bracket.js` — standalone tests

**Files:**
- Create: `verify_fantasy_bracket.js`

**Interfaces:**
- Consumes: inline copies of `buildFantasyBracketRounds` (must be kept in sync with `public/fantasy-bracket.js`) and cascade clear logic (must be kept in sync with `server.js` POST handler)
- Produces: exit 0 on pass, exit 1 on failure (same convention as `verify_bracket_layout.js`)

- [ ] **Step 1: Create `verify_fantasy_bracket.js`**

```javascript
// verify_fantasy_bracket.js
// Standalone tests for fantasy bracket data logic.
// Keep buildFantasyBracketRounds in sync with public/fantasy-bracket.js.
// Keep computeCascadeClear in sync with POST /api/fantasy-bracket/pick in server.js.

const BRACKET_ROUNDS = [
  { code: 'LAST_32',        label: 'Round of 32',    size: 16 },
  { code: 'LAST_16',        label: 'Round of 16',    size: 8  },
  { code: 'QUARTER_FINALS', label: 'Quarter-finals', size: 4  },
  { code: 'SEMI_FINALS',    label: 'Semi-finals',    size: 2  },
  { code: 'FINAL',          label: 'Final',          size: 1  }
];

function buildFantasyBracketRounds(r32Matches, picks, roundDefs) {
  const slotToMatch = new Map();
  r32Matches.forEach(m => slotToMatch.set(m.bracketSlot, m));
  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (r === 0) {
        const match = slotToMatch.get(i);
        if (match) { homeTeam = match.homeTeam; awayTeam = match.awayTeam; }
      } else {
        const prevRound = rounds[r - 1];
        const parentHome = prevRound.slots[i * 2];
        const parentAway = prevRound.slots[i * 2 + 1];
        const pickHome = picks[`${roundDefs[r - 1].code}:${i * 2}`];
        const pickAway = picks[`${roundDefs[r - 1].code}:${i * 2 + 1}`];
        if (pickHome && parentHome) homeTeam = pickHome === 'home' ? parentHome.homeTeam : parentHome.awayTeam;
        if (pickAway && parentAway) awayTeam = pickAway === 'home' ? parentAway.homeTeam : parentAway.awayTeam;
      }
      slots.push({ slot: i, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}

function computeCascadeClear(roundCode, slot) {
  const order = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'];
  const startIdx = order.indexOf(roundCode);
  const toClear = [];
  let currentSlot = slot;
  for (let i = startIdx + 1; i < order.length; i++) {
    currentSlot = Math.floor(currentSlot / 2);
    toClear.push(`${order[i]}:${currentSlot}`);
  }
  return toClear;
}

let passed = 0; let failed = 0;
function assert(desc, condition) {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}`); failed++; }
}

// ── buildFantasyBracketRounds ──────────────────────────────────────

console.log('\nbuildFantasyBracketRounds:');

const r32 = [
  { bracketSlot: 0, homeTeam: 'Mexico',  awayTeam: 'South Africa' },
  { bracketSlot: 1, homeTeam: 'France',  awayTeam: 'Brazil'       },
  { bracketSlot: 2, homeTeam: 'Germany', awayTeam: 'Japan'        },
  { bracketSlot: 3, homeTeam: 'Spain',   awayTeam: 'USA'          }
];

// No picks — R32 shows real teams, R16 shows TBD
let rounds = buildFantasyBracketRounds(r32, {}, BRACKET_ROUNDS);
assert('R32 slot 0 homeTeam = Mexico',                         rounds[0].slots[0].homeTeam === 'Mexico');
assert('R32 slot 0 awayTeam = South Africa',                   rounds[0].slots[0].awayTeam === 'South Africa');
assert('R32 slot 5 homeTeam = TBD (no match)',                  rounds[0].slots[5].homeTeam === 'TBD');
assert('R16 slot 0 homeTeam = TBD (no R32 pick yet)',           rounds[1].slots[0].homeTeam === 'TBD');

// Pick LAST_32:0 home → R16 slot 0 home = Mexico
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'home' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = Mexico (LAST_32:0 → home)',       rounds[1].slots[0].homeTeam === 'Mexico');
assert('R16 slot 0 awayTeam = TBD (LAST_32:1 not picked)',      rounds[1].slots[0].awayTeam === 'TBD');

// Pick LAST_32:0 away → R16 slot 0 home = South Africa
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'away' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = South Africa (LAST_32:0 → away)', rounds[1].slots[0].homeTeam === 'South Africa');

// Pick both LAST_32:0 and LAST_32:1 → R16 slot 0 fully resolved
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'away', 'LAST_32:1': 'home' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = South Africa',                    rounds[1].slots[0].homeTeam === 'South Africa');
assert('R16 slot 0 awayTeam = France',                          rounds[1].slots[0].awayTeam === 'France');

// Full propagation through to QF
const fullR32Picks = { 'LAST_32:0': 'home', 'LAST_32:1': 'away', 'LAST_32:2': 'home', 'LAST_32:3': 'away' };
rounds = buildFantasyBracketRounds(r32, { ...fullR32Picks, 'LAST_16:0': 'home', 'LAST_16:1': 'away' }, BRACKET_ROUNDS);
assert('QF slot 0 homeTeam = Mexico (winner of R16:0)',         rounds[2].slots[0].homeTeam === 'Mexico');
assert('QF slot 0 awayTeam = USA (winner of R16:1)',            rounds[2].slots[0].awayTeam === 'USA');

// ── computeCascadeClear ───────────────────────────────────────────

console.log('\ncomputeCascadeClear:');

let toClear = computeCascadeClear('LAST_32', 0);
assert('LAST_32:0 clears LAST_16:0',        toClear.includes('LAST_16:0'));
assert('LAST_32:0 clears QUARTER_FINALS:0', toClear.includes('QUARTER_FINALS:0'));
assert('LAST_32:0 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_32:0 clears FINAL:0',          toClear.includes('FINAL:0'));
assert('LAST_32:0 does not clear LAST_32',  !toClear.some(k => k.startsWith('LAST_32')));

toClear = computeCascadeClear('LAST_32', 7);
assert('LAST_32:7 clears LAST_16:3',        toClear.includes('LAST_16:3'));
assert('LAST_32:7 clears QUARTER_FINALS:1', toClear.includes('QUARTER_FINALS:1'));
assert('LAST_32:7 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_32:7 clears FINAL:0',          toClear.includes('FINAL:0'));

toClear = computeCascadeClear('LAST_16', 0);
assert('LAST_16:0 clears QUARTER_FINALS:0', toClear.includes('QUARTER_FINALS:0'));
assert('LAST_16:0 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_16:0 clears FINAL:0',          toClear.includes('FINAL:0'));
assert('LAST_16:0 does not clear LAST_32',  !toClear.some(k => k.startsWith('LAST_32')));
assert('LAST_16:0 does not clear LAST_16',  !toClear.some(k => k.startsWith('LAST_16')));

toClear = computeCascadeClear('FINAL', 0);
assert('FINAL:0 clears nothing',            toClear.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the verify script**

```bash
node verify_fantasy_bracket.js
```
Expected output: all lines start with `✓`, ends with `N passed, 0 failed`, exits 0.

- [ ] **Step 3: Commit**

```bash
git add verify_fantasy_bracket.js
git commit -m "test: add verify_fantasy_bracket standalone test script"
```

---

### Task 3: `public/fantasy-bracket.js` — rendering

**Files:**
- Create: `public/fantasy-bracket.js`

**Interfaces:**
- Consumes (globals from already-loaded `bracket.js`): `BRACKET_ROUNDS`, `BRACKET_CARD_W`, `BRACKET_CARD_H`, `BRACKET_ROW_H`, `BRACKET_COL_GAP`, `BRACKET_COL_PITCH`, `BRACKET_HEADER_H`, `BRACKET_LEFT_PAD`, `BRACKET_BOTTOM_PAD`, `computeBracketPositions`, `isBracketDesktop`, `bracketContentHeight`, `applyBracketScrollwrapHeight`, `debounceBracketScroll`, `wireBracketDrag`
- Produces (globals used by `app.js`): `buildFantasyBracketRounds(r32Matches, picks, roundDefs)`, `renderFantasyBracket(container, rounds, picks, locked, onPick)`

- [ ] **Step 1: Create `public/fantasy-bracket.js` with the full file content**

```javascript
// fantasy-bracket.js
// Fantasy bracket renderer. Shares layout constants from bracket.js (loaded first).
// Keep buildFantasyBracketRounds in sync with verify_fantasy_bracket.js.

let _fantasyFocused = 0;
let _fantasyPositions = [];

function buildFantasyBracketRounds(r32Matches, picks, roundDefs) {
  const slotToMatch = new Map();
  r32Matches.forEach(m => slotToMatch.set(m.bracketSlot, m));
  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (r === 0) {
        const match = slotToMatch.get(i);
        if (match) { homeTeam = match.homeTeam; awayTeam = match.awayTeam; }
      } else {
        const prevRound = rounds[r - 1];
        const parentHome = prevRound.slots[i * 2];
        const parentAway = prevRound.slots[i * 2 + 1];
        const pickHome = picks[`${roundDefs[r - 1].code}:${i * 2}`];
        const pickAway = picks[`${roundDefs[r - 1].code}:${i * 2 + 1}`];
        if (pickHome && parentHome) homeTeam = pickHome === 'home' ? parentHome.homeTeam : parentHome.awayTeam;
        if (pickAway && parentAway) awayTeam = pickAway === 'home' ? parentAway.homeTeam : parentAway.awayTeam;
      }
      slots.push({ slot: i, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}

function buildFantasyRow(roundCode, slotIdx, team, side, picks, locked, onPick) {
  const row = document.createElement('div');
  const isTbd = team === 'TBD';
  const isPick = picks[`${roundCode}:${slotIdx}`] === side;
  row.className = 'bracket-row' + (isTbd ? ' tbd' : '') + (isPick ? ' fantasy-pick' : '');
  row.textContent = team;
  if (!locked && !isTbd) {
    row.classList.add('votable');
    row.onclick = () => onPick(roundCode, slotIdx, side);
  }
  return row;
}

function buildFantasyCards(track, rounds, picks, locked, onPick) {
  track.querySelectorAll('.bracket-card--fantasy').forEach(el => el.remove());
  rounds.forEach((round, r) => {
    const xOffset = r * BRACKET_COL_PITCH;
    round.slots.forEach((slotData, i) => {
      const card = document.createElement('div');
      card.className = 'bracket-card bracket-card--fantasy' + (round.code === 'FINAL' ? ' final' : '');
      card.style.left = xOffset + 'px';
      card.dataset.round = r;
      card.dataset.slot = i;
      card.appendChild(buildFantasyRow(round.code, i, slotData.homeTeam, 'home', picks, locked, onPick));
      card.appendChild(buildFantasyRow(round.code, i, slotData.awayTeam, 'away', picks, locked, onPick));
      track.appendChild(card);
    });
  });
}

function applyFantasyPositions(rounds, track, svg) {
  rounds.forEach((round, r) => {
    if (!_fantasyPositions[r]) return;
    round.slots.forEach((_, i) => {
      const card = track.querySelector(`.bracket-card[data-round="${r}"][data-slot="${i}"]`);
      if (card) card.style.top = (_fantasyPositions[r][i] + BRACKET_HEADER_H) + 'px';
    });
  });
  drawFantasyConnectors(rounds, svg);
}

function drawFantasyConnectors(rounds, svg) {
  svg.innerHTML = '';
  let maxY = 0;
  for (let r = _fantasyFocused; r < rounds.length - 1; r++) {
    const positions = _fantasyPositions[r];
    if (!positions) continue;
    const xOffset = r * BRACKET_COL_PITCH;
    const childX = (r + 1) * BRACKET_COL_PITCH;
    positions.forEach((y, i) => {
      const pairIdx = Math.floor(i / 2);
      const childY = _fantasyPositions[r + 1][pairIdx] + BRACKET_HEADER_H + BRACKET_CARD_H / 2;
      const startX = xOffset + BRACKET_CARD_W;
      const startY = y + BRACKET_HEADER_H + BRACKET_CARD_H / 2;
      const midX = startX + BRACKET_COL_GAP / 2;
      maxY = Math.max(maxY, startY, childY);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} H ${midX} V ${childY} H ${childX}`);
      svg.appendChild(path);
    });
  }
  svg.setAttribute('height', Math.max(maxY + BRACKET_CARD_H + 60, 600));
}

function goToFantasyRound(idx, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn) {
  idx = Math.min(Math.max(idx, 0), rounds.length - 1);
  if (isBracketDesktop()) {
    track.style.transform = `translateX(${BRACKET_LEFT_PAD - idx * BRACKET_COL_PITCH}px)`;
    applyBracketScrollwrapHeight(scrollwrap, roundSizes[idx]);
  } else {
    scrollwrap.scrollTo({ left: idx * BRACKET_COL_PITCH, behavior: 'smooth' });
  }
  if (idx === _fantasyFocused) return;
  _fantasyFocused = idx;
  _fantasyPositions = computeBracketPositions(roundSizes, idx, BRACKET_ROW_H);
  applyFantasyPositions(rounds, track, svg);
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === rounds.length - 1;
  track.querySelectorAll('.bracket-col-label').forEach(label => {
    label.classList.toggle('active', +label.dataset.round === idx);
  });
}

function renderFantasyBracket(container, rounds, picks, locked, onPick) {
  const roundSizes = rounds.map(r => r.size);

  container.innerHTML = `
    <div class="bracket-scrollwrap" id="fantasyScrollwrap">
      <button class="bracket-nav-btn bracket-nav-prev" id="fantasyPrevBtn" aria-label="Previous round" type="button">&lsaquo;</button>
      <button class="bracket-nav-btn bracket-nav-next" id="fantasyNextBtn" aria-label="Next round" type="button">&rsaquo;</button>
      <div class="bracket-track" id="fantasyTrack">
        <svg class="bracket-connectors" id="fantasySvg"></svg>
      </div>
    </div>
  `;

  const scrollwrap = container.querySelector('#fantasyScrollwrap');
  const track     = container.querySelector('#fantasyTrack');
  const svg       = container.querySelector('#fantasySvg');
  const prevBtn   = container.querySelector('#fantasyPrevBtn');
  const nextBtn   = container.querySelector('#fantasyNextBtn');

  const trackWidth = rounds.length * BRACKET_COL_PITCH + 240;
  track.style.width = trackWidth + 'px';
  svg.setAttribute('width', trackWidth);

  const focused = Math.min(_fantasyFocused, rounds.length - 1);
  _fantasyFocused = focused;
  _fantasyPositions = computeBracketPositions(roundSizes, focused, BRACKET_ROW_H);

  rounds.forEach((round, r) => {
    const label = document.createElement('div');
    label.className = 'bracket-col-label' + (r === focused ? ' active' : '');
    label.style.left = (r * BRACKET_COL_PITCH) + 'px';
    label.textContent = round.label;
    label.dataset.round = r;
    track.appendChild(label);
  });

  buildFantasyCards(track, rounds, picks, locked, onPick);
  applyFantasyPositions(rounds, track, svg);
  applyBracketScrollwrapHeight(scrollwrap, roundSizes[focused]);

  const prevTransition = track.style.transition;
  track.style.transition = 'none';
  if (isBracketDesktop()) {
    track.style.transform = `translateX(${BRACKET_LEFT_PAD - focused * BRACKET_COL_PITCH}px)`;
  } else {
    scrollwrap.scrollLeft = focused * BRACKET_COL_PITCH;
  }
  track.offsetHeight;
  track.style.transition = prevTransition;

  prevBtn.disabled = focused === 0;
  nextBtn.disabled = focused === rounds.length - 1;

  prevBtn.onclick = () => goToFantasyRound(_fantasyFocused - 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
  nextBtn.onclick = () => goToFantasyRound(_fantasyFocused + 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);

  if (isBracketDesktop()) {
    scrollwrap.onscroll = null;
  } else {
    scrollwrap.onscroll = debounceBracketScroll(() => {
      const idx = Math.round(scrollwrap.scrollLeft / BRACKET_COL_PITCH);
      if (idx !== _fantasyFocused && idx >= 0 && idx < rounds.length) {
        goToFantasyRound(idx, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
      }
    });
    wireBracketDrag(scrollwrap);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/fantasy-bracket.js
git commit -m "feat: add fantasy-bracket.js render and data-build functions"
```

---

### Task 4: `index.html` + `style.css` — button, modal, and styles

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

**Interfaces:**
- Produces (DOM elements consumed by `app.js`): `#fantasyBracketBtn`, `#fantasyLockBadge`, `#fantasyBracketModal`, `#fantasyProgress`, `#fantasyBracketContainer`, `#fantasyModalClose`

- [ ] **Step 1: Add fantasy bracket button to `header-main` in `index.html`**

In `public/index.html`, find the `header-main` div (contains `.logo-area` and `#userStatusArea`). Add the button between those two elements:

```html
        <button id="fantasyBracketBtn" class="btn btn-fantasy" style="display:none;" onclick="openFantasyBracket()">
          ⭐<span class="fantasy-btn-label"> Fantasy Bracket</span><span id="fantasyLockBadge" class="fantasy-lock-badge" style="display:none;"> 🔒</span>
        </button>
```

The `header-main` div should now look like:
```html
      <div class="header-main">
        <div class="logo-area">
          ...existing logo content...
        </div>
        
        <button id="fantasyBracketBtn" class="btn btn-fantasy" style="display:none;" onclick="openFantasyBracket()">
          ⭐<span class="fantasy-btn-label"> Fantasy Bracket</span><span id="fantasyLockBadge" class="fantasy-lock-badge" style="display:none;"> 🔒</span>
        </button>

        <div class="user-status" id="userStatusArea">
          ...existing user status content...
        </div>
      </div>
```

- [ ] **Step 2: Add fantasy bracket modal overlay to `index.html`**

Add immediately before the closing `</body>` tag:

```html
  <!-- Fantasy Bracket Modal -->
  <div id="fantasyBracketModal" class="fantasy-modal" style="display:none;">
    <div class="fantasy-modal-inner">
      <div class="fantasy-modal-header">
        <span class="fantasy-modal-title">⭐ Fantasy Bracket</span>
        <span id="fantasyProgress" class="fantasy-progress">0 / 31 picks made</span>
        <button id="fantasyModalClose" class="fantasy-modal-close" onclick="closeFantasyBracket()" type="button">✕</button>
      </div>
      <div id="fantasyBracketContainer" class="fantasy-bracket-container"></div>
    </div>
  </div>
```

- [ ] **Step 3: Add `<script>` tag for `fantasy-bracket.js` to `index.html`**

Find the existing `<script src="bracket.js"></script>` tag and add the new script directly after it (order matters — fantasy-bracket.js depends on globals from bracket.js):

```html
  <script src="bracket.js"></script>
  <script src="fantasy-bracket.js"></script>
```

- [ ] **Step 4: Add CSS to `style.css`**

Append the following block at the end of `public/style.css`:

```css
/* ── Fantasy Bracket Button ───────────────────────────────────── */

.btn-fantasy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
  transition: background 0.2s;
}

.btn-fantasy:hover {
  background: linear-gradient(135deg, #d97706, #b45309);
}

@media (max-width: 600px) {
  .fantasy-btn-label { display: none; }
}

/* ── Fantasy Bracket Modal ────────────────────────────────────── */

.fantasy-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.fantasy-modal-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}

.fantasy-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #0f1f17;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.fantasy-modal-title {
  font-weight: 700;
  font-size: 1.05rem;
  color: #fbbf24;
}

.fantasy-progress {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
  margin-left: auto;
}

.fantasy-modal-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
  transition: color 0.15s;
}

.fantasy-modal-close:hover {
  color: #fff;
}

.fantasy-bracket-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* ── Fantasy bracket card accent ─────────────────────────────── */

.bracket-card--fantasy .bracket-row.fantasy-pick {
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
  font-weight: 700;
  border-left: 3px solid #f59e0b;
}

.bracket-card--fantasy .bracket-row.votable:hover:not(.fantasy-pick) {
  background: rgba(251, 191, 36, 0.08);
  cursor: pointer;
}
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add fantasy bracket button, modal HTML, and styles"
```

---

### Task 5: `app.js` — wire up the fantasy bracket

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes:
  - DOM: `#fantasyBracketBtn`, `#fantasyLockBadge`, `#fantasyBracketModal`, `#fantasyProgress`, `#fantasyBracketContainer`, `#fantasyModalClose`
  - Globals from `fantasy-bracket.js`: `buildFantasyBracketRounds(r32Matches, picks, roundDefs)`, `renderFantasyBracket(container, rounds, picks, locked, onPick)`
  - Globals from `bracket.js`: `BRACKET_ROUNDS`
  - `app.js` globals: `currentUserSecret`, `currentUsername`
  - Fetch: `GET /api/fantasy-bracket`, `POST /api/fantasy-bracket/pick`

- [ ] **Step 1: Add `_fantasyData` cache variable and the three fantasy bracket functions to `app.js`**

Find the `renderBracketTab` function in `app.js` (around line 1827). Add the following block directly after it:

```javascript
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
```

- [ ] **Step 2: Show the fantasy bracket button in `setupUser`**

Find `setupUser` in `app.js`. Inside the `else` branch (when `currentUserSecret` exists), add:

```javascript
  const fantasyBtn = document.getElementById('fantasyBracketBtn');
  if (fantasyBtn) fantasyBtn.style.display = 'inline-flex';
```

The `else` branch should now look like:
```javascript
  } else {
    usernameModal.style.display = 'none';
    currentUserNameDisplay.textContent = currentUsername;
    updateAdminTabVisibility();
    const fantasyBtn = document.getElementById('fantasyBracketBtn');
    if (fantasyBtn) fantasyBtn.style.display = 'inline-flex';
    loadStages();
    loadDashboardData();
  }
```

- [ ] **Step 3: Initialise lock badge in `setupUser`**

In `setupUser`, add a one-time fetch immediately after showing the fantasy button (inside the same `else` block from Step 2). This sets the badge correctly as soon as the user logs in:

```javascript
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
```

The badge is also updated whenever `renderFantasyBracketModal` runs (i.e., each time the modal opens or a pick is saved), so it stays correct throughout the session.

- [ ] **Step 4: Verify end-to-end in the browser**

Start the server:
```bash
node server.js
```

Open `http://localhost:3000` in a browser and verify:

1. After logging in, `⭐ Fantasy Bracket` button appears in the header between the logo and the welcome text
2. On mobile (≤600px viewport), only `⭐` is shown
3. Clicking the button opens the full-screen modal
4. R32 slots show real team names where admin has created LAST_32 matches; others show TBD
5. Clicking a team in R32 highlights it with amber colour and populates the winner in the corresponding R16 slot
6. Clicking a different team in the same R32 slot changes the highlight and clears the downstream R16 pick
7. Navigating rounds with prev/next works; focused round stays when the modal re-renders after a pick
8. After the first R32 kickoff time passes, the button shows `⭐ Fantasy Bracket 🔒` and clicks in the modal have no effect
9. Closing the modal restores the page scroll

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: wire fantasy bracket modal open/close and pick-save into app.js"
```
