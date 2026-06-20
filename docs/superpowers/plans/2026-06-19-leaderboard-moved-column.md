# Leaderboard MOVED Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Moved" column to the main leaderboard showing rank change since the last completed match; hide the "Pend" column on mobile only; in live mode show provisional rank change from the current live score.

**Architecture:** The server computes `prevRank` (each player's rank in the penultimate history snapshot) and adds it to the `/api/leaderboard` response. The client uses `prevRank` in non-live mode; in live mode it derives a baseline rank from `points` and compares it to the live-sorted rank. CSS hides `col-pending` on mobile and shows `col-moved` on all viewports.

**Tech Stack:** Node.js/Express (server.js), vanilla JS (public/app.js), HTML (public/index.html), CSS (public/style.css)

---

## File Map

| File | Change |
|------|--------|
| `server.js` | Add `prevRank` field to each player in `/api/leaderboard` response |
| `public/index.html` | Add `<th class="col-moved">` header; update loading-state colspan 6→7 |
| `public/app.js` | Compute + render MOVED cell; update empty/error colspans 6→7 |
| `public/style.css` | Add `.col-moved` desktop style; hide `col-pending` + show `col-moved` on mobile |

---

## Task 1: Server — add `prevRank` to `/api/leaderboard`

**Files:**
- Modify: `server.js` (around line 645, after the `leaderboard` array is sorted)

**Context:** `buildLeaderboardHistory(db)` already exists (line 306) and returns an array of frames ordered oldest-first, each with `standings: [{name, points}]` sorted best-first (index 0 = rank 1). The penultimate frame (`frames[frames.length - 2]`) is the snapshot immediately before the last resolved match.

- [ ] **Step 1: Add `prevRank` computation after the `leaderboard` sort**

Find this block in `server.js` (around line 645):

```javascript
  // Convert map to list and sort
  const leaderboard = Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points; // Sort by points desc
    }
    if (b.correct !== a.correct) {
      return b.correct - a.correct; // Tiebreaker 1: correct predictions desc
    }
    return a.name.localeCompare(b.name); // Tiebreaker 2: alphabetical
  });

  res.json(leaderboard);
```

Replace it with:

```javascript
  // Convert map to list and sort
  const leaderboard = Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points; // Sort by points desc
    }
    if (b.correct !== a.correct) {
      return b.correct - a.correct; // Tiebreaker 1: correct predictions desc
    }
    return a.name.localeCompare(b.name); // Tiebreaker 2: alphabetical
  });

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
```

- [ ] **Step 2: Manually verify the API response**

Start the server: `npm run dev`

In a browser or curl, hit `http://localhost:3000/api/leaderboard` and confirm each player object now has a `prevRank` field (integer or `null`).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add prevRank to /api/leaderboard response"
```

---

## Task 2: HTML — add `col-moved` header and fix colspan

**Files:**
- Modify: `public/index.html` (lines 129–141)

- [ ] **Step 1: Insert the `col-moved` th between `col-accuracy` and `col-pending`**

Find this block (around line 129):

```html
                  <th class="col-rank"><span class="th-full">Rank</span><span class="th-short">#</span></th>
                  <th class="col-name">Player</th>
                  <th class="col-predictions"><span class="th-full">Predictions (Correct/Resolved)</span><span class="th-short">P/R</span></th>
                  <th class="col-accuracy"><span class="th-full">Accuracy</span><span class="th-short">Acc</span></th>
                  <th class="col-pending" title="Live matches still open for voting that this player hasn't voted on yet"><span class="th-full">Not Yet Voted</span><span class="th-short">Pend</span></th>
                  <th class="col-points"><span class="th-full">Total Points</span><span class="th-short">Pts</span></th>
```

Replace it with:

```html
                  <th class="col-rank"><span class="th-full">Rank</span><span class="th-short">#</span></th>
                  <th class="col-name">Player</th>
                  <th class="col-predictions"><span class="th-full">Predictions (Correct/Resolved)</span><span class="th-short">P/R</span></th>
                  <th class="col-accuracy"><span class="th-full">Accuracy</span><span class="th-short">Acc</span></th>
                  <th class="col-moved" title="Position change since last completed match"><span class="th-full">Moved</span><span class="th-short">Mvd</span></th>
                  <th class="col-pending" title="Live matches still open for voting that this player hasn't voted on yet"><span class="th-full">Not Yet Voted</span><span class="th-short">Pend</span></th>
                  <th class="col-points"><span class="th-full">Total Points</span><span class="th-short">Pts</span></th>
```

- [ ] **Step 2: Update the loading-state colspan from 6 to 7**

Find (around line 140):

```html
                  <td colspan="6" class="loading-state">Loading standings...</td>
```

Replace with:

```html
                  <td colspan="7" class="loading-state">Loading standings...</td>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add col-moved th to leaderboard table header"
```

---

## Task 3: Client JS — compute and render MOVED cell

**Files:**
- Modify: `public/app.js` (function `loadLeaderboard`, starting around line 280)

**Context:** `loadLeaderboard` builds `sorted` (re-sorted by `livePoints` in live mode, else server order). The loop at line 317 renders one `<tr>` per player. `isLiveMode` is `true` when any player has `provisionalDelta > 0`.

- [ ] **Step 1: Compute `baseRanks` Map before the render loop**

Find this block (around line 310):

```javascript
    leaderboardBody.innerHTML = '';

    if (sorted.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }

    sorted.forEach((player, index) => {
```

Replace it with:

```javascript
    leaderboardBody.innerHTML = '';

    if (sorted.length === 0) {
      leaderboardBody.innerHTML = `<tr><td colspan="7" class="loading-state">No players registered yet.</td></tr>`;
      return;
    }

    // Baseline rank: sorted purely by points (no live delta), used in live mode
    // to compute how many spots each player has provisionally moved.
    const baseRanks = new Map(
      [...leaderboard].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.correct !== a.correct) return b.correct - a.correct;
        return a.name.localeCompare(b.name);
      }).map((p, i) => [p.name, i + 1])
    );

    sorted.forEach((player, index) => {
```

- [ ] **Step 2: Compute `deltaRank` and `movedCell` inside the loop**

Find this block inside the `sorted.forEach` (around line 332):

```javascript
      const delta      = player.provisionalDelta || 0;
      const displayPts = isLiveMode ? (player.livePoints ?? player.points) : player.points;
      const liveBadge  = isLiveMode && delta > 0
        ? `<span class="live-pts-badge">${delta}&#9889;</span>`
        : '';
```

Replace it with:

```javascript
      const delta      = player.provisionalDelta || 0;
      const displayPts = isLiveMode ? (player.livePoints ?? player.points) : player.points;
      const liveBadge  = isLiveMode && delta > 0
        ? `<span class="live-pts-badge">${delta}&#9889;</span>`
        : '';

      let deltaRank;
      if (isLiveMode) {
        const baseRank = baseRanks.get(player.name);
        deltaRank = baseRank != null ? baseRank - (index + 1) : null;
      } else {
        deltaRank = player.prevRank != null ? player.prevRank - rank : null;
      }

      let movedText, movedClass;
      if (deltaRank === null)     { movedText = 'NEW';                      movedClass = 'move-new'; }
      else if (deltaRank > 0)     { movedText = `&#9650; ${deltaRank}`;     movedClass = 'move-up'; }
      else if (deltaRank < 0)     { movedText = `&#9660; ${Math.abs(deltaRank)}`; movedClass = 'move-down'; }
      else                        { movedText = '&#8212;';                  movedClass = 'move-same'; }

      const movedCell = `<span class="${movedClass}">${movedText}</span>`;
```

- [ ] **Step 3: Add `col-moved` td to the row innerHTML**

Find the `row.innerHTML` block (around line 340):

```javascript
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${delta > 0 ? `<span class="pts-cell-inner">${liveBadge}<span class="pts-live">${displayPts}</span></span>` : displayPts}<span class="unit-label"> pts</span></td>
      `;
```

Replace it with:

```javascript
      row.innerHTML = `
        <td class="col-rank"><span class="rank-badge">${rank}</span></td>
        <td class="col-name">${escapeHtml(player.name)}</td>
        <td class="col-predictions">${correct} / ${total}</td>
        <td class="col-accuracy">${accuracy}%</td>
        <td class="col-moved">${movedCell}</td>
        <td class="col-pending">${pendingCell}</td>
        <td class="col-points">${delta > 0 ? `<span class="pts-cell-inner">${liveBadge}<span class="pts-live">${displayPts}</span></span>` : displayPts}<span class="unit-label"> pts</span></td>
      `;
```

- [ ] **Step 4: Fix error-state colspan**

Find (around line 352):

```javascript
    leaderboardBody.innerHTML = `<tr><td colspan="6" class="loading-state error-text">Error loading standings.</td></tr>`;
```

Replace with:

```javascript
    leaderboardBody.innerHTML = `<tr><td colspan="7" class="loading-state error-text">Error loading standings.</td></tr>`;
```

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: render MOVED column in leaderboard (live and non-live modes)"
```

---

## Task 4: CSS — style `col-moved` and hide `col-pending` on mobile

**Files:**
- Modify: `public/style.css`

**Context:**
- `.move-up`, `.move-down`, `.move-same`, `.move-new` classes already exist at line 920–923 — no need to add them.
- The desktop leaderboard column styles are around line 567–572.
- The mobile leaderboard media query block is at line 1502.

- [ ] **Step 1: Add desktop `col-moved` style**

Find (around line 571):

```css
.col-pending { text-align: center; width: 120px; }
```

Insert immediately after it:

```css
.col-moved { text-align: center; width: 80px; }
```

- [ ] **Step 2: Update mobile media query — hide `col-pending`, show `col-moved`, fix widths**

Find the mobile block (around line 1524):

```css
  #leaderboardTable .col-rank { width: 10%; }
  #leaderboardTable .col-name { width: 25%; }
  #leaderboardTable .col-predictions { width: 16%; }
  #leaderboardTable .col-accuracy { width: 12%; }
  #leaderboardTable .col-pending { width: 10%; }
  #leaderboardTable .col-points { width: 25%; }
```

Replace it with:

```css
  #leaderboardTable .col-rank { width: 10%; }
  #leaderboardTable .col-name { width: 26%; }
  #leaderboardTable .col-predictions { width: 16%; }
  #leaderboardTable .col-accuracy { width: 12%; }
  #leaderboardTable .col-moved { display: table-cell; width: 12%; }
  #leaderboardTable .col-pending { display: none; }
  #leaderboardTable .col-points { width: 24%; }
```

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: add col-moved styles; hide col-pending on mobile"
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify desktop layout**

Open `http://localhost:3000` in a browser. On the Leaderboard tab (Table view):
- Confirm 7 columns visible: `#`, `Player`, `P/R`, `Acc`, `Moved`, `Pend`, `Points`
- Each row has a value in the Moved column: `▲ N`, `▼ N`, `—`, or `NEW`
- If no matches are resolved yet, all rows show `NEW`

- [ ] **Step 3: Verify mobile layout**

Open DevTools → Toggle device toolbar → set width ≤ 600px. Confirm:
- `Pend` column is gone
- `Moved` column is visible
- Table fits without horizontal scrolling

- [ ] **Step 4: Verify live mode (if live matches are present)**

If there are live matches active, confirm the Moved column shows the provisional rank change (▲/▼ based on live scores), not the last completed match delta.

If no live matches are active, skip this step.

- [ ] **Step 5: Commit any fixes found during verification**

```bash
git add -p
git commit -m "fix: <describe what was wrong>"
```
