# Changelog

All notable changes to Prediction Arena are documented here.

---

## [v1.2] - 2026-06-15

### New Features

**Racing Leaderboard Chart**
- Added an animated bar-chart race to the Leaderboard tab showing how standings evolved after each resolved match
- Toggle between Table and Race views
- Playback controls: play/pause, frame scrubber, and per-match date label
- Backed by a new `/api/leaderboard/history` endpoint that builds cumulative snapshots after each resolved match

**Match Log (Admin)**
- Pulls live fixtures from football-data.org via a proxy endpoint with a 5-minute cache
- Navigate between fixtures with ◀ / ▶ buttons or jump directly by match number
- "Create Match" button is shown for all scheduled Group Stage fixtures; hidden for knockout rounds (LAST_32, LAST_16, QUARTER_FINALS, etc.)
- Displays official tournament match number alongside navigation position (e.g. `Match #23 · 23 of 104`)

**Configurable Open Match Stages (Admin)**
- New Settings panel lets admins toggle which tournament stages (Group Stage, Round of 32, Round of 16, etc.) have the "Create Match" button enabled — no code push needed when the tournament advances
- Backed by `GET /POST /api/admin/settings` endpoints

**Team Rankings in Tooltips**
- Match tooltips now show each team's FIFA/tournament ranking alongside the matchup

### Improvements

**Admin Audit Log**
- Every System History entry now includes the acting admin's username (e.g. `Admin Pradep resolved Match #23 … as HOME`) so actions are attributable with multiple admins

**Admin Session Handling**
- Stored admin passcode is now re-verified against the server on load; if it's stale the panel shows an "Admin session expired" prompt instead of silently failing every API call

**Resolve Scheduled Matches**
- The matches list now has a max-height with scroll on desktop so it doesn't cause full-page scrolling

**Mobile UI**
- Sticky header on mobile
- Admin panel cards are collapsible on mobile
- Vote Log table uses fixed column widths with responsive short-form headers to prevent text wrapping
- Leaderboard, results table, and tab nav all improved for small screens

### Infrastructure

**CI/CD Pipelines**
- GitHub Actions workflows added for automated deploys to staging and production (Cloud Run)

---

## [v1.1] - Initial Release

- Core prediction game: players vote on match outcomes (home / away / draw for league, home / away for knockout)
- Admin panel: create matches, lock/unlock voting, resolve outcomes, award points
- Leaderboard with live standings
- Results tab showing resolved matches and all player predictions
- Passcode-based login (no accounts required)
- GCS-backed persistence for Cloud Run deployments; falls back to local `data.json`
