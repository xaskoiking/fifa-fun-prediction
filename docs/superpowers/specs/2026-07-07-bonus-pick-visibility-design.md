# Bonus Pick Visibility + Logging — Design Spec

**Date:** 2026-07-07
**Branch:** feat/add-pred-bonus
**Status:** Approved

---

## Problem

The QF+ prediction bonus feature (already implemented on this branch) lets users pick Reg Time / Extra Time / Penalties and scores it, but the Past Results table doesn't show *what* a user actually picked (only whether it earned points), the "Result" column doesn't show how a match was actually decided, and the bonus pick isn't recorded in the vote log or audit log the way the team pick and booster usage already are.

---

## Goals

1. **"Your Pick" column:** show the user's own Reg/ET/Pens label whenever they've made one, for bonus-eligible matches, regardless of resolution state (locked/live or resolved) — consistent with how the team pick is already shown while locked.
2. **"Result" column:** for resolved, bonus-eligible matches, show the actual `decidedBy` label alongside the score.
3. **Logging:** record the bonus pick in `match.voteLog` entries (alongside the existing `vote`/`booster` fields) and in the `PREDICTION` audit log line.

## Out of Scope

- No change to scoring logic, the vote-confirm modal, or the admin resolve UI — all already implemented.
- No change to the `RESOLVE_MATCH` audit log line — it already includes `[decided by ${match.decidedBy}]` from the original feature.

---

## Design

### 1. "Your Pick" column (`public/app.js`, `renderResults()`)

Currently the cell shows one of: `🔒 Team` (locked), `🎉 Team (+N ...)` (resolved+correct), `❌ Team` (resolved+wrong), or "No Vote". Append ` · <Bonus Label>` to all three vote-present cases (locked, resolved-correct, resolved-wrong) whenever `match.boosterStageCode === 'QF_SF_FINAL'` and `match.myBonusPick` is set. Label mapping: `REGULAR` → "Reg Time", `EXTRA_TIME` → "Extra Time", `PENALTIES` → "Penalties". This is additive to the existing bonus-points suffix logic already in place (e.g. `+10 bonus`) — the label is shown independent of whether the bonus itself scored points.

Examples:
- Locked: `🔒 England · Extra Time`
- Resolved, team+bonus correct: `🎉 England (+12 · booster x2, +10 bonus) · Extra Time`
- Resolved, team wrong, bonus correct: `❌ England (+5 bonus) · Extra Time`
- Resolved, bonus wrong: `🎉 England (+12) · Extra Time` / `❌ England · Extra Time` (label still shown — it's what they picked, not whether it scored)

### 2. "Result" column (`public/app.js`, `renderResults()`)

Currently shows flags + score (or "Locked / Live" text) for a match. When `isResolved && match.boosterStageCode === 'QF_SF_FINAL'`, append ` · <decidedBy Label>` after the score, using the same label mapping as above, driven by `match.decidedBy`. No change for unresolved or non-eligible matches.

### 3. Logging (`server.js`, `POST /api/predict`)

- `match.voteLog` push: add a `bonusPick` field — the stored value (`'REGULAR'|'EXTRA_TIME'|'PENALTIES'`) when the match is bonus-eligible, `null` otherwise. Mirrors how `booster` is already always present as a boolean regardless of eligibility.
- `logAuditAction` call for `PREDICTION`: when bonus-eligible, insert `, bonus: <Label>` into the existing message before the booster clause, e.g.:
  `${username} voted "${prediction}"${useBoosterFlag ? ' with BOOSTER' : ''}${bonusEligible ? `, bonus: ${bonusLabel}` : ''} for Match #${match.matchNumber} (...)`.

---

## Testing

Manual trace (per project convention — no local server spin-up, code review + diff checks): verify the four "Your Pick" cases above produce the expected string, verify the Result column addition only fires when `isResolved && bonus-eligible`, and verify a sample `voteLog`/audit-log entry for both a bonus-eligible and non-eligible predict call.
