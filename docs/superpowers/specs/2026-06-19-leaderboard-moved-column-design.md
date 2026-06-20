# Design: Leaderboard MOVED Column + Hide Mobile PEND

**Date:** 2026-06-19
**Branch:** feat/leaderboard/live-results

## Summary

Add a "Moved" column to the main leaderboard table showing each player's rank change since the last completed match. On mobile, hide the existing "Pend" (Not Yet Voted) column and show "Moved" instead — on desktop, both columns remain visible. In live mode, the "Moved" column shows the provisional rank change based on the current live score rather than the last completed match.

---

## 1. Server (`server.js`)

**Endpoint:** `GET /api/leaderboard`

After computing all standings and before sorting into `leaderboard`, compute `prevRank` for each player:

1. Call `buildLeaderboardHistory(db)` to get historical frames.
2. If `frames.length >= 2`, take `frames[frames.length - 2]` (the snapshot *before* the last resolved match).
3. Build a `Map<name, rank>` from that frame's `standings` array (index + 1 = rank).
4. For each entry in `leaderboard`, set `prevRank = prevRankMap.get(entry.name) ?? null`.
5. If `frames.length < 2` (no resolved matches yet), all players get `prevRank: null`.

The `prevRank` field is added to the existing player object — no schema changes to other fields.

---

## 2. Client (`app.js`)

### Non-live mode

`deltaRank = player.prevRank - currentRank`

- Positive → climbed
- Negative → dropped
- Zero → same
- `prevRank === null` → new player (no prior snapshot)

### Live mode

Live rank replaces the current rank in the sorted array (already sorted by `livePoints`). The baseline is rank sorted purely by `points` (no live delta):

1. Sort the raw leaderboard by `points` (same tiebreakers as server) → `baseRanks: Map<name, rank>`
2. For each player at live position `i`: `deltaRank = baseRanks.get(name) - (i + 1)`

If a player has no live delta (`provisionalDelta === 0`), their live rank equals base rank → `deltaRank = 0` → renders `—`.

### Rendering

Reuse existing compare-tab CSS classes:

| Condition | Display | Class |
|-----------|---------|-------|
| `prevRank === null` (non-live) | `NEW` | `move-new` |
| `deltaRank > 0` | `▲ N` | `move-up` |
| `deltaRank < 0` | `▼ N` (`Math.abs`) | `move-down` |
| `deltaRank === 0` | `—` | `move-same` |

Rendered as a `<td class="col-moved"><span class="move-*">…</span></td>`.

---

## 3. HTML (`index.html`)

Add `<th class="col-moved">` after `col-accuracy` and before `col-pending`:

```html
<th class="col-moved">
  <span class="th-full">Moved</span>
  <span class="th-short">Mvd</span>
</th>
```

The existing `col-pending` header requires no change — it is hidden on mobile via CSS only.

Column order (left → right): `#`, `Name`, `W/P`, `Acc`, **`Moved`**, `Pend`, `Points`

---

## 4. CSS (`style.css`)

### Desktop (default)

```css
.col-moved { text-align: center; width: 80px; }
```

Both `col-moved` and `col-pending` are visible on desktop.

### Mobile (`@media (max-width: 600px)`)

Within `#leaderboardTable`:

- `col-pending`: `display: none` — hides the Pend column entirely
- `col-moved`: `display: table-cell; width: 12%` — ensures it stays visible

Adjusted column widths to sum to ~100% (6 visible columns → rank, name, predictions, accuracy, moved, points):

| Column | Width |
|--------|-------|
| `col-rank` | 10% |
| `col-name` | 26% |
| `col-predictions` | 16% |
| `col-accuracy` | 12% |
| `col-moved` | 12% |
| `col-points` | 24% |

---

## Edge Cases

- **No resolved matches yet:** `buildLeaderboardHistory` returns 1 frame (the initial empty snapshot). All `prevRank` values are `null` → display `NEW` for everyone.
- **Player added after some matches:** `prevRankMap.get(name)` returns `undefined` → `null` → display `NEW`.
- **Live mode, no live matches active:** `isLiveMode` is `false`, client uses non-live path with `prevRank` from server.
- **Live mode, player has no live delta:** `deltaRank = 0` → displays `—`.

---

## Out of Scope

- The Compare tab is unchanged — it already has its own MOVED column.
- No changes to the Race or Climb views.
- The Pend column remains visible on desktop.
