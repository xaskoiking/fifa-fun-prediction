# Race Segment Tooltip — Design

## Overview

Replace the Race chart's click-to-open modal popup (added by the prior
"stacked race bar segments" feature) with a small positioned tooltip:
hover-to-show on devices with real hover (desktop), tap-to-toggle on touch
devices (mobile), dismissed by hovering away or tapping elsewhere.

## Background / Current State

- `public/app.js:1256-1267` (`buildRaceSegmentsHtml`) emits one
  `.race-bar-segment` div per scoring match, each with
  `onclick="openMatchPopup('<playerName>', '<matchNumber>')"`.
- `public/app.js:1392-1422` (`openMatchPopup`/`closeMatchPopup`) show/hide a
  full-screen `.modal-overlay` (`public/index.html:654-665`,
  `#matchPopupModal`) containing a match label, flag-score-flag row, points
  line, and a Close button.
- The codebase already has a similar but distinct floating-tooltip pattern
  for flag names, at `public/app.js:2992-3027`:
  - `getFlagNameLabel()` lazily creates one reusable `<div id="flag-name-label">`
    appended to `document.body`, instead of one node per usage.
  - `showFlagNameLabel(flagEl, teamName)` positions it via
    `flagEl.getBoundingClientRect()`.
  - A single `document.addEventListener('click', ...)` toggles it: clicking
    the same flag again hides it (tracked via `label.dataset.forFlag`),
    clicking a different flag swaps content, clicking elsewhere hides it.
  - CSS (`public/style.css:488-497`, `.flag-name-label`): `position: fixed`,
    `z-index: 9999`, dark background, `pointer-events: none`.
  This is click/tap-only (no hover-awareness) — our new tooltip reuses this
  exact lazy-singleton + `getBoundingClientRect()` positioning + toggle-via-
  document-listener structure, adding a hover-capability gate on top.

## Behavior

**Capability detection:** compute once at script load,
`const supportsHoverForSegments = window.matchMedia('(hover: hover) and (pointer: fine)').matches;`
This is `true` on mouse/trackpad desktops, `false` on touch-only phones/tablets.

**Desktop (`supportsHoverForSegments === true`):** each segment's
`onmouseenter` shows the tooltip positioned above it; `onmouseleave` hides
it. Click does nothing extra (hover already covers it).

**Mobile (`supportsHoverForSegments === false`):** `onmouseenter`/
`onmouseleave` no-op. Each segment's `onclick` toggles the tooltip exactly
like the existing `flag-name-label` pattern: tapping the same segment again
closes it, tapping a different segment swaps to it, and a
`document`-level click listener (gated to the non-hover case) closes it when
the tap lands outside any `.race-bar-segment` and outside the tooltip itself.

**Content** (trimmed from the old modal): just the flag-score-flag row
(via the existing `buildFlagSpan()` helper, same score-or-fallback text as
today: `score ? "H-A" : (draw ? 'Draw' : 'Win')`) and a `"+N pts"` line
underneath. No match label/date, no Close button — dismissal is automatic.

**Positioning:** one reusable `<div id="race-segment-tooltip">` (not one per
segment), shown via `position: fixed`. On each show, read the triggering
segment's `getBoundingClientRect()`, center the tooltip horizontally over
it, clamp the left edge to `[8px, window.innerWidth - tooltipWidth - 8px]`
so it never clips off-screen, and place it just above the segment
(`segmentRect.top - tooltipHeight - 8px`).

## Changes

**Remove:**
- `public/index.html:654-665` — the `#matchPopupModal` block (the shared
  `.modal-overlay`/`.modal-card` CSS classes stay; only this instance goes).
- `public/app.js:1392-1422` — `openMatchPopup`/`closeMatchPopup`.

**Add (`public/app.js`, near the removed functions):**
- `supportsHoverForSegments` (computed once, module scope).
- `getSegmentTooltip()` — lazy-singleton creator, mirroring
  `getFlagNameLabel()`.
- `showSegmentTooltip(segmentEl, playerName, matchNumber)` — looks up the
  match via `raceScoringMatches.get(playerName)` (same lookup
  `openMatchPopup` used), builds the trimmed content, positions via
  `getBoundingClientRect()`.
- `hideSegmentTooltip()`.
- `onSegmentMouseEnter(el, playerName, matchNumber)` /
  `onSegmentMouseLeave()` — gated by `supportsHoverForSegments`.
- `onSegmentClick(el, playerName, matchNumber)` — gated by
  `!supportsHoverForSegments`, toggle logic via `tip.dataset.forSegment`
  (same pattern as `flag.dataset.team`/`label.dataset.forFlag`).
- A `document.addEventListener('click', ...)` that hides the tooltip when
  `!supportsHoverForSegments` and the click target is outside both
  `.race-bar-segment` and `#race-segment-tooltip`.

**Modify (`public/app.js:1256-1267`, `buildRaceSegmentsHtml`):** each
segment's single `onclick="openMatchPopup(...)"` becomes three handlers:
`onmouseenter="onSegmentMouseEnter(this, '<player>', '<matchNumber>')"`,
`onmouseleave="onSegmentMouseLeave()"`,
`onclick="onSegmentClick(this, '<player>', '<matchNumber>')"`.

**Add (`public/style.css`):** `.race-segment-tooltip`, modeled on
`.flag-name-label` (`position: fixed`, `z-index: 9999`, dark background,
rounded, `pointer-events: none`), plus a small `.race-segment-tooltip-points`
line style for the `+N pts` text.

## Edge cases

- **Tablet/hybrid devices** where `matchMedia('(hover: hover)')` is
  ambiguous: this is the standard, widely-supported feature-detection query
  (not a viewport-width guess), so it degrades the same way the platform's
  own hover/touch model does — out of scope to special-case further.
- **Rapid hover across adjacent segments:** each `mouseenter` simply
  repositions/repopulates the same singleton tooltip; no stale state since
  there's only ever one tooltip element.
- **Tooltip width near tooltip-content changes** (longer team names): width
  is read fresh via `getBoundingClientRect()` after `innerHTML` is set and
  before positioning, so clamping always uses the current size.

## Testing

- No DOM test framework in this project; verification is `node --check
  public/app.js` plus code review tracing the show/hide/toggle logic against
  the existing `flag-name-label` precedent it mirrors.
- Per project convention, no local server spin-up — the user verifies
  hover (desktop) and tap (mobile/responsive devtools) behavior visually
  after deploying.
