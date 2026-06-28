# Knockout Bracket UI — Design

## Overview

Knockout-stage matches (`matchType: "KO"`, starting at Round of 32) move
out of the existing flat `matchesGrid` card list entirely and get two new,
dedicated tabs. The existing Predictions tab keeps its current UI
unchanged but narrows to group-stage matches only — it never needs to
branch into bracket rendering.

Three tabs altogether:

1. **Predictions tab (existing, narrowed)** — unchanged flat card grid,
   group-stage matches only. Hidden once the knockout stage opens (see
   "Navigation & Tab Visibility").
2. **New "Bracket" tab** — the real, scored knockout predictions, shown as
   a bracket tree. Scoring and the admin workflow are unchanged; this is a
   rendering/navigation upgrade for KO matches, just split into its own
   tab rather than living inside Predictions.
3. **New "Bracket Challenge" tab** — a separate, unscored feature letting a
   player fill out an entire speculative bracket (R32 → champion) in one
   sitting, independent of real-world results.

## Background / Current State

- `public/app.js:1649` `renderMatches()` builds the flat card grid (used by
  `#matchesGrid`, `public/index.html:69-81`). Per-card prediction buttons
  are rendered with `submitVote(matchId, prediction)`
  (`public/app.js:1955`). This function needs one new filter to exclude
  `matchType: 'KO'` matches going forward, since those move to the Bracket
  tab exclusively — it no longer needs its existing 2-vs-3-button KO
  branching once KO matches never reach it, though leaving that branch in
  place is harmless if removal turns out riskier than expected.
- No knockout matches exist in `data.json` yet. `matchType: 'KO'` is wired
  end-to-end but unused in practice.
- `TOURNAMENT_STAGES` (`server.js:1096-1104`) already enumerates
  `LAST_32 → LAST_16 → QUARTER_FINALS → SEMI_FINALS → FINAL` (plus
  `THIRD_PLACE`, out of scope here) and is used today only to label
  fixtures and gate the admin "Create Match" button per stage
  (`db.settings.openMatchStages`, `server.js:1111-1120`).
- `/api/admin/fixtures` (`server.js:1214`) pulls real fixtures from
  football-data.org, including future KO-stage fixtures whose teams are
  still `'TBD'` (`server.js:1250-1251`), tagged with `m.stage`. Admin uses
  this list to create real match records as the tournament unfolds — this
  is the natural place to assign the new bracket fields (below), since the
  fixture list already arrives ordered and stage-tagged.
- `/api/admin/resolve` (`server.js:989`) is where the admin sets a match's
  real `outcome`. This is the trigger point for bracket propagation in the
  Bracket tab (see "Propagation rules").
- `match.votes` / a player's own vote (used today for the "selected" button
  state, `public/app.js:~1691`) is what bracket personal-pick highlighting
  reads — no new field needed for that part.

## Navigation & Tab Visibility

All three tabs ship and go live simultaneously the moment this feature is
released — Bracket and Bracket Challenge are **not** gated behind any
tournament-stage check. Players want to explore and fill out Bracket
Challenge in advance, well before Round of 32 is actually determined; both
new tabs simply render the full TBD skeleton until real matches exist to
fill it in.

The only visibility rule needed is hiding the *old* Predictions tab once
it's no longer useful: once `LAST_32` appears in
`db.settings.openMatchStages` (the existing admin-controlled setting,
`server.js:1111-1120`/`/api/admin/settings`), group-stage voting is done
and the flat-grid tab is removed from the nav. No new admin control is
required — this reuses the stage toggle the admin already operates today.

## Data Model Changes

Two new optional fields on a match record, assigned when the admin creates
a KO-stage match (whether manually or from `/api/admin/fixtures`):

```js
{
  ...,
  bracketRound: 'LAST_32',   // one of TOURNAMENT_STAGES codes (LAST_32..FINAL)
  bracketSlot: 0,            // 0-indexed position within that round
}
```

This is sufficient to derive the whole tree computationally — no
`nextMatchId` pointers needed. Slot `i` in round `r`'s pair always feeds
slot `floor(i / 2)` in the next round. Round sizes are fixed by the format
(16 / 8 / 4 / 2 / 1), so the full skeleton — including rounds with no
match records yet — can be drawn from these two facts alone.

**Bracket Challenge** needs one new lightweight structure, since rounds
beyond R32 don't have real match records to vote on:

```js
// per player
bracketChallenge: {
  'LAST_16:0': 'home' | 'away',   // keyed by "round:slot"
  'LAST_16:1': ...,
  'QUARTER_FINALS:0': ...,
  ...
}
```

R32 entries are *not* duplicated here — the Bracket Challenge tab reads/
writes the player's existing real prediction (`match.votes`) for R32 slots,
since those matches are real and shared between both tabs. Only LAST_16
and beyond use this new structure.

## Propagation Rules (the key difference between the two tabs)

This is the part that needs to be precise, since it's the main behavioral
difference between the two tabs:

- **Bracket Challenge**: clicking a team fills the next round's slot
  **immediately, client-side**. It's the player's own speculative pick
  driving what shows next — no dependency on real-world results or on the
  admin having created anything.
- **Bracket tab**: a round's slot shows a real team name only once the
  admin **resolves** the match that feeds it (`/api/admin/resolve` sets a
  real `outcome`) — not when a player predicts, and not gated on the admin
  having created the *next* round's match record yet. The moment one
  feeding match resolves, that half of the next slot fills in with the
  real winner; the other half stays `TBD` until its sibling resolves too.
  Whether that next-round slot's predict buttons are interactive is a
  separate, independent gate — that still requires the admin to have
  actually created the real match record (with a kickoff time) the way it
  works today.

In short: in the Bracket tab, *displaying* a team name is driven by
resolved real outcomes; *being predictable* is still gated on the admin
creating that match record. These are two independent layers.

## Bracket Rendering — One Algorithm, Two Viewport Modes

Round 0 (R32) lays out as a fixed-height vertical stack (one row height per
match). Every later round's box sits at the vertical midpoint of its two
parent boxes' *current* y-positions. This single recursive rule produces
correct bracket geometry in both modes:

- **Wide viewport (desktop/tablet)**: evaluated once from R32 outward — the
  classic full tree, every round visible simultaneously, no paging needed.
- **Narrow viewport (mobile)**: not enough width to show every round at
  once. Round tabs at the top plus horizontal drag/swipe bring one round
  into "focus." The focused round re-tightens into its own compact stack
  (ignoring the proportional midpoint math, since its parents are
  off-screen anyway), and every round after it cascades into new midpoint
  positions — this is the "compaction" animation: compacting one round
  ripples forward through every later round automatically, because each
  round's position is always defined relative to its parent's *current*
  position, recomputed live.
- At any width, two full columns plus a sliver of a third round stay
  visible, with SVG connector lines from each match's right edge to the
  midpoint feeding the next round's box — matching the reference bracket
  apps (FotMob-style), not a both-sides-converging poster layout.
- Round tabs are present at all viewport sizes (harmless/convenient even
  on wide screens where everything already fits, doubling as a quick-jump
  control).

**Known rough edge, deferred to implementation**: in the interactive
prototype, connector lines redraw instantly rather than animating
alongside the boxes. Confirmed acceptable to fix during the real build —
likely by switching from raw SVG `path` redraws to small CSS-transitioned
div elbows that can interpolate like the boxes do.

## TBD Placeholders & Personal Pick Highlighting

- Any round/slot with no resolved feeding match renders `TBD` in place of
  a team name (per-row, not per-box — so a half-decided match shows one
  real name and one `TBD` correctly).
- In the Bracket tab, a completed match highlights whichever team the
  *current logged-in player* predicted (existing `match.votes` lookup), so
  their personal path through the bracket is visible at a glance.

## Out of Scope (v1)

- No scoring changes to the existing Predictions flow.
- No scoring for Bracket Challenge picks — personal/fun feature only;
  could be revisited later once it's proven popular.
- No "both sides converge to a center Final" poster layout — single
  left-to-right (or top-to-bottom, paged) flow per round, matching the
  FotMob-style reference rather than the original tournament-poster
  reference image.
- Pinch-zoom controls — not needed given the paged/cascade interaction
  model.

## Verification

- Manual pass through the interactive mockups already validated the core
  interaction (paging, cascade compaction, connector lines) —
  `.superpowers/brainstorm/mockups/bracket-paged-v3-cascade.html`.
- Once implemented: exercise all three tabs end-to-end —
  - Confirm Bracket and Bracket Challenge are visible immediately (no
    stage gating), showing a fully-TBD skeleton before any KO match exists.
  - Predictions: confirm it now only lists group-stage matches; confirm it
    disappears from the nav once admin adds `LAST_32` to `openMatchStages`.
  - Bracket: create a KO match via admin, confirm bracket skeleton shows
    correct TBD placeholders pre-creation, predict, resolve via
    `/api/admin/resolve`, confirm the next round's slot fills with the
    real winner and the player's own pick is highlighted.
  - Bracket Challenge: pick an R32 winner, confirm it's the same underlying
    pick as the Bracket tab; pick through LAST_16/QF/SF/Final, confirm
    instant client-side propagation and a champion can be reached.
  - Resize/narrow the viewport and confirm the round-tabs + cascade
    behavior kicks in; widen it and confirm the full tree renders without
    paging.
