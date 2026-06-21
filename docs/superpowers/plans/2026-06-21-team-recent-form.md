# Inline Team Recent-Form Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hover/click team-info tooltip on Predictions-tab match cards with always-visible stats: FIFA ranking inline next to each team name, and up to 3 lines of recent-form results shown as `[circular flag] score [circular flag]`, sourced from football-data.org with zero new outbound API calls.

**Architecture:** The server already polls the full World Cup competition every 60s (`pollLiveScores`) for live-score badges — extend that cache with `utcDate`, derive each team's recent form from it, and attach the result to the existing `GET /api/matches` response. The client renders it inline on the match card, replacing emoji flags (which don't render on Windows) with a vendored circular flag-icon set, and replaces the old tooltip with a small tap-friendly click-to-reveal label on each flag.

**Tech Stack:** Vanilla Node.js/Express backend (`server.js`), vanilla JS/HTML/CSS frontend (`public/app.js`, `public/index.html`, `public/style.css`), vendored static assets (no bundler) — same pattern as the existing vendored `html2canvas.min.js`.

## Global Constraints

- **No new outbound football-data.org API calls.** All recent-form data must come from the existing `_liveScoresCache` populated by `pollLiveScores()` (server.js:1095-1123), which already runs every 60 seconds.
- **No test framework exists in this repo** (no jest/mocha/etc., no `test` script in `package.json`) and none should be added — that's out of scope and against this repo's established convention. Verify each step via `node -c <file>` (syntax check only) plus a manual trace against the worked example given in that step. **Do not start the dev server (`npm run dev`/`npm start`) to verify behavior** — per established project convention, verification is via code review/diff inspection; the user verifies behavior via deployment.
- **Results tab and Admin fixtures preview are unchanged.** `getTeamFlag()` (app.js:165-174) stays exactly as-is — it's still used at app.js:1382, 1384, 2517, 2521.
- **`getTeamRanking()` (app.js:176-196) is unchanged.**
- Recent-form limit is **3** matches per team everywhere (server helper default and client render).
- Flag codes use the `flag-icons` library's class convention (`fi fi-<code>`), including its UK-subdivision codes `gb-eng`, `gb-sct`, `gb-wls`.

---

## File Structure

| File | Change |
|---|---|
| `public/vendor/flag-icons/css/flag-icons.min.css` | New — vendored CSS (full file, unmodified) |
| `public/vendor/flag-icons/flags/4x3/*.svg` | New — vendored SVGs, only the ~60 codes this app uses |
| `public/index.html` | Add one `<link>` tag |
| `server.js` | Extend `pollLiveScores` cache shape; add `getRecentForm()`; attach `homeTeamForm`/`awayTeamForm` to `GET /api/matches` |
| `public/app.js` | Add `TEAM_COUNTRY_CODES`/`getTeamCountryCode()`; rewrite match-card team header + add form rows; add click-to-reveal flag label; delete dead tooltip code |
| `public/style.css` | Add `.flag-circle`, `.team-rank`, `.team-form`, `.form-row`, `.form-score`, `.flag-name-label`; adjust `.team-flag` sizing |

---

### Task 1: Vendor the flag-icon assets

**Files:**
- Create: `public/vendor/flag-icons/css/flag-icons.min.css`
- Create: `public/vendor/flag-icons/flags/4x3/{60 codes}.svg`
- Modify: `public/index.html:10` (add link tag after the existing `style.css` link)

**Interfaces:**
- Produces: a `fi fi-<code>` CSS class usable anywhere in the app for codes: `ar fr br de es it gb-eng us pt be nl uy mx ca hr ma jp sn ch dk co ir tr au ec at kr ng dz eg ua no ci pa ru pl gb-wls se hu cz py gb-sct rs cm tn cd sk gr qa iq za sa jo ba cv cw gh ht nz uz`

- [ ] **Step 1: Create the vendor directory and download the CSS**

```bash
mkdir -p public/vendor/flag-icons/css public/vendor/flag-icons/flags/4x3
curl -s -o public/vendor/flag-icons/css/flag-icons.min.css "https://cdn.jsdelivr.net/npm/flag-icons@7/css/flag-icons.min.css"
```

- [ ] **Step 2: Verify the CSS downloaded correctly**

Run: `wc -c public/vendor/flag-icons/css/flag-icons.min.css && grep -c '\.fi-' public/vendor/flag-icons/css/flag-icons.min.css`
Expected: file size > 20000 bytes, and a count well over 100 (one CSS rule per supported country code).

- [ ] **Step 3: Download only the SVGs this app actually uses**

```bash
codes=(ar fr br de es it gb-eng us pt be nl uy mx ca hr ma jp sn ch dk co ir tr au ec at kr ng dz eg ua no ci pa ru pl gb-wls se hu cz py gb-sct rs cm tn cd sk gr qa iq za sa jo ba cv cw gh ht nz uz)
for code in "${codes[@]}"; do
  curl -s -o "public/vendor/flag-icons/flags/4x3/${code}.svg" "https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/${code}.svg"
done
```

- [ ] **Step 4: Verify all 60 SVGs downloaded and are non-empty**

Run: `ls public/vendor/flag-icons/flags/4x3/*.svg | wc -l && find public/vendor/flag-icons/flags/4x3 -size 0`
Expected: first command prints `60`; second command prints nothing (no zero-byte files).

- [ ] **Step 5: Link the CSS in `index.html`**

Modify `public/index.html`, after line 10 (`<link rel="stylesheet" href="style.css">`):

```html
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="vendor/flag-icons/css/flag-icons.min.css">
```

- [ ] **Step 6: Sanity-check the relative paths resolve**

Run: `grep -o 'url([^)]*ar.svg)' public/vendor/flag-icons/css/flag-icons.min.css`
Expected output: `url(../flags/4x3/ar.svg)` — confirms the CSS's relative path (`css/` → `../flags/4x3/`) matches the directory structure created in Step 1.

- [ ] **Step 7: Commit**

```bash
git add public/vendor/flag-icons public/index.html
git commit -m "feat: vendor flag-icons asset set for team flag rendering"
```

---

### Task 2: Extend the live-score cache with match date, add `getRecentForm()`

**Files:**
- Modify: `server.js:1107-1118` (the `.map()` inside `pollLiveScores`)
- Modify: `server.js` (new function, placed directly after `pollLiveScores`, i.e. after line 1123)

**Interfaces:**
- Produces: `getRecentForm(teamName, limit = 3)` → `Array<{ opponent: string, result: 'W'|'D'|'L', scoreFor: number, scoreAgainst: number }>`, ordered most-recent-first. Task 3 consumes this exact signature.
- Consumes: existing `normalizeTeam(name)` (server.js:1060-1063), existing `_liveScoresCache` array.

- [ ] **Step 1: Add `utcDate` to the cached entry shape**

In `server.js`, replace the `_liveScoresCache` assignment inside `pollLiveScores` (lines 1107-1118):

```js
    _liveScoresCache = (data.matches || [])
      .filter(m => LIVE_STATUSES.has(m.status))
      .map(m => {
        const ft = (m.score || {}).fullTime || {};
        return {
          homeTeam: m.homeTeam?.name || '',
          awayTeam: m.awayTeam?.name || '',
          scoreHome: ft.home ?? null,
          scoreAway: ft.away ?? null,
          status: m.status,
          utcDate: m.utcDate
        };
      });
```

- [ ] **Step 2: Verify the edit is syntactically valid**

Run: `node -c server.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Add `getRecentForm()` directly after `pollLiveScores`**

Insert immediately after the closing `}` of `pollLiveScores` (after line 1123, before the `// Get which tournament stages are currently open` comment):

```js
function getRecentForm(teamName, limit = 3) {
  const normalized = normalizeTeam(teamName);
  return _liveScoresCache
    .filter(m => m.status === 'FINISHED')
    .filter(m => normalizeTeam(m.homeTeam) === normalized || normalizeTeam(m.awayTeam) === normalized)
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, limit)
    .map(m => {
      const isHome = normalizeTeam(m.homeTeam) === normalized;
      const scoreFor = isHome ? m.scoreHome : m.scoreAway;
      const scoreAgainst = isHome ? m.scoreAway : m.scoreHome;
      let result = 'D';
      if (scoreFor > scoreAgainst) result = 'W';
      else if (scoreFor < scoreAgainst) result = 'L';
      return {
        opponent: isHome ? m.awayTeam : m.homeTeam,
        result,
        scoreFor,
        scoreAgainst
      };
    });
}
```

- [ ] **Step 4: Verify syntax**

Run: `node -c server.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manually trace through a worked example**

Since this repo has no test framework and `server.js` boots a live server on require (no exports to unit-test in isolation — see Global Constraints), verify by tracing the logic by hand against this example state:

```js
_liveScoresCache = [
  { homeTeam: 'Mexico', awayTeam: 'Brazil', scoreHome: 2, scoreAway: 1, status: 'FINISHED', utcDate: '2026-06-15T19:00:00Z' },
  { homeTeam: 'Japan', awayTeam: 'Mexico', scoreHome: 1, scoreAway: 1, status: 'FINISHED', utcDate: '2026-06-10T19:00:00Z' },
  { homeTeam: 'Germany', awayTeam: 'Mexico', scoreHome: 2, scoreAway: 0, status: 'FINISHED', utcDate: '2026-06-05T19:00:00Z' },
  { homeTeam: 'Mexico', awayTeam: 'Canada', scoreHome: 3, scoreAway: 3, status: 'SCHEDULED', utcDate: '2026-06-20T19:00:00Z' }
]
```

`getRecentForm('Mexico')` should walk the array as follows: the `SCHEDULED` Canada match is filtered out by the `status === 'FINISHED'` check; the remaining 3 matches all involve Mexico; sorted descending by `utcDate` they're already in order (Jun 15, Jun 10, Jun 5); mapped to:
```js
[
  { opponent: 'Brazil',  result: 'W', scoreFor: 2, scoreAgainst: 1 },
  { opponent: 'Japan',   result: 'D', scoreFor: 1, scoreAgainst: 1 },
  { opponent: 'Germany', result: 'L', scoreFor: 0, scoreAgainst: 2 }
]
```
Confirm the code you wrote produces this by reading it line-by-line against the example — in particular that the Germany row correctly swaps `scoreFor`/`scoreAgainst` (Mexico was the *away* side in that match, so `isHome` is `false` and `scoreFor = m.scoreAway = 0`).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: derive team recent-form from existing live-score poll cache"
```

---

### Task 3: Attach recent-form data to `GET /api/matches`

**Files:**
- Modify: `server.js:419-483` (`app.get('/api/matches', ...)`)

**Interfaces:**
- Consumes: `getRecentForm(teamName, limit)` from Task 2.
- Produces: every object in the `GET /api/matches` JSON array gains `homeTeamForm` and `awayTeamForm` fields (same array shape as `getRecentForm`'s return value). Task 6 (client) consumes these exact field names.

- [ ] **Step 1: Attach the fields in the "started/resolved" branch**

In `server.js`, inside the `if (hasStarted || match.status === 'resolved')` block (lines 440-454), add two fields to the returned object:

```js
    if (hasStarted || match.status === 'resolved') {
      // If started but extension is active, treat it like a pre-kickoff open match for voting
      return {
        ...match,
        hasStarted: true,
        extensionActive: !!extensionActive,
        votingExtendedUntil: match.votingExtendedUntil || null,
        myVote,
        voteCounts: {
          home: match.votes.home.length,
          away: match.votes.away.length,
          draw: match.votes.draw ? match.votes.draw.length : 0
        },
        voters: match.votes,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam)
      };
    } else {
```

- [ ] **Step 2: Attach the same fields in the "hidden pre-kickoff" branch**

Immediately below, in the `else` block (lines 456-479):

```js
    } else {
      // Hide details before kickoff
      return {
        id: match.id,
        matchNumber: match.matchNumber,
        group: match.group,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        matchType: match.matchType,
        kickoff: match.kickoff,
        status: match.status,
        outcome: match.outcome,
        votingLocked: !!match.votingLocked,
        hasStarted: false,
        extensionActive: false,
        votingExtendedUntil: null,
        myVote,
        voteCounts: {
          home: null,
          away: null,
          draw: null
        },
        voters: null,
        homeTeamForm: getRecentForm(match.homeTeam),
        awayTeamForm: getRecentForm(match.awayTeam)
      };
    }
```

- [ ] **Step 3: Verify syntax**

Run: `node -c server.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Manual trace**

Confirm by reading the diff that both branches call `getRecentForm` with the match's own `homeTeam`/`awayTeam` strings (not the normalized form — `getRecentForm` normalizes internally), and that the fields are added without removing or renaming any existing field in either branch.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: include recent-form data in /api/matches response"
```

---

### Task 4: Add the team→country-code lookup table

**Files:**
- Modify: `public/app.js` (new function, placed directly after `getTeamRanking`, i.e. after line 196)

**Interfaces:**
- Produces: `getTeamCountryCode(teamName)` → `string | null`. Tasks 5, 6, 7 consume this.

- [ ] **Step 1: Add the table and lookup function**

Insert immediately after the closing `}` of `getTeamRanking` (after app.js:196):

```js
function getTeamCountryCode(teamName) {
  const codes = {
    'argentina': 'ar', 'france': 'fr', 'brazil': 'br', 'germany': 'de',
    'spain': 'es', 'italy': 'it', 'england': 'gb-eng', 'usa': 'us',
    'portugal': 'pt', 'belgium': 'be', 'netherlands': 'nl', 'uruguay': 'uy',
    'mexico': 'mx', 'canada': 'ca', 'croatia': 'hr', 'morocco': 'ma',
    'japan': 'jp', 'senegal': 'sn', 'switzerland': 'ch', 'denmark': 'dk',
    'colombia': 'co', 'iran': 'ir', 'türkiye': 'tr', 'australia': 'au',
    'ecuador': 'ec', 'austria': 'at', 'south korea': 'kr', 'nigeria': 'ng',
    'algeria': 'dz', 'egypt': 'eg', 'ukraine': 'ua', 'norway': 'no',
    'ivory coast': 'ci', 'panama': 'pa', 'russia': 'ru', 'poland': 'pl',
    'wales': 'gb-wls', 'sweden': 'se', 'hungary': 'hu', 'czechia': 'cz',
    'paraguay': 'py', 'scotland': 'gb-sct', 'serbia': 'rs', 'cameroon': 'cm',
    'tunisia': 'tn', 'dr congo': 'cd', 'slovakia': 'sk', 'greece': 'gr',
    'qatar': 'qa', 'iraq': 'iq', 'south africa': 'za',
    'saudi arabia': 'sa', 'jordan': 'jo', 'bosnia & herzegovina': 'ba',
    'cape verde': 'cv', 'curaçao': 'cw', 'ghana': 'gh', 'haiti': 'ht',
    'new zealand': 'nz', 'uzbekistan': 'uz'
  };
  return codes[teamName.toLowerCase().trim()] || null;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c public/app.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Manual trace**

Confirm `getTeamCountryCode('Mexico')` → `'mx'`, `getTeamCountryCode('mexico')` → `'mx'` (case-insensitive, matches `getTeamRanking`'s behavior), and `getTeamCountryCode('Atlantis')` → `null` (unmapped team, no crash) by reading the lookup logic.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add team name to country-code lookup for flag rendering"
```

---

### Task 5: Rewrite the match-card team header (ranking inline, circular flag, no info button)

**Files:**
- Modify: `public/app.js:1256-1272` (the `.match-teams` block inside `renderMatches()`)

**Interfaces:**
- Consumes: `getTeamCountryCode(teamName)` (Task 4), existing `getTeamRanking(teamName)` (app.js:176), existing `escapeHtml`.

- [ ] **Step 1: Add a small helper to build one team's flag span**

Insert directly above `function renderMatches()` (before app.js:1155):

```js
function buildFlagSpan(teamName, extraClass) {
  const code = getTeamCountryCode(teamName);
  const fiClass = code ? `fi fi-${code}` : '';
  return `<span class="flag-circle ${extraClass} ${fiClass}" data-team="${escapeHtml(teamName)}"></span>`;
}
```

- [ ] **Step 2: Replace the team header markup**

In `renderMatches()`, replace lines 1256-1272:

```js
      <div class="match-teams">
        <div class="team">
          <span class="team-flag">${getTeamFlag(match.homeTeam)}</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
            <button class="team-info-btn" data-team="${escapeHtml(match.homeTeam)}" title="Team info" aria-label="Team info" style="background:transparent; border:none; color:var(--text-muted); font-size:0.9rem; padding:2px 6px; cursor:pointer;">ℹ️</button>
          </span>
        </div>
        <div class="vs-divider">VS</div>
        <div class="team">
          <span class="team-flag">${getTeamFlag(match.awayTeam)}</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
            <button class="team-info-btn" data-team="${escapeHtml(match.awayTeam)}" title="Team info" aria-label="Team info" style="background:transparent; border:none; color:var(--text-muted); font-size:0.9rem; padding:2px 6px; cursor:pointer;">ℹ️</button>
          </span>
        </div>
      </div>
```

with:

```js
      <div class="match-teams">
        <div class="team">
          ${buildFlagSpan(match.homeTeam, 'team-flag')}
          <span style="display:flex; align-items:center; gap:6px;">
            <span class="team-name" title="${escapeHtml(match.homeTeam)}">${escapeHtml(match.homeTeam)}</span>
            <span class="team-rank">#${getTeamRanking(match.homeTeam) || '-'}</span>
          </span>
          ${buildTeamFormHtml(match.homeTeam, match.homeTeamForm)}
        </div>
        <div class="vs-divider">VS</div>
        <div class="team">
          ${buildFlagSpan(match.awayTeam, 'team-flag')}
          <span style="display:flex; align-items:center; gap:6px;">
            <span class="team-name" title="${escapeHtml(match.awayTeam)}">${escapeHtml(match.awayTeam)}</span>
            <span class="team-rank">#${getTeamRanking(match.awayTeam) || '-'}</span>
          </span>
          ${buildTeamFormHtml(match.awayTeam, match.awayTeamForm)}
        </div>
      </div>
```

(`buildTeamFormHtml` is added in Task 6 — this task will not yet be syntactically runnable end-to-end until Task 6 lands, but `node -c` only checks syntax, not that every referenced function exists, so this is fine to commit as an incremental step.)

- [ ] **Step 3: Verify syntax**

Run: `node -c public/app.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Manual trace**

Confirm: the `ℹ️` button and its inline `team-info-btn` styling are gone; `buildFlagSpan` is called with the raw (non-escaped) team name and escapes it internally for the `data-team` attribute; `getTeamRanking(match.homeTeam) || '-'` renders `-` for an unranked team (since `getTeamRanking` returns `0` for unranked, and `0 || '-'` evaluates to `'-'`).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: render inline flag and ranking on match-card team headers"
```

---

### Task 6: Render recent-form rows (API data + local fallback)

**Files:**
- Modify: `public/app.js` (new `buildTeamFormHtml` function, placed near `buildFlagSpan` from Task 5)

**Interfaces:**
- Consumes: `match.homeTeamForm`/`match.awayTeamForm` (Task 3's shape: `Array<{opponent, result, scoreFor, scoreAgainst}>`), existing `getRecentResolvedMatchesForTeam(teamName, limit)` (app.js:2817) as fallback, `getTeamCountryCode` (Task 4).
- Produces: `buildTeamFormHtml(teamName, apiForm)` → HTML string, called from Task 5's template.

- [ ] **Step 1: Add `buildTeamFormHtml`**

Insert directly after `buildFlagSpan` (added in Task 5):

```js
function buildTeamFormHtml(teamName, apiForm) {
  let rows;
  if (apiForm && apiForm.length > 0) {
    rows = apiForm.map(f => ({
      opponent: f.opponent,
      middle: `${f.scoreFor}-${f.scoreAgainst}`
    }));
  } else {
    const local = getRecentResolvedMatchesForTeam(teamName, 3);
    rows = local.map(r => ({
      opponent: r.opponent,
      middle: r.result === 'Win' ? 'W' : r.result === 'Lost' ? 'L' : 'D'
    }));
  }
  if (rows.length === 0) return '';
  const rowsHtml = rows.map(r => `
    <div class="form-row">
      ${buildFlagSpan(teamName, 'form-flag')}
      <span class="form-score">${escapeHtml(r.middle)}</span>
      ${buildFlagSpan(r.opponent, 'form-flag')}
    </div>
  `).join('');
  return `<div class="team-form">${rowsHtml}</div>`;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c public/app.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Manual trace through both branches**

API branch — given `apiForm = [{ opponent: 'Brazil', result: 'W', scoreFor: 2, scoreAgainst: 1 }]` and `teamName = 'Mexico'`, confirm the output is one `.form-row` with a Mexico flag, the text `2-1`, and a Brazil flag.

Fallback branch — given `apiForm = []` and a local resolved match where Mexico beat Japan, confirm `getRecentResolvedMatchesForTeam('Mexico', 3)` (existing function, app.js:2817) returns `[{ opponent: 'Japan', result: 'Win', kickoff: ..., raw: ... }]`, which maps to `middle: 'W'`, producing one `.form-row` with a Mexico flag, the text `W`, and a Japan flag.

Empty branch — given both `apiForm = []` and no local resolved matches, confirm `rows.length === 0` returns `''`, so `buildTeamFormHtml`'s caller renders nothing extra for that team (matches spec: omit the block entirely, no empty-state text).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: render recent-form score rows under each team on match cards"
```

---

### Task 7: Click-to-reveal team name on flag tap

**Files:**
- Modify: `public/app.js` (new code, placed where the old tooltip listener attachment used to be called, i.e. near the end of the file)

**Interfaces:**
- Consumes: `data-team` attribute already emitted by `buildFlagSpan` (Task 5).
- Produces: a single document-level click listener, attached once at module load. No other task depends on this one.

- [ ] **Step 1: Add the label element helper and click handler**

Add near the bottom of `public/app.js` (this replaces the tooltip-related code that Task 8 will delete — for now, add it independently so it can be verified on its own):

```js
function getFlagNameLabel() {
  let label = document.getElementById('flag-name-label');
  if (!label) {
    label = document.createElement('div');
    label.id = 'flag-name-label';
    label.className = 'flag-name-label';
    label.style.display = 'none';
    document.body.appendChild(label);
  }
  return label;
}

function showFlagNameLabel(flagEl, teamName) {
  const label = getFlagNameLabel();
  label.textContent = teamName;
  const rect = flagEl.getBoundingClientRect();
  label.style.left = `${Math.round(rect.left)}px`;
  label.style.top = `${Math.round(rect.bottom + 6)}px`;
  label.style.display = 'block';
  label.dataset.forFlag = teamName;
}

function hideFlagNameLabel() {
  const label = document.getElementById('flag-name-label');
  if (label) label.style.display = 'none';
}

document.addEventListener('click', (e) => {
  const flag = e.target.closest('.flag-circle[data-team]');
  const label = document.getElementById('flag-name-label');
  const wasShowingForThisFlag = flag && label && label.style.display === 'block' && label.dataset.forFlag === flag.dataset.team;
  hideFlagNameLabel();
  if (flag && !wasShowingForThisFlag) {
    showFlagNameLabel(flag, flag.dataset.team);
  }
});
```

- [ ] **Step 2: Verify syntax**

Run: `node -c public/app.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Manual trace**

Confirm the toggle behavior by tracing two consecutive clicks on the same flag: click 1 — `label` doesn't exist yet (`wasShowingForThisFlag` is falsy), so `hideFlagNameLabel` is a no-op and the label is shown. Click 2 on the *same* flag — `label.style.display === 'block'` and `label.dataset.forFlag === flag.dataset.team` are both true, so `wasShowingForThisFlag` is `true`, the label is hidden, and the `if` guard prevents it from being immediately re-shown. Click on a *different* flag while one is open — `wasShowingForThisFlag` is `false` (different `data-team`), so the old label is hidden and the new one shown.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add click-to-reveal team name label on flag tap"
```

---

### Task 8: Remove the old tooltip system (dead code)

**Files:**
- Modify: `public/app.js` — delete the functions listed below and their call sites.

**Interfaces:**
- Nothing downstream depends on any of these — confirmed in Task analysis (`unescapeHtml` has no callers outside this block).

- [ ] **Step 1: Delete the tooltip functions and DOM element creation**

Delete from `public/app.js`, in full:
- `createTeamTooltipElement` (app.js:2668-2687)
- `showTeamTooltipForElement` (app.js:2692-2720)
- `hideTeamTooltip` (app.js:2722-2733)
- `attachTeamTooltipListeners` (app.js:2735-2803)
- `unescapeHtml` (app.js:2806-2814)
- `getRecentResolvedMatchesForTeam` is **kept** (it's the fallback data source used by Task 6's `buildTeamFormHtml` — do not delete)
- `buildRecentMatchesHtml` (app.js:2838-2849)
- `populateTeamTooltipWithMatches` (app.js:2852-2888)
- `attachExtendedTeamTooltipBehavior` (app.js:2891-2935, including its trailing `MutationObserver` block)
- The call site `attachExtendedTeamTooltipBehavior();` (the line directly after that function's closing `}`)

- [ ] **Step 2: Remove the call to the now-deleted `attachTeamTooltipListeners`**

In `renderMatches()`, remove this line near the end of the function (app.js:1284):

```js
  attachTeamTooltipListeners();
```

(`updateAllTimers();` directly above it stays.)

- [ ] **Step 3: Verify syntax and check for orphaned references**

Run: `node -c public/app.js`
Expected: no output (exit code 0).

Run: `grep -n "TeamTooltip\|team-ranking-tooltip\|buildRecentMatchesHtml\|populateTeamTooltipWithMatches\|unescapeHtml" public/app.js`
Expected: no output (all references removed).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "refactor: remove dead hover/click team-info tooltip code"
```

---

### Task 9: CSS for flags, ranking, form rows, and the name label

**Files:**
- Modify: `public/style.css` (add new rules near the existing `.team`/`.team-name`/`.team-flag` rules, i.e. after line ~368)

**Interfaces:**
- Consumes: class names emitted by Tasks 5-7 (`flag-circle`, `team-flag`, `form-flag`, `team-rank`, `team-form`, `form-row`, `form-score`, `flag-name-label`).

- [ ] **Step 1: Replace the `.team-flag` rule and add the new rules**

In `public/style.css`, replace the existing `.team-flag` rule (around line 366-368):

```css
.team-flag {
  font-size: 2rem;
}
```

with:

```css
.flag-circle {
  display: inline-block;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  flex-shrink: 0;
}

.team-flag {
  width: 32px;
  height: 32px;
}

.form-flag {
  width: 16px;
  height: 16px;
}

.team-rank {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.team-form {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.72rem;
}

.form-score {
  font-weight: 700;
  color: var(--text-muted);
  min-width: 20px;
  text-align: center;
}

.flag-name-label {
  position: fixed;
  z-index: 9999;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  border-radius: 6px;
  font-size: 0.8rem;
  pointer-events: none;
}
```

- [ ] **Step 2: Verify no leftover reference to the old 2rem emoji sizing**

Run: `grep -n "team-flag" public/style.css`
Expected: one match — the new `.team-flag { width: 32px; height: 32px; }` rule (font-size is gone since `.flag-circle` is now an image-backed element, not emoji text).

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add circular flag, ranking, and recent-form row styles"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (server cache + helper) → Tasks 2-3. §2 (flag vendoring + lookup table) → Tasks 1, 4. §3.1-3.2 (header + form rows) → Tasks 5-6. §3.3 (fallback) → Task 6. §3.4 (click-to-reveal) → Task 7. §3.5 (removal) → Task 8. §4 (CSS) → Task 9.
- **Type consistency:** `getRecentForm` (Task 2) returns `{opponent, result, scoreFor, scoreAgainst}` — Task 6's `buildTeamFormHtml` destructures exactly those four fields. `buildFlagSpan(teamName, extraClass)` (Task 5) is called identically in Tasks 5 and 6 with `'team-flag'`/`'form-flag'` as the second argument, matching the CSS classes Task 9 defines.
- **Ordering dependency:** Task 5 references `buildTeamFormHtml` before Task 6 defines it — called out explicitly in Task 5 Step 2 as an expected, harmless intermediate state (syntax-valid, just not runtime-complete until Task 6 lands). If executing tasks out of order, do Tasks 5 and 6 back-to-back.
