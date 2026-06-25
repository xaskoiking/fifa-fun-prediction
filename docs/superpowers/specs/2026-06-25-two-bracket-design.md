# Two-Bracket Design: Fantasy Bracket + Prediction Bracket

**Date:** 2026-06-25
**Branch:** feat/ko-fixtures-bracket

---

## Overview

Two distinct bracket experiences exist side by side:

1. **Fantasy Bracket** — pick the entire KO tree once before R32 starts, locked permanently at first kickoff. Unscored. Accessed via a header button.
2. **Prediction Bracket** — live-updating bracket fed by real match data. Vote per-match until kickoff. Unchanged from current behaviour. Accessed via the existing tab button.

---

## 1. Data Model

### `db.fantasyBrackets`

New top-level key added to `data.json` alongside `matches`, `users`, `settings`, etc.

```json
{
  "Pradep": {
    "picks": {
      "LAST_32:0": "home",
      "LAST_32:1": "away",
      "LAST_16:0": "home"
    }
  }
}
```

- Key: username string (matches `db.users[].name`)
- `picks`: map of `"roundCode:slot"` → `"home" | "away"`
- Full bracket = 31 picks: 16 (LAST_32) + 8 (LAST_16) + 4 (QUARTER_FINALS) + 2 (SEMI_FINALS) + 1 (FINAL)
- Absent key = no bracket started yet
- Partial bracket is valid (saved progressively)

### Lock Condition

Evaluated server-side on every fantasy bracket API call:

```
locked = db.matches.some(m => m.bracketRound === 'LAST_32' && new Date(m.kickoff) <= new Date())
```

No admin action required — automatic and time-based.

---

## 2. API

### `GET /api/fantasy-bracket`

Auth: requires valid `x-user-secret` header (same as all other user endpoints).

Response:
```json
{
  "locked": false,
  "picks": { "LAST_32:0": "home" },
  "r32Matches": [
    { "bracketSlot": 0, "homeTeam": "Mexico", "awayTeam": "South Africa", "kickoff": "..." },
    ...
  ]
}
```

- `r32Matches`: all admin-created matches with `bracketRound === 'LAST_32'`, ordered by `bracketSlot`. Slots with no match yet are absent (client renders TBD).
- `picks`: current user's picks (empty object if none).

### `POST /api/fantasy-bracket/pick`

Auth: requires valid `x-user-secret` header.

Request body:
```json
{ "roundCode": "LAST_32", "slot": 0, "side": "home" }
```

Validation:
- `roundCode` must be a valid bracket round code
- `slot` must be an integer within range for that round
- `side` must be `"home"` or `"away"`
- Rejected with 403 if locked

Response:
```json
{ "ok": true, "picks": { "LAST_32:0": "home" } }
```

Returns full updated picks object after save.

---

## 3. Fantasy Bracket Rendering Logic

### New file: `public/fantasy-bracket.js`

Shares layout constants from `bracket.js` (both loaded on the page): `BRACKET_ROUNDS`, `BRACKET_CARD_W`, `BRACKET_CARD_H`, `BRACKET_GAP`, `BRACKET_ROW_H`, `BRACKET_COL_GAP`, `BRACKET_COL_PITCH`, `BRACKET_HEADER_H`, `BRACKET_LEFT_PAD`, `BRACKET_BOTTOM_PAD`, `computeBracketPositions`, `isBracketDesktop`, etc.

#### `buildFantasyBracketRounds(r32Matches, picks, roundDefs)`

Builds round data for rendering:

- **LAST_32:** `homeTeam`/`awayTeam` come from real `r32Matches` keyed by `bracketSlot`. Slots with no match → `TBD`/`TBD`.
- **LAST_16 and beyond:** teams derived from user picks:
  - Slot `i` home = winner of parent slot `i*2` per user's pick (or `TBD` if no pick yet)
  - Slot `i` away = winner of parent slot `i*2+1` per user's pick (or `TBD` if no pick yet)
- Propagation is pure/deterministic — re-derived fresh from picks on every render.

#### Forward propagation

Picking a winner in round R immediately makes that team appear as one of the two teams in the corresponding slot in round R+1. Once both parent slots in R are picked, the R+1 slot becomes clickable.

#### Cascade clear on upstream change

Handled server-side atomically within `POST /api/fantasy-bracket/pick`. When a pick at `(roundCode, slot)` is saved, the server traverses forward through the bracket and deletes any stored picks that depended on that slot:
- R+1 slot `floor(slot/2)` is cleared, then its R+2 dependent `floor(slot/4)`, and so on up to `FINAL:0`.

The response returns the full updated picks object (with cleared entries removed), which the client uses to re-render. No separate client-side clearing required.

#### Card row states

| State | Condition | Behaviour |
|---|---|---|
| TBD | team string is `"TBD"` | greyed out, not clickable |
| Pickable | team known, no pick yet, not locked | clickable, hover highlight |
| Picked | `picks["roundCode:slot"] === side` | `.fantasy-pick` highlight (amber/gold) |
| Locked | `locked === true` | all click handlers removed, picks shown as static highlights |

#### `renderFantasyBracket(container, rounds, picks, locked, onPick)`

Same DOM structure as `renderBracket` in `bracket.js` (scrollwrap → track → cards + SVG connectors). Reuses `goToBracketRound`, `wireBracketDrag`, `debounceBracketScroll`, `drawBracketConnectors`, `applyBracketPositions`. Fantasy-specific: different card CSS class (`bracket-card--fantasy`), `.fantasy-pick` highlight class.

Progress counter: `Object.keys(picks).length` / 31, shown in modal header.

---

## 4. UI / UX

### Header Button

**Placement:** standalone `<button id="fantasyBracketBtn">` added as a flex sibling inside `.header-main`, between `.logo-area` and `#userStatusArea`. Only visible once a username is set.

**Desktop (≥601px):** `⭐ Fantasy Bracket`
**Mobile (≤600px):** `⭐` (emoji only, no text)

**Locked state:** 🔒 badge/suffix appears on the button: `⭐ Fantasy Bracket 🔒` / `⭐🔒`

### Fantasy Bracket Modal

Opens as a full-screen overlay on top of the existing app. Tab nav and content remain underneath.

**Modal header row:**
- Title: `⭐ Fantasy Bracket`
- Progress counter: `X / 31 picks made` (or `X / 31 complete 🔒` when locked)
- Close button (top right)

**Modal body:** the fantasy bracket (same scrollable column-nav layout, prev/next buttons, same card dimensions as prediction bracket). Cards use amber/gold `.fantasy-pick` accent instead of the prediction bracket's green.

**Locked + incomplete:** remaining TBD slots shown greyed, lock message in header: `Bracket locked — X / 31 complete`.

### Prediction Bracket

No changes. Tab button stays in tab nav, behaviour identical to current implementation.

### Admin

No admin changes needed. Lock is automatic (time-based). R32 teams flow from existing KO match creation.

---

## 5. Files Changed

| File | Change |
|---|---|
| `server.js` | `ensureFantasyBrackets()` migration, `isFantasyLocked()` helper, `GET /api/fantasy-bracket`, `POST /api/fantasy-bracket/pick` |
| `public/fantasy-bracket.js` | New file — `buildFantasyBracketRounds`, `renderFantasyBracket`, cascade clear logic |
| `public/app.js` | Fantasy bracket button, modal open/close, `openFantasyBracket()`, `saveFantasyPick()` |
| `public/index.html` | Fantasy bracket button in `header-main`, modal overlay HTML |
| `public/style.css` | Header button styles (responsive), modal overlay, `.fantasy-pick` accent, `bracket-card--fantasy` |

---

## 6. Out of Scope

- Scoring the fantasy bracket (explicitly unscored)
- Leaderboard for fantasy bracket
- Admin visibility into user fantasy brackets
- Fantasy bracket for League stage matches
