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

function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => {
    standings[user.name] = { name: user.name, points: 0 };
  });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });

  const frames = [
    { matchNumber: null, homeTeam: null, awayTeam: null, kickoff: null, standings: snapshot() }
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
    Object.keys(pointsAllocated).forEach(user => {
      if (!standings[user]) {
        standings[user] = { name: user, points: 0 };
      }
      standings[user].points += pointsAllocated[user];
    });

    frames.push({
      matchNumber: match.matchNumber,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
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
    standings: [{ name: 'Alice', points: 0 }, { name: 'Bob', points: 0 }, { name: 'Carol', points: 0 }]
  }, 'frame 0 is the start frame, all zero, alphabetical');
  assertDeepEqual(frames[1], {
    matchNumber: '1', homeTeam: 'A', awayTeam: 'B', kickoff: '2026-06-01T00:00:00.000Z',
    standings: [{ name: 'Alice', points: 2 }, { name: 'Bob', points: 0 }, { name: 'Carol', points: 0 }]
  }, 'frame 1 reflects match 1 (Alice wins home pick)');
  assertDeepEqual(frames[2], {
    matchNumber: '2', homeTeam: 'C', awayTeam: 'D', kickoff: '2026-06-02T00:00:00.000Z',
    standings: [{ name: 'Alice', points: 4 }, { name: 'Carol', points: 2 }, { name: 'Bob', points: 0 }]
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
  assertDeepEqual(frames[2].standings, [{ name: 'X', points: 2 }, { name: 'Y', points: 2 }],
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

  assertDeepEqual(frames[1].standings, [{ name: 'Ghost', points: 2 }, { name: 'Alice', points: 0 }],
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
  assertDeepEqual(frames[0].standings, [{ name: 'Alice', points: 0 }, { name: 'Bob', points: 0 }],
    'start frame lists all registered users at zero');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll leaderboard history tests PASSED successfully!");
}
