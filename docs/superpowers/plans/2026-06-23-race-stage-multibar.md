# Race Stage Multi-Bar Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Race chart's two diverging behaviors — desktop's always-visible inline per-match segments and mobile's tap-to-reveal boustrophedon snake — with one unified interaction at every screen width: a plain solid bar that grows as the tournament progresses, which expands on click/tap into six stacked, color-coded per-match bars, one per tournament stage, each scaled to that stage's own leading scorer and live-synced to playback.

**Architecture:** Delete the `isMobileRaceWidth` flag so the collapsed `.race-bar-fill` is always a plain solid block on every width. A new pure function, `computeStageBreakdown`, buckets a player's `raceScoringMatches` into six fixed match-number ranges (`RACE_STAGE_GROUPS`) and computes each stage's per-player totals and per-stage max (for width scaling) — this is unit-tested standalone before being copied into `app.js`, following this codebase's existing `verify_*.js` pattern. A new `renderStagePanel` function (replacing `renderRaceSnakePanel`) renders one `.race-stage-row` per *started* stage, each containing per-match `.race-bar-segment` children built by a repurposed `buildStageSegmentsHtml` (renamed from `buildRaceSegmentsHtml`) that reuses the existing `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick` tooltip wiring unchanged. `renderRaceFrame` is extended to re-render any currently-open panel on every frame tick, so expanded breakdowns track Play/scrub live instead of freezing at open-time.

**Tech Stack:** Vanilla JS/CSS/HTML (no frameworks), same single-file `public/app.js`/`public/style.css` as the rest of the app.

## Global Constraints

- No new dependencies (vanilla JS/CSS only — no SVG this time, plain flexbox bars).
- No local server spin-up for verification — per project convention, rely on `node --check`, the `verify_*.js` scripts, and code review; the user verifies visually after deploying.
- Collapsed `.race-bar-fill` is a plain solid `var(--color-accent)` block with no children, on every screen width — the `isMobileRaceWidth` flag and all width-based branching in `renderRaceFrame`/`initRaceBars` are removed.
- Each stage bar's width is `stagePoints / stageMaxPoints * 100%`, where `stageMaxPoints` is the highest total any player has for that specific stage at the current frame — **not** `raceMaxPoints`.
- A stage is shown only if at least one resolved match (`raceFrames[1..frameIndex]`) falls in its range; unstarted stages are omitted entirely, no placeholder row.
- An open panel re-renders on every `renderRaceFrame` call (Play tick or scrub), so it stays in sync with the play head — unlike the snake panel it replaces, which snapshotted once at open-time.
- Multiple players' panels may be open simultaneously (unchanged from existing toggle behavior).
- Every per-match segment inside a stage bar uses the exact existing `onSegmentMouseEnter(el, playerName, matchNumber)` / `onSegmentMouseLeave()` / `onSegmentClick(el, playerName, matchNumber)` functions, verbatim, same call signature — no tooltip code changes.
- `MIN_SEGMENT_LABEL_FRACTION = 0.04` (existing constant, unchanged value) is evaluated against each stage's own total (`points / stageMaxPoints`), not the all-time total.
- `RACE_STAGE_GROUPS` boundaries (inclusive `matchNumber` ranges): Group Stage Matchday 1 = 1–24, Matchday 2 = 25–48, Matchday 3 = 49–72, Round of 32 = 73–88, Round of 16 = 89–96, Quarter-Finals to Final = 97–104.

---

### Task 1: CSS — unscope chevron/panel, rename snake panel, add stage-row styles

**Files:**
- Modify: `public/style.css:869-904` (the `@media (max-width: 600px)` block holding `.race-row`, `.race-row-chevron`, `.race-row-snake-panel`, `.race-snake-segment`, `.race-snake-label`)

**Interfaces:**
- Produces: unscoped (apply at every width) `.race-row { flex-wrap: wrap; cursor: pointer; }`, `.race-row-chevron`, `.race-row-stage-panel` (renamed from `.race-row-snake-panel`), plus new `.race-stage-row`, `.race-stage-label`, `.race-stage-bar-track`, `.race-stage-bar-fill`, `.race-stage-points` — consumed by Task 2 (row markup) and Task 4 (panel content).

- [ ] **Step 1: Replace the mobile-only block with unscoped rules + new stage-row styles**

Replace lines 869-904 of `public/style.css` (the entire `@media (max-width: 600px) { ... }` block shown below):

```css
@media (max-width: 600px) {
  .race-row {
    flex-wrap: wrap;
    cursor: pointer;
  }

  .race-row-chevron {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .race-row-snake-panel {
    flex-basis: 100%;
    margin-top: 8px;
    cursor: default;
  }

  .race-row-snake-panel svg {
    display: block;
    width: 100%;
  }

  .race-snake-segment {
    cursor: pointer;
  }

  .race-snake-label {
    font-size: 0.7rem;
    font-weight: 800;
    fill: rgba(0, 0, 0, 0.75);
    pointer-events: none;
  }
}
```

with:

```css
.race-row {
  flex-wrap: wrap;
  cursor: pointer;
}

.race-row-chevron {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.race-row-stage-panel {
  flex-basis: 100%;
  margin-top: 8px;
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.race-stage-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.race-stage-label {
  width: 150px;
  flex-shrink: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.race-stage-bar-track {
  flex: 1;
  height: 18px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.race-stage-bar-fill {
  height: 100%;
  width: 0%;
  display: flex;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: width 700ms ease;
}

.race-stage-points {
  width: 55px;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-accent);
}
```

Note this new block is **not** wrapped in any `@media` query — `.race-row`'s existing base rule at `public/style.css:792-796` (`display: flex; align-items: center; gap: 12px;`) stays as-is; this new unscoped block adds `flex-wrap: wrap` so the panel can drop to its own full-width line at every screen width, exactly like the mobile-only behavior worked before, just no longer gated by viewport width. `.race-bar-segment` (`public/style.css:825-838`) is reused as-is inside `.race-stage-bar-fill` — no new segment styles needed.

- [ ] **Step 2: Sanity-check brace balance**

Run: `grep -c "{" public/style.css` and `grep -c "}" public/style.css`
Expected: the two counts match each other.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: unify race row layout across widths, add stage-row styles"
```

---

### Task 2: JS — delete mobile flag, always-solid collapsed bar, universal row toggle

**Files:**
- Modify: `public/app.js:39` (delete `isMobileRaceWidth`)
- Modify: `public/app.js:1239-1262` (`initRaceBars`)
- Modify: `public/app.js:1286-1337` (`renderRaceFrame`)
- Modify: `public/app.js:1343-1359` (`onRaceRowClick`)

**Interfaces:**
- Consumes: `raceRowsByName` (existing global `Map<playerName, HTMLElement>`), `raceCurrentFrame` (existing global), `escapeHtml` (existing).
- Produces: every `.race-row` now always has a chevron + `.race-row-stage-panel` and an `onclick` handler, regardless of width. `onRaceRowClick` calls `renderStagePanel(panel, playerName)` — **this function does not exist yet; it is added by Task 4.** Until Task 4 lands, clicking a row throws a `ReferenceError` in the console; this is the same accepted forward-reference pattern used by the snake feature this replaces (see `docs/superpowers/plans/2026-06-23-mobile-race-snake.md` Task 2).

- [ ] **Step 1: Delete the `isMobileRaceWidth` flag**

In `public/app.js`, delete line 39 and the comment immediately above it:

```javascript
// Below this width, the race chart hides per-match segments in the bar
// itself and shows them only in a tap-to-expand snake panel instead.
const isMobileRaceWidth = window.matchMedia('(max-width: 600px)').matches;
```

- [ ] **Step 2: Make chevron/panel markup and click handler unconditional in `initRaceBars`**

Replace `initRaceBars` (`public/app.js:1239-1262`):

```javascript
function initRaceBars() {
  raceBars.innerHTML = '';
  raceRowsByName = new Map();

  const startFrame = raceFrames[0];
  startFrame.standings.forEach(player => {
    const row = document.createElement('div');
    row.className = 'race-row';
    const mobileExtras = isMobileRaceWidth
      ? `<span class="race-row-chevron">&#9656;</span><div class="race-row-snake-panel" style="display:none;"></div>`
      : '';
    row.innerHTML = `
      <span class="race-name">${escapeHtml(player.name)}</span>
      <div class="race-bar-track"><div class="race-bar-fill"></div></div>
      <span class="race-points">0 pts</span>
      ${mobileExtras}
    `;
    if (isMobileRaceWidth) {
      row.onclick = (e) => onRaceRowClick(e, row, player.name);
    }
    raceBars.appendChild(row);
    raceRowsByName.set(player.name, row);
  });
}
```

with:

```javascript
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
```

- [ ] **Step 3: Make the collapsed bar always solid in `renderRaceFrame`**

Replace the per-player loop body inside `renderRaceFrame` (`public/app.js:1304-1320`):

```javascript
  frame.standings.forEach(player => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    const fill = row.querySelector('.race-bar-fill');
    fill.style.width = `${pct}%`;
    if (isMobileRaceWidth) {
      fill.style.background = 'var(--color-accent)';
      fill.innerHTML = '';
    } else {
      fill.innerHTML = buildRaceSegmentsHtml(player.name, frameIndex);
    }
    row.querySelector('.race-points').textContent = `${player.points} pts`;

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
    fill.style.background = 'var(--color-accent)';
    fill.innerHTML = '';
    row.querySelector('.race-points').textContent = `${player.points} pts`;

    raceBars.appendChild(row);
  });
```

(Live-sync re-rendering of any open stage panel is added in Task 5, not here — this step only handles the collapsed bar.)

- [ ] **Step 4: Update `onRaceRowClick` to the new panel class name and function**

Replace `onRaceRowClick` (`public/app.js:1343-1359`):

```javascript
function onRaceRowClick(e, row, playerName) {
  if (e.target.closest('.race-row-snake-panel')) return;
  const panel = row.querySelector('.race-row-snake-panel');
  const chevron = row.querySelector('.race-row-chevron');
  if (!panel) return;

  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    if (chevron) chevron.textContent = '▸';
  } else {
    panel.style.display = 'block';
    if (chevron) chevron.textContent = '▾';
    renderRaceSnakePanel(panel, playerName);
  }
}
```

with:

```javascript
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
  } else {
    panel.style.display = 'flex';
    if (chevron) chevron.textContent = '▾';
    renderStagePanel(panel, playerName);
  }
}
```

- [ ] **Step 5: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0 (`renderStagePanel` is referenced but not yet defined — `node --check` validates syntax only, not that every called function exists, so this still passes).

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: make race row collapsed bar and stage-panel toggle universal"
```

---

### Task 3: JS — pure stage-bucketing math (`RACE_STAGE_GROUPS`, `computeStageBreakdown`)

**Files:**
- Modify: `public/app.js` (add `RACE_STAGE_GROUPS` constant and `computeStageBreakdown` function — search for `function onRaceRowClick` to locate the insertion point immediately after it, since exact line numbers may have shifted after Task 2)
- Test: `verify_race_stage_breakdown.js` (new)

**Interfaces:**
- Produces: `RACE_STAGE_GROUPS` (`Array<{label: string, lo: number, hi: number}>`, 6 entries), `computeStageBreakdown(scoringMatchesMap, playerNames, frames, frameIndex, stages)` → `Array<{label, lo, hi, maxPoints, players: Map<playerName, points>}>`, containing one entry per *started* stage (a stage with at least one resolved match in `frames[1..frameIndex]` within `lo..hi`), in `stages` order, omitting unstarted stages entirely. Consumed by Task 4's `renderStagePanel`.

- [ ] **Step 1: Write the failing test**

Create `verify_race_stage_breakdown.js`:

```javascript
// verify_race_stage_breakdown.js
// Test script for the pure stage-bucketing math used by the Race chart's
// click-to-expand stage breakdown panel. Mirrors the existing standalone
// -test pattern used by verify_snake_geometry.js: a local copy of the pure
// function, runnable under plain Node (no DOM needed for this math).

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

console.log("=== RUNNING STAGE BREAKDOWN TESTS ===");

// Test stages use small ranges for readable fixtures; computeStageBreakdown
// is agnostic to the actual lo/hi values, so this exercises the same logic
// the real RACE_STAGE_GROUPS (1-24, 25-48, ...) will use in app.js.
const stages = [
  { label: 'Stage A', lo: 1, hi: 10 },
  { label: 'Stage B', lo: 11, hi: 20 },
  { label: 'Stage C', lo: 21, hi: 30 }
];

const frames = [
  { matchNumber: null },        // frame 0: "Start"
  { matchNumber: '5' },         // frame 1: in Stage A
  { matchNumber: '15' },        // frame 2: in Stage B
  { matchNumber: '6' },         // frame 3: in Stage A
  { matchNumber: '25' }         // frame 4: in Stage C, nobody scores
];

const scoringMatchesMap = new Map([
  ['Alice', [
    { frameIndex: 1, matchNumber: '5', points: 3 },
    { frameIndex: 3, matchNumber: '6', points: 2 }
  ]],
  ['Bob', [
    { frameIndex: 2, matchNumber: '15', points: 5 }
  ]]
]);
const playerNames = ['Alice', 'Bob'];

console.log("\nTest #1: frame 0 — nothing started yet");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 0, stages);
  assertEqual(result.length, 0, 'no stages have started at frame 0');
}

console.log("\nTest #2: frame 1 — only Stage A started");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 1, stages);
  assertEqual(result.length, 1, 'exactly one stage started');
  assertEqual(result[0].label, 'Stage A', 'the started stage is Stage A');
  assertEqual(result[0].players.get('Alice'), 3, "Alice has 3 points in Stage A so far");
  assertEqual(result[0].players.get('Bob'), 0, 'Bob has 0 points in Stage A so far');
  assertEqual(result[0].maxPoints, 3, 'Stage A max is 3 (Alice)');
}

console.log("\nTest #3: frame 2 — Stage A and Stage B both started, in stage order");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 2, stages);
  assertEqual(result.length, 2, 'two stages started');
  assertEqual(result[0].label, 'Stage A', 'Stage A appears first (stage order, not start order)');
  assertEqual(result[1].label, 'Stage B', 'Stage B appears second');
  assertEqual(result[0].maxPoints, 3, "Stage A max still 3 (Alice's frame-3 match not counted yet at frameIndex 2)");
  assertEqual(result[1].players.get('Bob'), 5, 'Bob has 5 points in Stage B');
  assertEqual(result[1].players.get('Alice'), 0, 'Alice has 0 points in Stage B');
  assertEqual(result[1].maxPoints, 5, 'Stage B max is 5 (Bob)');
}

console.log("\nTest #4: frame 3 — Stage A total grows once its second match is included");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 3, stages);
  const stageA = result.find(s => s.label === 'Stage A');
  assertEqual(stageA.players.get('Alice'), 5, 'Alice now has 3+2=5 points in Stage A');
  assertEqual(stageA.maxPoints, 5, 'Stage A max is now 5');
}

console.log("\nTest #5: frame 4 — Stage C started but nobody scored (zero-max edge case)");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 4, stages);
  const stageC = result.find(s => s.label === 'Stage C');
  assertEqual(stageC.players.get('Alice'), 0, 'Alice has 0 points in Stage C');
  assertEqual(stageC.players.get('Bob'), 0, 'Bob has 0 points in Stage C');
  assertEqual(stageC.maxPoints, 0, 'Stage C max is 0 (no divide-by-zero in this pure function — that guard lives in the renderer)');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll stage breakdown tests PASSED successfully!");
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node verify_race_stage_breakdown.js`
Expected output:
```
All stage breakdown tests PASSED successfully!
```
If any assertion fails, recheck the test fixture by hand (re-derive which frames fall in which stage range) before adjusting the function — do not change a correct function to match a miscalculated expectation.

- [ ] **Step 3: Copy the verified constant and function into `app.js`**

In `public/app.js`, immediately after the `onRaceRowClick` function (search for `function onRaceRowClick` to find the current location regardless of line drift from Task 2), add:

```javascript
// Fixed tournament-stage buckets for the Race chart's stage-breakdown
// panel, as inclusive matchNumber ranges (48-team World Cup format: 12
// groups x 3 matchdays x 24 matches, then 16+8+4+2+1+1 knockout matches).
const RACE_STAGE_GROUPS = [
  { label: 'Group Stage – Matchday 1', lo: 1,  hi: 24 },
  { label: 'Group Stage – Matchday 2', lo: 25, hi: 48 },
  { label: 'Group Stage – Matchday 3', lo: 49, hi: 72 },
  { label: 'Round of 32',              lo: 73, hi: 88 },
  { label: 'Round of 16',              lo: 89, hi: 96 },
  { label: 'Quarter-Finals to Final',  lo: 97, hi: 104 }
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
```

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/app.js verify_race_stage_breakdown.js
git commit -m "feat: add pure stage-bucketing math for race stage breakdown panel"
```

---

### Task 4: JS — render the stage panel, repurpose segment builder

**Files:**
- Modify: `public/app.js:1266-1283` (`buildRaceSegmentsHtml` → renamed/repurposed `buildStageSegmentsHtml`)
- Modify: `public/app.js` (add `renderStagePanel`, immediately after `computeStageBreakdown` from Task 3 — search for `function computeStageBreakdown` to find the current location)

**Interfaces:**
- Consumes: `raceScoringMatches`, `raceRowsByName`, `raceCurrentFrame` (existing globals), `escapeHtml`, `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick` (existing, unchanged), `RACE_STAGE_GROUPS`/`computeStageBreakdown` (Task 3), `SEGMENT_PALETTE_SIZE`/`MIN_SEGMENT_LABEL_FRACTION` (existing constants, `public/app.js:35-36`).
- Produces: `buildStageSegmentsHtml(playerName, frameIndex, stage, stageMaxPoints)` → HTML string of `.race-bar-segment` children. `renderStagePanel(panel, playerName)` — the function Task 2's `onRaceRowClick` already calls by name.

- [ ] **Step 1: Rename and repurpose `buildRaceSegmentsHtml` into `buildStageSegmentsHtml`**

Replace `buildRaceSegmentsHtml` (`public/app.js:1266-1283`):

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
```

with:

```javascript
// Build the colored, per-match <div> segments for one player's stage bar:
// every scoring match within [stage.lo, stage.hi], up to (and including)
// the given frame index, with each segment's label-visibility threshold
// evaluated against that stage's own max (not the all-time raceMaxPoints).
function buildStageSegmentsHtml(playerName, frameIndex, stage, stageMaxPoints) {
  const scoringMatches = raceScoringMatches.get(playerName) || [];
  return scoringMatches
    .filter(m => m.frameIndex <= frameIndex)
    .filter(m => {
      const n = parseInt(m.matchNumber, 10);
      return n >= stage.lo && n <= stage.hi;
    })
    .map(m => {
      const colorIndex = parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE;
      const showLabel = stageMaxPoints > 0 && (m.points / stageMaxPoints) >= MIN_SEGMENT_LABEL_FRACTION;
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
```

- [ ] **Step 2: Add `renderStagePanel`**

In `public/app.js`, immediately after the `computeStageBreakdown` function added in Task 3, add:

```javascript
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
    const pct = stageEntry.maxPoints > 0 ? (stagePoints / stageEntry.maxPoints) * 100 : 0;
    const segmentsHtml = buildStageSegmentsHtml(playerName, raceCurrentFrame, stageEntry, stageEntry.maxPoints);
    return `
      <div class="race-stage-row">
        <span class="race-stage-label">${escapeHtml(stageEntry.label)}</span>
        <div class="race-stage-bar-track"><div class="race-stage-bar-fill" style="width: ${pct}%;">${segmentsHtml}</div></div>
        <span class="race-stage-points">${stagePoints} pts</span>
      </div>
    `;
  }).join('');
}
```

- [ ] **Step 3: Confirm no leftover references to the old function name**

Run: `grep -n "buildRaceSegmentsHtml\|renderRaceSnakePanel" public/app.js`
Expected: no matches (the only call site of `buildRaceSegmentsHtml` was removed in Task 2, and the function itself is now `buildStageSegmentsHtml`; `renderRaceSnakePanel` was already replaced by `renderStagePanel` in Task 2's `onRaceRowClick` and is still defined further down in the file at this point — that's addressed in Task 6).

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Code-review trace through one end-to-end scenario**

With no local server, verify the wiring by reading the code path: at `raceCurrentFrame = 2` with the Task 3 test fixture's data shape (Alice has a 3-point match at matchNumber 5 and a 2-point match at matchNumber 6 in "Stage A" = matchNumber range 1-24; Bob has a 5-point match at matchNumber 15 in the same range), `computeStageBreakdown` returns one started-stage entry for the real `RACE_STAGE_GROUPS[0]` ("Group Stage – Matchday 1") with `players = {Alice: 3, Bob: 5}` (only Alice's frameIndex-1 match counts at `frameIndex=2`) and `maxPoints = 5`. `renderStagePanel` for Alice renders one `.race-stage-row` with `width: 60%` (3/5) and one `.race-bar-segment` (`flex-grow: 3`, color `var(--seg-5)` since `5 % 10 = 5`) with the existing `onclick="onSegmentClick(this, 'Alice', '5')"` — clicking it opens the same flag–score–flag tooltip already used by the inline bar, unchanged.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: render race stage breakdown panel with stacked per-match segments"
```

---

### Task 5: JS — live frame-sync for open panels during Play/scrub

**Files:**
- Modify: `public/app.js` (`renderRaceFrame`'s per-player loop, modified again in this task — search for `function renderRaceFrame` to find the current location)

**Interfaces:**
- Consumes: `renderStagePanel(panel, playerName)` (Task 4).
- Produces: an open `.race-row-stage-panel` now refreshes its content on every `renderRaceFrame` call, instead of only at the moment it was opened.

- [ ] **Step 1: Re-render any open panel inside `renderRaceFrame`'s per-player loop**

Locate the per-player loop inside `renderRaceFrame` (after Task 2's Step 3, it reads):

```javascript
  frame.standings.forEach(player => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    const fill = row.querySelector('.race-bar-fill');
    fill.style.width = `${pct}%`;
    fill.style.background = 'var(--color-accent)';
    fill.innerHTML = '';
    row.querySelector('.race-points').textContent = `${player.points} pts`;

    raceBars.appendChild(row);
  });
```

Replace it with:

```javascript
  frame.standings.forEach(player => {
    const row = raceRowsByName.get(player.name);
    if (!row) return;

    const pct = (player.points / raceMaxPoints) * 100;
    const fill = row.querySelector('.race-bar-fill');
    fill.style.width = `${pct}%`;
    fill.style.background = 'var(--color-accent)';
    fill.innerHTML = '';
    row.querySelector('.race-points').textContent = `${player.points} pts`;

    const panel = row.querySelector('.race-row-stage-panel');
    if (panel && panel.style.display !== 'none') {
      renderStagePanel(panel, player.name);
    }

    raceBars.appendChild(row);
  });
```

- [ ] **Step 2: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Code-review trace the live-sync scenario**

Read through: a row is opened via `onRaceRowClick` while `raceCurrentFrame = 1` (one stage, one segment, panel shows it). Playback advances (`startRacePlayback`'s `setInterval`, `public/app.js:~1540`) and calls `renderRaceFrame(2, true)`. That call's per-player loop now finds this row's panel with `style.display === 'block'` and calls `renderStagePanel(panel, player.name)` again, which recomputes `computeStageBreakdown` at `frameIndex = 2` — if match #2 added a new scoring match within an already-started stage, that stage's bar widens; if it started a brand-new stage, a new `.race-stage-row` appears. No leftover stale content from frame 1 remains, since `renderStagePanel` always replaces `panel.innerHTML` wholesale rather than patching it.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: live-sync open race stage panels with playback/scrub"
```

---

### Task 6: Cleanup — delete the superseded snake code

**Files:**
- Modify: `public/app.js` (delete the snake constants and functions listed below)
- Delete: `verify_snake_geometry.js`

**Interfaces:**
- Produces: no remaining references to any snake-specific identifier anywhere in `public/app.js`.

- [ ] **Step 1: Delete the snake constants and functions**

In `public/app.js`, delete these in their entirety (search for each by name, since exact line numbers have shifted across Tasks 1-5):

- `SNAKE_STROKE_WIDTH`, `SNAKE_ROW_PITCH`, `SNAKE_CORNER_RADIUS`, `SNAKE_PIXELS_PER_POINT` (the four `const` declarations, originally `public/app.js:1362-1365`)
- `computeSnakeRowCount` (originally `public/app.js:1369-1374`)
- `computeSnakeLastRowWidth` (originally `public/app.js:1381-1387`)
- `buildSnakePathD` (originally `public/app.js:1395-1428`)
- `buildSnakeSegmentData` (originally `public/app.js:1433-1448`)
- `renderRaceSnakePanel` (originally `public/app.js:1453-1518`)

- [ ] **Step 2: Delete the now-orphaned test script**

```bash
git rm verify_snake_geometry.js
```

This script only tested the snake math deleted in Step 1; keeping it around would mean a passing test for code that no longer exists in `app.js`.

- [ ] **Step 3: Confirm no dangling references remain**

Run: `grep -n "SNAKE_\|computeSnakeRowCount\|computeSnakeLastRowWidth\|buildSnakePathD\|buildSnakeSegmentData\|renderRaceSnakePanel\|race-snake\|isMobileRaceWidth" public/app.js public/style.css`
Expected: no matches.

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/app.js verify_snake_geometry.js
git commit -m "chore: remove superseded race snake code and its test script"
```

---

## Final Verification

- [ ] Run `node --check public/app.js && node --check server.js`
- [ ] Run `node verify_leaderboard_history.js && node verify_race_scoring_matches.js && node verify_race_stage_breakdown.js && node verify_points.js`
- [ ] Run `grep -n "renderStagePanel\|computeStageBreakdown\|RACE_STAGE_GROUPS\|buildStageSegmentsHtml\|onRaceRowClick" public/app.js` and confirm: one definition each for `renderStagePanel`/`computeStageBreakdown`/`buildStageSegmentsHtml`/`onRaceRowClick`, `RACE_STAGE_GROUPS` defined once and referenced from `renderStagePanel`, and `onRaceRowClick`'s call to `renderStagePanel` matches the defined signature.
- [ ] Run `grep -n "SNAKE_\|race-snake\|isMobileRaceWidth\|buildRaceSegmentsHtml\|renderRaceSnakePanel" public/app.js public/style.css` and confirm no matches remain anywhere.
- [ ] Per project convention, no local server spin-up — the user verifies the collapsed-bar/expand/live-sync/tooltip behavior visually on both desktop and mobile widths after deploying.
