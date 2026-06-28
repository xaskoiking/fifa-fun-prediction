# Bracket Booster Integration — Design Spec

**Date:** 2026-06-27
**Branch:** feat/ko-fixtures-bracket
**Status:** Approved

---

## Problem

The booster feature (merged to staging via `feat/booster-addition`) was built against the old prediction list UI. The new bracket UI (on `feat/ko-fixtures-bracket`) needs to support boosters, but with a lighter touch: no inline callout banners, no header stage-badges redesign — just a ⚡ on the bracket card and the booster checkbox in the existing vote confirmation popup.

---

## Goals

1. Bring the booster backend and popup logic into the bracket branch via rebase onto `origin/staging`.
2. Show a ⚡ badge on a prediction bracket card when the current user has an active booster on that match.
3. Ensure the vote confirmation popup that appears when clicking a bracket team includes the booster checkbox (opt-in to double points).
4. Preserve all existing booster behaviour in the old prediction list UI (callout banners, header ⚡⚡⚡ stage badges, voter tags in results).
5. No changes to the fantasy bracket.

---

## Out of Scope

- Fantasy bracket (`fantasy-bracket.js`, `renderFantasyBracketModal`) — untouched.
- Booster logic for group-stage matches — only KO matches are eligible (unchanged from staging).
- Any redesign of the header stage badges.

---

## Architecture

### Data flow (unchanged from staging)

```
GET /api/matches
  └── per match: myBooster, boosterEligible, boosterStageCode,
                 boosterStageLabel, boosterStageUsed, myMatchBooster

POST /vote  { matchId, prediction, useBooster }
  └── server doubles points when useBooster=true and eligible
```

The bracket tab calls `renderBracketTab()` → `renderBracket()` → per team-row click: `submitVote(match.id, side)`. This is the same `submitVote` used by the list UI, so the booster checkbox logic in that function is inherited for free.

### What the rebase brings in

| File | Change from staging |
|------|---------------------|
| `server.js` | `getUserBoosterStatus`, `ensureMatchBoosterData`, booster fields in match API response, `useBooster` handling in POST /vote, 2× point multiplier |
| `public/app.js` | `updateBoosterDisplay()` (header badges), `boosterCalloutHtml` in list cards, booster section show/hide in `submitVote()`, `useBooster` in `confirmVote()` |
| `public/index.html` | `#boosterStatusDisplay` in header, `#voteConfirmBoosterSection` in vote confirm modal |
| `public/style.css` | Minor booster-related styles (if any) |

### Conflict resolution approach

Each staging booster commit is replayed on top of the bracket branch. For each conflict:
- **Keep bracket-branch structure** as the base (it is strictly newer and more complete).
- **Weave booster additions** into the appropriate locations in the bracket-branch version.
- The booster callout banners in list cards (`boosterCalloutHtml`) are scoped to `renderMatches()` — they apply only to the list UI and do not touch bracket rendering.

---

## New bracket card badge

**Location:** `public/bracket.js` → `buildBracketCards()`

After building the card DOM element, if `slotData.match.myBooster` is true, append a positioned ⚡ span:

```js
if (match && match.myBooster) {
  const bolt = document.createElement('span');
  bolt.className = 'bracket-card-booster';
  bolt.textContent = '⚡';
  card.appendChild(bolt);
}
```

**CSS** (`public/style.css`):

```css
.bracket-card-booster {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 0.7rem;
  line-height: 1;
  pointer-events: none;
}
```

`.bracket-card` already has `position: relative` via existing styles.

---

## Vote confirmation popup

No code changes needed beyond what comes in from staging. `submitVote()` already:
- Shows `#voteConfirmBoosterSection` when `match.matchType === 'KO' && (match.boosterEligible || match.myMatchBooster)`
- Pre-checks the checkbox if `match.myBooster && match.myVote === prediction`
- Passes `useBooster` to `confirmVote()` → POST /vote

Since the bracket tab calls `submitVote()` for every team click, the popup behaviour is inherited automatically.

---

## Fantasy bracket — no changes

`fantasy-bracket.js` and `renderFantasyBracketModal()` are not modified. Fantasy picks are speculative (no real match data), so boosters don't apply.

---

## Testing checklist

- [ ] Rebase completes without leftover conflict markers
- [ ] Old list UI: booster callout banners, header ⚡⚡⚡ badges, voter ⚡ tags still work
- [ ] Bracket tab: clicking a KO team opens the vote popup with booster checkbox visible
- [ ] Bracket tab: after voting with booster, the bracket card shows ⚡ badge
- [ ] Bracket tab: cards without a booster show no ⚡
- [ ] Fantasy bracket: opens and works as before, no booster UI visible
