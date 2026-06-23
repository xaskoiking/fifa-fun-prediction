# Mobile Race Snake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On narrow screens, replace the Race chart's hard-to-see inline segments with a plain bar; tapping a row expands an animated, continuous "snake" of the same per-match colored segments folded across multiple rows with rounded turns, reusing the existing tooltip click/hover handlers unchanged.

**Architecture:** A `isMobileRaceWidth` flag (computed once, `matchMedia('(max-width: 600px)')`) branches `renderRaceFrame`/`initRaceBars` between today's per-segment inline bar (desktop) and a plain solid bar plus a collapsible per-row panel (mobile). The panel's content — an SVG boustrophedon path with per-match colored strokes — is built from two pure, unit-testable functions (path geometry, segment fraction/offset math) plus a DOM-rendering function that wires up the existing `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick` handlers unchanged and triggers a one-time "draw on" reveal animation via an SVG mask.

**Tech Stack:** Vanilla JS/CSS/HTML (no frameworks, no SVG libraries), same single-file `public/app.js`/`public/style.css`/`public/index.html` as the rest of the app.

## Global Constraints

- No new dependencies (vanilla JS/CSS/SVG only).
- No local server spin-up for verification — per project convention, rely on code review, diffing, and Node syntax checks; the user verifies the expand/draw-on animation visually on a real narrow viewport after deploying.
- `isMobileRaceWidth = window.matchMedia('(max-width: 600px)').matches`, computed once at load, not re-evaluated on resize (matches the existing `supportsHoverForSegments` precedent).
- The snake panel is a **snapshot only**: built from `raceScoringMatches` filtered to the frame current *at the moment the row is tapped open*. It does not live-update while the race animation plays/scrubs with the panel already open — closing and reopening refreshes it. (Confirmed with the user as the deliberate, lower-risk choice over live-updating.)
- Geometry constants: `STROKE_WIDTH = 28` (matches the existing `.race-bar-track` height), `ROW_PITCH = 36`, `CORNER_RADIUS = 14`, `PIXELS_PER_POINT = 24`. These are starting values; an implementer may retune them later if the rendered result looks off, as long as the relationships in the design doc hold.
- Each match segment keeps using the existing `--seg-${matchNumber % 10}` palette and the existing `MIN_SEGMENT_LABEL_FRACTION = 0.04` label-visibility threshold — no new palette or threshold.
- Every snake segment reuses the existing `onSegmentMouseEnter(el, playerName, matchNumber)` / `onSegmentMouseLeave()` / `onSegmentClick(el, playerName, matchNumber)` functions verbatim — no new tooltip code, no duplication of that logic.
- Desktop (`isMobileRaceWidth === false`) behavior is completely unchanged — this plan only adds a new code path, gated by the flag, alongside the existing one.

---

### Task 1: CSS — mobile row layout, chevron, and snake panel

**Files:**
- Modify: `public/style.css` (add a new block inside the existing `@media (max-width: 600px)` pattern used elsewhere in this file — add a *new* media query block near the existing race-chart styles, e.g. directly after the `.race-date` rule around `public/style.css:847-848`, since there is no existing `(max-width: 600px)` block already scoped to `.race-*` selectors to extend)

**Interfaces:**
- Produces: CSS classes `.race-row-chevron`, `.race-row-snake-panel`, `.race-snake-segment`, `.race-snake-label`, and a `flex-wrap`/`flex-basis` layout technique that makes `.race-row-snake-panel` wrap onto its own full-width line below the existing header content — consumed by Task 2 (row markup) and Task 4 (SVG content).

- [ ] **Step 1: Add the new mobile-only rules**

In `public/style.css`, immediately after the `.race-date` rule (currently `public/style.css:860-867`, right before the `/* ==== Ranking comparison ==== */` comment that follows it — insert this as its own new block; do not merge into the existing `@media (max-width: 480px)` block further down in the file, since that one already targets a narrower breakpoint for a different purpose), insert:

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

This relies on `.race-row` already being `display: flex` (it is, at `public/style.css:792-796`) — adding `flex-wrap: wrap` there and `flex-basis: 100%` on the panel is what pushes the panel onto its own line below the existing name/bar/points/chevron, with no HTML restructuring needed.

- [ ] **Step 2: Sanity-check brace balance**

Run: `grep -c "{" public/style.css` and `grep -c "}" public/style.css`
Expected: the two counts match each other.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add mobile race row layout, chevron, and snake panel styles"
```

---

### Task 2: JS — mobile-mode flag, collapsed solid bar, row tap-to-toggle

**Files:**
- Modify: `public/app.js` (add a constant near line 36; modify `initRaceBars` at `public/app.js:1236-1252`; modify `renderRaceFrame`'s per-player loop at `public/app.js:1294-1305`; add a new `onRaceRowClick` function after `renderRaceFrame`, currently ending at `public/app.js:1322`)

**Interfaces:**
- Consumes: `raceRowsByName` (existing global `Map<playerName, HTMLElement>`), `raceCurrentFrame` (existing global).
- Produces: `isMobileRaceWidth` (module-scope boolean), and calls `renderRaceSnakePanel(panel, playerName)` when opening a row — **this function does not exist yet; it is added by Task 4.** This mirrors how an earlier, already-shipped task in this same file called `openMatchPopup` before a later task defined it — calling forward to a not-yet-defined function is an accepted, working pattern in this codebase's task sequencing. Until Task 4 lands, opening a row on a narrow screen will throw a `ReferenceError` in the browser console; that is expected and resolved by Task 4, not a defect in this task.

- [ ] **Step 1: Add the mobile-mode flag**

In `public/app.js`, immediately after line 36 (`const MIN_SEGMENT_LABEL_FRACTION = 0.04;`), add:

```javascript
// Below this width, the race chart hides per-match segments in the bar
// itself and shows them only in a tap-to-expand snake panel instead.
const isMobileRaceWidth = window.matchMedia('(max-width: 600px)').matches;
```

- [ ] **Step 2: Add the chevron/panel markup and row click handler to `initRaceBars`**

Replace `initRaceBars` (currently `public/app.js:1236-1252`):

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
    `;
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

- [ ] **Step 3: Branch `renderRaceFrame`'s fill rendering on `isMobileRaceWidth`**

Replace the per-player loop body inside `renderRaceFrame` (currently `public/app.js:1294-1305`):

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

with:

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

(On mobile this intentionally does **not** touch `.race-row-snake-panel` — per the Global Constraints, the panel is a snapshot that only refreshes when reopened, not on every frame render.)

- [ ] **Step 4: Add the row tap-to-toggle handler**

Immediately after `renderRaceFrame`'s closing brace (currently ending at `public/app.js:1322`, right before the `// Play/Pause button handler` comment), add:

```javascript
// Tapping a row (mobile only) toggles its snake breakdown panel open/closed.
// Multiple rows may be open at once. Clicks that originate inside an
// already-open panel (e.g. tapping a segment for its tooltip) don't
// toggle the row.
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

- [ ] **Step 5: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: a syntax error is NOT expected to occur from this task's own code, but `renderRaceSnakePanel` is referenced and not yet defined — `node --check` only validates syntax, not that every called function exists, so this will still report no output / exit 0. Confirm that is in fact what happens (a `ReferenceError` would only occur at runtime when a row is actually clicked, which doesn't happen during a syntax check).

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: add mobile race row tap-to-toggle and collapsed solid bar"
```

---

### Task 3: JS — pure snake geometry and segment math

**Files:**
- Modify: `public/app.js` (add constants and three pure functions immediately after the `onRaceRowClick` function added in Task 2 — locate it by searching for `function onRaceRowClick`, since exact line numbers may have shifted)
- Test: `verify_snake_geometry.js` (new)

**Interfaces:**
- Produces:
  - `computeSnakeRowCount(totalPoints, availableWidth)` → `number` (≥ 1)
  - `buildSnakePathD(numRows, availableWidth)` → `string` (an SVG path `d` attribute value)
  - `buildSnakeSegmentData(scoringMatches, totalPoints)` → `Array<{ matchNumber, points, fraction, offset, colorIndex, showLabel }>`, ordered to match `scoringMatches`' input order, with `offset` values forming a running cumulative sum of `fraction` (so `offset` of the first entry is `0`, and each subsequent entry's `offset` equals the previous entry's `offset + fraction`).
  These three are consumed by Task 4's `renderRaceSnakePanel`.

- [ ] **Step 1: Write the failing test**

Create `verify_snake_geometry.js`:

```javascript
// verify_snake_geometry.js
// Test script for the pure snake-geometry math used by the mobile race
// chart's tap-to-expand panel. Mirrors the existing standalone-test
// pattern used by verify_race_scoring_matches.js: a local copy of the
// pure functions, runnable under plain Node (no DOM needed for this math).

const STROKE_WIDTH = 28;
const ROW_PITCH = 36;
const CORNER_RADIUS = 14;
const PIXELS_PER_POINT = 24;
const SEGMENT_PALETTE_SIZE = 10;
const MIN_SEGMENT_LABEL_FRACTION = 0.04;

function computeSnakeRowCount(totalPoints, availableWidth) {
  if (totalPoints <= 0) return 1;
  const rowSpan = Math.max(1, availableWidth - STROKE_WIDTH);
  const totalLength = totalPoints * PIXELS_PER_POINT;
  return Math.max(1, Math.ceil(totalLength / rowSpan));
}

function buildSnakePathD(numRows, availableWidth) {
  const xLeft = STROKE_WIDTH / 2;
  const xRight = Math.max(xLeft + 1, availableWidth - STROKE_WIDTH / 2);
  const rowY = (i) => STROKE_WIDTH / 2 + i * ROW_PITCH;
  const insetToward = (edgeX) => (edgeX === xRight ? edgeX - CORNER_RADIUS : edgeX + CORNER_RADIUS);

  let d = '';
  for (let i = 0; i < numRows; i++) {
    const y = rowY(i);
    const goingRight = i % 2 === 0;
    const isLastRow = i === numRows - 1;
    const fromX = goingRight ? xLeft : xRight;
    const toX = goingRight ? xRight : xLeft;
    const lineToX = isLastRow ? toX : insetToward(toX);

    if (i === 0) d += `M ${fromX},${y} `;
    d += `L ${lineToX},${y} `;

    if (!isLastRow) {
      const cornerX = toX;
      const nextY = rowY(i + 1);
      const dropToY = nextY - CORNER_RADIUS;
      d += `Q ${cornerX},${y} ${cornerX},${y + CORNER_RADIUS} `;
      if (dropToY > y + CORNER_RADIUS) {
        d += `L ${cornerX},${dropToY} `;
      }
      const nextLineStartX = insetToward(cornerX);
      d += `Q ${cornerX},${nextY} ${nextLineStartX},${nextY} `;
    }
  }
  return d.trim();
}

function buildSnakeSegmentData(scoringMatches, totalPoints) {
  let cumulative = 0;
  return scoringMatches.map(m => {
    const fraction = totalPoints > 0 ? m.points / totalPoints : 0;
    const offset = cumulative;
    cumulative += fraction;
    return {
      matchNumber: m.matchNumber,
      points: m.points,
      fraction,
      offset,
      colorIndex: parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE,
      showLabel: fraction >= MIN_SEGMENT_LABEL_FRACTION
    };
  });
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

function assertClose(actual, expected, label, epsilon = 1e-9) {
  if (Math.abs(actual - expected) > epsilon) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING SNAKE GEOMETRY TESTS ===");

console.log("\nTest #1: computeSnakeRowCount");
{
  assertEqual(computeSnakeRowCount(0, 300), 1, 'zero points still yields 1 row');
  assertEqual(computeSnakeRowCount(10, 300), 1, '10 pts at 24px/pt = 240px fits in one 272px row');
  assertEqual(computeSnakeRowCount(50, 300), 5, '50 pts = 1200px needs ceil(1200/272) = 5 rows');
  assertEqual(computeSnakeRowCount(20, 100), 7, '20 pts = 480px in a narrow 72px row needs ceil(480/72) = 7 rows');
}

console.log("\nTest #2: buildSnakePathD — single row has no corners");
{
  const d = buildSnakePathD(1, 300);
  assertEqual(d, 'M 14,14 L 286,14', 'single row is a plain straight line from left edge to right edge');
}

console.log("\nTest #3: buildSnakePathD — two rows produces one rounded turn");
{
  const d = buildSnakePathD(2, 300);
  assertEqual(
    d,
    'M 14,14 L 272,14 Q 286,14 286,28 L 286,36 Q 286,50 272,50 L 14,50',
    'two rows: row 0 left-to-right stopping short of the corner (272,14), ' +
    'a quarter-turn down to (286,28), a straight vertical drop to (286,36) ' +
    'since dropToY(36) is greater than y+radius(28), a quarter-turn into ' +
    'row 1 landing at (272,50), then row 1 right-to-left to the full left edge (14,50)'
  );
}

console.log("\nTest #4: buildSnakeSegmentData — fractions and cumulative offsets");
{
  const scoringMatches = [
    { matchNumber: '3', points: 2 },
    { matchNumber: '7', points: 6 },
    { matchNumber: '12', points: 2 }
  ];
  const segments = buildSnakeSegmentData(scoringMatches, 10);

  assertClose(segments[0].fraction, 0.2, 'match 3: 2/10 = 0.2');
  assertClose(segments[0].offset, 0, 'match 3 starts at offset 0');
  assertEqual(segments[0].showLabel, true, 'match 3 (0.2) is above the 0.04 label threshold');

  assertClose(segments[1].fraction, 0.6, 'match 7: 6/10 = 0.6');
  assertClose(segments[1].offset, 0.2, 'match 7 starts right after match 3 ends (offset 0.2)');

  assertClose(segments[2].fraction, 0.2, 'match 12: 2/10 = 0.2');
  assertClose(segments[2].offset, 0.8, 'match 12 starts at offset 0.8 (0.2 + 0.6)');

  assertEqual(segments[1].colorIndex, 7 % 10, 'match 7 colorIndex is matchNumber % 10');
}

console.log("\nTest #5: buildSnakeSegmentData — thin segment below label threshold");
{
  const scoringMatches = [{ matchNumber: '1', points: 1 }];
  const segments = buildSnakeSegmentData(scoringMatches, 1000);
  assertEqual(segments[0].showLabel, false, '1/1000 = 0.001 is below the 0.04 threshold, label hidden');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll snake geometry tests PASSED successfully!");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify_snake_geometry.js`
Expected: this test file is self-contained (its own local copy of the functions), so it should already PASS on its own — this step confirms the test file's internal arithmetic is correct *before* copying the same functions into `app.js`. If any assertion fails, recheck the arithmetic in Test #3 by hand (re-derive `buildSnakePathD(2, 300)`'s expected string using the formulas in Step 1) before proceeding — do not adjust the function to make a wrong expectation pass.

Expected output once correct:
```
All snake geometry tests PASSED successfully!
```

- [ ] **Step 3: Copy the verified functions and constants into `app.js`**

In `public/app.js`, immediately after the `onRaceRowClick` function added in Task 2 (search for `function onRaceRowClick` to find the current location regardless of line drift), add:

```javascript
// Geometry constants for the mobile snake panel.
const SNAKE_STROKE_WIDTH = 28;
const SNAKE_ROW_PITCH = 36;
const SNAKE_CORNER_RADIUS = 14;
const SNAKE_PIXELS_PER_POINT = 24;

// How many rows the boustrophedon snake needs to fit a player's total
// points at the panel's available width.
function computeSnakeRowCount(totalPoints, availableWidth) {
  if (totalPoints <= 0) return 1;
  const rowSpan = Math.max(1, availableWidth - SNAKE_STROKE_WIDTH);
  const totalLength = totalPoints * SNAKE_PIXELS_PER_POINT;
  return Math.max(1, Math.ceil(totalLength / rowSpan));
}

// Build an SVG path `d` string: numRows horizontal strokes spanning
// availableWidth, alternating direction, connected by rounded
// quarter-turn corners (a "rounded zigzag" / boustrophedon snake).
function buildSnakePathD(numRows, availableWidth) {
  const xLeft = SNAKE_STROKE_WIDTH / 2;
  const xRight = Math.max(xLeft + 1, availableWidth - SNAKE_STROKE_WIDTH / 2);
  const rowY = (i) => SNAKE_STROKE_WIDTH / 2 + i * SNAKE_ROW_PITCH;
  const insetToward = (edgeX) => (edgeX === xRight ? edgeX - SNAKE_CORNER_RADIUS : edgeX + SNAKE_CORNER_RADIUS);

  let d = '';
  for (let i = 0; i < numRows; i++) {
    const y = rowY(i);
    const goingRight = i % 2 === 0;
    const isLastRow = i === numRows - 1;
    const fromX = goingRight ? xLeft : xRight;
    const toX = goingRight ? xRight : xLeft;
    const lineToX = isLastRow ? toX : insetToward(toX);

    if (i === 0) d += `M ${fromX},${y} `;
    d += `L ${lineToX},${y} `;

    if (!isLastRow) {
      const cornerX = toX;
      const nextY = rowY(i + 1);
      const dropToY = nextY - SNAKE_CORNER_RADIUS;
      d += `Q ${cornerX},${y} ${cornerX},${y + SNAKE_CORNER_RADIUS} `;
      if (dropToY > y + SNAKE_CORNER_RADIUS) {
        d += `L ${cornerX},${dropToY} `;
      }
      const nextLineStartX = insetToward(cornerX);
      d += `Q ${cornerX},${nextY} ${nextLineStartX},${nextY} `;
    }
  }
  return d.trim();
}

// Per-match fraction (of the player's total points) and cumulative offset
// along the shared snake path, plus color/label info reusing the existing
// per-match palette and label-visibility threshold.
function buildSnakeSegmentData(scoringMatches, totalPoints) {
  let cumulative = 0;
  return scoringMatches.map(m => {
    const fraction = totalPoints > 0 ? m.points / totalPoints : 0;
    const offset = cumulative;
    cumulative += fraction;
    return {
      matchNumber: m.matchNumber,
      points: m.points,
      fraction,
      offset,
      colorIndex: parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE,
      showLabel: fraction >= MIN_SEGMENT_LABEL_FRACTION
    };
  });
}
```

Note the constants are prefixed `SNAKE_` in `app.js` (unlike the test file's unprefixed local copy) to avoid any naming collision with other constants already in this large file — search for `SNAKE_STROKE_WIDTH`, `SNAKE_ROW_PITCH`, `SNAKE_CORNER_RADIUS`, `SNAKE_PIXELS_PER_POINT` before adding to confirm none already exist.

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/app.js verify_snake_geometry.js
git commit -m "feat: add pure snake geometry and segment math for mobile race panel"
```

---

### Task 4: JS — render the snake panel and wire the draw-on animation

**Files:**
- Modify: `public/app.js` (add `renderRaceSnakePanel` immediately after the functions added in Task 3 — search for `function buildSnakeSegmentData` to find the current location)

**Interfaces:**
- Consumes: `raceScoringMatches` (existing global), `raceCurrentFrame` (existing global), `escapeHtml` (existing), `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick` (existing, unchanged), `computeSnakeRowCount`/`buildSnakePathD`/`buildSnakeSegmentData`/`SNAKE_*` constants (Task 3), `RACE_FRAME_DURATION_MS` (existing, `= 700`).
- Produces: `renderRaceSnakePanel(panel, playerName)` — the function Task 2's `onRaceRowClick` already calls by name.

- [ ] **Step 1: Add `renderRaceSnakePanel`**

In `public/app.js`, immediately after the `buildSnakeSegmentData` function added in Task 3, add:

```javascript
// Build and animate-in the snake panel's SVG content for one player,
// snapshotting raceScoringMatches as of the current frame at the moment
// the row was opened (per design, this does not live-update afterward).
function renderRaceSnakePanel(panel, playerName) {
  const scoringMatches = (raceScoringMatches.get(playerName) || [])
    .filter(m => m.frameIndex <= raceCurrentFrame);
  const totalPoints = scoringMatches.reduce((sum, m) => sum + m.points, 0);

  const availableWidth = Math.round(panel.getBoundingClientRect().width) || 280;
  const numRows = computeSnakeRowCount(totalPoints, availableWidth);
  const pathD = buildSnakePathD(numRows, availableWidth);
  const segments = buildSnakeSegmentData(scoringMatches, totalPoints);
  const height = SNAKE_STROKE_WIDTH / 2 + (numRows - 1) * SNAKE_ROW_PITCH + SNAKE_STROKE_WIDTH / 2;
  const maskId = `race-snake-mask-${Math.random().toString(36).slice(2)}`;
  const player = escapeHtml(playerName);

  const segmentsHtml = segments.map(s => {
    const matchNum = escapeHtml(String(s.matchNumber));
    return `
      <path d="${pathD}" pathLength="1" data-match-number="${matchNum}"
            stroke="var(--seg-${s.colorIndex})" stroke-width="${SNAKE_STROKE_WIDTH}"
            stroke-linecap="butt" fill="none"
            stroke-dasharray="${s.fraction} ${1 - s.fraction}"
            stroke-dashoffset="${-s.offset}"
            class="race-snake-segment"
            onmouseenter="onSegmentMouseEnter(this, '${player}', '${matchNum}')"
            onmouseleave="onSegmentMouseLeave()"
            onclick="onSegmentClick(this, '${player}', '${matchNum}')"></path>
    `;
  }).join('');

  panel.innerHTML = `
    <svg viewBox="0 0 ${availableWidth} ${height}" width="${availableWidth}" height="${height}">
      <mask id="${maskId}">
        <path d="${pathD}" pathLength="1" stroke="#fff" stroke-width="${SNAKE_STROKE_WIDTH}" fill="none"
              stroke-dasharray="1" stroke-dashoffset="1" class="race-snake-reveal"></path>
      </mask>
      <g mask="url(#${maskId})">${segmentsHtml}</g>
    </svg>
  `;

  const reveal = panel.querySelector('.race-snake-reveal');
  if (reveal) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        reveal.style.transition = `stroke-dashoffset ${RACE_FRAME_DURATION_MS}ms ease`;
        reveal.style.strokeDashoffset = '0';
      });
    });
  }

  segments.filter(s => s.showLabel).forEach(s => {
    const matchNum = escapeHtml(String(s.matchNumber));
    const pathEl = panel.querySelector(`.race-snake-segment[data-match-number="${matchNum}"]`);
    if (!pathEl) return;
    const totalLength = pathEl.getTotalLength();
    const midLength = (s.offset + s.fraction / 2) * totalLength;
    const point = pathEl.getPointAtLength(midLength);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(point.x));
    label.setAttribute('y', String(point.y));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('class', 'race-snake-label');
    label.textContent = String(s.points);
    panel.querySelector('svg').appendChild(label);
  });
}
```

- [ ] **Step 2: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Confirm no leftover references to a now-fully-wired function**

Run: `grep -n "renderRaceSnakePanel" public/app.js`
Expected: two matches — the call site in `onRaceRowClick` (Task 2) and this task's `function renderRaceSnakePanel(...)` definition. No `ReferenceError` risk remains.

- [ ] **Step 4: Code-review trace through one end-to-end scenario**

With no local server, verify the wiring by reading the code path: a player with scoring matches `[{matchNumber:'3', points:2}, {matchNumber:'7', points:6}, {matchNumber:'12', points:2}]` (10 total points) on a 300px-wide panel. `computeSnakeRowCount(10, 300)` returns `1` (240px fits in a 272px row). `buildSnakePathD(1, 300)` returns a single straight line. `buildSnakeSegmentData` produces the three fraction/offset pairs verified in Task 3's Test #4. `renderRaceSnakePanel` renders three `<path>` elements sharing that one straight `d`, each with its own `stroke-dasharray`/`stroke-dashoffset` slicing out its 0.2/0.6/0.2 share, color `var(--seg-3)`/`var(--seg-7)`/`var(--seg-2)` (`matchNumber % 10`), and the two 0.2-fraction segments (≥ 0.04 threshold) get point-value labels positioned via `getPointAtLength` at their path midpoints; the 0.6 segment also gets one. All three share the exact same `onclick="onSegmentClick(this, ...)"` already used and tested by the inline desktop bar — clicking any of them opens the existing tooltip, unchanged.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: render and animate the mobile race snake panel"
```

---

## Final Verification

- [ ] Run `node --check public/app.js && node --check server.js`
- [ ] Run `node verify_leaderboard_history.js && node verify_race_scoring_matches.js && node verify_snake_geometry.js && node verify_points.js`
- [ ] `grep -n "renderRaceSnakePanel\|onRaceRowClick\|isMobileRaceWidth" public/app.js` shows the expected definitions and call sites with no dangling references.
- [ ] Per project convention, no local server spin-up — the user verifies the tap-to-expand, draw-on animation, and per-segment tooltip behavior visually on a real narrow viewport after deploying.
