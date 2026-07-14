// verify_bracket_layout.js
// Test script for the pure bracket-tree layout math used by the Bracket
// tab. Mirrors the existing standalone-test pattern used by
// verify_race_stage_breakdown.js: a local copy of the pure function,
// runnable under plain Node (no DOM needed for this math). The real copy
// lives in public/bracket.js.

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

function buildThirdPlaceSlot(byRoundSlot) {
  const match = byRoundSlot.get('THIRD_PLACE:0') || null;
  let homeTeam = 'TBD';
  let awayTeam = 'TBD';
  if (match) {
    homeTeam = match.homeTeam;
    awayTeam = match.awayTeam;
  }
  return { slot: 0, match, homeTeam, awayTeam };
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
  const thirdPlace = buildThirdPlaceSlot(byRoundSlot);
  return { rounds, thirdPlace };
}

let failed = false;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING BRACKET LAYOUT TESTS ===");

const ROUND_SIZES = [4, 2, 1]; // small tree: 4 -> 2 -> 1, same shape as LAST_32..FINAL

console.log("\nTest #1: focused = 0 (first round) — tight stack at rowHeight intervals");
{
  const positions = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(positions[0][0], 0, 'round 0 slot 0 sits at y=0');
  assertEqual(positions[0][1], 80, 'round 0 slot 1 sits at y=80 (one rowHeight down)');
  assertEqual(positions[0][2], 160, 'round 0 slot 2 sits at y=160');
  assertEqual(positions[0][3], 240, 'round 0 slot 3 sits at y=240');
}

console.log("\nTest #2: later rounds are the midpoint of their two parents");
{
  const positions = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(positions[1][0], 40, 'round 1 slot 0 is midpoint of round 0 slots 0 (y=0) and 1 (y=80)');
  assertEqual(positions[1][1], 200, 'round 1 slot 1 is midpoint of round 0 slots 2 (y=160) and 3 (y=240)');
  assertEqual(positions[2][0], 120, 'round 2 (final) slot 0 is midpoint of round 1 slots 0 (y=40) and 1 (y=200)');
}

console.log("\nTest #3: rounds before focusedIdx are left unset (not rendered)");
{
  const positions = computeBracketPositions(ROUND_SIZES, 1, 80);
  assertEqual(positions[0], undefined, 'round 0 has no computed position when focus starts at round 1');
  assertEqual(positions[1][0], 0, 'the now-focused round 1 slot 0 tight-stacks at y=0');
  assertEqual(positions[1][1], 80, 'the now-focused round 1 slot 1 tight-stacks at y=80');
}

console.log("\nTest #4: cascade — focusing a later round re-tightens it and ripples forward");
{
  const beforeFocus = computeBracketPositions(ROUND_SIZES, 0, 80);
  assertEqual(beforeFocus[1][0], 40, 'before compaction, round 1 slot 0 sits at the sparser midpoint y=40');

  const afterFocus = computeBracketPositions(ROUND_SIZES, 1, 80);
  assertEqual(afterFocus[1][0], 0, 'after round 1 becomes focused, it compacts to the tight y=0');
  assertEqual(afterFocus[2][0], 40, 'round 2 (final) cascades to the midpoint of round 1\'s NEW positions (0 and 80) = 40, not the old 120');
}

console.log("\nTest #5: single-round tree (FINAL only, focused) has exactly one position");
{
  const positions = computeBracketPositions([1], 0, 80);
  assertEqual(positions[0].length, 1, 'exactly one slot');
  assertEqual(positions[0][0], 0, 'sits at y=0');
}

console.log("\n=== RUNNING BRACKET ROUNDS DERIVATION TESTS ===");

const ROUND_DEFS = [
  { code: 'LAST_32', label: 'Round of 32', size: 4 },
  { code: 'LAST_16', label: 'Round of 16', size: 2 },
  { code: 'FINAL', label: 'Final', size: 1 }
];

console.log("\nTest #6: no matches at all — full TBD skeleton");
{
  const { rounds } = buildBracketRounds([], ROUND_DEFS);
  assertEqual(rounds.length, 3, 'three rounds in the skeleton');
  assertEqual(rounds[0].slots.length, 4, 'LAST_32 has 4 slots');
  assertEqual(rounds[0].slots[0].homeTeam, 'TBD', 'LAST_32 slot 0 home is TBD with no matches');
  assertEqual(rounds[1].slots[0].homeTeam, 'TBD', 'LAST_16 slot 0 home is TBD with no matches');
  assertEqual(rounds[2].slots[0].homeTeam, 'TBD', 'FINAL slot 0 home is TBD with no matches');
}

console.log("\nTest #7: an unresolved LAST_32 match shows its real teams in round 0 only");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'scheduled', outcome: null }
  ];
  const { rounds } = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[0].slots[0].homeTeam, 'Germany', 'round 0 slot 0 shows the real home team');
  assertEqual(rounds[0].slots[0].awayTeam, 'Paraguay', 'round 0 slot 0 shows the real away team');
  assertEqual(rounds[1].slots[0].homeTeam, 'TBD', 'LAST_16 slot 0 home stays TBD — parent A not resolved yet');
}

console.log("\nTest #8: resolving one parent fills only that half of the next round's slot");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'scheduled', outcome: null }
  ];
  const { rounds } = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 home fills with the resolved winner (Germany)');
  assertEqual(rounds[1].slots[0].awayTeam, 'TBD', 'LAST_16 slot 0 away stays TBD — sibling match (slot 1) not resolved yet');
}

console.log("\nTest #9: resolving both parents fills both halves of the next round's slot");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'resolved', outcome: 'away' }
  ];
  const { rounds } = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 home is the LAST_32 slot-0 winner');
  assertEqual(rounds[1].slots[0].awayTeam, 'Sweden', 'LAST_16 slot 0 away is the LAST_32 slot-1 winner (away won)');
}

console.log("\nTest #10: an explicit next-round match record takes priority over derivation");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Paraguay', status: 'resolved', outcome: 'home' },
    { matchType: 'KO', bracketRound: 'LAST_32', bracketSlot: 1, homeTeam: 'France', awayTeam: 'Sweden', status: 'resolved', outcome: 'away' },
    { matchType: 'KO', bracketRound: 'LAST_16', bracketSlot: 0, homeTeam: 'Germany', awayTeam: 'Sweden', status: 'scheduled', outcome: null }
  ];
  const { rounds } = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(rounds[1].slots[0].homeTeam, 'Germany', 'LAST_16 slot 0 uses the real match record\'s home team');
  assertEqual(rounds[1].slots[0].awayTeam, 'Sweden', 'LAST_16 slot 0 uses the real match record\'s away team');
}

console.log("\nTest #11: no THIRD_PLACE match yet — TBD slot, doesn't affect rounds");
{
  const { rounds, thirdPlace } = buildBracketRounds([], ROUND_DEFS);
  assertEqual(thirdPlace.homeTeam, 'TBD', 'third place home is TBD with no THIRD_PLACE match');
  assertEqual(thirdPlace.awayTeam, 'TBD', 'third place away is TBD with no THIRD_PLACE match');
  assertEqual(thirdPlace.match, null, 'third place match is null when none exists');
  assertEqual(rounds.length, 3, 'third place lookup does not add a fourth round to the tree');
}

console.log("\nTest #12: a THIRD_PLACE match shows its real teams");
{
  const matches = [
    { matchType: 'KO', bracketRound: 'THIRD_PLACE', bracketSlot: 0, homeTeam: 'Belgium', awayTeam: 'Croatia', status: 'scheduled', outcome: null }
  ];
  const { thirdPlace } = buildBracketRounds(matches, ROUND_DEFS);
  assertEqual(thirdPlace.homeTeam, 'Belgium', 'third place home shows the real team');
  assertEqual(thirdPlace.awayTeam, 'Croatia', 'third place away shows the real team');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll bracket layout tests PASSED successfully!");
}
