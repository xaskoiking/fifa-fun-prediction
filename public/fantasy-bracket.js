// fantasy-bracket.js
// Fantasy bracket renderer. Shares layout constants from bracket.js (loaded first).
// Keep buildFantasyBracketRounds in sync with verify_fantasy_bracket.js.

let _fantasyFocused = 0;
let _fantasyPositions = [];

function buildFantasyBracketRounds(r32Matches, picks, roundDefs) {
  const slotToMatch = new Map();
  r32Matches.forEach(m => slotToMatch.set(m.bracketSlot, m));
  const rounds = [];
  roundDefs.forEach((roundDef, r) => {
    const slots = [];
    for (let i = 0; i < roundDef.size; i++) {
      let homeTeam = 'TBD';
      let awayTeam = 'TBD';
      if (r === 0) {
        const match = slotToMatch.get(i);
        if (match) { homeTeam = match.homeTeam; awayTeam = match.awayTeam; }
      } else {
        const prevRound = rounds[r - 1];
        const parentHome = prevRound.slots[i * 2];
        const parentAway = prevRound.slots[i * 2 + 1];
        const pickHome = picks[`${roundDefs[r - 1].code}:${i * 2}`];
        const pickAway = picks[`${roundDefs[r - 1].code}:${i * 2 + 1}`];
        if (pickHome && parentHome) homeTeam = pickHome === 'home' ? parentHome.homeTeam : parentHome.awayTeam;
        if (pickAway && parentAway) awayTeam = pickAway === 'home' ? parentAway.homeTeam : parentAway.awayTeam;
      }
      slots.push({ slot: i, homeTeam, awayTeam });
    }
    rounds.push({ code: roundDef.code, label: roundDef.label, size: roundDef.size, slots });
  });
  return rounds;
}

function buildFantasyRow(roundCode, slotIdx, team, side, picks, locked, onPick) {
  const row = document.createElement('div');
  const isTbd = team === 'TBD';
  const isPick = picks[`${roundCode}:${slotIdx}`] === side;
  row.className = 'bracket-row' + (isTbd ? ' tbd' : '') + (isPick ? ' fantasy-pick' : '');
  if (!isTbd) {
    const code = getTeamCountryCode(team);
    if (code) {
      const flag = document.createElement('span');
      flag.className = 'fi fi-' + code + ' bracket-row-flag';
      row.appendChild(flag);
    }
  }
  const name = document.createElement('span');
  name.textContent = team;
  row.appendChild(name);
  if (!locked && !isTbd) {
    row.classList.add('votable');
    row.onclick = () => onPick(roundCode, slotIdx, side);
  }
  return row;
}

function buildFantasyCards(track, rounds, picks, locked, onPick) {
  track.querySelectorAll('.bracket-card--fantasy').forEach(el => el.remove());
  rounds.forEach((round, r) => {
    const xOffset = r * BRACKET_COL_PITCH;
    round.slots.forEach((slotData, i) => {
      const card = document.createElement('div');
      card.className = 'bracket-card bracket-card--fantasy' + (round.code === 'FINAL' ? ' final' : '');
      card.style.left = xOffset + 'px';
      card.dataset.round = r;
      card.dataset.slot = i;
      card.appendChild(buildFantasyRow(round.code, i, slotData.homeTeam, 'home', picks, locked, onPick));
      card.appendChild(buildFantasyRow(round.code, i, slotData.awayTeam, 'away', picks, locked, onPick));
      track.appendChild(card);
    });
  });
}

function applyFantasyPositions(rounds, track, svg) {
  rounds.forEach((round, r) => {
    if (!_fantasyPositions[r]) return;
    round.slots.forEach((_, i) => {
      const card = track.querySelector(`.bracket-card[data-round="${r}"][data-slot="${i}"]`);
      if (card) card.style.top = (_fantasyPositions[r][i] + BRACKET_HEADER_H) + 'px';
    });
  });
  drawFantasyConnectors(rounds, svg);
}

function drawFantasyConnectors(rounds, svg) {
  svg.innerHTML = '';
  let maxY = 0;
  for (let r = _fantasyFocused; r < rounds.length - 1; r++) {
    const positions = _fantasyPositions[r];
    if (!positions) continue;
    const xOffset = r * BRACKET_COL_PITCH;
    const childX = (r + 1) * BRACKET_COL_PITCH;
    positions.forEach((y, i) => {
      const pairIdx = Math.floor(i / 2);
      const childY = _fantasyPositions[r + 1][pairIdx] + BRACKET_HEADER_H + BRACKET_CARD_H / 2;
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

function goToFantasyRound(idx, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn) {
  idx = Math.min(Math.max(idx, 0), rounds.length - 1);
  if (isBracketDesktop()) {
    track.style.transform = `translateX(${BRACKET_LEFT_PAD - idx * BRACKET_COL_PITCH}px)`;
    applyBracketScrollwrapHeight(scrollwrap, roundSizes[idx]);
  } else {
    scrollwrap.scrollTo({ left: idx * BRACKET_COL_PITCH, behavior: 'smooth' });
  }
  if (idx === _fantasyFocused) return;
  _fantasyFocused = idx;
  _fantasyPositions = computeBracketPositions(roundSizes, idx, BRACKET_ROW_H);
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === rounds.length - 1;
  requestAnimationFrame(() => {
    applyFantasyPositions(rounds, track, svg);
    track.querySelectorAll('.bracket-col-label').forEach(label => {
      label.classList.toggle('active', +label.dataset.round === idx);
    });
  });
}

function renderFantasyBracket(container, rounds, picks, locked, onPick) {
  const roundSizes = rounds.map(r => r.size);

  container.innerHTML = `
    <div class="bracket-scrollwrap" id="fantasyScrollwrap">
      <button class="bracket-nav-btn bracket-nav-prev" id="fantasyPrevBtn" aria-label="Previous round" type="button">&lsaquo;</button>
      <button class="bracket-nav-btn bracket-nav-next" id="fantasyNextBtn" aria-label="Next round" type="button">&rsaquo;</button>
      <div class="bracket-track" id="fantasyTrack">
        <svg class="bracket-connectors" id="fantasySvg"></svg>
      </div>
    </div>
  `;

  const scrollwrap = container.querySelector('#fantasyScrollwrap');
  const track     = container.querySelector('#fantasyTrack');
  const svg       = container.querySelector('#fantasySvg');
  const prevBtn   = container.querySelector('#fantasyPrevBtn');
  const nextBtn   = container.querySelector('#fantasyNextBtn');

  const trackWidth = rounds.length * BRACKET_COL_PITCH + 240;
  track.style.width = trackWidth + 'px';
  svg.setAttribute('width', trackWidth);

  const focused = Math.min(_fantasyFocused, rounds.length - 1);
  _fantasyFocused = focused;
  _fantasyPositions = computeBracketPositions(roundSizes, focused, BRACKET_ROW_H);

  rounds.forEach((round, r) => {
    const label = document.createElement('div');
    label.className = 'bracket-col-label' + (r === focused ? ' active' : '');
    label.style.left = (r * BRACKET_COL_PITCH) + 'px';
    label.textContent = round.label;
    label.dataset.round = r;
    track.appendChild(label);
  });

  buildFantasyCards(track, rounds, picks, locked, onPick);
  applyFantasyPositions(rounds, track, svg);
  applyBracketScrollwrapHeight(scrollwrap, roundSizes[focused]);

  const prevTransition = track.style.transition;
  track.style.transition = 'none';
  if (isBracketDesktop()) {
    track.style.transform = `translateX(${BRACKET_LEFT_PAD - focused * BRACKET_COL_PITCH}px)`;
  } else {
    scrollwrap.scrollLeft = focused * BRACKET_COL_PITCH;
  }
  track.offsetHeight;
  track.style.transition = prevTransition;

  prevBtn.disabled = focused === 0;
  nextBtn.disabled = focused === rounds.length - 1;

  prevBtn.onclick = () => goToFantasyRound(_fantasyFocused - 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
  nextBtn.onclick = () => goToFantasyRound(_fantasyFocused + 1, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);

  if (isBracketDesktop()) {
    scrollwrap.onscroll = null;
  } else {
    scrollwrap.onscroll = debounceBracketScroll(() => {
      const idx = Math.round(scrollwrap.scrollLeft / BRACKET_COL_PITCH);
      if (idx !== _fantasyFocused && idx >= 0 && idx < rounds.length) {
        goToFantasyRound(idx, rounds, roundSizes, track, svg, scrollwrap, prevBtn, nextBtn);
      }
    });
    wireBracketDrag(scrollwrap);
  }
}
