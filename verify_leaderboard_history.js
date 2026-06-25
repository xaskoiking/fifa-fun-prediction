// verify_leaderboard_history.js
// Test script to verify the leaderboard history (racing chart frames) logic.

function calculatePointsForMatch(votes, outcome, matchType) {
  const votersHome = votes.home || [];
  const votersAway = votes.away || [];
  const votersDraw = votes.draw || [];

  const countHome = votersHome.length;
  const countAway = votersAway.length;
  const countDraw = matchType === 'League' ? votersDraw.length : 0;

  const pointsAllocated = {};

  if (!outcome) return pointsAllocated;

  if (outcome === 'home') {
    const pts = countAway + countDraw + 1;
    votersHome.forEach(v => { pointsAllocated[v] = pts; });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => { pointsAllocated[v] = pts; });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => { pointsAllocated[v] = pts; });
  }

  return pointsAllocated;
}

// Stub: the real getMatchScore reads from the live external-API cache, which
// isn't available in this standalone script. Tests control scores directly.
function getMatchScore(homeTeam, awayTeam) {
  return _scoreStub[`${homeTeam}|${awayTeam}`] || null;
}
let _scoreStub = {};

function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0, correct: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points, correct: s.correct }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    {
      matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null,
      outcome: null, score: null, matchPoints: {},
      standings: snapshot()
    }
  ];

  const resolvedMatches = db.matches
    .filter(m => m.status === 'resolved')
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.kickoff) - new Date(b.kickoff);
      if (diff !== 0) return diff;
      return String(a.matchNumber).localeCompare(String(b.matchNumber));
    });

  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType);
    const matchPoints = {};
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0, correct: 0 };
      }
      if (pointsAllocated[user] > 0) {
        standings[user].points += pointsAllocated[user];
        standings[user].correct += 1;
        matchPoints[user] = pointsAllocated[user];
      }
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      outcome: match.outcome,
      score: getMatchScore(match.homeTeam, match.awayTeam),
      matchPoints,
      standings: snapshot()
    });
  });

  return frames;
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

console.log("=== RUNNING LEADERBOARD HISTORY TESTS ===");

// Test 1: basic cumulative accumulation across two resolved matches, in kickoff order
console.log("\nTest #1: basic cumulative accumulation");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Alice'], away: ['Bob'], draw: [] }
      },
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'draw',
        votes: { home: ['Bob'], away: [], draw: ['Alice', 'Carol'] }
      },
      {
        matchNumber: '3', homeTeam: 'E', awayTeam: 'F', matchType: 'KO',
        kickoff: '2026-06-03T00:00:00.000Z', status: 'scheduled', outcome: null,
        votes: { home: ['Alice'], away: ['Bob'], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames.length, 3, 'three frames (start + 2 resolved matches, scheduled match ignored)');
  assertDeepEqual(frames[0], {
    matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null,
    outcome: null, score: null, matchPoints: {},
    standings: [{ name: 'Alice', points: 0, correct: 0 }, { name: 'Bob', points: 0, correct: 0 }, { name: 'Carol', points: 0, correct: 0 }]
  }, 'frame 0 is the start frame, all zero, alphabetical');
  assertDeepEqual(frames[1], {
    matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z',
    outcome: 'home', score: null, matchPoints: { Alice: 2 },
    standings: [{ name: 'Alice', points: 2, correct: 1 }, { name: 'Bob', points: 0, correct: 0 }, { name: 'Carol', points: 0, correct: 0 }]
  }, 'frame 1 reflects match 1 (Alice wins home pick)');
  assertDeepEqual(frames[2], {
    matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z',
    outcome: 'draw', score: null, matchPoints: { Alice: 2, Carol: 2 },
    standings: [{ name: 'Alice', points: 4, correct: 2 }, { name: 'Carol', points: 2, correct: 1 }, { name: 'Bob', points: 0, correct: 0 }]
  }, 'frame 2 accumulates match 2 (Alice + Carol picked draw)');
}

// Test 2: frames are ordered by kickoff, not by array order
console.log("\nTest #2: frames ordered by kickoff regardless of array order");
{
  const db = {
    users: [{ name: 'X' }, { name: 'Y' }],
    matches: [
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Y'], away: ['X'], draw: [] }
      },
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['X'], away: ['Y'], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[1].matchNumber, '1', 'earlier kickoff (match 1) becomes frame 1');
  assertDeepEqual(frames[2].matchNumber, '2', 'later kickoff (match 2) becomes frame 2');
  assertDeepEqual(frames[2].standings, [{ name: 'X', points: 2, correct: 1 }, { name: 'Y', points: 2, correct: 1 }],
    'tied points break alphabetically (X before Y)');
}

// Test 3: voter not in registered users is added dynamically (legacy voter)
console.log("\nTest #3: unregistered voter is added dynamically");
{
  const db = {
    users: [{ name: 'Alice' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'away',
        votes: { home: [], away: ['Ghost'], draw: ['Alice'] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[1].standings, [{ name: 'Ghost', points: 2, correct: 1 }, { name: 'Alice', points: 0, correct: 0 }],
    'Ghost (unregistered voter) appears with earned points, ranked above Alice');
}

// Test 4: no resolved matches -> only the start frame
console.log("\nTest #4: no resolved matches yields only the start frame");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'scheduled', outcome: null,
        votes: { home: [], away: [], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames.length, 1, 'only the start frame exists');
  assertDeepEqual(frames[0].standings, [{ name: 'Alice', points: 0, correct: 0 }, { name: 'Bob', points: 0, correct: 0 }],
    'start frame lists all registered users at zero');
}

// Test 5: frames carry matchPoints/outcome/score enrichment
console.log("\nTest #5: frames carry per-match points, outcome, and score");
{
  _scoreStub = { 'A|B': { scoreHome: 2, scoreAway: 1 } };

  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      {
        matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        votes: { home: ['Alice'], away: ['Bob'], draw: ['Carol'] }
      },
      {
        matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League',
        kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'draw',
        votes: { home: [], away: [], draw: [] }
      }
    ]
  };

  const frames = buildLeaderboardHistory(db);

  assertDeepEqual(frames[0].outcome, null, 'start frame has null outcome');
  assertDeepEqual(frames[0].score, null, 'start frame has null score');
  assertDeepEqual(frames[0].matchPoints, {}, 'start frame has empty matchPoints');

  assertDeepEqual(frames[1].outcome, 'home', 'frame 1 carries match outcome');
  assertDeepEqual(frames[1].score, { scoreHome: 2, scoreAway: 1 }, 'frame 1 carries looked-up score');
  assertDeepEqual(frames[1].matchPoints, { Alice: 3 },
    'frame 1 matchPoints only includes the scoring voter (Alice), not Bob/Carol who picked wrong');

  assertDeepEqual(frames[2].outcome, 'draw', 'frame 2 carries match outcome even with no voters');
  assertDeepEqual(frames[2].score, null, 'frame 2 has null score when no stub entry exists for that matchup');
  assertDeepEqual(frames[2].matchPoints, {}, 'frame 2 matchPoints is empty when nobody scored');

  _scoreStub = {};
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll leaderboard history tests PASSED successfully!");
}
