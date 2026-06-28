# Bracket Booster Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase `feat/ko-fixtures-bracket` onto `origin/staging` (which includes the booster feature), resolve all conflicts to preserve both sets of changes, then add a ⚡ badge to prediction bracket cards where the user has an active booster.

**Architecture:** Rebasing replays bracket-branch commits on top of staging, which already has the booster server logic, vote-popup checkbox, and header stage badges. Conflicts are resolved by keeping the bracket-branch structure and weaving in the booster additions at the right locations. After the rebase, a small DOM addition in `bracket.js` reads `match.myBooster` (already returned by the server after the rebase) and renders a positioned ⚡ span on the card.

**Tech Stack:** Node.js/Express (server), vanilla JS (frontend), no build step, no test framework — verification is manual via curl + browser.

## Global Constraints

- Fantasy bracket (`fantasy-bracket.js`, `renderFantasyBracketModal`) must not be modified.
- Existing booster behaviour in the prediction list UI (callout banners, header ⚡⚡⚡ badges, voter tags) must be preserved.
- No new npm packages.

---

## File Map

| File | Change |
|------|--------|
| `public/index.html` | Conflict resolution: merge user-status + booster modal section |
| `server.js` | Conflict resolution: add booster helper fns, update calculatePointsForMatch, update GET /api/matches and POST /api/predict |
| `public/app.js` | Conflict resolution: add updateBoosterDisplay(), update submitVote() + confirmVote() |
| `public/bracket.js` | Add ⚡ badge to buildBracketCards() |
| `public/style.css` | Add .bracket-card-booster rule |

---

## Task 1: Rebase onto origin/staging and resolve conflicts

**Files:**
- Modify: `public/index.html`
- Modify: `server.js`
- Modify: `public/app.js`

**Interfaces:**
- Produces: `match.myBooster`, `match.boosterEligible`, `match.boosterStageCode`, `match.boosterStageLabel`, `match.boosterStageUsed`, `match.myMatchBooster` available on every match object from GET /api/matches — Task 2 reads `match.myBooster`.

- [ ] **Step 1: Fetch latest remote state**

```bash
git fetch --all
```

Expected: `origin/staging` updates to show the booster merge commit (`cc05f66 Merge pull request #32 from xaskoiking/feat/booster-addition`).

- [ ] **Step 2: Start the rebase**

```bash
git rebase origin/staging
```

Expected: git will replay bracket commits on top of staging. Conflicts will appear in `public/index.html`, `server.js`, and/or `public/app.js`. Proceed file by file below.

- [ ] **Step 3: Resolve conflict in `public/index.html` — user-status area**

When a conflict appears in `public/index.html`, find the `<div class="user-status" id="userStatusArea">` block and replace the entire conflict (from `<<<<<<` to `>>>>>>>`) with the following, which combines the bracket branch's fantasy button + welcome span with staging's booster badge + icon-only Switch Player button:

```html
        <div class="user-status" id="userStatusArea">
          <button id="fantasyBracketBtn" class="btn btn-fantasy" style="display:none;" onclick="openFantasyBracket()">
            ⭐<span class="fantasy-btn-label"> Fantasy Bracket</span><span id="fantasyLockBadge" class="fantasy-lock-badge" style="display:none;"> 🔒</span>
          </button>
          <span class="user-welcome">Welcome, <strong id="currentUserNameDisplay">Guest</strong></span>
          <span id="boosterStatusDisplay" style="display:none; font-size: 1rem; letter-spacing: 2px; margin-left: auto;"></span>
          <button id="changeUserBtn" class="btn btn-secondary btn-sm"><span class="switch-label">Switch Player</span><span class="switch-icon" aria-hidden="true">👤</span></button>
        </div>
```

- [ ] **Step 4: Verify vote confirm modal has booster section in `public/index.html`**

Search for `voteConfirmBoosterSection` in the file. If it's present, no action needed. If it's missing (staging addition was lost in conflict), add it inside `#voteConfirmModal`'s `.modal-body` div, between `#voteConfirmMatchInfo` and the `<p>` about changing votes:

```html
        <div id="voteConfirmBoosterSection" style="display:none; background: rgba(60,120,255,0.08); border: 1px solid rgba(60,120,255,0.16); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <label style="display:flex; align-items:center; gap: 10px; font-weight: 700; cursor: pointer;">
            <input type="checkbox" id="voteConfirmUseBooster" style="transform: scale(1.1);" />
            Use knockout booster for this vote (2× points if correct)
          </label>
          <div id="voteConfirmBoosterInfo" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 8px;"></div>
        </div>
```

- [ ] **Step 5: Resolve conflict in `server.js` — calculatePointsForMatch**

Find the `calculatePointsForMatch` function. Replace it entirely with the booster-aware version:

```javascript
function calculatePointsForMatch(votes, outcome, matchType, boosters = {}) {
  const votersHome = votes.home || [];
  const votersAway = votes.away || [];
  const votersDraw = votes.draw || [];

  const countHome = votersHome.length;
  const countAway = votersAway.length;
  const countDraw = matchType === 'League' ? votersDraw.length : 0;

  const pointsAllocated = {};

  if (!outcome) return pointsAllocated;

  if (outcome === 'home') {
    const pts = countAway + countDraw + 1;
    votersHome.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.home || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.away || []).includes(v) ? 2 : 1);
    });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => {
      pointsAllocated[v] = pts * ((boosters.draw || []).includes(v) ? 2 : 1);
    });
  }

  return pointsAllocated;
}
```

- [ ] **Step 6: Add booster helper constants and functions in `server.js`**

Find the line `const STAGE_LABELS = TOURNAMENT_STAGES.reduce(...)` block (ends with `}, {});`). Directly after that closing line, add:

```javascript
STAGE_LABELS.QF_SF_FINAL = 'QF/SF/Final';

const KNOCKOUT_BOOSTER_STAGES = ['LAST_32', 'LAST_16', 'QF_SF_FINAL'];

function normalizeStageText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function getMatchStageCode(match) {
  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|qf\/sf\/final|qf sf final)\b/.test(stageText)) {
      return 'QF_SF_FINAL';
    }
  }

  const num = parseInt(match.matchNumber, 10);
  if (!Number.isFinite(num)) return null;
  if (num >= 73 && num <= 88) return 'LAST_32';
  if (num >= 89 && num <= 96) return 'LAST_16';
  if (num >= 97 && num <= 104) return 'QF_SF_FINAL';
  return null;
}

function ensureMatchBoosterData(match) {
  if (!match.boosters || typeof match.boosters !== 'object') {
    match.boosters = { home: [], away: [], draw: [] };
  } else {
    match.boosters = {
      home: Array.isArray(match.boosters.home) ? match.boosters.home : [],
      away: Array.isArray(match.boosters.away) ? match.boosters.away : [],
      draw: Array.isArray(match.boosters.draw) ? match.boosters.draw : []
    };
  }
  return match;
}

function getUserBoosterStatus(db, username) {
  const status = { LAST_32: false, LAST_16: false, QF_SF_FINAL: false };
  db.matches.forEach(match => {
    const stageCode = getMatchStageCode(match);
    if (!stageCode) return;
    ensureMatchBoosterData(match);
    if (match.boosters.home.includes(username)
      || match.boosters.away.includes(username)
      || match.boosters.draw.includes(username)) {
      status[stageCode] = true;
    }
  });
  return status;
}
```

- [ ] **Step 7: Update GET /api/matches in `server.js` to include booster fields**

Find the `app.get('/api/matches', ...)` handler. Inside `const processedMatches = db.matches.map(match => {`, add two lines right after `readData()` is called and before the `map`:

```javascript
  const userBoosterStatus = getUserBoosterStatus(db, username);
```

Then at the top of the `.map` callback (right after `const processedMatches = db.matches.map(match => {`), add:

```javascript
    ensureMatchBoosterData(match);
```

Then before the `if (hasStarted || match.status === 'resolved')` branch, add the booster field computations:

```javascript
    const stageCode = getMatchStageCode(match);
    const stageLabel = stageCode ? STAGE_LABELS[stageCode] || 'Knockout' : null;
    const stageBoosterUsed = stageCode ? !!userBoosterStatus[stageCode] : false;
    const votingOpen = !match.votingLocked && (kickoffTime > now || extensionActive);
    const boosterEligible = match.matchType === 'KO' && !!stageCode && votingOpen && !stageBoosterUsed;
    const myBooster = !!(myVote && match.boosters[myVote] && match.boosters[myVote].includes(username));
    const myMatchBooster = !!(
      (match.boosters.home || []).includes(username) ||
      (match.boosters.away || []).includes(username) ||
      (match.boosters.draw || []).includes(username)
    );
```

Then in the `hasStarted` return object (the `...match` spread), add after `score: getMatchScore(...)`:

```javascript
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed,
        boosters: match.boosters,
```

And in the pre-kickoff return object (the explicit field list), add before the closing `}`:

```javascript
        boosterStageCode: stageCode,
        boosterStageLabel: stageLabel,
        boosterEligible,
        myBooster,
        myMatchBooster,
        boosterStageUsed: stageBoosterUsed,
```

- [ ] **Step 8: Update POST /api/predict in `server.js` to handle useBooster**

Find `app.post('/api/predict', ...)`. Replace the destructure line:

```javascript
  const { matchId, prediction } = req.body;
```

With:

```javascript
  const { matchId, prediction, useBooster } = req.body;
  const useBoosterFlag = !!useBooster;
```

After the existing validation checks (after the `!['home', 'away', 'draw'].includes(prediction)` guard), add booster validation:

```javascript
  const stageCode = getMatchStageCode(match);
  const userBoosterStatus = getUserBoosterStatus(db, username);
  const alreadyBoostedHere = stageCode && match.boosters && (
    (match.boosters.home || []).includes(username) ||
    (match.boosters.away || []).includes(username) ||
    (match.boosters.draw || []).includes(username)
  );
  const stageAlreadyUsedElsewhere = stageCode && userBoosterStatus[stageCode] && !alreadyBoostedHere;

  if (useBoosterFlag) {
    if (match.matchType !== 'KO' || !stageCode) {
      return res.status(400).json({ error: 'Boosters are only available on knockout matches.' });
    }
    if (stageAlreadyUsedElsewhere) {
      return res.status(400).json({ error: 'You have already used your booster for this stage.' });
    }
  }
```

After the vote-removal lines (the three `match.votes.X = match.votes.X.filter(...)` lines), add booster removal:

```javascript
  ensureMatchBoosterData(match);
  match.boosters.home = match.boosters.home.filter(u => u !== username);
  match.boosters.away = match.boosters.away.filter(u => u !== username);
  match.boosters.draw = match.boosters.draw.filter(u => u !== username);
```

After `match.votes[prediction].push(username);`, add:

```javascript
  if (useBoosterFlag) {
    match.boosters[prediction].push(username);
  }
```

Update the voteLog push to include the booster flag:

```javascript
  match.voteLog.push({
    timestamp: new Date().toISOString(),
    player: username,
    vote: prediction,
    booster: useBoosterFlag
  });
```

Update the audit log message:

```javascript
  logAuditAction(db, 'PREDICTION', `${username} voted "${prediction}"${useBoosterFlag ? ' with BOOSTER' : ''} for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
```

- [ ] **Step 9: Resolve conflict in `public/app.js` — add updateBoosterDisplay()**

Find the `loadDashboardData` function. Directly before it, add the `updateBoosterDisplay` function:

```javascript
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

- [ ] **Step 10: Call updateBoosterDisplay() in `loadDashboardData` in `public/app.js`**

Inside `loadDashboardData`, find the line `matches = await response.json();` and add a call to `updateBoosterDisplay()` immediately after it:

```javascript
    matches = await response.json();
    updateBoosterDisplay();
```

- [ ] **Step 11: Update `submitVote()` in `public/app.js` to show/hide booster checkbox**

Find `function submitVote(matchId, prediction)`. After the three `document.getElementById('voteConfirm...')` assignment lines (matchLabel, matchup, choice), add:

```javascript
  const boosterSection = document.getElementById('voteConfirmBoosterSection');
  const boosterCheckbox = document.getElementById('voteConfirmUseBooster');
  const boosterInfo = document.getElementById('voteConfirmBoosterInfo');
  if (boosterSection && boosterCheckbox && boosterInfo) {
    const showBooster = match.matchType === 'KO' && (match.boosterEligible || match.myMatchBooster);
    if (showBooster) {
      boosterSection.style.display = 'block';
      boosterCheckbox.checked = match.myBooster && match.myVote === prediction;
      boosterInfo.textContent = match.boosterEligible
        ? `Use your one knockout booster for ${match.boosterStageLabel || 'this stage'} to double points on a correct pick.`
        : `Boost this prediction on your current knockout match. If you switch picks, the booster will move with your selection.`;
    } else {
      boosterSection.style.display = 'none';
      boosterCheckbox.checked = false;
    }
  }
```

- [ ] **Step 12: Update `confirmVote()` in `public/app.js` to pass useBooster**

Find `async function confirmVote()`. After the `const prediction = pendingVotePrediction;` line, add:

```javascript
  const useBooster = document.getElementById('voteConfirmUseBooster')?.checked || false;
```

Then find the `body: JSON.stringify({ matchId, prediction })` line and change it to:

```javascript
      body: JSON.stringify({ matchId, prediction, useBooster })
```

- [ ] **Step 13: Stage all resolved files and continue the rebase**

```bash
git add public/index.html server.js public/app.js
git rebase --continue
```

If git prompts for a commit message, accept the default (it will be the original bracket commit message). Repeat steps 3–13 if further conflicts appear in subsequent commits.

- [ ] **Step 14: Verify the rebase completed**

```bash
git log --oneline | head -10
```

Expected: bracket branch commits are now on top of staging commits. The top commit should be the last bracket commit (`fix: update bracket description to reflect button nav instead of swipe`).

- [ ] **Step 15: Smoke-test booster fields from the server**

```bash
node server.js &
sleep 2
# login to get a secret, then:
curl -s -H "x-user-secret: <your-test-secret>" http://localhost:3000/api/matches | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const ko=d.find(m=>m.matchType==='KO'); console.log(ko ? JSON.stringify({boosterEligible:ko.boosterEligible,myBooster:ko.myBooster,boosterStageCode:ko.boosterStageCode},null,2) : 'No KO match found');"
kill %1
```

Expected: a KO match should show `boosterEligible`, `myBooster`, and `boosterStageCode` fields (values depend on data state).

- [ ] **Step 16: Commit the conflict resolution**

If the rebase produced a clean commit history with the bracket commits already committed, no extra commit is needed — the rebase will have applied them. Verify with `git status` that the working tree is clean. If anything is uncommitted, commit it:

```bash
git add -p  # stage only the booster integration changes
git commit -m "$(cat <<'EOF'
feat: rebase onto staging — integrate booster backend and popup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add ⚡ badge to prediction bracket cards

**Files:**
- Modify: `public/bracket.js:161-197` (`buildBracketCards` function)
- Modify: `public/style.css` (add `.bracket-card-booster` rule)

**Interfaces:**
- Consumes: `slotData.match.myBooster` (boolean) — available after Task 1 rebase.
- Produces: visual ⚡ badge on bracket cards where the user has an active booster.

- [ ] **Step 1: Add ⚡ badge DOM element in `bracket.js`**

In `buildBracketCards()`, find these two lines:

```javascript
      card.appendChild(buildBracketRow(slotData, 'home'));
      card.appendChild(buildBracketRow(slotData, 'away'));
```

Add immediately after them (before `track.appendChild(card)`):

```javascript
      if (match && match.myBooster) {
        const bolt = document.createElement('span');
        bolt.className = 'bracket-card-booster';
        bolt.textContent = '⚡';
        card.appendChild(bolt);
      }
```

Full context after the change:

```javascript
      card.appendChild(buildBracketRow(slotData, 'home'));
      card.appendChild(buildBracketRow(slotData, 'away'));
      if (match && match.myBooster) {
        const bolt = document.createElement('span');
        bolt.className = 'bracket-card-booster';
        bolt.textContent = '⚡';
        card.appendChild(bolt);
      }
      track.appendChild(card);
```

- [ ] **Step 2: Add CSS for the booster badge in `style.css`**

Find the bracket card CSS block (`.bracket-card {`). After the closing brace of that block, add:

```css
.bracket-card-booster {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 0.7rem;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}
```

(`.bracket-card` already has `position: absolute` which makes it the positioning context for its children — no additional `position` property needed. The card is 60px tall; `top: 3px` keeps the badge well within bounds even with `overflow: hidden`.)

- [ ] **Step 3: Verify ⚡ badge renders**

Open the app in a browser, go to the Bracket tab, and vote on a KO match with the booster checkbox ticked in the confirmation popup. After confirming, the bracket card for that match should show a small ⚡ in its top-right corner. Cards without a booster should show nothing.

- [ ] **Step 4: Commit**

```bash
git add public/bracket.js public/style.css
git commit -m "$(cat <<'EOF'
feat: show ⚡ badge on bracket card when user has active booster

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
