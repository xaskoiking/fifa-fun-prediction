# Leaderboard Booster Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Booster" column to the main leaderboard table showing each player's ⚡ status for the currently active knockout round (bright = available, dimmed = used because the boosted match has kicked off).

**Architecture:** The server computes the "current" booster round by scanning matches in tournament order (`LAST_32` → `LAST_16` → `QF_SF_FINAL`) for the first bucket that has matches and isn't fully resolved, then attaches `boosterStage`/`boosterStatus` to each entry returned by `GET /api/leaderboard`. The client renders a new `col-booster` cell right after the name column, reusing the same ⚡ glyph and dim/greyscale styling the header booster widget already uses.

**Tech Stack:** Node.js/Express (server), vanilla JS (frontend), no build step, no test framework — verification is via syntax checks and code review; the user validates the live feature after deploy.

## Global Constraints

- Reuse existing helpers (`getMatchStageCode`, `ensureMatchBoosterData`) — no new persisted state, no `data.json` schema changes.
- A booster only counts as "used" once the specific match it was applied to has kicked off (`kickoff <= now`) — applying it to a future match still shows as "available" since it's retractable.
- Do not modify the existing header booster widget (`updateBoosterDisplay`) behavior.
- No new npm packages.
- Per project convention: do not start a local dev server to "verify" the feature works end-to-end — verify via code reading, syntax checks, and let the user confirm after deploy.

---

## File Map

| File | Change |
|------|--------|
| `server.js` | Add `getCurrentBoosterStage()` helper; attach `boosterStage`/`boosterStatus` fields in `GET /api/leaderboard` |
| `public/app.js` | Add `BOOSTER_STAGE_LABELS` constant (shared with header widget); add `renderBoosterCell()`; render new cell in `loadLeaderboard()`; fix `colspan` |
| `public/index.html` | Add `<th class="col-booster">` |
| `public/style.css` | Add `.col-booster` desktop rule + mobile width table entry |

---

## Task 1: Server — compute current booster stage and per-player status

**Files:**
- Modify: `server.js:1364-1377` (add helper after `getUserBoosterStatus`)
- Modify: `server.js:766-778` (`GET /api/leaderboard` handler, right after the `prevRank` block)

**Interfaces:**
- Produces: `getCurrentBoosterStage(matches)` → `'LAST_32' | 'LAST_16' | 'QF_SF_FINAL' | null`. Each object returned by `GET /api/leaderboard` gains `boosterStage: string|null` and `boosterStatus: 'available'|'used'|null` — Task 2 reads these two fields.

- [ ] **Step 1: Add `getCurrentBoosterStage` helper**

Open `server.js` and find `getUserBoosterStatus` (ends at line 1377 with the closing `}` of the function, directly before the `// Ensure db.settings.openMatchStages exists...` comment). Insert this new function directly after it:

```javascript
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

- [ ] **Step 2: Verify the helper was inserted correctly**

```bash
grep -n "function getCurrentBoosterStage" -A 10 server.js
```

Expected: the function body prints exactly as written above, and running `grep -n "function getUserBoosterStatus\|function getCurrentBoosterStage\|Ensure db.settings.openMatchStages" server.js` shows `getCurrentBoosterStage` between the other two.

- [ ] **Step 3: Attach `boosterStage`/`boosterStatus` in `GET /api/leaderboard`**

Find this block near the end of the `app.get('/api/leaderboard', ...)` handler:

```javascript
  // Add prevRank: each player's rank in the snapshot before the last resolved match.
  // Used by the client to render the MOVED column.
  const history = buildLeaderboardHistory(db);
  if (history.length >= 2) {
    const prevFrame = history[history.length - 2];
    const prevRankMap = new Map(prevFrame.standings.map((p, i) => [p.name, i + 1]));
    leaderboard.forEach(p => { p.prevRank = prevRankMap.get(p.name) ?? null; });
  } else {
    leaderboard.forEach(p => { p.prevRank = null; });
  }

  res.json(leaderboard);
});
```

Replace it with:

```javascript
  // Add prevRank: each player's rank in the snapshot before the last resolved match.
  // Used by the client to render the MOVED column.
  const history = buildLeaderboardHistory(db);
  if (history.length >= 2) {
    const prevFrame = history[history.length - 2];
    const prevRankMap = new Map(prevFrame.standings.map((p, i) => [p.name, i + 1]));
    leaderboard.forEach(p => { p.prevRank = prevRankMap.get(p.name) ?? null; });
  } else {
    leaderboard.forEach(p => { p.prevRank = null; });
  }

  // Add boosterStage/boosterStatus: each player's booster availability for the
  // currently active knockout round. A booster only counts as "used" once the
  // match it was applied to has kicked off — otherwise it's still retractable.
  const currentBoosterStage = getCurrentBoosterStage(db.matches);
  const currentStageMatches = currentBoosterStage
    ? db.matches.filter(m => getMatchStageCode(m) === currentBoosterStage)
    : [];
  currentStageMatches.forEach(ensureMatchBoosterData);

  leaderboard.forEach(p => {
    if (!currentBoosterStage) {
      p.boosterStage = null;
      p.boosterStatus = null;
      return;
    }
    const appliedMatch = currentStageMatches.find(m =>
      (m.boosters.home || []).includes(p.name) ||
      (m.boosters.away || []).includes(p.name) ||
      (m.boosters.draw || []).includes(p.name)
    );
    p.boosterStage = currentBoosterStage;
    if (!appliedMatch) {
      p.boosterStatus = 'available';
    } else {
      const hasStarted = new Date(appliedMatch.kickoff) <= now;
      p.boosterStatus = hasStarted ? 'used' : 'available';
    }
  });

  res.json(leaderboard);
});
```

Note: `now` is already in scope — it's declared as `const now = new Date();` at the top of this handler.

- [ ] **Step 4: Syntax-check the file**

```bash
node -c server.js
```

Expected: no output (exit code 0), confirming valid JavaScript. This does not start the server.

- [ ] **Step 5: Review the change against the spec's edge cases**

```bash
sed -n '1326,1349p' server.js
grep -n "function getCurrentBoosterStage" -A 10 server.js
```

Expected: read the printed `getMatchStageCode` and `getCurrentBoosterStage` source and manually confirm against the "Edge Cases" section of `docs/superpowers/specs/2026-06-30-leaderboard-booster-column-design.md` (empty bucket is skipped, first unresolved bucket wins, `null` when nothing is active). This project does not run a local server for verification — the live behavior will be confirmed by the user after deploy.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
feat: add current booster round status to leaderboard API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Client — render the Booster column

**Files:**
- Modify: `public/index.html:146-158` (leaderboard table header)
- Modify: `public/app.js:325-347` (extract shared stage-label constant)
- Modify: `public/app.js:436-536` (`loadLeaderboard()` — render new cell, fix colspan)
- Modify: `public/style.css:724-731` (desktop column rule)
- Modify: `public/style.css:1849-1880` (mobile column widths)

**Interfaces:**
- Consumes: `player.boosterStage` (`'LAST_32'|'LAST_16'|'QF_SF_FINAL'|null`) and `player.boosterStatus` (`'available'|'used'|null`) from `GET /api/leaderboard`, produced by Task 1.
- Produces: `BOOSTER_STAGE_LABELS` constant and `renderBoosterCell(stage, status)` function, both reused by nothing outside this task (the header widget keeps its own inline array to minimize blast radius, but is updated to source from the same constant for consistency).

- [ ] **Step 1: Add `<th class="col-booster">` to the leaderboard table header**

In `public/index.html`, find:

```html
                <tr>
                  <th class="col-rank"><span class="th-full">Rank</span><span class="th-short">#</span></th>
                  <th class="col-name">Player</th>
                  <th class="col-predictions"><span class="th-full">Predictions (Correct/Resolved)</span><span class="th-short">P/R</span></th>
                  <th class="col-accuracy"><span class="th-full">Accuracy</span><span class="th-short">Acc</span></th>
                  <th class="col-moved" title="Position change since last completed match"><span class="th-full">Moved</span><span class="th-short">Mvd</span></th>
                  <th class="col-pending" title="Live matches still open for voting that this player hasn't voted on yet"><span class="th-full">Not Yet Voted</span><span class="th-short">Pend</span></th>
                  <th class="col-points"><span class="th-full">Total Points</span><span class="th-short">Pts</span></th>
                </tr>
```

Replace with:

```html
                <tr>
                  <th class="col-rank"><span class="th-full">Rank</span><span class="th-short">#</span></th>
                  <th class="col-name">Player</th>
                  <th class="col-booster" title="Booster status for the current knockout round"><span class="th-full">Boost</span><span class="th-short">&#9889;</span></th>
                  <th class="col-predictions"><span class="th-full">Predictions (Correct/Resolved)</span><span class="th-short">P/R</span></th>
                  <th class="col-accuracy"><span class="th-full">Accuracy</span><span class="th-short">Acc</span></th>
                  <th class="col-moved" title="Position change since last completed match"><span class="th-full">Moved</span><span class="th-short">Mvd</span></th>
                  <th class="col-pending" title="Live matches still open for voting that this player hasn't voted on yet"><span class="th-full">Not Yet Voted</span><span class="th-short">Pend</span></th>
                  <th class="col-points"><span class="th-full">Total Points</span><span class="th-short">Pts</span></th>
                </tr>
```

- [ ] **Step 2: Extract a shared `BOOSTER_STAGE_LABELS` constant in `public/app.js`**

Find `updateBoosterDisplay` in `public/app.js`:

```javascript
// Fetch matches (requires passcode header)
function updateBoosterDisplay() {
  const el = document.getElementById('boosterStatusDisplay');
  if (!el) return;

  const used = { LAST_32: false, LAST_16: false, QF_SF_FINAL: false };
  matches.forEach(match => {
    if (match.boosterStageCode && match.boosterStageUsed) {
      used[match.boosterStageCode] = true;
    }
  });

  const stages = [
    { code: 'LAST_32',     label: 'R32 Booster' },
    { code: 'LAST_16',     label: 'R16 Booster' },
    { code: 'QF_SF_FINAL', label: 'QF/SF/Final Booster' },
  ];

  el.innerHTML = stages.map(s =>
    `<span title="${s.label}" style="${used[s.code] ? 'opacity:0.25; filter:grayscale(1);' : ''}">⚡</span>`
  ).join('');
  el.style.display = 'inline-flex';
  el.style.alignItems = 'center';
}
```

Replace with (adds the shared constant above the function, and rewrites the function to read from it — output is unchanged):

```javascript
// Fetch matches (requires passcode header)
const BOOSTER_STAGE_LABELS = {
  LAST_32:     'R32 Booster',
  LAST_16:     'R16 Booster',
  QF_SF_FINAL: 'QF/SF/Final Booster',
};

function updateBoosterDisplay() {
  const el = document.getElementById('boosterStatusDisplay');
  if (!el) return;

  const used = { LAST_32: false, LAST_16: false, QF_SF_FINAL: false };
  matches.forEach(match => {
    if (match.boosterStageCode && match.boosterStageUsed) {
      used[match.boosterStageCode] = true;
    }
  });

  el.innerHTML = Object.keys(BOOSTER_STAGE_LABELS).map(code =>
    `<span title="${BOOSTER_STAGE_LABELS[code]}" style="${used[code] ? 'opacity:0.25; filter:grayscale(1);' : ''}">⚡</span>`
  ).join('');
  el.style.display = 'inline-flex';
  el.style.alignItems = 'center';
}
```

- [ ] **Step 3: Add `renderBoosterCell()` helper**

Directly after the `updateBoosterDisplay` function (before `async function loadDashboardData()`), add:

```javascript
function renderBoosterCell(stage, status) {
  if (!status) return '';
  const label = BOOSTER_STAGE_LABELS[stage] || 'Booster';
  if (status === 'used') {
    return `<span title="${label} — Used" style="opacity:0.25; filter:grayscale(1);">⚡</span>`;
  }
  return `<span title="${label} — Available">⚡</span>`;
}
```

- [ ] **Step 4: Render the booster cell in `loadLeaderboard()` and fix `colspan`**

Find this section in `loadLeaderboard()`:

```javascript
    if (sorted.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="7" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }
```

Replace with:

```javascript
    if (sorted.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="8" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }
```

Then find the row-building block:

```javascript
      const row = document.createElement('tr');
      row.className = rankClass;
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-moved">${movedCell}</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${delta > 0 ? `<span class="pts-cell-inner">${liveBadge}<span class="pts-live">${displayPts}</span></span>` : displayPts}<span class="unit-label"> pts</span></td>
      `;
      leaderboardBody.appendChild(row);
```

Replace with:

```javascript
      const boosterCell = renderBoosterCell(player.boosterStage, player.boosterStatus);

      const row = document.createElement('tr');
      row.className = rankClass;
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-booster">${boosterCell}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-moved">${movedCell}</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${delta > 0 ? `<span class="pts-cell-inner">${liveBadge}<span class="pts-live">${displayPts}</span></span>` : displayPts}<span class="unit-label"> pts</span></td>
      `;
      leaderboardBody.appendChild(row);
```

Finally, find the error-state line:

```javascript
    leaderboardBody.innerHTML = `<tr><td colspan="7" class="loading-state error-text">Error loading standings.</td></tr>`;
```

Replace with:

```javascript
    leaderboardBody.innerHTML = `<tr><td colspan="8" class="loading-state error-text">Error loading standings.</td></tr>`;
```

- [ ] **Step 5: Add desktop CSS for `.col-booster`**

In `public/style.css`, find:

```css
/* Specific table columns */
.col-rank { width: 80px; text-align: center; }
.col-name { font-weight: 700; font-size: 1.05rem; }
.col-predictions { color: var(--text-muted); }
.col-accuracy { font-weight: 500; }
.col-pending { text-align: center; width: 120px; }
.col-moved { text-align: center; width: 80px; }
.col-points { font-weight: 800; font-size: 1.15rem; color: var(--color-accent); text-align: right; width: 150px; }
```

Replace with:

```css
/* Specific table columns */
.col-rank { width: 80px; text-align: center; }
.col-name { font-weight: 700; font-size: 1.05rem; }
.col-booster { text-align: center; width: 50px; }
.col-predictions { color: var(--text-muted); }
.col-accuracy { font-weight: 500; }
.col-pending { text-align: center; width: 120px; }
.col-moved { text-align: center; width: 80px; }
.col-points { font-weight: 800; font-size: 1.15rem; color: var(--color-accent); text-align: right; width: 150px; }
```

- [ ] **Step 6: Add `.col-booster` to the mobile width table**

In `public/style.css`, find the mobile block:

```css
  #leaderboardTable .col-rank { width: 10%; }
  #leaderboardTable .col-name { width: 26%; }
  #leaderboardTable .col-predictions { width: 16%; }
  #leaderboardTable .col-accuracy { width: 12%; }
  #leaderboardTable .col-moved { display: table-cell; width: 12%; }
  #leaderboardTable .col-pending { display: none; }
  #leaderboardTable .col-points { width: 24%; }
```

Replace with:

```css
  #leaderboardTable .col-rank { width: 8%; }
  #leaderboardTable .col-name { width: 24%; }
  #leaderboardTable .col-booster { width: 10%; }
  #leaderboardTable .col-predictions { width: 14%; }
  #leaderboardTable .col-accuracy { width: 10%; }
  #leaderboardTable .col-moved { display: table-cell; width: 12%; }
  #leaderboardTable .col-pending { display: none; }
  #leaderboardTable .col-points { width: 22%; }
```

- [ ] **Step 7: Review the diff**

```bash
git diff public/index.html public/app.js public/style.css
```

Expected: the diff matches exactly the replacements above — new `col-booster` header cell, `BOOSTER_STAGE_LABELS` constant + `renderBoosterCell()`, new `<td class="col-booster">` in the row template, `colspan` bumped from 7 to 8 in both empty-state rows, and the two CSS additions. Confirm no other lines were unintentionally touched. Per project convention, this diff/code review is the verification step — the user will confirm the rendered column visually after deploying.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "$(cat <<'EOF'
feat: show booster status column on leaderboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual Verification Checklist (for the user, after deploy)

- Leaderboard shows a "Boost" column right after the player name.
- During Group Stage (before any R32 match exists), the column is present but blank for every player.
- Once R32 matches exist and at least one is unresolved, players who haven't boosted show a bright ⚡ with tooltip "R32 Booster — Available".
- A player who applied their booster to an R32 match that hasn't kicked off yet still shows the bright ⚡ (still retractable).
- Once that match kicks off, the same player's icon becomes dimmed/greyscale with tooltip "R32 Booster — Used".
- Once every R32 match is resolved and R16 matches exist, the column switches to reflect R16 booster status the same way.
- Header booster widget (⚡⚡⚡ next to "Switch Player") still behaves exactly as before.
