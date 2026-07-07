# Bonus Pick Visibility + Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user's own Reg Time/Extra Time/Penalties bonus pick in the Past Results "Your Pick" column, show the actual decided-by method in the "Result" column, and record the bonus pick in the vote log and audit log.

**Architecture:** All display changes are confined to `renderResults()` in `public/app.js`, reusing fields (`match.boosterStageCode`, `match.myBonusPick`, `match.decidedBy`) already exposed by the existing prediction-bonus feature — no new backend fields needed for display. The logging change is a small addition to the existing `match.voteLog.push(...)` and `logAuditAction(...)` calls in `POST /api/predict` (`server.js`).

**Tech Stack:** Node.js/Express (`server.js`), vanilla JS (`public/app.js`). No test framework in this repo — verification is manual tracing of the diff, per existing project convention.

## Global Constraints

- The Reg/ET/Pens label is shown for the "Your Pick" column whenever `match.myBonusPick` is set and `match.boosterStageCode === 'QF_SF_FINAL'`, regardless of resolution state (locked/live or resolved) — the label itself is independent of whether the bonus scored points.
- The "Result" column shows the actual `match.decidedBy` label only when `isResolved && match.boosterStageCode === 'QF_SF_FINAL'`.
- Label mapping everywhere: `REGULAR` → "Reg Time", `EXTRA_TIME` → "Extra Time", `PENALTIES` → "Penalties".
- `match.voteLog` entries gain a `bonusPick` field (the stored value when bonus-eligible, `null` otherwise) — mirrors how `booster` is always present regardless of eligibility.
- The `PREDICTION` audit log line gets `, bonus: <Label>` inserted when bonus-eligible; no change to the `RESOLVE_MATCH` audit log (already includes decided-by info from the original feature).

---

## File Map

| File | Change |
|------|--------|
| `public/app.js` | `renderResults()`: hoist a shared `bonusLabels` map, add decided-by text to the Result column, add bonus-pick suffix to the Your Pick column, remove now-redundant duplicate `bonusLabels` declaration |
| `server.js` | `POST /api/predict`: add `bonusPick` to the `voteLog` entry and `, bonus: <Label>` to the `PREDICTION` audit log message |

---

## Task 1: Frontend — show bonus pick in "Your Pick" and "Result" columns

**Files:**
- Modify: `public/app.js:2010-2107` (`renderResults()`)

**Interfaces:**
- Consumes: `match.boosterStageCode`, `match.myBonusPick`, `match.decidedBy` (all already present on every match from the existing prediction-bonus feature)

**Context:** `renderResults()` already computes `bonusEligible` and a local `bonusLabels` map (used only inside the "Bonus" column's distribution block). This task hoists `bonusLabels` to the top of the per-match scope so it's usable by the Result and Your Pick columns too, and adds the display logic to both.

- [ ] **Step 1: Hoist `bonusEligible`/`bonusLabels` before the Result column, and add the decided-by text to it**

Find (`public/app.js`, current lines 2010-2034):

```js
    const isWinnerHome = isResolved && match.outcome === 'home';
    const isWinnerAway = isResolved && match.outcome === 'away';
    const isWinnerDraw = isResolved && match.outcome === 'draw';

    // Result Outcome text
    let outcomeText = '';
    if (isResolved) {
      const homeFlagClass = isWinnerHome ? 'result-flag result-flag-winner' : 'result-flag';
      const awayFlagClass = isWinnerAway ? 'result-flag result-flag-winner' : 'result-flag';
      const scoreMid = match.score ? `${match.score.scoreHome}-${match.score.scoreAway}` : (isWinnerDraw ? 'Draw' : 'Win');
      outcomeText = `
        <span style="display:inline-flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap;">
          ${buildFlagSpan(match.homeTeam, homeFlagClass)}
          <span class="form-score">${escapeHtml(scoreMid)}</span>
          ${buildFlagSpan(match.awayTeam, awayFlagClass)}
        </span>
      `;
    } else {
      outcomeText = '<span style="color: var(--color-warning); font-weight: bold;">Locked / Live</span>';
    }

    // Player prediction text & styling
    const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
    const myBonusCorrect = isResolved && bonusEligible && match.decidedBy && match.myBonusPick === match.decidedBy;
    const myBonusPts = myBonusCorrect ? (match.myVote === match.outcome ? 10 : 5) : 0;
```

Replace with:

```js
    const isWinnerHome = isResolved && match.outcome === 'home';
    const isWinnerAway = isResolved && match.outcome === 'away';
    const isWinnerDraw = isResolved && match.outcome === 'draw';

    const bonusEligible = match.boosterStageCode === 'QF_SF_FINAL';
    const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };

    // Result Outcome text
    let outcomeText = '';
    if (isResolved) {
      const homeFlagClass = isWinnerHome ? 'result-flag result-flag-winner' : 'result-flag';
      const awayFlagClass = isWinnerAway ? 'result-flag result-flag-winner' : 'result-flag';
      const scoreMid = match.score ? `${match.score.scoreHome}-${match.score.scoreAway}` : (isWinnerDraw ? 'Draw' : 'Win');
      const decidedByText = bonusEligible && match.decidedBy
        ? `<br><span style="font-size: 0.72rem; color: var(--text-muted);">${bonusLabels[match.decidedBy]}</span>`
        : '';
      outcomeText = `
        <span style="display:inline-flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap;">
          ${buildFlagSpan(match.homeTeam, homeFlagClass)}
          <span class="form-score">${escapeHtml(scoreMid)}</span>
          ${buildFlagSpan(match.awayTeam, awayFlagClass)}
        </span>
        ${decidedByText}
      `;
    } else {
      outcomeText = '<span style="color: var(--color-warning); font-weight: bold;">Locked / Live</span>';
    }

    // Player prediction text & styling
    const myBonusCorrect = isResolved && bonusEligible && match.decidedBy && match.myBonusPick === match.decidedBy;
    const myBonusPts = myBonusCorrect ? (match.myVote === match.outcome ? 10 : 5) : 0;
```

- [ ] **Step 2: Add the bonus-pick suffix to "Your Pick", after all three vote-present branches**

Find (`public/app.js`, the end of the `if (match.myVote) { ... }` block):

```js
      } else {
        pickText = `🔒 ${escapeHtml(pickTeam)}`;
      }
    }

    // Voters list formatting
```

Replace with:

```js
      } else {
        pickText = `🔒 ${escapeHtml(pickTeam)}`;
      }

      if (bonusEligible && match.myBonusPick) {
        pickText += ` · ${bonusLabels[match.myBonusPick]}`;
      }
    }

    // Voters list formatting
```

- [ ] **Step 3: Remove the now-redundant duplicate `bonusLabels` inside the "Bonus" column block**

Find (`public/app.js`, inside the `bonusColHtml` block):

```js
    // Bonus (Reg Time / Extra Time / Penalties) distribution — QF+/3rd-place only
    let bonusColHtml = '<span style="color: var(--text-muted);">&mdash;</span>';
    if (bonusEligible) {
      const bonusPicks = match.bonusPicks || {};
      const bonusGroups = { REGULAR: [], EXTRA_TIME: [], PENALTIES: [] };
      Object.keys(bonusPicks).forEach(name => {
        if (bonusGroups[bonusPicks[name]]) bonusGroups[bonusPicks[name]].push(name);
      });
      const bonusLabels = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' };
      bonusColHtml = `
```

Replace with:

```js
    // Bonus (Reg Time / Extra Time / Penalties) distribution — QF+/3rd-place only
    let bonusColHtml = '<span style="color: var(--text-muted);">&mdash;</span>';
    if (bonusEligible) {
      const bonusPicks = match.bonusPicks || {};
      const bonusGroups = { REGULAR: [], EXTRA_TIME: [], PENALTIES: [] };
      Object.keys(bonusPicks).forEach(name => {
        if (bonusGroups[bonusPicks[name]]) bonusGroups[bonusPicks[name]].push(name);
      });
      bonusColHtml = `
```

(This removes the inner `const bonusLabels = ...` line only — it was shadowing the now-hoisted outer one. Without this removal there'd be two identical maps in overlapping scope, which is exactly the kind of duplication this task should not introduce.)

- [ ] **Step 4: Verify with `node --check` and a manual trace**

Run: `node --check public/app.js`
Expected: no output (syntax OK).

Manually trace four scenarios against the edited code and confirm the resulting strings:
1. Locked bonus-eligible match, user picked England + Extra Time → Your Pick: `🔒 England · Extra Time`. Result: `Locked / Live` (unchanged, decidedBy only applies when resolved).
2. Resolved, team+bonus correct, booster used, `pts=12`, bonus pick was Extra Time and `decidedBy='EXTRA_TIME'` → Your Pick: `🎉 England (+12 · booster x2, +10 bonus) · Extra Time`.
3. Resolved, team wrong, bonus correct (`decidedBy='PENALTIES'`, user picked Penalties) → Your Pick: `❌ Mexico (+5 bonus) · Penalties`.
4. Resolved bonus-eligible match with `decidedBy='PENALTIES'` → Result column shows the score line, then a second line `Penalties` in muted small text.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: show bonus pick in Your Pick and decided-by in Result column"
```

---

## Task 2: Backend — record bonus pick in vote log and audit log

**Files:**
- Modify: `server.js:689-697` (`POST /api/predict`)

**Interfaces:**
- Consumes: `bonusEligible`, `bonusPick` (both already computed/destructured earlier in this same handler, from the existing prediction-bonus feature)

- [ ] **Step 1: Add `bonusPick` to the vote log entry and to the audit log message**

Find (`server.js`):

```js
  // Record timestamped vote log entry
  match.voteLog.push({
    timestamp: new Date().toISOString(),
    player: username,
    vote: prediction,
    booster: useBoosterFlag
  });

  logAuditAction(db, 'PREDICTION', `${username} voted "${prediction}"${useBoosterFlag ? ' with BOOSTER' : ''} for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
```

Replace with:

```js
  const loggedBonusPick = bonusEligible ? bonusPick : null;
  const bonusLabelForLog = { REGULAR: 'Reg Time', EXTRA_TIME: 'Extra Time', PENALTIES: 'Penalties' }[loggedBonusPick] || null;

  // Record timestamped vote log entry
  match.voteLog.push({
    timestamp: new Date().toISOString(),
    player: username,
    vote: prediction,
    booster: useBoosterFlag,
    bonusPick: loggedBonusPick
  });

  logAuditAction(db, 'PREDICTION', `${username} voted "${prediction}"${useBoosterFlag ? ' with BOOSTER' : ''}${bonusLabelForLog ? `, bonus: ${bonusLabelForLog}` : ''} for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
```

- [ ] **Step 2: Verify with `node --check` and a manual trace**

Run: `node --check server.js`
Expected: no output (syntax OK).

Manually trace two calls against the edited code:
1. `POST /api/predict` on a bonus-eligible QF match with `bonusPick: 'EXTRA_TIME'`, `useBooster: true` → voteLog entry: `{..., booster: true, bonusPick: 'EXTRA_TIME'}`. Audit log: `"Pradep voted \"home\" with BOOSTER, bonus: Extra Time for Match #101 (England vs Mexico)"`.
2. `POST /api/predict` on a non-eligible Group Stage match (any `bonusPick` value sent or omitted) → `bonusEligible` is `false` (established by the existing feature), so `loggedBonusPick` is `null`, voteLog entry: `{..., bonusPick: null}`, audit log unchanged from before this task: `"Pradep voted \"home\" for Match #12 (...)"`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: log bonus pick in vote log and audit log"
```

---

## Task 3: End-to-end review pass

- [ ] **Step 1: Re-run both syntax checks**

```bash
node --check server.js
node --check public/app.js
```

Expected: no output from either.

- [ ] **Step 2: Diff review**

Run `git diff HEAD~2..HEAD -- public/app.js server.js` (after Tasks 1 and 2 are committed) and confirm:
- `bonusLabels` is declared exactly once per `renderResults()` call (no duplicate/shadowed declaration remains).
- The "Your Pick" bonus suffix and "Result" decided-by text both correctly gate on `bonusEligible` (and, for Result, also `isResolved`) — neither ever renders for a non-bonus-eligible match.
- The vote log's `bonusPick` field and the audit log's `bonus: <Label>` clause are both `null`/absent for non-eligible matches, matching the existing pattern for `booster`.

- [ ] **Step 3: Commit any fixes found during review**

```bash
git add -p
git commit -m "fix: <describe what was wrong>"
```
