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
const BRACKET_GAP = 16;
const BRACKET_ROW_H = BRACKET_CARD_H + BRACKET_GAP;
const BRACKET_COL_GAP = 56;
const BRACKET_COL_PITCH = BRACKET_CARD_W + BRACKET_COL_GAP;

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
      } else if (r > 0) {
        const prevCode = roundDefs[r - 1].code;
        const parentA = byRoundSlot.get(`${prevCode}:${i * 2}`);
        const parentB = byRoundSlot.get(`${prevCode}:${i * 2 + 1}`);
        if (parentA && parentA.status === 'resolved') {
          homeTeam = parentA.outcome === 'home' ? parentA.homeTeam : parentA.awayTeam;
        }
        if (parentB && parentB.status === 'resolved') {
          awayTeam = parentB.outcome === 'home' ? parentB.homeTeam : parentB.awayTeam;
        }
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

function renderBracket(rootEl, rounds, onPick) {
  _bracketOnPick = onPick;
  const roundSizes = rounds.map(r => r.size);

  rootEl.innerHTML = `
    <div class="bracket-tabs" id="bracketTabs"></div>
    <div class="bracket-scrollwrap" id="bracketScrollwrap">
      <div class="bracket-track" id="bracketTrack">
        <svg class="bracket-connectors" id="bracketSvg"></svg>
      </div>
    </div>
  `;

  const tabsEl = rootEl.querySelector('#bracketTabs');
  const scrollwrap = rootEl.querySelector('#bracketScrollwrap');
  const track = rootEl.querySelector('#bracketTrack');
  const svg = rootEl.querySelector('#bracketSvg');

  rounds.forEach((round, i) => {
    const t = document.createElement('div');
    t.className = 'bracket-tab' + (i === 0 ? ' active' : '');
    t.textContent = round.label;
    t.onclick = () => goToBracketRound(i, rounds, roundSizes, track, svg, scrollwrap, tabsEl);
    tabsEl.appendChild(t);
  });

  const trackWidth = rounds.length * BRACKET_COL_PITCH + 240;
  track.style.width = trackWidth + 'px';
  svg.setAttribute('width', trackWidth);

  _bracketFocused = 0;
  _bracketPositions = computeBracketPositions(roundSizes, 0, BRACKET_ROW_H);

  buildBracketCards(track, rounds);
  applyBracketPositions(rounds, track, svg);

  scrollwrap.onscroll = debounceBracketScroll(() => {
    const idx = Math.round(scrollwrap.scrollLeft / BRACKET_COL_PITCH);
    if (idx !== _bracketFocused && idx >= 0 && idx < rounds.length) {
      goToBracketRound(idx, rounds, roundSizes, track, svg, scrollwrap, tabsEl);
    }
  });

  wireBracketDrag(scrollwrap);
}

function debounceBracketScroll(fn) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, 140);
  };
}

let _bracketDragHandlers = null;

function wireBracketDrag(scrollwrap) {
  if (_bracketDragHandlers) {
    window.removeEventListener('mouseup', _bracketDragHandlers.up);
    window.removeEventListener('mousemove', _bracketDragHandlers.move);
  }
  let isDown = false, startX, scrollStart;
  scrollwrap.onmousedown = e => {
    isDown = true;
    startX = e.pageX;
    scrollStart = scrollwrap.scrollLeft;
    scrollwrap.style.cursor = 'grabbing';
  };
  const onMouseUp = () => { isDown = false; scrollwrap.style.cursor = 'grab'; };
  const onMouseMove = e => {
    if (!isDown) return;
    scrollwrap.scrollLeft = scrollStart - (e.pageX - startX);
  };
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  _bracketDragHandlers = { up: onMouseUp, move: onMouseMove };
}

function buildBracketCards(track, rounds) {
  track.querySelectorAll('.bracket-card').forEach(el => el.remove());
  rounds.forEach((round, r) => {
    const xOffset = r * BRACKET_COL_PITCH;
    round.slots.forEach((slotData, i) => {
      const card = document.createElement('div');
      card.className = 'bracket-card' + (round.code === 'FINAL' ? ' final' : '');
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
  const votable = !!match && match.status !== 'resolved' && !match.votingLocked;

  row.className = 'bracket-row' + (isTbd ? ' tbd' : '') + (isPick ? ' pick' : '');
  row.textContent = team;
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
      const card = track.querySelector(`.bracket-card[data-round="${r}"][data-slot="${i}"]`);
      if (card) card.style.top = _bracketPositions[r][i] + 'px';
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
      const childY = _bracketPositions[r + 1][pairIdx] + BRACKET_CARD_H / 2;
      const startX = xOffset + BRACKET_CARD_W;
      const startY = y + BRACKET_CARD_H / 2;
      const midX = startX + BRACKET_COL_GAP / 2;
      maxY = Math.max(maxY, y, childY);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} H ${midX} V ${childY} H ${childX}`);
      svg.appendChild(path);
    });
  }
  svg.setAttribute('height', Math.max(maxY + BRACKET_CARD_H + 60, 600));
}

function goToBracketRound(idx, rounds, roundSizes, track, svg, scrollwrap, tabsEl) {
  scrollwrap.scrollTo({ left: idx * BRACKET_COL_PITCH, behavior: 'smooth' });
  if (idx === _bracketFocused) return;
  _bracketFocused = idx;
  _bracketPositions = computeBracketPositions(roundSizes, idx, BRACKET_ROW_H);
  applyBracketPositions(rounds, track, svg);
  tabsEl.querySelectorAll('.bracket-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
}
