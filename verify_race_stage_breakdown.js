// verify_race_stage_breakdown.js
// Test script for the pure stage-bucketing math used by the Race chart's
// click-to-expand stage breakdown panel. Mirrors the existing standalone
// -test pattern used by verify_snake_geometry.js: a local copy of the pure
// function, runnable under plain Node (no DOM needed for this math).

function computeStageBreakdown(scoringMatchesMap, playerNames, frames, frameIndex, stages) {
  const startedIndexes = new Set();
  for (let i = 1; i <= frameIndex; i++) {
    const frame = frames[i];
    if (!frame || frame.matchNumber == null) continue;
    const n = parseInt(frame.matchNumber, 10);
    stages.forEach((stage, idx) => {
      if (n >= stage.lo && n <= stage.hi) startedIndexes.add(idx);
    });
  }

  const result = [];
  stages.forEach((stage, idx) => {
    if (!startedIndexes.has(idx)) return;
    const players = new Map();
    let maxPoints = 0;
    playerNames.forEach(name => {
      const matches = scoringMatchesMap.get(name) || [];
      const points = matches
        .filter(m => m.frameIndex <= frameIndex)
        .filter(m => {
          const n = parseInt(m.matchNumber, 10);
          return n >= stage.lo && n <= stage.hi;
        })
        .reduce((sum, m) => sum + m.points, 0);
      players.set(name, points);
      if (points > maxPoints) maxPoints = points;
    });
    result.push({ label: stage.label, lo: stage.lo, hi: stage.hi, maxPoints, players });
  });
  return result;
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

console.log("=== RUNNING STAGE BREAKDOWN TESTS ===");

// Test stages use small ranges for readable fixtures; computeStageBreakdown
// is agnostic to the actual lo/hi values, so this exercises the same logic
// the real RACE_STAGE_GROUPS (1-24, 25-48, ...) will use in app.js.
const stages = [
  { label: 'Stage A', lo: 1, hi: 10 },
  { label: 'Stage B', lo: 11, hi: 20 },
  { label: 'Stage C', lo: 21, hi: 30 }
];

const frames = [
  { matchNumber: null },        // frame 0: "Start"
  { matchNumber: '5' },         // frame 1: in Stage A
  { matchNumber: '15' },        // frame 2: in Stage B
  { matchNumber: '6' },         // frame 3: in Stage A
  { matchNumber: '25' }         // frame 4: in Stage C, nobody scores
];

const scoringMatchesMap = new Map([
  ['Alice', [
    { frameIndex: 1, matchNumber: '5', points: 3 },
    { frameIndex: 3, matchNumber: '6', points: 2 }
  ]],
  ['Bob', [
    { frameIndex: 2, matchNumber: '15', points: 5 }
  ]]
]);
const playerNames = ['Alice', 'Bob'];

console.log("\nTest #1: frame 0 — nothing started yet");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 0, stages);
  assertEqual(result.length, 0, 'no stages have started at frame 0');
}

console.log("\nTest #2: frame 1 — only Stage A started");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 1, stages);
  assertEqual(result.length, 1, 'exactly one stage started');
  assertEqual(result[0].label, 'Stage A', 'the started stage is Stage A');
  assertEqual(result[0].players.get('Alice'), 3, "Alice has 3 points in Stage A so far");
  assertEqual(result[0].players.get('Bob'), 0, 'Bob has 0 points in Stage A so far');
  assertEqual(result[0].maxPoints, 3, 'Stage A max is 3 (Alice)');
}

console.log("\nTest #3: frame 2 — Stage A and Stage B both started, in stage order");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 2, stages);
  assertEqual(result.length, 2, 'two stages started');
  assertEqual(result[0].label, 'Stage A', 'Stage A appears first (stage order, not start order)');
  assertEqual(result[1].label, 'Stage B', 'Stage B appears second');
  assertEqual(result[0].maxPoints, 3, "Stage A max still 3 (Alice's frame-3 match not counted yet at frameIndex 2)");
  assertEqual(result[1].players.get('Bob'), 5, 'Bob has 5 points in Stage B');
  assertEqual(result[1].players.get('Alice'), 0, 'Alice has 0 points in Stage B');
  assertEqual(result[1].maxPoints, 5, 'Stage B max is 5 (Bob)');
}

console.log("\nTest #4: frame 3 — Stage A total grows once its second match is included");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 3, stages);
  const stageA = result.find(s => s.label === 'Stage A');
  assertEqual(stageA.players.get('Alice'), 5, 'Alice now has 3+2=5 points in Stage A');
  assertEqual(stageA.maxPoints, 5, 'Stage A max is now 5');
}

console.log("\nTest #5: frame 4 — Stage C started but nobody scored (zero-max edge case)");
{
  const result = computeStageBreakdown(scoringMatchesMap, playerNames, frames, 4, stages);
  const stageC = result.find(s => s.label === 'Stage C');
  assertEqual(stageC.players.get('Alice'), 0, 'Alice has 0 points in Stage C');
  assertEqual(stageC.players.get('Bob'), 0, 'Bob has 0 points in Stage C');
  assertEqual(stageC.maxPoints, 0, 'Stage C max is 0 (no divide-by-zero in this pure function — that guard lives in the renderer)');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll stage breakdown tests PASSED successfully!");
}
