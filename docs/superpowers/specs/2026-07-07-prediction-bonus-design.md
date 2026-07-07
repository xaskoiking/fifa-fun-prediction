# Prediction Bonus (Reg Time / Extra Time / Penalties) — Design Spec

**Date:** 2026-07-07
**Branch:** feat/add-pred-bonus
**Status:** Approved

---

## Problem

For knockout matches from Quarter-finals onward (including the 3rd Place playoff), there's no way for users to predict *how* a match will be decided (regular time, extra time, or penalties). We want to add a bonus scoring mechanic on top of the existing team-pick scoring for these matches, to reward users who correctly call the outcome method as well as the winning team.

---

## Goals

1. Let users pick one of **Reg Time / Extra Time / Penalties** when confirming a prediction on a QF+ (and 3rd place) match — a mandatory 3-way toggle, defaulting to "Reg Time".
2. Award bonus points based on whether that pick matches how the match was actually decided, and whether the team pick was also correct:
   - Bonus pick correct, team pick wrong → **+5**
   - Bonus pick correct, team pick also correct → **+10 total** (not additive with the +5 case)
   - Bonus pick wrong → **+0**, regardless of team pick
   - Max bonus per match: **10**
3. Bonus points are **never** multiplied by the booster — only the existing team-pick points are.
4. Fold bonus points into the same total as team-pick points everywhere a total is shown (leaderboard, live/provisional scoring) — no separate breakdown there.
5. In the **Past Results** table:
   - Extend the existing "Your Pick" column to show the bonus contribution when relevant.
   - Add a new **"Bonus"** column (QF+ matches only) showing the three groups (Reg Time / Extra Time / Penalties) and who picked each, with the correct group highlighted — mirroring the existing "Group Votes Distribution" column's style.
6. Extend booster eligibility to include the 3rd Place match (currently a gap — it falls through to a matchNumber heuristic), so both booster and bonus share one stage-eligibility check.
7. Admin can record how a QF+ match was decided when resolving it, via inline buttons next to the existing resolve buttons.

## Out of Scope

- Any change to the core pari-mutuel team-pick point formula (`calculatePointsForMatch`).
- Fantasy bracket (`fantasy-bracket.js`) — untouched.
- Retroactive bonus for already-resolved matches (feature applies going forward only).
- Bonus eligibility for Group Stage / R32 / R16 matches.

---

## Example (from requirements discussion)

England vs Mexico. User A picks England + Extra Time, and used a booster. Vote split: 5 Mexico, 7 England (12 total voters excluding self... treat as given).

| Actual result | User A's points | Why |
|---|---|---|
| Mexico wins, Reg Time or Penalties | 0 | Team wrong, bonus wrong |
| Mexico wins, Extra Time | 5 | Team wrong, bonus right → +5 |
| England wins, Reg Time or Penalties | 12 | Team right: (5+1)×2 booster = 12. Bonus wrong → +0 |
| England wins, Extra Time | 22 | Team right: 12 (as above). Bonus right AND team right → +10. Total 12+10=22 |

---

## Architecture

### Stage eligibility (shared by booster + bonus)

Fix `getMatchStageCode()` (server.js:1287-1349) so the `QF_SF_FINAL` bucket explicitly includes `THIRD_PLACE`:
- Add `THIRD_PLACE` to the `bracketRound` include-list at server.js:1331.
- Extend the regex fallback at server.js:1338 to also match "third place" / "3rd place".

This is a bug fix to existing booster-eligibility logic (3rd place currently relies on a fragile matchNumber-range heuristic) and becomes the single source of truth both features use: `getMatchStageCode(match) === 'QF_SF_FINAL'`.

### Data model additions

On a match object:

```js
match.decidedBy   // 'REGULAR' | 'EXTRA_TIME' | 'PENALTIES' | null
                   // set by admin alongside `outcome` in POST /api/admin/resolve
                   // cleared alongside `outcome` in POST /api/admin/unresolve

match.bonusPicks  // { [username]: 'REGULAR' | 'EXTRA_TIME' | 'PENALTIES' }
                   // one entry per user who has predicted on this match
                   // only meaningful when getMatchStageCode(match) === 'QF_SF_FINAL'
```

`bonusPicks` is a flat `{username: choice}` map rather than mirroring the `votes`/`boosters` array-per-outcome shape used elsewhere. Those arrays exist because the team-pick point formula needs to *count* voters per outcome (pari-mutuel). Bonus points don't depend on crowd size — a direct per-user lookup is simpler and sufficient.

A new helper `ensureMatchBonusData(match)` (analogous to `ensureMatchBoosterData()`, server.js:1351-1362) normalizes `match.bonusPicks` to `{}` if missing, called wherever `ensureMatchBoosterData` is currently called.

### Scoring logic

New function, kept separate from `calculatePointsForMatch`:

```js
function calculateBonusPointsForMatch(match) {
  // returns { username: bonusPoints }
  if (getMatchStageCode(match) !== 'QF_SF_FINAL' || !match.decidedBy) return {};

  const result = {};
  for (const [username, pick] of Object.entries(match.bonusPicks || {})) {
    const correctBonus = pick === match.decidedBy;
    const correctTeam = match.outcome && (match.votes[match.outcome] || []).includes(username);
    result[username] = correctBonus && correctTeam ? 10
                      : correctBonus ? 5
                      : 0;
  }
  return result;
}
```

Kept as a separate function (rather than extending `calculatePointsForMatch`'s signature/return shape) to avoid restructuring a function with 3 existing call sites, and because it has fundamentally different inputs (no crowd counting).

**Call sites — add bonus into the same total, no separate exposure:**
- `buildLeaderboardHistory()` (server.js:339-399)
- `GET /api/leaderboard` (server.js:663+)
- Live provisional scoring path (server.js:742)

At each site: `total[username] = (teamPoints[username] || 0) + (bonusPoints[username] || 0)`.

### Past Results display (app.js `renderResults()`, ~line 1982+)

**"Your Pick" column (app.js:2031-2059):** extend the correct/incorrect text to include bonus when it applies:
- Team correct + bonus correct: `🎉 England (+12 · booster x2, +10 bonus)`
- Team correct + bonus wrong: unchanged, `🎉 England (+12 · booster x2)`
- Team wrong + bonus correct: `❌ England (+5 bonus)`
- Team wrong + bonus wrong: unchanged, `❌ England`

**New "Bonus" column** (header in index.html, after the existing `col-votes` header at index.html:117; cell after app.js:2104-2106): only for `getMatchStageCode(match) === 'QF_SF_FINAL'` matches, otherwise `—`. Built by inverting `match.bonusPicks` into three username lists (`REGULAR`, `EXTRA_TIME`, `PENALTIES`) and rendering them in the same style as the existing vote-distribution column, highlighting the group matching `match.decidedBy` in green/bold (same convention as the winning team today):

```
Reg Time (n): name1, name2
Extra Time (n): name3          ← highlighted if decidedBy === 'EXTRA_TIME'
Penalties (n): name4, name5
```

### Prediction confirm modal (`#voteConfirmModal`, index.html:714-741)

Add a new section below/alongside the existing booster checkbox section: a 3-button segmented control (Reg Time / Extra Time / Penalties), single-select (one carries a `selected`-style class, following the same visual pattern as the existing `.predict-btn` home/draw/away buttons at app.js:1818-1832). Shown only when `getMatchStageCode(match) === 'QF_SF_FINAL'`; "Reg Time" pre-selected by default.

- `submitVote()` (app.js:2162-2200): show/hide this section alongside the existing booster-section logic; pre-select "Reg Time" (or the user's existing `bonusPicks` entry, if re-opening the modal to change a prior pick).
- `confirmVote()` (app.js:2210-2251): read the selected segment, include as `bonusPick` in the `POST /api/predict` body. No extra client validation needed — a segment is always selected by default.

### Admin resolve UI (`resolveMatch()`, app.js:2693-2722; row markup app.js:2573-2582)

Add a 3-button segmented control (Reg / ET / Pens, default "Reg Time") next to the existing resolve buttons, visible only when the match is unresolved and `getMatchStageCode(match) === 'QF_SF_FINAL'`. `resolveMatch(matchId, outcome)` reads the currently selected segment and includes it as `decidedBy` in the `POST /api/admin/resolve` body.

### API changes

- **`POST /api/predict`** (server.js:564-660): accept `bonusPick` in body. When `getMatchStageCode(match) === 'QF_SF_FINAL'`, require it (400 if missing/invalid). Store into `match.bonusPicks[username]`. Follows the same removal/re-add pattern already used for `votes`/`boosters` when a user changes their prediction — except `bonusPicks` is keyed by username directly, so it's just an assignment, not an array move.
- **`POST /api/admin/resolve`** (server.js:1154-1185): accept `decidedBy`. When bonus-eligible, require it (400 if missing/invalid). Store into `match.decidedBy`.
- **`POST /api/admin/unresolve`** (server.js:1188-1208): clear `match.decidedBy` back to `null` alongside `outcome`.

---

## Testing

- Unit-level verification of `calculateBonusPointsForMatch` against the 4 rows of the England/Mexico example table above, plus: no `decidedBy` set (should return `{}`), non-QF+ stage (should return `{}`), user with no `bonusPicks` entry (should be absent from result / treated as 0).
- `getMatchStageCode` fix: verify a 3rd-place match (by `bracketRound: 'THIRD_PLACE'` and by group-text fallback) now resolves to `'QF_SF_FINAL'`, and that this doesn't change classification for any other existing stage.
- API validation: `POST /api/predict` rejects missing/invalid `bonusPick` on bonus-eligible matches; accepts and ignores it on non-eligible matches. Same pattern for `decidedBy` on resolve.
- Manual verification (per project convention — no local server spin-up expected, review via diff/deploy): confirm modal shows/hides the toggle correctly per stage, admin inline buttons appear only for QF+/3rd place, Past Results renders the new column and updated "Your Pick" text correctly for resolved bonus-eligible matches.
