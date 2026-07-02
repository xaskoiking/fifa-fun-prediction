# Design: Leaderboard Booster Column

**Date:** 2026-06-30
**Branch:** feat/remaining-boosters

## Summary

Add a "Booster" column to the main leaderboard table, immediately after the player's name. It shows a single ⚡ icon reflecting the status of that player's booster **for the current knockout round only**: bright ⚡ if their booster is still available for that round, dimmed/greyscale ⚡ if they've used it (applied it to a match whose kickoff has already passed). The column is blank for a player, and for everyone, when there is no active knockout round (still Group Stage, or the tournament has fully concluded).

A booster is only "used" once the specific match it was applied to has kicked off. If a player applied a booster to a match that hasn't started yet, they can still retract it — so the column continues to show it as available until kickoff.

---

## 1. Server (`server.js`)

**Endpoint:** `GET /api/leaderboard`

### 1a. Determine the current booster round

New helper, near `getMatchStageCode`/`getUserBoosterStatus`:

```js
function getCurrentBoosterStage(matches) {
  const order = ['LAST_32', 'LAST_16', 'QF_SF_FINAL'];
  for (const stageCode of order) {
    const stageMatches = matches.filter(m => getMatchStageCode(m) === stageCode);
    if (stageMatches.length === 0) continue; // bracket for this stage not created yet
    const hasUnresolved = stageMatches.some(m => m.status !== 'resolved');
    if (hasUnresolved) return stageCode;
  }
  return null; // nothing created yet, or every KO round is fully resolved
}
```

Walks the three booster buckets in tournament order. The first bucket that has matches and isn't fully resolved is "current." A bucket with zero matches (bracket not generated yet) is skipped, not treated as "current with nothing to do" — this naturally yields `null` before R32 exists, and again after the Final is resolved.

### 1b. Determine each player's booster status for that round

In the `GET /api/leaderboard` handler, after computing `liveMatches`/before building `standings` output:

```js
const currentBoosterStage = getCurrentBoosterStage(db.matches);
const currentStageMatches = currentBoosterStage
  ? db.matches.filter(m => getMatchStageCode(m) === currentBoosterStage)
  : [];
```

For each player (when building the final `leaderboard` array, alongside the existing `prevRank` pass), compute:

```js
function getPlayerBoosterState(name) {
  if (!currentBoosterStage) return null;
  const appliedMatch = currentStageMatches.find(m =>
    (m.boosters.home || []).includes(name) ||
    (m.boosters.away || []).includes(name) ||
    (m.boosters.draw || []).includes(name)
  );
  if (!appliedMatch) return 'available';
  const hasStarted = new Date(appliedMatch.kickoff) <= now;
  return hasStarted ? 'used' : 'available';
}
```

Add two fields to each leaderboard entry:
- `boosterStage: currentBoosterStage` (e.g. `'LAST_32'`, or `null`)
- `boosterStatus: getPlayerBoosterState(p.name)` (`'available'`, `'used'`, or `null`)

This reuses `ensureMatchBoosterData`/`getMatchStageCode` conventions already used elsewhere in `server.js` — no new persisted state, no `data.json` schema changes.

---

## 2. Client (`app.js`)

In `loadLeaderboard()`'s row-building code (where `col-name` etc. are assembled), add a new cell immediately after `col-name`:

```js
const boosterCell = renderBoosterCell(player.boosterStage, player.boosterStatus);
```

```js
function renderBoosterCell(stage, status) {
  if (!status) return '';
  const stageLabel = STAGE_LABELS_CLIENT[stage] || 'Booster'; // e.g. "R32 Booster"
  if (status === 'used') {
    return `<span title="${stageLabel} — Used" style="opacity:0.25; filter:grayscale(1);">⚡</span>`;
  }
  return `<span title="${stageLabel} — Available">⚡</span>`;
}
```

`STAGE_LABELS_CLIENT` mirrors the server's `STAGE_LABELS` (`LAST_32` → "R32 Booster", `LAST_16` → "R16 Booster", `QF_SF_FINAL` → "QF/SF/Final Booster") — add a small constant in `app.js` next to the existing header booster stage list (`app.js:336-340`) to avoid duplicating literal strings.

Row markup becomes:

```js
row.innerHTML = `
  <td class="col-rank">...</td>
  <td class="col-name">${escapeHtml(player.name)}</td>
  <td class="col-booster">${boosterCell}</td>
  <td class="col-predictions">...</td>
  ...
`;
```

---

## 3. HTML (`index.html`)

Add `<th class="col-booster">` right after the Name header (`index.html:146-157`):

```html
<th class="col-booster">
  <span class="th-full">Boost</span>
  <span class="th-short">⚡</span>
</th>
```

Column order (left → right): `#`, `Name`, **`Boost`**, `W/P`, `Acc`, `Moved`, `Pend`, `Points`

---

## 4. CSS (`style.css`)

### Desktop

```css
.col-booster { text-align: center; width: 50px; }
```

### Mobile (`@media (max-width: 600px)`)

Extend the existing mobile width table (`style.css:1872-1878`) to fit the new column, keeping columns summing to ~100%:

| Column | Width |
|--------|-------|
| `col-rank` | 8% |
| `col-name` | 24% |
| `col-booster` | 10% |
| `col-predictions` | 14% |
| `col-accuracy` | 10% |
| `col-moved` | 12% |
| `col-points` | 22% |

`col-pending` stays hidden on mobile as it already is today.

---

## Edge Cases

- **Before R32 bracket exists (Group Stage):** `getCurrentBoosterStage` returns `null` → `boosterStatus: null` for everyone → column renders blank for all rows, header still visible.
- **All KO rounds fully resolved (tournament over):** same as above — `null` for everyone.
- **Player applied booster, match hasn't kicked off:** `boosterStatus: 'available'` (bright ⚡) — matches the requirement that retractable boosters don't count as used.
- **Player applied booster, match has kicked off:** `boosterStatus: 'used'` (dimmed ⚡), regardless of whether the match is resolved yet.
- **Player never applied a booster for the current stage:** `'available'`.
- **Transition gap between rounds** (e.g. R32 fully resolved, R16 bracket not yet generated): `getCurrentBoosterStage` skips the empty R16 bucket, finds nothing else unresolved, returns `null` → column blank until R16 matches are created.

---

## Out of Scope

- Not changing the existing header booster widget (`updateBoosterDisplay` in `app.js`) or its current "applied counts as used" behavior — that's pre-existing behavior for a different UI element and is not part of this task.
- No changes to the Compare tab, Race view, or bracket page.
- No new admin controls — round detection is fully automatic from match data.
