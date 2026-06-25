// verify_race_scoring_matches.js
// Test script for the pure frontend helper that turns leaderboard history
// frames into a per-player ordered list of "scoring matches" (used to build
// the race chart's stacked bar segments).

function buildRaceScoringMatches(frames) {
  const result = new Map();
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    const matchPoints = frame.matchPoints || {};
    Object.keys(matchPoints).forEach(playerName => {
      if (!result.has(playerName)) result.set(playerName, []);
      result.get(playerName).push({
        frameIndex,
        matchNumber: frame.matchNumber,
        homeTeam: frame.homeTeam,
        awayTeam: frame.awayTeam,
        kickoff: frame.kickoff,
        outcome: frame.outcome,
        score: frame.score,
        points: matchPoints[playerName]
      });
    });
  }
  return result;
}

let failed = false;

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING RACE SCORING MATCHES TESTS ===");

// Test 1: builds an ordered per-player list across multiple frames
console.log("\nTest #1: builds ordered per-player scoring match list");
{
  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null, outcome: null, score: null, matchPoints: {} },
    { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z', outcome: 'home', score: { scoreHome: 2, scoreAway: 0 }, matchPoints: { Alice: 2 } },
    { matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, matchPoints: { Alice: 3, Bob: 3 } }
  ];

  const result = buildRaceScoringMatches(frames);

  assertDeepEqual(Array.from(result.keys()).sort(), ['Alice', 'Bob'], 'only players who ever scored appear as keys');
  assertDeepEqual(result.get('Alice'), [
    { frameIndex: 1, matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z', outcome: 'home', score: { scoreHome: 2, scoreAway: 0 }, points: 2 },
    { frameIndex: 2, matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, points: 3 }
  ], 'Alice has two ordered scoring matches');
  assertDeepEqual(result.get('Bob'), [
    { frameIndex: 2, matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z', outcome: 'draw', score: null, points: 3 }
  ], 'Bob only has the match he scored in');
}

// Test 2: no resolved matches yields an empty map
console.log("\nTest #2: no resolved matches yields an empty map");
{
  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null, outcome: null, score: null, matchPoints: {} }
  ];

  const result = buildRaceScoringMatches(frames);

  assertDeepEqual(result.size, 0, 'empty map when only the start frame exists');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll race scoring matches tests PASSED successfully!");
}
