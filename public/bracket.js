// bracket.js
// Bracket-tree renderer for the knockout stage (Round of 32 -> Final).
// computeBracketPositions/buildBracketRounds are verified in
// verify_bracket_layout.js (a standalone Node script with its own copy of
// this logic, per this repo's testing convention) — keep them in sync if
// either changes.

const BRACKET_ROUNDS = [
  { code: 'LAST_32', label: 'Round of 32', size: 16 },
  { code: 'LAST_16', label: 'Round of 16', size: 8 },
  { code: 'QUARTER_FINALS', label: 'Quarter-finals', size: 4 },
  { code: 'SEMI_FINALS', label: 'Semi-finals', size: 2 },
  { code: 'FINAL', label: 'Final', size: 1 }
];

const BRACKET_CARD_W = 168;
const BRACKET_CARD_H = 60;
const BRACKET_GAP = 28;
const BRACKET_ROW_H = BRACKET_CARD_H + BRACKET_GAP;
const BRACKET_COL_GAP = 56;
const BRACKET_COL_PITCH = BRACKET_CARD_W + BRACKET_COL_GAP;
// Vertical space reserved above row 0 for the per-column round-name label.
// Applied only at render time (card.style.top / connector Y) — kept out of
// computeBracketPositions itself so that function stays byte-identical to
// the verified copy in verify_bracket_layout.js.
const BRACKET_HEADER_H = 44;
// Desktop only: how far the focused column sits from the scrollwrap's left
// edge, so the prev-button never overlaps the focused column.
const BRACKET_LEFT_PAD = 44;
// Extra bottom breathing room below the last card.
const BRACKET_BOTTOM_PAD = 24;

function computeBracketPositions(roundSizes, focusedIdx, rowHeight) {
  const positions = [];
  positions[focusedIdx] = Array.from({ length: roundSizes[focusedIdx] }, (_, i) => i * rowHeight);
  for (let r = focusedIdx + 1; r < roundSizes.length; r++) {
    const prev = positions[r - 1];
    const n = roundSizes[r];
    positions[r] = Array.from({ length: n }, (_, i) => (prev[i * 2] + prev[i * 2 + 1]) / 2);
  }
  return positions;
}

function buildBracketRounds(matches, roundDefs) {
  const byRoundSlot = new Map();
  matches.forEach(m => {
    if (m.matchType !== 'KO' || !m.bracketRound) return;
    byRoundSlot.set(`${m.bracketRound}:${m.bracketSlot}`, m);
  });

  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      const match = byRoundSlot.get(`${roundDef.code}:${i}`) || null;
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (match) {
        homeTeam = match.homeTeam;
        awayTeam = match.awayTeam;
      }
      slots.push({ slot: i, match, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}

// --- DOM rendering ---

let _bracketFocused = 0;
let _bracketPositions = [];
let _bracketOnPick = null;
let _bracketLabelEl = null;

// The focused round is always tight-stacked (see computeBracketPositions),
// so its content height is just its own row count.
function bracketContentHeight(roundSize) {
  return BRACKET_HEADER_H + (roundSize - 1) * BRACKET_ROW_H + BRACKET_CARD_H + BRACKET_BOTTOM_PAD;
}

function renderBracket(rootEl, rounds, onPick) {
  _bracketOnPick = onPick;
  const roundSizes = rounds.map(r => r.size);

  rootEl.innerHTML = `
    <div class="bracket-header" id="bracketHeader">
      <button class="bracket-nav-btn bracket-nav-prev" id="bracketPrevBtn" aria-label="Previous round" type="button">&lsaquo;</button>
      <span class="bracket-active-label" id="bracketActiveLabel"></span>
      <button class="bracket-nav-btn bracket-nav-next" id="bracketNextBtn" aria-label="Next round" type="button">&rsaquo;</button>
    </div>
    <div class="bracket-scrollwrap" id="bracketScrollwrap">
      <div class="bracket-track" id="bracketTrack">
        <svg class="bracket-connectors" id="bracketSvg"></svg>
      </div>
    </div>
  `;

  const scrollwrap = rootEl.querySelector('#bracketScrollwrap');
  const track = rootEl.querySelector('#bracketTrack');
  const svg = rootEl.querySelector('#bracketSvg');
  const prevBtn = rootEl.querySelector('#bracketPrevBtn');
  const nextBtn = rootEl.querySelector('#bracketNextBtn');
  _bracketLabelEl = rootEl.querySelector('#bracketActiveLabel');

  const trackWidth = rounds.length * BRACKET_COL_PITCH + 240;
  track.style.width = trackWidth + 'px';
  svg.setAttribute('width', trackWidth);

  // renderBracket() is called on every data poll while the Bracket tab is
  // open — preserve whichever round the player was viewing.
  const focused = Math.min(_bracketFocused, rounds.length - 1);
  _bracketFocused = focused;
  _bracketPositions = computeBracketPositions(roundSizes, focused, BRACKET_ROW_H);

  if (_bracketLabelEl) _bracketLabelEl.textContent = rounds[focused].label;

  buildBracketColLabels(track, rounds, focused);
  buildBracketCards(track, rounds);
  applyBracketPositions(rounds, track, svg);
  updateBracketNavButtons(rounds.length, prevBtn, nextBtn);

  scrollwrap.style.height = bracketContentHeight(roundSizes[focused]) + 'px';

  // Re-apply preserved position instantly (no transition) so a silent
  // background refresh doesn't visibly move anything.
  const prevTrackTransition = track.style.transition;
  track.style.transition = 'none';
  track.style.transform = `translateX(${BRACKET_LEFT_PAD - focused * BRACKET_COL_PITCH}px)`;
  track.offsetHeight; // force reflow before re-enabling transition
  track.style.transition = prevTrackTransition;

  prevBtn.onclick = () => goToBracketRound(_bracketFocused - 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
  nextBtn.onclick = () => goToBracketRound(_bracketFocused + 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
}

function buildBracketColLabels(track, rounds, focused) {
  rounds.forEach((round, r) => {
    const label = document.createElement('div');
    label.className = 'bracket-col-label' + (r === focused ? ' active' : '');
    label.style.left = (r * BRACKET_COL_PITCH) + 'px';
    label.textContent = round.label;
    label.dataset.round = r;
    track.appendChild(label);
  });
}

function updateBracketNavButtons(roundCount, prevBtn, nextBtn) {
  prevBtn.disabled = _bracketFocused === 0;
  nextBtn.disabled = _bracketFocused === roundCount - 1;
}

function formatBracketKickoff(isoString) {
  const d = new Date(isoString);
  const mon = d.toLocaleString(undefined, { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${mon} ${day} · ${time}`;
}

function buildBracketCards(track, rounds) {
  track.querySelectorAll('.bracket-card, .bracket-slot-num').forEach(el => el.remove());
  rounds.forEach((round, r) => {
    const xOffset = r * BRACKET_COL_PITCH;
    round.slots.forEach((slotData, i) => {
      const match = slotData.match;
      const isResolved = match && match.status === 'resolved';
      const isLocked = !isResolved && match
        && (match.votingLocked || (match.hasStarted && !match.extensionActive));
      const isLive = !isResolved && match && match.hasStarted;
      const hasKickoff = match && match.kickoff;

      if (hasKickoff) {
        const num = document.createElement('div');
        num.className = 'bracket-slot-num';
        num.style.left = xOffset + 'px';
        num.dataset.round = r;
        num.dataset.slot = i;
        num.textContent = (match.matchNumber ? `#${match.matchNumber} · ` : '') + formatBracketKickoff(match.kickoff);
        track.appendChild(num);
      }

      const card = document.createElement('div');
      card.className = 'bracket-card'
        + (round.code === 'FINAL' ? ' final' : '')
        + (isResolved ? ' bracket-card--resolved' : '')
        + (isLocked   ? ' bracket-card--locked'   : '')
        + (isLive     ? ' bracket-card--live'      : '')
        + (match && match.myBooster ? ' bracket-card--boosted' : '');
      card.style.left = xOffset + 'px';
      card.dataset.round = r;
      card.dataset.slot = i;
      card.appendChild(buildBracketRow(slotData, 'home'));
      card.appendChild(buildBracketRow(slotData, 'away'));
      track.appendChild(card);
    });
  });
}

function buildBracketRow(slotData, side) {
  const row = document.createElement('div');
  const team = side === 'home' ? slotData.homeTeam : slotData.awayTeam;
  const isTbd = team === 'TBD';
  const match = slotData.match;
  const myVote = match ? match.myVote : null;
  const isPick = myVote === side;
  // Locked once the game has started (unless admin extension is active)
  const votable = !!match && match.status !== 'resolved' && !match.votingLocked
    && (!match.hasStarted || match.extensionActive);

  row.className = 'bracket-row' + (isTbd ? ' tbd' : '') + (isPick ? ' pick' : '');

  if (!isTbd && isPick && match && match.myBooster) {
    const bolt = document.createElement('span');
    bolt.className = 'bracket-row-booster';
    bolt.textContent = '⚡';
    row.appendChild(bolt);
  }

  if (!isTbd) {
    const code = getTeamCountryCode(team);
    if (code) {
      const flag = document.createElement('span');
      flag.className = 'fi fi-' + code + ' bracket-row-flag';
      row.appendChild(flag);
    }
  }

  const name = document.createElement('span');
  name.className = 'bracket-row-name';
  name.textContent = team;
  row.appendChild(name);

  const scoreVal = match && match.score != null
    ? (side === 'home' ? match.score.scoreHome : match.score.scoreAway)
    : null;
  if (scoreVal != null) {
    const scoreEl = document.createElement('span');
    scoreEl.className = 'bracket-row-score';
    scoreEl.textContent = scoreVal;
    row.appendChild(scoreEl);
  }

  if (match && match.status === 'resolved') {
    const winnerEl = document.createElement('span');
    winnerEl.className = 'bracket-row-winner';
    if (match.outcome === side) {
      row.classList.add('bracket-row--winner');
      winnerEl.textContent = '✓';
    }
    row.appendChild(winnerEl);
  }

  if (votable && !isTbd) {
    row.classList.add('votable');
    row.onclick = () => _bracketOnPick(match, side);
  }
  return row;
}

function applyBracketPositions(rounds, track, svg) {
  rounds.forEach((round, r) => {
    if (!_bracketPositions[r]) return;
    round.slots.forEach((_, i) => {
      const cardTop = _bracketPositions[r][i] + BRACKET_HEADER_H;
      const card = track.querySelector(`.bracket-card[data-round="${r}"][data-slot="${i}"]`);
      if (card) card.style.top = cardTop + 'px';
      const num = track.querySelector(`.bracket-slot-num[data-round="${r}"][data-slot="${i}"]`);
      if (num) num.style.top = (cardTop - BRACKET_GAP / 2) + 'px';
    });
  });
  drawBracketConnectors(rounds, svg);
}

function drawBracketConnectors(rounds, svg) {
  svg.innerHTML = '';
  let maxY = 0;
  for (let r = _bracketFocused; r < rounds.length - 1; r++) {
    const positions = _bracketPositions[r];
    if (!positions) continue;
    const xOffset = r * BRACKET_COL_PITCH;
    const childX = (r + 1) * BRACKET_COL_PITCH;
    positions.forEach((y, i) => {
      const pairIdx = Math.floor(i / 2);
      const childY = _bracketPositions[r + 1][pairIdx] + BRACKET_HEADER_H + BRACKET_CARD_H / 2;
      const startX = xOffset + BRACKET_CARD_W;
      const startY = y + BRACKET_HEADER_H + BRACKET_CARD_H / 2;
      const midX = startX + BRACKET_COL_GAP / 2;
      maxY = Math.max(maxY, startY, childY);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} H ${midX} V ${childY} H ${childX}`);
      svg.appendChild(path);
    });
  }
  svg.setAttribute('height', Math.max(maxY + BRACKET_CARD_H + 60, 600));
}

function goToBracketRound(idx, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn) {
  idx = Math.min(Math.max(idx, 0), rounds.length - 1);
  track.style.transform = `translateX(${BRACKET_LEFT_PAD - idx * BRACKET_COL_PITCH}px)`;
  scrollwrap.style.height = bracketContentHeight(roundSizes[idx]) + 'px';
  if (idx === _bracketFocused) return;
  _bracketFocused = idx;
  _bracketPositions = computeBracketPositions(roundSizes, idx, BRACKET_ROW_H);
  updateBracketNavButtons(rounds.length, prevBtn, nextBtn);
  if (_bracketLabelEl) _bracketLabelEl.textContent = rounds[idx].label;
  requestAnimationFrame(() => {
    applyBracketPositions(rounds, track, svg);
    track.querySelectorAll('.bracket-col-label').forEach(label => {
      label.classList.toggle('active', +label.dataset.round === idx);
    });
  });
}
