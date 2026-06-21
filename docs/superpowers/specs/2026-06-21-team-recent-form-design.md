# Design: Inline Team Recent-Form Stats on Match Cards

**Date:** 2026-06-21
**Branch:** feature/team-form-stats

## Summary

Replace the hover/click "Team Info" tooltip on Predictions-tab match cards with always-visible stats under each team name: FIFA ranking inline next to the name, and up to 3 lines of recent results shown as `[circular flag] score [circular flag]`. Recent-form data comes from football-data.org, riding entirely on an API call the server already makes every 60 seconds (`pollLiveScores`) — no new outbound API requests. Falls back to locally-resolved vote data when the API has nothing for a team. Flags are rendered via a bundled flag-icon set instead of emoji (emoji flags don't render on Windows). Tapping a flag reveals the team name via a small click-toggled label that works on mobile (no hover dependency).

---

## 1. Server (`server.js`)

### 1.1 Extend the existing live-score poll (no new API calls)

`pollLiveScores()` (server.js:1095-1123) already fetches `GET /v4/competitions/WC/matches` every 60 seconds for live-score badges. Add `utcDate` to the cached entry shape (the raw API response already includes it — just stop dropping it):

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

### 1.2 New helper: `getRecentForm(teamName, limit = 3)`

Added near `normalizeTeam()` (server.js:1060). Filters `_liveScoresCache` for `status === 'FINISHED'` matches involving `teamName` (matched via `normalizeTeam`, reusing the existing `TEAM_NAME_ALIASES` table), sorts by `utcDate` descending, takes the first `limit`, and maps to:

```js
{ opponent, result: 'W'|'D'|'L', scoreFor, scoreAgainst }
```

`result`/`scoreFor`/`scoreAgainst` are computed relative to whichever side `teamName` was on in that match.

### 1.3 Attach to `GET /api/matches`

In `app.get('/api/matches', ...)` (server.js:419-483), compute and attach to every match object in both the "started/resolved" branch and the "hidden pre-kickoff" branch (past results don't leak anything about the upcoming match):

```js
homeTeamForm: getRecentForm(match.homeTeam),
awayTeamForm: getRecentForm(match.awayTeam)
```

If `_liveScoresCache` has no finished matches for that team (pre-tournament, name mismatch, or a locally-created friendly not in the WC competition), this returns `[]` and the client falls back to local data (see 3.3).

---

## 2. Flag rendering (`public/`)

### 2.1 Vendor a flag-icon set

Emoji flags (current `getTeamFlag()`, app.js:165-174) don't render on Windows and can't be clipped into a circle. Vendor the `flag-icons` library (MIT, covers all ISO 3166-1 codes) the same way `html2canvas` is already vendored (public/index.html:603) — drop its CSS + sprite/SVG assets into `public/vendor/flag-icons/` and link it:

```html
<link rel="stylesheet" href="vendor/flag-icons/css/flag-icons.min.css">
```

### 2.2 Team name → country code table

Replace `getTeamFlag()` entirely with a name→ISO-code lookup, reusing the same ~48 team-name keys already in `getTeamRanking()` (app.js:177-195):

```js
const TEAM_COUNTRY_CODES = {
  'argentina': 'ar', 'france': 'fr', 'brazil': 'br', 'germany': 'de',
  'spain': 'es', 'italy': 'it', 'england': 'gb-eng', 'usa': 'us',
  // ... mirrors getTeamRanking's key list
};
function getTeamCountryCode(teamName) {
  return TEAM_COUNTRY_CODES[teamName.toLowerCase().trim()] || null;
}
```

`flag-icons` supports home-nation codes (`gb-eng`, `gb-sct`, `gb-wls`, `gb-nir`) for the UK sides.

### 2.3 Rendering a flag

```html
<span class="flag-circle fi fi-br" data-team="Brazil"></span>
```

`.flag-circle` (new CSS, see §4) clips it to ~18-20px circle. If `getTeamCountryCode` returns `null` (unmapped team), render a neutral placeholder circle with no `fi-*` class instead of a broken flag.

This same lookup also replaces the large flag shown today next to each team's name at the top of the card (app.js:1258, :1266) — fixing the rendering bug everywhere, not just in the new form rows.

---

## 3. Client rendering (`app.js`)

### 3.1 Team header (within `renderMatches()`, app.js:1251-1278)

Remove the `.team-info-btn` ℹ️ button. Append ranking inline after the name:

```html
<span class="team-flag flag-circle fi fi-br"></span>
<span class="team-name">Brazil</span>
<span class="team-rank">#6</span>
```

### 3.2 Recent-form rows

Below each team's header, render up to 3 rows from `match.homeTeamForm` / `match.awayTeamForm`:

```html
<div class="team-form">
  <div class="form-row">
    <span class="flag-circle fi fi-mx" data-team="Mexico"></span>
    <span class="form-score">2-1</span>
    <span class="flag-circle fi fi-br" data-team="Brazil"></span>
  </div>
  <!-- up to 2 more rows -->
</div>
```

Each row's two flags are: the form entry's own team and `entry.opponent`, ordered so the team matching this card's column renders first. `form-score` is `${scoreFor}-${scoreAgainst}`.

### 3.3 Fallback when `homeTeamForm`/`awayTeamForm` is empty

Reuse `getRecentResolvedMatchesForTeam()` (app.js:2817, kept as-is). Since locally-resolved matches only store `outcome` (no numeric score), render the middle cell as the result letter instead of a score:

```html
<span class="flag-circle fi fi-mx"></span>
<span class="form-score">W</span>
<span class="flag-circle fi fi-br" data-team="Brazil"></span>
```

If both the API form and the local fallback are empty, omit the `.team-form` block entirely for that team (no placeholder text).

### 3.4 Click-to-reveal team name on flag tap

A single delegated click listener (attached once, analogous in spirit to the old tooltip's document click handler but much smaller):

```js
document.addEventListener('click', (e) => {
  const flag = e.target.closest('.flag-circle[data-team]');
  hideFlagNameLabel();
  if (flag) showFlagNameLabel(flag, flag.dataset.team);
});
```

`showFlagNameLabel` positions a small reused label `<div>` (single shared DOM node, created lazily like the old `team-ranking-tooltip` was) near the clicked flag showing the team name as plain text; any other click (including a different flag) hides the previous label first. This works identically via tap on mobile and click on desktop — no dependency on hover or the native `title` attribute.

### 3.5 Removed

Delete entirely (now dead code): `createTeamTooltipElement`, `showTeamTooltipForElement`, `hideTeamTooltip`, `attachTeamTooltipListeners`, `attachExtendedTeamTooltipBehavior`, `populateTeamTooltipWithMatches`, `buildRecentMatchesHtml`, `unescapeHtml` (only used by the removed tooltip code — confirm no other callers before deleting), the `#team-ranking-tooltip` DOM element, and the `.team-info-btn` markup/CSS. `getTeamFlag()` is replaced by `getTeamCountryCode()`. `getTeamRanking()` is unchanged.

---

## 4. CSS (`style.css`)

```css
.flag-circle {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255,255,255,0.08); /* visible placeholder when unmapped */
  vertical-align: middle;
  cursor: pointer;
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
  margin-top: 2px;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.75rem;
}

.form-score {
  font-weight: 700;
  color: var(--text-muted);
}

.flag-name-label {
  position: fixed;
  z-index: 9999;
  padding: 4px 8px;
  background: rgba(0,0,0,0.85);
  color: #fff;
  border-radius: 6px;
  font-size: 0.8rem;
  pointer-events: none;
}
```

The enlarged top-of-card flag keeps its existing larger size (`.team-flag` font-size rule is replaced by an explicit width/height on the same `.flag-circle` class, scoped via a modifier e.g. `.team .flag-circle` at ~32px).

---

## Edge Cases

- **Team not in `TEAM_COUNTRY_CODES`:** render a plain placeholder circle (no `fi-*` class, no crash); clicking it still shows the name label.
- **No finished matches yet for a team this tournament, and no local resolved matches either:** omit the `.team-form` block — no empty-state text.
- **API team-name spelling differs from local naming (e.g. "Korea Republic" vs "South Korea"):** pre-existing gap, not introduced by this change — falls back to the placeholder flag rather than crashing. Not addressed further in this pass.
- **Flag tapped twice in a row:** second click hides the label (toggle), matching tap-to-dismiss expectations on mobile.
- **`pollLiveScores` hasn't run yet (server just started):** `_liveScoresCache` is `[]`, `getRecentForm` returns `[]` for everyone, all teams show the local fallback (or nothing) until the first poll completes (≤60s after boot).

---

## Out of Scope

- Results tab and leaderboard are unchanged.
- No head-to-head (`/head2head`) data — recent form only, per earlier decision.
- No new backend endpoint — everything rides on the existing `/api/matches` response.
- No change to `getTeamRanking()` or the ranking data itself.
