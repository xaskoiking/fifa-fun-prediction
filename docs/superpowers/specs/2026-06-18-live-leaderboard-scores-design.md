# Live Leaderboard Scores — Design Spec

**Date:** 2026-06-18  
**Branch:** feat/leaderboard/live-results  
**Status:** Approved

---

## Goal

Show provisional leaderboard standings based on live scores from football-data.org, updating every minute, until an admin manually resolves each match. Display a live match info panel in the leaderboard UI so players can see which matches are driving the provisional standings.

---

## Architecture

```
football-data.org API
        ↓  every 60 s (background setInterval in startServer)
_liveScoresCache  ←  in-memory module-level array
        ↓
/api/leaderboard   →  confirmed pts (resolved) + livePoints / provisionalDelta (live)
/api/live-matches  →  public; matched live matches with current scores
        ↓
Frontend leaderboard table
  - live match info panel (scores + status per match)
  - pulsing LIVE banner
  - table sorted by livePoints in live mode
  - "+N" amber badge per player for provisional gain
```

---

## Backend

### 1. Background poller

Added to `startServer()` in `server.js`:

- `pollLiveScores()` is called once at startup, then every 60 s via `setInterval`
- Fetches `https://api.football-data.org/v4/competitions/WC/matches` (same endpoint as `/api/admin/fixtures`, same API key `FOOTBALL_DATA_API_KEY`)
- Filters the response to matches with `status` of `IN_PLAY`, `PAUSED`, or `FINISHED`
- Stores results in `_liveScoresCache`: array of `{ homeTeam, awayTeam, scoreHome, scoreAway, status }`
- If the API call fails or the key is absent, the previous cache is left intact (graceful degradation — no error is surfaced to users)
- Rate budget: 1 request per 60 s, well within the free-tier limit of 10 req/min

```js
let _liveScoresCache = [];

async function pollLiveScores() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': apiKey }
    });
    if (!res.ok) return;
    const data = await res.json();
    const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);
    _liveScoresCache = (data.matches || [])
      .filter(m => LIVE_STATUSES.has(m.status))
      .map(m => {
        const ft = (m.score || {}).fullTime || {};
        return {
          homeTeam: m.homeTeam?.name || '',
          awayTeam: m.awayTeam?.name || '',
          scoreHome: ft.home ?? null,
          scoreAway: ft.away ?? null,
          status: m.status
        };
      });
  } catch (err) {
    console.error('[LIVE] Poll failed:', err.message);
  }
}
```

### 2. Match matching

When enriching leaderboard data, for each **unresolved** internal match:

- Normalize both sides: `trim().toLowerCase()`
- Look for a cache entry where normalized `homeTeam` and `awayTeam` both match
- A null score on either side (e.g. match only just kicked off) means no provisional points are added for that match

### 3. Provisional outcome logic

Given a matched live score for an unresolved match:

| Score condition | Provisional outcome |
|---|---|
| `scoreHome > scoreAway` | `'home'` |
| `scoreAway > scoreHome` | `'away'` |
| `scoreHome === scoreAway` | `'draw'` |

Run `calculatePointsForMatch(match.votes, provisionalOutcome, match.matchType)` — the existing function, unchanged. For KO matches tied 0–0 or 1–1, no draw voters exist so nobody gains points (correct behaviour for provisional KO standing).

### 4. Enriched `/api/leaderboard`

The existing endpoint is extended (backwards-compatible — all existing fields are unchanged):

- Confirmed `points`, `correct`, `totalPredictions`, `liveNotVoted` computed exactly as today
- Additional loop over unresolved internal matches with a live score match: accumulates `provisionalPoints` per player
- Each player entry gains two new fields:
  - `livePoints`: `points + provisionalPoints`
  - `provisionalDelta`: `provisionalPoints` (0 if no live matches affect this player)
- Sort order remains by `points` (confirmed) — frontend handles live-mode sort client-side to keep the existing consumer contract

No auth change — the endpoint remains public.

### 5. New `/api/live-matches` (public, no auth)

Returns the subset of `_liveScoresCache` that matched at least one unresolved internal match:

```json
[
  {
    "homeTeam": "England",
    "awayTeam": "France",
    "scoreHome": 2,
    "scoreAway": 1,
    "status": "IN_PLAY"
  }
]
```

Returns `[]` when no live matches are active. Never returns an error — always succeeds.

---

## Frontend

### Live match info panel

Rendered above the leaderboard table when `/api/live-matches` returns at least one match. One row per match:

```
🔴 England   2 — 1   France      · IN PLAY
⬜ Brazil    0 — 0   Argentina   · FINISHED
```

- `IN_PLAY` / `PAUSED`: pulsing red dot (`🔴`), text label in red
- `FINISHED`: neutral dot (`⬜`), gray label — "waiting for admin to resolve"
- Score rendered in a larger/bolder font between the two team names

### LIVE banner

Shown above the match info panel when live mode is active:

> `⚡ LIVE · provisional standings · may change as matches progress`

Pulsing amber border or highlight on the leaderboard card container.

### Leaderboard table

When `livePoints !== points` for any player (i.e. at least one provisional delta exists):

- Table sorted by `livePoints` descending (same tiebreakers as today: correct, then name)
- Column header "Total Points" → "Points (Live)"
- Points cell per player:
  - Confirmed points displayed normally
  - If `provisionalDelta > 0`: `+N` badge in amber appended inline (e.g. `12 pts +3⚡`)
  - If `provisionalDelta === 0`: points shown normally, no badge

When no live matches are active, the leaderboard renders exactly as today — no UI change.

### Polling

No change to polling cadence. `loadDashboardData` already runs every 10 s. When the leaderboard tab is active, both `/api/leaderboard` and `/api/live-matches` are fetched on each cycle.

### Unaffected views

Race chart, Compare, and Climb views continue using `/api/leaderboard/history` (confirmed-only historical snapshots). No changes to those views.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| `FOOTBALL_DATA_API_KEY` not set | Poller no-ops silently; leaderboard returns confirmed points only; no live panel shown |
| API call fails / rate-limited | Previous `_liveScoresCache` retained; UI continues showing last known live data |
| Team name mismatch (internal vs API) | Match silently skipped; no provisional points added for that match |
| `/api/live-matches` called before first poll | Returns `[]`; no live panel shown |

---

## Out of scope

- Storing live scores persistently (GCS / disk)
- Showing live scores in the race/compare/climb charts
- Auto-resolving matches from live scores (admin resolve remains manual)
- Any UI changes outside the leaderboard table view
