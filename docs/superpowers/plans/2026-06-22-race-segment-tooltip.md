# Race Segment Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Race chart's click-to-open modal popup with a small positioned tooltip — hover-to-show on desktop, tap-to-toggle on mobile — mirroring the codebase's existing `flag-name-label` floating-tooltip pattern.

**Architecture:** Remove the `#matchPopupModal` markup and its `openMatchPopup`/`closeMatchPopup` JS. Add a single reusable, lazily-created `#race-segment-tooltip` div (same lazy-singleton approach as `getFlagNameLabel()`), positioned via `getBoundingClientRect()`, shown/hidden through a capability-gated set of handlers: `mouseenter`/`mouseleave` on hover-capable devices, `click` + a document-level outside-click listener on touch devices.

**Tech Stack:** Vanilla JS/CSS/HTML (no frameworks, no chart library), same single-file `public/app.js`/`public/style.css`/`public/index.html` as the rest of the app.

## Global Constraints

- No new dependencies (vanilla JS/CSS only).
- No local server spin-up for verification — per project convention, rely on code review, diffing, and Node syntax checks; the user verifies hover/tap behavior visually via deploy.
- Capability detection is exactly `window.matchMedia('(hover: hover) and (pointer: fine)').matches`, computed once into `supportsHoverForSegments`.
- Tooltip content is exactly: the flag-score-flag row (via `buildFlagSpan`, same score-or-fallback text as the rest of the app: `score ? "H-A" : (draw ? 'Draw' : 'Win')`) plus a `"+N pts"` line. No match label/date, no Close button.
- Tooltip positioning: centered horizontally over the triggering segment, clamped to `[8px, window.innerWidth - tooltipWidth - 8px]`, placed at `segmentRect.top - tooltipHeight - 8px`.
- Follow the existing `flag-name-label` pattern's structure exactly: lazy-singleton getter, a `dataset.forSegment` key for toggle-detection, a single `document.addEventListener('click', ...)` for outside-click dismissal.

---

### Task 1: CSS — add `.race-segment-tooltip` styles

**Files:**
- Modify: `public/style.css:488-497` (right after `.flag-name-label`)

**Interfaces:**
- Produces: CSS classes `.race-segment-tooltip` and `.race-segment-tooltip-points`, consumed by Task 3's `getSegmentTooltip()`/`showSegmentTooltip()`.

- [ ] **Step 1: Add the new rules**

In `public/style.css`, immediately after the closing `}` of `.flag-name-label` (currently ending at line 497) and before the blank line + `.vs-divider` rule, insert:

```css
.race-segment-tooltip {
  position: fixed;
  z-index: 9999;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  pointer-events: none;
  text-align: center;
}

.race-segment-tooltip-points {
  margin-top: 4px;
  font-weight: 800;
  font-size: 0.85rem;
  color: var(--color-accent);
}
```

- [ ] **Step 2: Sanity-check brace balance**

Run: `grep -c "{" public/style.css` and `grep -c "}" public/style.css`
Expected: the two counts match each other (same relative balance as before this edit, plus the 2 new balanced rules).

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add race segment tooltip styles"
```

---

### Task 2: HTML — remove the match popup modal markup

**Files:**
- Modify: `public/index.html:653-665`

**Interfaces:**
- Removes: DOM IDs `#matchPopupModal`, `#matchPopupLabel`, `#matchPopupBody`, `#matchPopupPoints` (no longer referenced by anything after Task 3 removes their JS consumers).

- [ ] **Step 1: Remove the modal block**

In `public/index.html`, delete this entire block (currently lines 653-665, including the leading comment and trailing blank line before `<!-- General Script -->`):

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

So that the file reads, around that area:

```html
  </div>

  <!-- General Script -->
```

(The closing `</div>` immediately above is the end of the still-present `voteConfirmModal` block — leave that one untouched.)

- [ ] **Step 2: Verify no dangling references remain in this file**

Run: `grep -n "matchPopup" public/index.html`
Expected: no output (Task 3 removes the remaining JS references in `app.js`).

- [ ] **Step 3: Verify the file is still well-formed**

Run: `grep -c "<div" public/index.html` and `grep -c "</div>" public/index.html`
Expected: both counts drop by exactly 6 compared to before this change (the modal had 6 balanced div pairs), and remain equal to each other.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: remove match popup modal markup"
```

---

### Task 3: JS — replace modal popup with hover/tap tooltip

**Files:**
- Modify: `public/app.js:1256-1267` (`buildRaceSegmentsHtml`)
- Modify: `public/app.js:1391-1422` (remove `openMatchPopup`/`closeMatchPopup`, add the new tooltip system)

**Interfaces:**
- Consumes: `raceScoringMatches` (existing global, `Map<playerName, ScoringMatch[]>`), `buildFlagSpan(teamName, extraClass)` (existing), `escapeHtml(text)` (existing), CSS classes `.race-segment-tooltip`/`.race-segment-tooltip-points` (Task 1).
- Produces: `supportsHoverForSegments` (module-scope boolean), `getSegmentTooltip()`, `showSegmentTooltip(segmentEl, playerName, matchNumber)`, `hideSegmentTooltip()`, `onSegmentMouseEnter(el, playerName, matchNumber)`, `onSegmentMouseLeave()`, `onSegmentClick(el, playerName, matchNumber)` — these replace `openMatchPopup`/`closeMatchPopup` as what `buildRaceSegmentsHtml`'s emitted segments call.

- [ ] **Step 1: Rewire the segment markup in `buildRaceSegmentsHtml`**

Replace the segment-building `.map()` callback (currently `public/app.js:1260-1266`):

```javascript
    .map(m => {
      const colorIndex = parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE;
      const showLabel = (m.points / raceMaxPoints) >= MIN_SEGMENT_LABEL_FRACTION;
      return `
        <div class="race-bar-segment" style="flex-grow: ${m.points}; background: var(--seg-${colorIndex});"
             onclick="openMatchPopup('${escapeHtml(playerName)}', '${escapeHtml(String(m.matchNumber))}')">${showLabel ? m.points : ''}</div>
      `;
    })
```

with:

```javascript
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
```

- [ ] **Step 2: Replace `openMatchPopup`/`closeMatchPopup` with the tooltip system**

Replace this block (currently `public/app.js:1391-1422`):

```javascript
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

with:

```javascript
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
```

- [ ] **Step 3: Syntax-check app.js**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Confirm no dangling references to the removed functions/IDs**

Run: `grep -n "openMatchPopup\|closeMatchPopup\|matchPopupModal\|matchPopupLabel\|matchPopupBody\|matchPopupPoints" public/app.js public/index.html`
Expected: no output.

- [ ] **Step 5: Code-review trace through one end-to-end scenario (desktop)**

With no local server, verify the wiring by reading the code path: a resolved match where `Alice` earned 5 points produces a segment with `onmouseenter="onSegmentMouseEnter(this, 'Alice', '7')"`. On a desktop (`supportsHoverForSegments === true`), hovering calls `onSegmentMouseEnter` → `showSegmentTooltip(el, 'Alice', '7')`, which finds the same `raceScoringMatches` entry, builds the flag-score-flag + `+5 pts` content, and positions the tooltip above the segment via `el.getBoundingClientRect()`. Moving the mouse away calls `onSegmentMouseLeave` → `hideSegmentTooltip()`. Clicking the segment does nothing extra (`onSegmentClick` returns immediately since `supportsHoverForSegments` is true).

- [ ] **Step 6: Code-review trace through the same scenario (mobile)**

On a touch device (`supportsHoverForSegments === false`), `onSegmentMouseEnter`/`onSegmentMouseLeave` no-op. Tapping the segment calls `onSegmentClick(el, 'Alice', '7')`: `wasShowingForThis` is `false` (tooltip not yet open for this key), so it calls `showSegmentTooltip` and the tooltip appears. Tapping the *same* segment again: `wasShowingForThis` is now `true` (tooltip's `dataset.forSegment` already equals `'Alice|7'`), so `hideSegmentTooltip()` runs and the `if (!wasShowingForThis)` guard skips re-showing — tooltip closes. Tapping a *different* segment (e.g. `Bob`, match `'9'`): that segment's own `onSegmentClick` hides the current tooltip and reopens it with Bob's content (its `wasShowingForThis` check uses its own key, which doesn't match `'Alice|7'`). Tapping empty space elsewhere on the page: no `.race-bar-segment` or `#race-segment-tooltip` is in `e.target`'s ancestor chain, so the document-level listener's `hideSegmentTooltip()` runs.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: replace race chart match popup with hover/tap tooltip"
```

---

## Final Verification

- [ ] Run `node --check public/app.js && node --check server.js`
- [ ] Run `node verify_leaderboard_history.js && node verify_race_scoring_matches.js && node verify_points.js` (unaffected by this change, confirms no regression)
- [ ] `grep -n "matchPopup\|race-row-leader" server.js public/app.js public/index.html public/style.css` returns nothing.
- [ ] Per project convention, no local server spin-up — the user verifies hover (desktop) and tap (mobile/responsive devtools) behavior visually after deploying.
