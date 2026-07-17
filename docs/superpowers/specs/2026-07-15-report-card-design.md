# Report Card — Design Spec

**Date:** 2026-07-15
**Branch:** feat/add-report-card
**Status:** Approved

---

## Problem

There's no single place to see a player's entire tournament: every one of the 104 matches they picked, how many points each earned, their rank trajectory, and their prediction streaks. The existing "Reports" sub-tab (`public/index.html:232-238`, `public/app.js:594-926`) only shows aggregate/leaderboard-wide views (Hall of Fame, Journey, Streaks top-10, Daily winners) — nothing per-player. `renderResults()` (`public/app.js:2018-2194`) shows all matches with a "Your Pick" column, but only for the logged-in user, not for viewing anyone else's card. There's also no profile photo, no fun "title" per player, and no shareable single-image summary.

## Goals

1. A **Report Card** view, in a new top-level tab, for any one player at a time (default: yourself), viewable by any logged-in user for any player — same transparency the app already has for picks.
2. Full 104-match table for that player: match, stage, kickoff, result, their pick, points earned. Sortable chronologically (default) or by points earned.
3. Stats header: current rank, highest rank ever achieved, current streak, best streak ever, accuracy %, total points.
4. Optional profile photo, self-uploaded.
5. Optional fun AI-generated title (e.g. "Risk Taker") with a short reason, generated **offline** (not called from the running app) and imported by the admin.
6. A "Download Card" button that exports a condensed shareable image (photo + title + stats) via `html2canvas`, matching the existing `saveLeaderboardImage()` pattern (`public/app.js:942-969`).

## Out of Scope

- No change to scoring rules (`calculatePointsForMatch`, `calculateBonusPointsForMatch`, `server.js:306-357`).
- No live Claude/Anthropic API call from the server — titles are generated in an offline Claude conversation and imported as static data.
- No per-user privacy toggle — all report cards are visible to all logged-in users, consistent with existing full vote-log visibility.
- No server-side image resizing (no `sharp`/`canvas` dependency) — photos are stored as uploaded, displayed at a fixed CSS size.
- No editing of past titles/photos by anyone other than the photo's own user (self) or admin (titles import only).

---

## Design

### 1. Data model changes (`data.json`, `users[name]`)

Add three optional fields to each user record:
```js
{
  name, secret, isAdmin,           // existing
  photoUrl: "photos/raag.jpg",     // new — relative path, undefined until uploaded
  title: "Risk Taker",             // new — undefined until imported
  titleReason: "Boosted 9 of 12 knockout picks..." // new — short reason, shown as a tooltip
}
```
No migration needed — reads default to `undefined`/falsy and render as empty/placeholder.

### 2. Shared rank/streak/accuracy computation (`server.js`)

Extract one new helper, `computePlayerReportStats(db, name)`, built on the existing `buildLeaderboardHistory(db)` (`server.js:361-~420`), reusing the exact math already used client-side so numbers never disagree across views:

- **Frames → ranks:** for each frame, sort `standings` (already sorted desc by points/correct) and take `index + 1` as that player's rank in that frame — same approach `renderComparison()` already uses client-side (`public/app.js:1223-1297`).
- **Current rank:** rank in the last frame (falls back to unranked/`null` if the player has no resolved matches yet).
- **Highest rank ever:** `Math.min` of rank across all frames.
- **Streak (current + best):** walk frames in order; a "hit" is when that player's cumulative `points` increased from the previous frame — the same definition `renderStreaks()` already uses (`public/app.js:613-641`). Track the running length for `current` (reset to 0 on a non-hit, but don't reset at a "no vote" match the same way the existing streak logic doesn't) and the max length seen for `best`.
- **Accuracy %:** `correct / totalPredictions` from the same standings entry used by `GET /api/leaderboard` (`server.js:709-859`).

This helper is server-only; no new client math is needed beyond rendering.

### 3. `GET /api/report-card/:name` (new endpoint, `server.js`)

Auth: any valid `x-user-secret` (existing `authenticateSecret`, `server.js:429-442`) may request any `:name` — no admin check, matching the "visible to everyone" decision.

Response shape:
```js
{
  name, photoUrl, title, titleReason,
  stats: { totalPoints, accuracy, currentRank, highestRank, currentStreak, bestStreak },
  matches: [
    {
      matchNumber, group, stage, homeTeam, awayTeam, kickoff, status,
      outcome, decidedBy,          // null until resolved
      pick,                        // this player's vote, or null
      boosted, bonusPick,          // booleans/enum, mirrors existing myBooster/myBonusPick shape
      points                       // this player's points earned on this match (0 if none/unresolved)
    },
    ...  // all matches, chronological by kickoff
  ]
}
```
Per-match `points` reuses `calculatePointsForMatch` / `calculateBonusPointsForMatch` exactly as `GET /api/leaderboard` does today, just attributed to one player instead of summed across all players. If `name` doesn't exist in `db.users`, respond 404.

### 4. Photo upload

- **Dependency:** add `multer` to `package.json` for multipart form handling.
- **`POST /api/profile/photo`** — authenticated via `x-user-secret`; a user may only upload their *own* photo (the target name is derived from the authenticated secret, not a request param, so there's no path to overwrite someone else's photo without their secret).
- Accepts `image/jpeg`, `image/png`, `image/webp`; rejects other types; max 5MB (multer `limits.fileSize`).
- **Storage abstraction**, mirroring the existing GCS/local split for `data.json` (`server.js:8-20`, `226-251`):
  - If `GCS_BUCKET_NAME` is set: write to `gs://<bucket>/photos/<safeName>.<ext>`.
  - Else: write to `public/uploads/photos/<safeName>.<ext>` on local disk.
  - `safeName` = the player's name, lowercased, non-alphanumerics stripped (avoids path traversal / weird filenames).
- On success, set `users[name].photoUrl = "photos/<safeName>.<ext>?v=<timestamp>"` (query-string cache-bust) and persist via the existing `saveData()` path.
- **`GET /photos/:file`** — new route: streams from GCS if configured, else serves from the local `public/uploads/photos/` directory (Express static-like behavior, but routed explicitly so the same URL works in both storage modes).

### 5. Frontend — Report Card tab (`public/index.html`, `public/app.js`)

- New top-level nav tab "Report Card" alongside existing tabs, following the same pattern as other top-level tab wiring already in `index.html`/`app.js`.
- **Player picker:** a `<select>` of all `db.users` names (from the already-available users list), defaulting to the logged-in user's own name. Changing it re-fetches `GET /api/report-card/:name`.
- **Header panel** (`#reportCardHeader`): photo (`<img>` pointed at `photoUrl`, or a placeholder silhouette graphic if absent), name, `title` + `titleReason` as a tooltip/subtitle if present, and a stats row: Total Points, Accuracy, Current Rank, Highest Rank, Current Streak, Best Streak.
- **Match table** (`#reportCardTable`): one row per match — Match #, Matchup, Stage, Kickoff, Result, Your Pick (reusing the same label formatting `renderResults()` already builds for pick/points/booster/bonus display, generalized to work off the report-card payload instead of `/api/matches`), Points. Default sort: chronological by kickoff. A "Sort by points" toggle re-sorts descending by the `points` field (client-side array sort, no re-fetch).
- **Self-upload control:** only rendered when viewing your *own* card — a file input + "Upload Photo" button posting to `/api/profile/photo`, then re-fetching the report card to show the new image.
- **Download Card button:** calls `html2canvas` on `#reportCardHeader` only (not the match table), same options as `saveLeaderboardImage()` (`backgroundColor`, `scale: 2`, `useCORS: true`), then triggers a PNG download — condensed image per the approved design, not all 104 rows.

### 6. Offline AI titling workflow

No Anthropic API key or SDK in the app. Instead:

1. **`GET /api/admin/report-card-stats-export`** (admin-only, existing `verifyAdmin` check) — returns a JSON array, one entry per user, with the inputs a human (or Claude, pasted into a chat) needs to write a title: accuracy %, total points, current/best streak, highest rank, booster-usage rate, bonus-pick tendency (how often they picked Extra Time/Penalties vs Reg Time), and rank trajectory (first/last/min rank). This reuses `computePlayerReportStats` for every user plus a couple of extra aggregates not needed by the per-player endpoint.
2. Admin downloads that JSON, pastes it into a Claude conversation, asks for a title + one-line reason per player, and gets back `{ "Name": { "title": "...", "reason": "..." }, ... }`.
3. **`POST /api/admin/titles/import`** (admin-only) — accepts that JSON shape, merges `title`/`titleReason` into the matching `users[name]` entries (unknown names ignored, matched case-sensitively against existing user names), persists via `saveData()`. Re-importing overwrites only the names present in the payload; other users' titles are untouched.
4. Both are wired into the existing admin panel as a small "Report Card Titles" section: a "Download Stats for Titling" button and a JSON file/textarea "Import Titles" control.

---

## Testing

Manual trace (per project convention — no local server spin-up, code review + diff checks):

- Verify `computePlayerReportStats` against a hand-traced example: pick 2-3 players from the current `data.json`, manually replay a few `buildLeaderboardHistory` frames, and confirm current rank / highest rank / streaks match what the code produces.
- Verify `GET /api/report-card/:name` per-match `points` sum equals the player's `totalPoints` from `GET /api/leaderboard` for the same player (cross-check against already-trusted leaderboard math).
- Verify photo upload path selection (GCS vs local) matches whichever mode `data.json` persistence is currently using, and that `safeName` sanitization rejects/normalizes an adversarial name like `"../../etc"` or `"a/b"`.
- Verify a user cannot upload a photo for another user (no `name` param honored — always derived from `x-user-secret`).
- Verify titles import is idempotent and doesn't clobber users omitted from a partial re-import.
- Verify the sort-by-points toggle on the match table produces a stable, correct descending order including ties and unresolved (0-point) matches.
