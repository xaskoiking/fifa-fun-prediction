# Mobile Race Snake — Design

## Overview

On narrow (mobile) screens, the Race chart's per-match segments are too
thin to see or tap. Replace the always-visible inline segments with a plain
solid bar on mobile; tapping a player's row expands an animated "snake" —
the same per-match colored segments, still proportional to points, but
folded across multiple rows (boustrophedon/zigzag) with rounded turns, so
each segment stays wide enough to read and tap. Desktop is unaffected.

## Background / Current State

- `public/app.js:1256-1269` (`buildRaceSegmentsHtml`) emits one
  `.race-bar-segment` flex child per scoring match, `flex-grow: points`,
  colored via `var(--seg-${matchNumber % 10})`, with
  `onmouseenter`/`onmouseleave`/`onclick` wired to
  `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick`.
- `onSegmentClick(el, playerName, matchNumber)` (`public/app.js:~1460`) is
  capability-gated: no-ops when `supportsHoverForSegments` is true (desktop
  relies on hover instead), otherwise toggles `showSegmentTooltip`/
  `hideSegmentTooltip` by comparing `tip.dataset.forSegment`.
  `onSegmentMouseEnter`/`onSegmentMouseLeave` are gated the opposite way.
  These three functions are reused as-is by this feature — no tooltip
  changes.
- `.race-row` (`public/style.css:792-796`) is `display:flex` containing
  `.race-name`, `.race-bar-track` > `.race-bar-fill` > N×
  `.race-bar-segment`, and `.race-points`, all on one line.
  `.race-bar-track` is `height: 28px`. A `@media (max-width: 480px)` rule
  (`public/style.css:1172-1190`) already shrinks `.race-name`/`.race-points`
  font and `.race-bar-track` to 22px on very narrow phones.
- The codebase's general mobile breakpoint, used throughout
  `public/style.css`, is `@media (max-width: 600px)`.
- `raceScoringMatches` (`Map<playerName, ScoringMatch[]>`,
  `public/app.js`) already holds, per player, the ordered list of
  `{ frameIndex, matchNumber, homeTeam, awayTeam, kickoff, outcome, score,
  points }` this feature needs — no backend or data changes required.

## Mobile-mode detection

A new flag, computed once at load like `supportsHoverForSegments`:

```javascript
const isMobileRaceWidth = window.matchMedia('(max-width: 600px)').matches;
```

This is independent of hover-capability (a narrow desktop window and a wide
touch tablet are both real cases) and is not re-evaluated on resize/rotate
— consistent with how `supportsHoverForSegments` already behaves.

## Collapsed row (mobile)

When `isMobileRaceWidth` is true, `renderRaceFrame` skips
`buildRaceSegmentsHtml` and fills `.race-bar-fill` with one plain
`background: var(--color-accent)` block (today's pre-segment look), plus a
small chevron (▸ collapsed / ▾ expanded) appended after `.race-points`.
`.race-row` gains a second child, `.race-row-snake-panel` (initially
`display:none`), and switches to `flex-direction: column` so the panel
stacks below the header line — scoped to the same `max-width: 600px`
breakpoint, so desktop's existing single-line flex row is untouched.

Tapping anywhere on the row — except inside an already-open
`.race-row-snake-panel` — toggles that row's panel independently (multiple
rows may be open at once, per your choice). The toggle handler ignores
clicks whose target is inside `.race-row-snake-panel` (same `closest()`
guard pattern already used by the tooltip's outside-click listener), so
tapping a snake segment for its tooltip doesn't also collapse the row.

## The snake itself

**Geometry:** an SVG `<svg>` inside `.race-row-snake-panel`, sized to the
panel's measured available width. A single shared path is built as a
boustrophedon: horizontal strokes spanning the available width, connected
by rounded semicircular U-turns at alternating ends, for as many rows as
needed. Stroke thickness matches the existing bar, `28px`. Row pitch
(vertical distance between consecutive row centerlines) is `36px`, and
each U-turn is a semicircular arc of radius `14px` (half the stroke
width) connecting the end of one row to the start of the next — chosen so
the turn's curve is exactly as thick as the straight strokes, giving a
constant-width snake with no pinching. These are starting values; the
implementer may adjust them if the rendered result looks off, as long as
turn radius stays at half the stroke width.

**Total length:** proportional to the player's total points via a fixed
rate of `24px` per point (not relative to `raceMaxPoints` or other
players) — so a player with more points naturally gets a longer,
more-wrapped snake. Number of rows = `ceil(totalLength / availableWidth)`.
This rate is a starting value the implementer may adjust if rows end up
too short (e.g. a 1-2 point match barely visible) or too long (excessive
scrolling for high scorers) when checked against realistic point totals.

**Per-match segments:** one SVG `<path>` per scoring match, all sharing the
exact same `d` geometry with `pathLength="1"` (SVG's length-normalization
attribute, so positions can be expressed as 0-1 fractions regardless of
actual geometric length — this is what lets a segment's colored stroke
flow seamlessly through a rounded turn without special-casing the curve).
Each segment sets:
- `stroke="var(--seg-${matchNumber % 10})"`, `stroke-width="28"`,
  `stroke-linecap="butt"` (segments abut without gaps or overlap)
- `stroke-dasharray="${fraction} ${1 - fraction}"` where `fraction` is this
  match's share of total points
- `stroke-dashoffset="${-cumulativeFractionBefore}"` to position it at its
  place along the path

Point-value label: same rule as the inline bar — shown only when
`fraction >= MIN_SEGMENT_LABEL_FRACTION` (the existing `0.04` constant),
rendered as an SVG `<text>` positioned at that segment's midpoint along the
path; thinner segments stay colored/tappable but unlabeled.

**Interaction:** each segment `<path>` gets the identical
`onmouseenter="onSegmentMouseEnter(this, playerName, matchNumber)"`,
`onmouseleave="onSegmentMouseLeave()"`, `onclick="onSegmentClick(this,
playerName, matchNumber)"` already used by the inline bar — no new
tooltip code. Reusing the same capability-gated functions also correctly
handles the edge case of a hover-capable device with a narrow (mobile-width)
window: hover works there exactly like it does on the inline bar.

## Opening animation

A `<mask>` containing one wide white stroke along the same shared path
geometry (`pathLength="1"`, `stroke-dasharray="1"`, `stroke-dashoffset`
animatable 1→0) is applied to the `<g>` wrapping all per-match segment
paths. Expanding a row adds a class that transitions `stroke-dashoffset`
to `0` over ~700ms (matching the existing race-chart animation timing),
sweeping the reveal continuously from the snake's start to its end through
every turn — the colored segments themselves are static and pre-positioned;
only the mask animates. Collapsing simply hides the panel (`display:none`)
— no closing animation.

## Edge cases

- **A player with zero scoring matches:** panel still toggles open but
  shows an empty/short stub (or could be suppressed — implementation detail,
  not user-visible in practice since the row wouldn't have any points to
  tap into in the first place if nobody ever scores).
- **Incomplete final row:** whatever length remains just ends mid-row,
  left-aligned at the start of that row — no special handling needed since
  the path is built purely from total length, not a fixed row-by-row item
  count.
- **Resize/orientation change:** not handled (matches existing
  `supportsHoverForSegments` precedent of computing once at load).

## Testing

- No DOM test framework in this project. Verification is `node --check
  public/app.js` plus code review tracing the geometry/animation logic and
  confirming segment click/hover wiring matches the existing, already-tested
  `onSegmentClick`/`onSegmentMouseEnter`/`onSegmentMouseLeave` functions
  exactly (no duplication, no drift).
- Per project convention, no local server spin-up — the user verifies the
  expand/draw-on animation and tap-to-tooltip behavior visually on a real
  narrow viewport after deploying.
