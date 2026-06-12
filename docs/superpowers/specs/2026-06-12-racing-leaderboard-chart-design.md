# Racing Leaderboard Chart — Design

## Overview

Add a "Race" view to the Leaderboard tab that animates how player standings
changed match-by-match over the course of the season, with play/pause and
scrubber controls (like scrubbing through a video). Implemented in vanilla
JS/CSS — no new dependencies — and toggled alongside the existing standings
table.

## Background / Current State

- Standings are computed on the fly by `GET /api/leaderboard`
  (`server.js:503`), which iterates `db.matches` and sums
  `calculatePointsForMatch` results for every match with
  `status: "resolved"`.
- No historical standings snapshots exist anywhere in `data.json`.
- Match schema (`data.json`):
  ```json
  {
    "id": "match_...",
    "matchNumber": "3",
    "group": "Group B",
    "homeTeam": "...",
    "awayTeam": "...",
    "matchType": "League" | "KO",
    "kickoff": "ISO timestamp",
    "status": "scheduled" | "resolved",
    "votingLocked": false,
    "outcome": null | "home" | "away" | "draw",
    "voteLog": [{ "timestamp": "...", "player": "...", "vote": "home|away|draw" }],
    "votes": { "home": [...], "away": [...], "draw": [...] }
  }
  ```
- The "time" axis for the race is **match order** (resolved matches sorted by
  `kickoff` ascending, `matchNumber` as tiebreak), not real-world resolution
  timestamps — there's no `resolvedAt` field on matches.

## Backend: new endpoint `GET /api/leaderboard/history`

Returns an array of "frames" — cumulative standings snapshots, one per
resolved match, in chronological order:

1. Sort matches with `status: "resolved"` by `kickoff` ascending
   (tiebreak `matchNumber`).
2. Initialize standings for every registered user at `{ name, points: 0 }`
   (same as `/api/leaderboard`).
3. Walk the sorted resolved matches in order, applying the existing
   `calculatePointsForMatch` cumulatively, and push a snapshot of full
   standings after each match.
4. Prepend a synthetic **frame 0** (all players at 0, no match label) so the
   race has a clean starting point.

Response shape:

```json
[
  { "matchNumber": null, "homeTeam": null, "awayTeam": null,
    "standings": [{"name":"Prad","points":0}, {"name":"ADMIN","points":0}] },
  { "matchNumber": "1", "homeTeam": "Canada", "awayTeam": "Mexico",
    "standings": [{"name":"Prad","points":3}, {"name":"ADMIN","points":0}] }
]
```

`standings` in each frame is sorted using the same comparator as
`/api/leaderboard` (points desc, then `correct` desc — though `correct`
isn't tracked per-frame, so points desc then alphabetical is sufficient here
for stable tiebreaking).

This reuses `calculatePointsForMatch` — no new scoring rules, just an
additional accumulation loop that snapshots state at each step instead of
only returning final totals.

## Frontend: view toggle & layout

Add a small segmented toggle above the leaderboard card: **Table | Race**,
consistent with the existing tab-switching pattern in `app.js`. Switching to
"Race" hides the table card and shows a new race card; switching back hides
it again. The history data is fetched lazily (on first switch to "Race") via
`/api/leaderboard/history`.

Race card structure:

```
┌─────────────────────────────────────┐
│  Match 3: Canada vs Bosnia-Herz.      │  ← current frame label
├─────────────────────────────────────┤
│  Prad     ████████████████  12 pts  │
│  ADMIN    ███                3 pts  │
│  ...                                 │
├─────────────────────────────────────┤
│  ▶  ─────●──────────────  (slider)   │  ← play/pause + scrubber
└─────────────────────────────────────┘
```

- One row per registered player (all players shown, no top-N cutoff).
- Each row: player name (left, fixed-width, truncated with ellipsis on
  narrow screens) + horizontal bar (fills remaining width) + points value
  (right, or just past the bar end).
- Bar width is scaled relative to the **max points reached across all
  frames** (not just the current frame), so bar growth over time is
  meaningful.
- Bar color uses `--color-accent`; the row in 1st place for the current frame
  gets `--color-gold`, matching the existing rank-1 styling in the table.
- Frame label: "Start" for frame 0, then "Match N: Home vs Away" for
  subsequent frames.
- On mobile, rows stack full-width with the same name-column + bar + points
  layout; name column shrinks/truncates as needed.

## Animation mechanics (FLIP)

Each frame transition (700ms, `FRAME_DURATION_MS`):

1. **First** — read each row's current `getBoundingClientRect()`.
2. **Last** — update bar `width` and points text for the new frame
   (CSS `transition: width` handles the grow/shrink smoothly), then
   re-insert rows into the DOM in their new rank order.
3. **Invert + Play** — for each row, compute the delta between old and new
   position, apply it instantly as `transform: translateY(...)`, then on the
   next animation frame remove the transform with
   `transition: transform 700ms ease` — rows slide to their new slot while
   bars simultaneously resize.

Points text updates instantly (no count-up tween) — bar movement and growth
carry the "race" effect. `FRAME_DURATION_MS = 700` drives both the CSS
transition duration and the auto-play interval.

## Controls & edge cases

**Play/Pause:**
- "Play" starts a `setInterval` at `FRAME_DURATION_MS`, advancing
  `currentFrame` and rendering each tick.
- Reaching the last frame auto-stops and resets the button to "Play"; if
  already at the last frame, pressing "Play" again restarts from frame 0.
- "Pause" stops the interval, leaving the chart at the current frame.

**Scrubber** (range input, `0` to `frames.length - 1`):
- While dragging (`input` events), rows update **without transition**
  (instant) to avoid overlapping animations from rapid scrubbing.
- Dragging pauses auto-play if running; playback stays paused after release.

**Edge cases:**
- **No resolved matches:** `frames` contains only frame 0 (all players at
  0). Race view shows this static state with controls disabled and a note:
  "No matches resolved yet."
- **Ties:** points desc, then alphabetical — same tiebreak ordering as
  `/api/leaderboard`, so tied rows don't jitter for no reason.
- **Players with no votes in early matches:** included from frame 0 at 0
  points, same as `/api/leaderboard` initializes all registered users.

## Testing

- Extend `verify_points.js` (or add a small script) to assert
  `/api/leaderboard/history` produces correct cumulative snapshots for a
  sample sequence of resolved matches, including ties and a player with no
  early votes.
- Manual verification in browser: toggle Table/Race, play/pause/scrub on
  desktop and mobile viewport widths.
