# Race Stage Multi-Bar Breakdown — Design

## Overview

Replace today's two diverging Race-chart behaviors — desktop's always-visible
inline per-match segments, and mobile's tap-to-reveal boustrophedon snake —
with one unified interaction at every screen width: each player's bar
collapses to a plain solid green bar that just grows as the tournament
progresses. Clicking/tapping the row expands a panel beneath it showing one
stacked, color-coded bar per tournament stage (Group Stage Matchday 1/2/3,
Round of 32, Round of 16, Quarter-Finals to Final), each scaled to that
stage's own leading scorer and built from per-match segments with the exact
same hover/click tooltip (flag–score–flag + points earned) as today's main
bar. The boustrophedon snake is fully removed.

## Background / Current State

- `isMobileRaceWidth` (`public/app.js:39`) currently branches collapsed vs.
  segmented rendering by screen width; this flag is removed entirely by this
  change (no longer needed — collapsed bar is now solid everywhere, segments
  now live only inside the expanded panel).
- `buildRaceSegmentsHtml(playerName, frameIndex)` (`public/app.js:1266-1283`)
  emits one `.race-bar-segment` flex child per scoring match,
  `flex-grow: points`, colored via `var(--seg-${matchNumber % 10})`, wired to
  `onSegmentMouseEnter`/`onSegmentMouseLeave`/`onSegmentClick`. This logic is
  repurposed (not duplicated) into the new per-stage segment builder.
- `onSegmentClick`/`onSegmentMouseEnter`/`onSegmentMouseLeave`
  (`public/app.js:~1646-1662`), gated by `supportsHoverForSegments`
  (`public/app.js:1594`), and `showSegmentTooltip` (`public/app.js:1610`,
  renders flag–score–flag + `+N pts`) are reused completely unchanged — no
  tooltip code changes of any kind.
- `raceScoringMatches` (`Map<playerName, ScoringMatch[]>`, populated by
  `buildRaceScoringMatches`, `public/app.js:1216-1236`) already holds, per
  player, `{ frameIndex, matchNumber, homeTeam, awayTeam, kickoff, outcome,
  score, points }` for every match that player scored in — exactly what stage
  bucketing needs. No backend or data-shape changes required.
- `onRaceRowClick`/`renderRaceSnakePanel` and the snake geometry helpers
  (`computeSnakeRowCount`, `computeSnakeLastRowWidth`, `buildSnakePathD`,
  `buildSnakeSegmentData`, `public/app.js:1339-1518`) are deleted by this
  change and replaced by the logic below.
- `initRaceBars()`/`renderRaceFrame()` (`public/app.js:1239-1337`) build one
  `.race-row` per player and re-render on every playback tick / scrub.
- The Reports tab already buckets match numbers into stage ranges
  (`public/app.js:777-784`) with the same six boundaries this feature needs,
  under different labels/usage — that array is not reused directly; a new,
  independent constant is added (see below) to avoid coupling two unrelated
  features.
- CSS: `.race-row`, `.race-bar-track`, `.race-bar-fill`, `.race-bar-segment`,
  `.race-points` (`public/style.css:792-847`); mobile-only
  `.race-row-chevron`/`.race-row-snake-panel`/`.race-snake-segment`/
  `.race-snake-label` scoped under `@media (max-width: 600px)`
  (`public/style.css:869-902`).

## Stage definitions

```javascript
const RACE_STAGE_GROUPS = [
  { label: 'Group Stage – Matchday 1', lo: 1,  hi: 24 },
  { label: 'Group Stage – Matchday 2', lo: 25, hi: 48 },
  { label: 'Group Stage – Matchday 3', lo: 49, hi: 72 },
  { label: 'Round of 32',              lo: 73, hi: 88 },
  { label: 'Round of 16',              lo: 89, hi: 96 },
  { label: 'Quarter-Finals to Final',  lo: 97, hi: 104 },
];
```

`lo`/`hi` are inclusive `matchNumber` boundaries (a match belongs to a stage
iff `lo <= matchNumber <= hi`), matching the 48-team World Cup format already
assumed elsewhere in this codebase (12 groups × 3 matchdays × 24 matches,
then 16+8+4+2+1+1 knockout matches = 104 total).

## Collapsed bar (every width)

`renderRaceFrame` drops the `isMobileRaceWidth` branch: `.race-bar-fill` is
always a plain solid `background: var(--color-accent)` block with no
children, width = `player.points / raceMaxPoints * 100%`, on every screen
width. `buildRaceSegmentsHtml`'s call site here is removed.

`initRaceBars()` unconditionally appends a chevron (`▸`/`▾`) after
`.race-points` and a hidden `.race-row-stage-panel`, for every row regardless
of width — the `isMobileRaceWidth ? ... : ''` ternary becomes plain markup.
`row.onclick = (e) => onRaceRowClick(e, row, player.name)` is likewise
assigned unconditionally.

`isMobileRaceWidth` itself is deleted (`public/app.js:39`) — nothing else
references it after this change.

## Expand/collapse interaction

`onRaceRowClick(e, row, playerName)` keeps its existing shape: ignores clicks
whose target is inside an already-open `.race-row-stage-panel` (so tapping a
segment for its tooltip doesn't also collapse the row), toggles only that
row's panel, and multiple rows may be open simultaneously — all unchanged
from today's snake behavior, just no longer gated to mobile widths. Opening a
panel calls `renderStagePanel(panel, playerName)` (renamed from
`renderRaceSnakePanel`), using `raceCurrentFrame` for "as of now."

**Live frame-sync:** `renderRaceFrame(frameIndex, animate)` — already called
on every playback tick and scrub — additionally re-calls
`renderStagePanel(panel, playerName)` for any row whose panel is currently
open (checked via `panel.style.display !== 'none'`), right after updating
that row's collapsed bar. This makes an open panel advance in lockstep with
Play/scrub instead of freezing at the moment it was opened (unlike today's
snake panel, which snapshots once).

A stage is **"started"** — and therefore shown at all — only if at least one
resolved match in `raceFrames[1..frameIndex]` has a `matchNumber` within its
`lo..hi` range. Unstarted stages are omitted from the panel entirely (no
placeholder row).

## Per-stage bar rendering

For each started stage, `renderStagePanel` emits one `.race-stage-row`:
a label (`stage.label`) + a `.race-stage-bar-track` containing a
`.race-stage-bar-fill` built the same way `buildRaceSegmentsHtml` builds the
main bar today — one `.race-bar-segment` child per scoring match in that
player's history that falls within the stage's `lo..hi` range and has
`frameIndex <= currentFrame`:

- `flex-grow: points`, `background: var(--seg-${matchNumber % 10})` — same
  palette as today, so a given match is the same color in the main bar's
  history and every stage's breakdown, for every player.
- Identical `onmouseenter="onSegmentMouseEnter(this, playerName,
  matchNumber)"` / `onmouseleave="onSegmentMouseLeave()"` /
  `onclick="onSegmentClick(this, playerName, matchNumber)"` wiring — hovering
  (desktop) or tapping (touch) a segment pops the exact same tooltip as
  today: flag–score–flag for that match plus `+N pts` for that player, via
  the unmodified `showSegmentTooltip`/`onSegmentClick`/`onSegmentMouseEnter`
  functions.
- Point-value label shown inside a segment only when its share of the
  *stage's* total (`segment.points / stageMaxPoints`) meets
  `MIN_SEGMENT_LABEL_FRACTION` — same constant, evaluated per-stage instead
  of per-tournament.

**Bar width:** `.race-stage-bar-fill`'s overall width is
`stagePoints / stageMaxPoints * 100%`, where `stagePoints` is this player's
point total within the stage (sum of matching `raceScoringMatches` entries up
to `currentFrame`) and `stageMaxPoints` is the highest `stagePoints` any
player has for that same stage/frame — i.e. each stage bar is scaled against
that stage's own leading scorer, not the all-time max. If `stageMaxPoints` is
`0` (matches resolved, nobody scored), all bars for that stage render at `0%`
width (guarded, no divide-by-zero) with no segments.

A trailing `.race-stage-points` label (e.g. `"7 pts"`) sits to the right of
each stage's track, mirroring `.race-points` on the main row.

## Removed code

Deleted entirely from `public/app.js`:
- `isMobileRaceWidth`
- `SNAKE_STROKE_WIDTH`, `SNAKE_ROW_PITCH`, `SNAKE_CORNER_RADIUS`,
  `SNAKE_PIXELS_PER_POINT`
- `computeSnakeRowCount`, `computeSnakeLastRowWidth`, `buildSnakePathD`,
  `buildSnakeSegmentData`, `renderRaceSnakePanel`

`buildRaceSegmentsHtml` is repurposed into the new per-stage segment builder
(parameterized by stage range and `stageMaxPoints` instead of always using
`raceMaxPoints`) rather than left as unused dead code alongside a new
duplicate function.

Deleted from `public/style.css`: `.race-row-snake-panel svg`,
`.race-snake-segment`, `.race-snake-label`.

## CSS changes

- `.race-row-chevron` and the base (non-SVG) part of
  `.race-row-snake-panel` move out of `@media (max-width: 600px)`
  (`public/style.css:869-902`) into unscoped rules — they now apply at every
  width. `.race-row-snake-panel` is renamed `.race-row-stage-panel`.
- `.race-row` gains `flex-wrap: wrap` unconditionally (today this is
  mobile-only, `public/style.css:870-873`) so the panel drops to its own
  line at any width.
- New rules: `.race-stage-row` (flex row: label + track + points, smaller
  gap than `.race-row`), `.race-stage-label` (narrower fixed width than
  `.race-name`, smaller font), `.race-stage-bar-track` (shorter height than
  `.race-bar-track`, e.g. `18px` vs `28px`, same background/border-radius
  pattern), `.race-stage-bar-fill` (`display:flex`, `transition: width 700ms
  ease` — same easing as `.race-bar-fill` so stage bars visually grow in
  step with Play/scrub), `.race-stage-points` (narrower version of
  `.race-points`). `.race-bar-segment` itself is reused as-is inside
  `.race-stage-bar-fill` (same class, same styling, smaller container).

## Animation

No SVG reveal sweep (no SVG at all in this design) — stage bar widths
transition via the same `width 700ms ease` rule pattern as the main bar, so
they visibly grow during Play/scrub exactly like the collapsed bar does.
Opening/closing a panel is instant (`display: block`/`none`, no transition),
matching today's snake collapse behavior (expand also has no animation
beyond the width transitions that happen naturally as `renderStagePanel`
re-runs on subsequent frames).

## Edge cases

- **Frame 0 ("Start"):** no stage has started; an opened panel renders no
  stage rows (empty). Acceptable since there's nothing to show yet.
- **Stage with resolved matches but zero points for everyone:** all players'
  bars for that stage render at `0%` width, no segments, `"0 pts"` label —
  guarded explicitly to avoid a `0/0` divide.
- **Player with zero points in an otherwise-started stage:** that player's
  bar renders at `0%` width with `"0 pts"`, same as today's main-bar
  zero-points case.
- **Resize/orientation change:** no special handling needed — unlike the
  snake (which measured pixel width via JS and could go stale on resize),
  these are plain CSS percentage widths, so they reflow correctly on resize
  with no JS recomputation at all.

## Backend

No changes. `matchNumber`, `matchPoints`, `score`, `outcome` are already
present on leaderboard history frames (added by the earlier stacked-race-bar
-segments feature) and already consumed into `raceScoringMatches`
client-side. Stage bucketing is pure client-side arithmetic over data already
fetched by the existing `/api/leaderboard/history` call.

## Testing

- `node --check public/app.js` plus code review tracing the new stage-bucket
  math (`stagePoints`/`stageMaxPoints` computation, started-stage filtering)
  against a sample `raceFrames`/`raceScoringMatches` fixture, and confirming
  segment click/hover wiring inside stage bars matches the existing,
  already-tested `onSegmentClick`/`onSegmentMouseEnter`/`onSegmentMouseLeave`
  functions exactly (same call signature, no duplication, no drift).
- Per project convention, no local server spin-up — the user verifies the
  collapsed-bar/expand/live-sync behavior visually after deploying.
