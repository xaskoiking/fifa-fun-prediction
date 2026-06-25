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

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll bracket layout tests PASSED successfully!");
}
