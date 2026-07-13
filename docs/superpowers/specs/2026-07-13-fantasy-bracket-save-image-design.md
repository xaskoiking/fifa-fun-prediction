# Fantasy Bracket Save Image — Design

## Problem

The real prediction Bracket/Leaderboard tab already has a "Save image" feature (`saveLeaderboardImage()`, `public/app.js:942-977`) that captures a DOM element via `html2canvas` and downloads it as a PNG. The Fantasy Bracket modal (pre-tournament pick-your-winner game, `public/fantasy-bracket.js`) has no equivalent — users can't easily share/save their fantasy bracket picks as an image.

## Goal

Add a "Save image" button to the Fantasy Bracket modal that captures the whole bracket and downloads it as a PNG, with the current user's username stamped in big bold text in the top-right corner of the saved image (so a shared screenshot is identifiable as theirs).

## Approach

Reuse the existing `saveLeaderboardImage()` pattern exactly (same `html2canvas` options, same disabled/"Saving…" button state, same try/catch/alert-on-failure, same `<a download>` + `canvas.toDataURL('image/png')` delivery) rather than introducing a new capture mechanism.

- **Button:** A compact icon button (📷, `title="Save image"`) added to `.fantasy-modal-header` in `public/index.html`, placed before the existing `#fantasyModalClose` button. Styled as a modal-header icon button (mirroring `.fantasy-modal-close`'s look, `style.css:2780-2794`) rather than the leaderboard's `.filter-btn`/`.save-img-btn` classes, since the fantasy modal header is a tight flex row unsuited to a labeled text button.
- **Capture function:** New `saveFantasyBracketImage()` in `public/app.js`, adjacent to `saveLeaderboardImage()`. Targets `document.getElementById('fantasyBracketContainer')` (the div `renderFantasyBracket()` populates) with the same `html2canvas(el, { backgroundColor: '#07130b', scale: 2, useCORS: true })` call.
- **Username overlay:** After `html2canvas` resolves, draw the username onto the returned `canvas` via its 2D context (not the live DOM, avoiding any layout/reflow side effects) — big, bold, top-right corner, using the app's accent color with a dark stroke for legibility over bracket content. Read the username from the existing `currentUsername` global (`public/app.js:4`, already kept in sync with the logged-in user).
- **Download:** Same `<a download>` + `canvas.toDataURL('image/png')` pattern as `saveLeaderboardImage()`. Filename: `fifa-fantasy-bracket-<username>-<date>.png`.

## Out of scope

- No changes to `saveLeaderboardImage()` itself or the real Bracket tab.
- No username overlay on the existing leaderboard save-image feature — this is fantasy-bracket-only, per the request.
