# Stacked Race Bar Segments — Design

## Overview

Today the Race view's bars (`public/app.js:1206-1270`) are single-color
blocks whose width tracks cumulative points. Replace each bar with a
**stacked bar made of one segment per match the player scored in**, colored
distinctly per match, optionally labeled with the points earned, and
clickable to show that match's result.

## Background / Current State

- `buildLeaderboardHistory()` (`server.js:315`) returns frames — one per
  resolved match, in chronological order — each with cumulative
  `standings: [{name, points, correct}]`. It already computes
  `calculatePointsForMatch(match.votes, match.outcome, match.matchType)`
  per match internally but only uses it to accumulate totals; the per-match
  breakdown is discarded today.
- `getMatchScore(homeTeam, awayTeam)` (`server.js:1165`) looks up a finished
  match's `{scoreHome, scoreAway}` from `_liveScoresCache`, returning `null`
  if unavailable (e.g. cache no longer has it). Already used by
  `/api/matches` and the Results tab with this fallback pattern
  (`app.js:1541`):
  ```js
  match.score ? `${scoreHome}-${scoreAway}` : (isWinnerDraw ? 'Draw' : 'Win')
  ```
- `buildFlagSpan(teamName, extraClass)` (`app.js:1337`) renders a team flag
  span using the `flag-icons` library; this plus a score span in between is
  the existing "flag-score-flag" pattern used in Results and Predictions.
- A reusable modal pattern already exists: `.modal-overlay`/`.modal-card`
  (`style.css:1519`, instances in `index.html:613,632`).
- `initRaceBars()`/`renderRaceFrame()` currently render one solid
  `.race-bar-fill` per row, width = `(points / raceMaxPoints) * 100%`, with
  FLIP-based row reordering and a 700ms width transition. The frame-0
  ("Start") leader gets `--color-gold`; all other bars/leaders otherwise use
  `--color-accent`.

## Backend: enrich `buildLeaderboardHistory()` frames

For each non-start frame (i.e. each resolved match), add three fields
alongside the existing `matchNumber`/`homeTeam`/`awayTeam`/`kickoff`/
`standings`:

- `outcome`: `'home' | 'away' | 'draw'` (copied from `match.outcome`)
- `score`: `getMatchScore(match.homeTeam, match.awayTeam)` →
  `{scoreHome, scoreAway}` or `null`
- `matchPoints`: the `pointsAllocated` map already produced by
  `calculatePointsForMatch` for this match, filtered to entries `> 0` —
  `{ [playerName]: pointsEarnedThisMatch }`

The frame-0 ("Start") frame keeps `outcome`/`score`/`matchPoints` as `null`/
`{}`, consistent with its existing null `matchNumber`/`homeTeam`/`awayTeam`.

No new endpoint or response shape change beyond these additive fields —
`/api/leaderboard/history` (`server.js:689`) stays the single source the
Race view fetches.

## Frontend: segmented bars

**Precompute on history load:** walk `raceFrames` once (skipping frame 0)
and build, per player, an ordered list of "scoring matches":
`{ frameIndex, matchNumber, homeTeam, awayTeam, outcome, score, points }`
for every frame where `matchPoints[player] > 0`. This list is what each
player's bar is built from — order matches frame order, so it's also
playback order.

**Rendering (`initRaceBars`/`renderRaceFrame`):**

- `.race-bar-fill` becomes a flex container; instead of one block it holds
  one `.race-bar-segment` child per scoring match up to the current frame
  index. Width math per segment stays consistent with current total-bar
  math: `(segment.points / raceMaxPoints) * 100%` of the track, so the sum
  of a player's segment widths still equals today's total bar width.
- Segments for matches beyond the current playback frame simply aren't
  rendered yet — this is what makes segments "build up as it plays" during
  Play/scrubbing, reusing the existing FLIP grow/reorder transitions
  unchanged.
- Each segment is colored via `matchNumber % PALETTE.length`, so a given
  match is the same color in every player's bar. New CSS custom properties
  (e.g. `--seg-1` … `--seg-10`) added alongside the existing
  `--color-gold`/`--color-accent` set, cycling ~10 distinguishable hues.
- If a segment is wide enough to legibly fit its number (a simple min-width
  check, e.g. comparable to a couple characters at the current font size),
  render the point value centered inside it; otherwise render no text but
  keep the segment's click target and color.
- The existing solid-gold leader override is **removed** — every player's
  bar, including 1st place, shows its real per-match segment colors with no
  special leader styling.

**Click → popup:**

- Each segment's click handler calls `openMatchPopup(playerName, matchNumber)`
  (inline `onclick`, consistent with the rest of `app.js`), looking up the
  match's `{homeTeam, awayTeam, outcome, score}` from `raceFrames` and the
  player's earned `points` from the precomputed list.
- Reuses the `.modal-overlay`/`.modal-card` pattern for a small popup:
  - Header: `"Match {matchNumber} · {kickoff formatted like the existing
    raceDateLabel}"`.
  - Body: flag-score-flag row via `buildFlagSpan()`, with the same
    score-or-fallback text as Results (`match.score` formatted, else `'Draw'`
    if `outcome === 'draw'` else `'Win'`).
  - Footer line: `"+{points} pts"` for that player in that match.
- Closing follows the existing modal close pattern (overlay click / close
  button, matching `closeVoteModal()`-style handling).

## Edge cases

- **Frame 0 / no resolved matches:** no segments exist yet — bar is empty,
  same as today's behavior with no points.
- **Player scored 0 in a match:** no segment is created for that match for
  that player (matches current points math — zero-width contributions are
  simply omitted rather than rendered as a zero-width segment).
- **`score` is `null`** (older match no longer in the live cache): popup
  falls back to `'Win'`/`'Draw'` text, identical to the Results tab's
  existing fallback.
- **Narrow segments:** point-value text is omitted when it wouldn't fit;
  the segment remains clickable and colored.

## Testing

- Code review of the frame-enrichment logic against a sample
  `db.matches`/`db.users` fixture (e.g. via the existing `verify_points.js`
  pattern) to confirm `matchPoints`/`score`/`outcome` line up with what
  `/api/leaderboard` already computes for the same matches.
- Per project convention, no local server spin-up for manual UI
  verification — rely on code review and diffing against the current Race
  view behavior; the user verifies visually via deploy.
