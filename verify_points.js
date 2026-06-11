// verify_points.js
// Test script to verify the points calculation logic.

function calculatePointsForMatch(votes, outcome, matchType) {
  const votersHome = votes.home || [];
  const votersAway = votes.away || [];
  const votersDraw = votes.draw || [];

  const countHome = votersHome.length;
  const countAway = votersAway.length;
  const countDraw = matchType === 'League' ? votersDraw.length : 0;

  const results = {};

  // Initialize all voters with 0 points
  const allVoters = [...votersHome, ...votersAway, ...votersDraw];
  allVoters.forEach(voter => {
    results[voter] = 0;
  });

  if (!outcome) {
    return results; // Match not resolved yet
  }

  if (outcome === 'home') {
    const points = countAway + countDraw + 1;
    votersHome.forEach(voter => {
      results[voter] = points;
    });
  } else if (outcome === 'away') {
    const points = countHome + countDraw + 1;
    votersAway.forEach(voter => {
      results[voter] = points;
    });
  } else if (outcome === 'draw' && matchType === 'League') {
    const points = countHome + countAway + 1;
    votersDraw.forEach(voter => {
      results[voter] = points;
    });
  }

  return results;
}

// Running Test Cases
const testCases = [
  {
    name: "User Example: 10 vs 2, Option B (away) is correct",
    matchType: "KO",
    votes: {
      home: Array(10).fill().map((_, i) => `A_${i}`), // 10 voters for Option A (home)
      away: ["B_1", "B_2"], // 2 voters for Option B (away)
      draw: []
    },
    outcome: "away",
    expectedPoints: {
      "B_1": 11,
      "B_2": 11,
      "A_0": 0
    }
  },
  {
    name: "League Match: 5 home, 3 draw, 2 away. Draw wins.",
    matchType: "League",
    votes: {
      home: ["H1", "H2", "H3", "H4", "H5"],
      draw: ["D1", "D2", "D3"],
      away: ["A1", "A2"]
    },
    outcome: "draw",
    expectedPoints: {
      "D1": 8, // (5 + 2) + 1 = 8
      "H1": 0,
      "A1": 0
    }
  },
  {
    name: "Unanimous match: everyone votes Home, Home wins.",
    matchType: "KO",
    votes: {
      home: ["U1", "U2", "U3"],
      away: [],
      draw: []
    },
    outcome: "home",
    expectedPoints: {
      "U1": 1, // 0 + 1 = 1
      "U2": 1,
      "U3": 1
    }
  }
];

let failed = false;
console.log("=== RUNNING POINTS CALCULATION TESTS ===");

testCases.forEach((tc, index) => {
  console.log(`\nTest #${index + 1}: ${tc.name}`);
  const actual = calculatePointsForMatch(tc.votes, tc.outcome, tc.matchType);
  
  let success = true;
  Object.keys(tc.expectedPoints).forEach(voter => {
    const expected = tc.expectedPoints[voter];
    const got = actual[voter];
    if (got !== expected) {
      console.error(`  FAIL: Voter '${voter}' expected ${expected} points, but got ${got}`);
      success = false;
      failed = true;
    } else {
      console.log(`  PASS: Voter '${voter}' got ${got} points as expected.`);
    }
  });

  if (success) {
    console.log("  => Test passed!");
  }
});

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll points calculation tests PASSED successfully!");
}
