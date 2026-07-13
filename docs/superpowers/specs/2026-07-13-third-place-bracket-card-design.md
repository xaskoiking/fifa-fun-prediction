# Third Place Card in Bracket — Design

## Problem

The backend already supports a `THIRD_PLACE` bracket round (`server.js` `TOURNAMENT_STAGES` / `BRACKET_ROUND_SIZES`), and an admin can create a match with `bracketRound: "THIRD_PLACE", bracketSlot: 0` today. But `public/bracket.js`'s `BRACKET_ROUNDS` list (used by `renderBracketTab`) never includes `THIRD_PLACE`, so such a match has no visual home in the bracket — it's invisible in the UI even once created.

## Goal

Show a third place game card in the real prediction Bracket tab, positioned directly below the Final card, labeled "Third Place Game". No connector lines to/from it. Shows `TBD` vs `TBD` until an admin creates the match; once created it appears automatically (same poll-driven refresh as every other match).

Out of scope: the Fantasy Bracket modal (pre-tournament pick-the-winner game) does not get a third place slot — there's no existing mechanism there for predicting who plays in it.

## Approach

Keep `BRACKET_ROUNDS` (the R32→Final tree used for `computeBracketPositions` / connector math) untouched, so nothing about the existing tree layout changes. The third place card is a separate, independently-positioned card anchored to the Final column, not a tree round.

- `buildBracketRounds(matches, roundDefs)` additionally builds one `thirdPlace` slot object (same shape as any other slot: `{ slot: 0, match, homeTeam, awayTeam }`, defaulting to `'TBD'`/`'TBD'` when no match exists) by looking up `matches.find(m => m.bracketRound === 'THIRD_PLACE' && m.bracketSlot === 0)`. Return shape changes from `rounds` (array) to `{ rounds, thirdPlace }`.
- `renderBracketTab` (app.js) passes `thirdPlace` through to `renderBracket` as a new argument.
- `renderBracket` stores it in a module-level var (mirroring `_bracketOnPick` etc.) and renders one extra card via a new `buildThirdPlaceCard` function, reusing the existing `buildBracketRow(slotData, side)` for each team row — this gets TBD styling, kickoff badge, votable rows, score, and winner checkmark for free, identical to any other match card, with no special-casing needed for when the match goes live/resolves.
- Positioning: same x-offset as the last column (`(rounds.length - 1) * BRACKET_COL_PITCH`), `top` = the Final card's computed top (`_bracketPositions[last][0] + BRACKET_HEADER_H`) + `BRACKET_ROW_H`. A small label ("Third Place Game") sits above it, styled like `.bracket-col-label` but always visible (not tied to the focused-round label swap).
- Visibility: the third place card is always in the DOM, but the bracket's horizontal carousel (`overflow: hidden` on `#bracketContainer .bracket-scrollwrap`, track translated via `transform`) already clips anything outside the focused column. Since the card shares the Final column's x-offset, it's naturally only visible when Final is focused — no extra focus-check needed for horizontal clipping.
- Vertical clipping: `bracketContentHeight(roundSize)` drives `scrollwrap.style.height`, which does need adjusting — when the focused round is the last one (Final), add enough extra height for the third place card + its label so it isn't cut off. This applies in both `renderBracket` (initial height) and `goToBracketRound` (height on nav).
- Styling: new `.bracket-card.third-place` class using the existing-but-unused-in-bracket `--color-bronze` token (already defined in `style.css`), mirroring how `.bracket-card.final` uses `--color-gold`.

## Data model

No backend changes needed — `THIRD_PLACE` round validation, `BRACKET_ROUND_SIZES`, and stage-code mapping already exist in `server.js`. Admin match creation UI already supports selecting `THIRD_PLACE` as a bracket round.

## Testing

`verify_bracket_layout.js` keeps a standalone copy of `computeBracketPositions`/`buildBracketRounds` logic for testing; since `buildBracketRounds`'s return shape changes (`rounds` → `{ rounds, thirdPlace }`), that standalone copy and its test script need the same update so they stay in sync, per this repo's existing convention (noted in the `bracket.js` file header comment).
