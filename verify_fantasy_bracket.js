// verify_fantasy_bracket.js
// Standalone tests for fantasy bracket data logic.
// Keep buildFantasyBracketRounds in sync with public/fantasy-bracket.js.
// Keep computeCascadeClear in sync with POST /api/fantasy-bracket/pick in server.js.

const BRACKET_ROUNDS = [
  { code: 'LAST_32',        label: 'Round of 32',    size: 16 },
  { code: 'LAST_16',        label: 'Round of 16',    size: 8  },
  { code: 'QUARTER_FINALS', label: 'Quarter-finals', size: 4  },
  { code: 'SEMI_FINALS',    label: 'Semi-finals',    size: 2  },
  { code: 'FINAL',          label: 'Final',          size: 1  }
];

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

function computeCascadeClear(roundCode, slot) {
  const order = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'];
  const startIdx = order.indexOf(roundCode);
  const toClear = [];
  let currentSlot = slot;
  for (let i = startIdx + 1; i < order.length; i++) {
    currentSlot = Math.floor(currentSlot / 2);
    toClear.push(`${order[i]}:${currentSlot}`);
  }
  return toClear;
}

let passed = 0; let failed = 0;
function assert(desc, condition) {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}`); failed++; }
}

// ── buildFantasyBracketRounds ──────────────────────────────────────

console.log('\nbuildFantasyBracketRounds:');

const r32 = [
  { bracketSlot: 0, homeTeam: 'Mexico',  awayTeam: 'South Africa' },
  { bracketSlot: 1, homeTeam: 'France',  awayTeam: 'Brazil'       },
  { bracketSlot: 2, homeTeam: 'Germany', awayTeam: 'Japan'        },
  { bracketSlot: 3, homeTeam: 'Spain',   awayTeam: 'USA'          }
];

// No picks — R32 shows real teams, R16 shows TBD
let rounds = buildFantasyBracketRounds(r32, {}, BRACKET_ROUNDS);
assert('R32 slot 0 homeTeam = Mexico',                         rounds[0].slots[0].homeTeam === 'Mexico');
assert('R32 slot 0 awayTeam = South Africa',                   rounds[0].slots[0].awayTeam === 'South Africa');
assert('R32 slot 5 homeTeam = TBD (no match)',                  rounds[0].slots[5].homeTeam === 'TBD');
assert('R16 slot 0 homeTeam = TBD (no R32 pick yet)',           rounds[1].slots[0].homeTeam === 'TBD');

// Pick LAST_32:0 home → R16 slot 0 home = Mexico
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'home' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = Mexico (LAST_32:0 → home)',       rounds[1].slots[0].homeTeam === 'Mexico');
assert('R16 slot 0 awayTeam = TBD (LAST_32:1 not picked)',      rounds[1].slots[0].awayTeam === 'TBD');

// Pick LAST_32:0 away → R16 slot 0 home = South Africa
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'away' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = South Africa (LAST_32:0 → away)', rounds[1].slots[0].homeTeam === 'South Africa');

// Pick both LAST_32:0 and LAST_32:1 → R16 slot 0 fully resolved
rounds = buildFantasyBracketRounds(r32, { 'LAST_32:0': 'away', 'LAST_32:1': 'home' }, BRACKET_ROUNDS);
assert('R16 slot 0 homeTeam = South Africa',                    rounds[1].slots[0].homeTeam === 'South Africa');
assert('R16 slot 0 awayTeam = France',                          rounds[1].slots[0].awayTeam === 'France');

// Full propagation through to QF
const fullR32Picks = { 'LAST_32:0': 'home', 'LAST_32:1': 'away', 'LAST_32:2': 'home', 'LAST_32:3': 'away' };
rounds = buildFantasyBracketRounds(r32, { ...fullR32Picks, 'LAST_16:0': 'home', 'LAST_16:1': 'away' }, BRACKET_ROUNDS);
assert('QF slot 0 homeTeam = Mexico (winner of R16:0)',         rounds[2].slots[0].homeTeam === 'Mexico');
assert('QF slot 0 awayTeam = USA (winner of R16:1)',            rounds[2].slots[0].awayTeam === 'USA');

// ── computeCascadeClear ───────────────────────────────────────────

console.log('\ncomputeCascadeClear:');

let toClear = computeCascadeClear('LAST_32', 0);
assert('LAST_32:0 clears LAST_16:0',        toClear.includes('LAST_16:0'));
assert('LAST_32:0 clears QUARTER_FINALS:0', toClear.includes('QUARTER_FINALS:0'));
assert('LAST_32:0 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_32:0 clears FINAL:0',          toClear.includes('FINAL:0'));
assert('LAST_32:0 does not clear LAST_32',  !toClear.some(k => k.startsWith('LAST_32')));

toClear = computeCascadeClear('LAST_32', 7);
assert('LAST_32:7 clears LAST_16:3',        toClear.includes('LAST_16:3'));
assert('LAST_32:7 clears QUARTER_FINALS:1', toClear.includes('QUARTER_FINALS:1'));
assert('LAST_32:7 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_32:7 clears FINAL:0',          toClear.includes('FINAL:0'));

toClear = computeCascadeClear('LAST_16', 0);
assert('LAST_16:0 clears QUARTER_FINALS:0', toClear.includes('QUARTER_FINALS:0'));
assert('LAST_16:0 clears SEMI_FINALS:0',    toClear.includes('SEMI_FINALS:0'));
assert('LAST_16:0 clears FINAL:0',          toClear.includes('FINAL:0'));
assert('LAST_16:0 does not clear LAST_32',  !toClear.some(k => k.startsWith('LAST_32')));
assert('LAST_16:0 does not clear LAST_16',  !toClear.some(k => k.startsWith('LAST_16')));

toClear = computeCascadeClear('FINAL', 0);
assert('FINAL:0 clears nothing',            toClear.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
