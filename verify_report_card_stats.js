// verify_report_card_stats.js
// Test script to verify the per-player report card stats logic
// (rank, highest rank + date reached, current/best streak + match range,
// accuracy).

function calculatePointsForMatch(votes, outcome, matchType, boosters = {}) {
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
    votersHome.forEach(v => { pointsAllocated[v] = pts * ((boosters.home || []).includes(v) ? 2 : 1); });
  } else if (outcome === 'away') {
    const pts = countHome + countDraw + 1;
    votersAway.forEach(v => { pointsAllocated[v] = pts * ((boosters.away || []).includes(v) ? 2 : 1); });
  } else if (outcome === 'draw' && matchType === 'League') {
    const pts = countHome + countAway + 1;
    votersDraw.forEach(v => { pointsAllocated[v] = pts * ((boosters.draw || []).includes(v) ? 2 : 1); });
  }
  return pointsAllocated;
}

function normalizeStageText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function getMatchStageCode(match) {
  // Bracket round is the authoritative source for bracket-created matches
  if (match.bracketRound) {
    if (match.bracketRound === 'LAST_32') return 'LAST_32';
    if (match.bracketRound === 'LAST_16') return 'LAST_16';
    if (['QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE'].includes(match.bracketRound)) return 'QF_SF_FINAL';
  }

  const stageText = normalizeStageText(match.group || match.stage || match.round || '');
  if (stageText) {
    if (/(round of 32|last 32|r32)\b/.test(stageText)) return 'LAST_32';
    if (/(round of 16|last 16|r16)\b/.test(stageText)) return 'LAST_16';
    if (/(quarter final|quarter-final|quarterfinal|semi final|semi-final|semifinal|final|third place|3rd place|qf\/sf\/final|qf sf final)\b/.test(stageText)) {
      return 'QF_SF_FINAL';
    }
  }

  const num = parseInt(match.matchNumber, 10);
  if (!Number.isFinite(num)) return null;
  if (num >= 73 && num <= 88) return 'LAST_32';
  if (num >= 89 && num <= 96) return 'LAST_16';
  if (num >= 97 && num <= 104) return 'QF_SF_FINAL';
  return null;
}

function calculateBonusPointsForMatch(match) {
  const bonusPoints = {};
  if (getMatchStageCode(match) !== 'QF_SF_FINAL' || !match.decidedBy) return bonusPoints;
  const bonusPicks = match.bonusPicks || {};
  Object.keys(bonusPicks).forEach(username => {
    const correctBonus = bonusPicks[username] === match.decidedBy;
    if (!correctBonus) return;
    const correctTeam = !!(match.outcome && (match.votes[match.outcome] || []).includes(username));
    bonusPoints[username] = correctTeam ? 10 : 5;
  });
  return bonusPoints;
}

function buildLeaderboardHistory(db) {
  const standings = {};
  db.users.forEach(user => { standings[user.name] = { name: user.name, points: 0, correct: 0 }; });

  const snapshot = () => Object.values(standings)
    .map(s => ({ name: s.name, points: s.points, correct: s.correct }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });

  const frames = [{ matchNumber: null, kickoff: null, standings: snapshot() }];

  const resolvedMatches = db.matches
    .filter(m => m.status === 'resolved')
    .slice()
    .sort((a, b) => {
      const diff = new Date(a.kickoff) - new Date(b.kickoff);
      if (diff !== 0) return diff;
      return String(a.matchNumber).localeCompare(String(b.matchNumber));
    });

  resolvedMatches.forEach(match => {
    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const involvedUsers = new Set([...Object.keys(pointsAllocated), ...Object.keys(bonusPoints)]);
    involvedUsers.forEach(user => {
      if (!standings[user]) standings[user] = { name: user, points: 0, correct: 0 };
      const teamPts = pointsAllocated[user] || 0;
      const bonusPts = bonusPoints[user] || 0;
      if (teamPts > 0) standings[user].correct += 1;
      const total = teamPts + bonusPts;
      if (total > 0) standings[user].points += total;
    });
    frames.push({ matchNumber: match.matchNumber, kickoff: match.kickoff, standings: snapshot() });
  });

  return frames;
}

// Per-player report card stats: rank (current + highest ever, with the date
// the highest rank was MOST RECENTLY reached — in case it was hit more than
// once), scoring streak (current + best, with the match-number range of the
// most recent run that reached the best length), and accuracy. Built on
// buildLeaderboardHistory's replay so numbers never disagree with the racing
// chart / comparison view.
//
// "Most recent" semantics for both highestRank and the best-streak range are
// achieved with a single forward pass using <=/>= (not strict </>) so a later
// frame that TIES the existing best overwrites which frame is reported.
function computePlayerReportStats(db, name) {
  const frames = buildLeaderboardHistory(db);
  const matchFrames = frames.slice(1); // drop the initial all-zero frame

  let currentRank = null;
  let highestRank = null;
  let highestRankFrame = null;
  let gamesAtHighestRank = 0;
  let runningStreak = 0;
  let bestStreak = 0;
  let runStartFrame = null;
  let bestStreakStartFrame = null;
  let bestStreakEndFrame = null;
  let prevPoints = 0;
  let sawAnyFrame = false;

  matchFrames.forEach(frame => {
    const idx = frame.standings.findIndex(s => s.name === name);
    if (idx !== -1) {
      sawAnyFrame = true;
      const rank = idx + 1;
      currentRank = rank;
      if (highestRank === null || rank < highestRank) {
        // A strictly better peak resets the count — earlier games at the
        // old (worse) peak no longer qualify as "at the best rank".
        highestRank = rank;
        highestRankFrame = frame;
        gamesAtHighestRank = 1;
      } else if (rank === highestRank) {
        highestRankFrame = frame; // still tracks the most recent tie
        gamesAtHighestRank += 1;
      }
    }
    const entry = idx !== -1 ? frame.standings[idx] : null;
    const points = entry ? entry.points : prevPoints;
    if (points > prevPoints) {
      if (runningStreak === 0) runStartFrame = frame;
      runningStreak += 1;
    } else {
      runningStreak = 0;
      runStartFrame = null;
    }
    if (runningStreak > 0 && runningStreak >= bestStreak) {
      bestStreak = runningStreak;
      bestStreakStartFrame = runStartFrame;
      bestStreakEndFrame = frame;
    }
    prevPoints = points;
  });

  if (!sawAnyFrame) {
    currentRank = null;
    highestRank = null;
    highestRankFrame = null;
    gamesAtHighestRank = 0;
  }

  // totalPredictions/correct: count resolved matches this player voted in,
  // same definition GET /api/leaderboard already uses.
  let totalPredictions = 0;
  let correct = 0;
  let totalPoints = 0;
  db.matches.forEach(match => {
    if (match.status !== 'resolved') return;
    const voted = (match.votes.home || []).includes(name)
      || (match.votes.away || []).includes(name)
      || (match.votes.draw || []).includes(name);
    if (voted) totalPredictions += 1;

    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType, match.boosters);
    const bonusPoints = calculateBonusPointsForMatch(match);
    const teamPts = pointsAllocated[name] || 0;
    const bonusPts = bonusPoints[name] || 0;
    if (teamPts > 0) correct += 1;
    totalPoints += teamPts + bonusPts;
  });

  const accuracy = totalPredictions > 0 ? Math.round((correct / totalPredictions) * 1000) / 10 : 0;

  return {
    totalPoints,
    correct,
    totalPredictions,
    accuracy,
    currentRank,
    highestRank,
    highestRankDate: highestRankFrame ? highestRankFrame.kickoff : null,
    gamesAtHighestRank,
    currentStreak: runningStreak,
    bestStreak,
    bestStreakStartMatch: bestStreakStartFrame ? bestStreakStartFrame.matchNumber : null,
    bestStreakEndMatch: bestStreakEndFrame ? bestStreakEndFrame.matchNumber : null
  };
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

console.log("=== RUNNING REPORT CARD STATS TESTS ===");

// Test #1: rank climbs then a loss knocks it back down; totalPredictions/accuracy count only resolved matches voted on
console.log("\nTest #1: rank + streak across 3 resolved matches");
{
  const db = {
    users: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    matches: [
      { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'League', kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Alice'], away: ['Bob', 'Carol'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '2', homeTeam: 'C', awayTeam: 'D', matchType: 'League', kickoff: '2026-06-02T00:00:00.000Z', status: 'resolved', outcome: 'away', votes: { home: ['Alice', 'Bob'], away: ['Carol'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '3', homeTeam: 'E', awayTeam: 'F', matchType: 'League', kickoff: '2026-06-03T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Alice'], away: [], draw: ['Bob', 'Carol'] }, boosters: {}, bonusPicks: {} }
    ]
  };
  // Match 1: Alice picks home (correct, +3). Bob/Carol pick away (wrong).
  //   -> standings after M1: Alice 3, Bob 0, Carol 0. Alice rank 1.
  // Match 2: Alice+Bob pick home (wrong), Carol picks away (correct, +3).
  //   -> standings after M2: Carol 3, Alice 3, Bob 0. Tie Alice/Carol by points -> tiebreak by correct(1 each) -> alphabetical: Alice rank 1, Carol rank 2.
  //   Alice's points did NOT increase (stayed at 3) -> streak breaks.
  // Match 3: Alice picks home (correct, +1 since 0 away/0 draw... wait draw voters=2 -> pts = 0+2+1=3).
  //   -> standings after M3: Alice 6, Carol 3, Bob 0. Alice rank 1 again, streak resumes at 1.
  // Alice is rank 1 at every frame -> highestRankDate keeps advancing to the
  // most recent frame (M3), even though the rank value itself never changes.
  // The M3 streak-of-1 TIES the M1 streak-of-1 for "best" -> most recent
  // qualifying run (M3..M3) wins over the earlier one (M1..M1).
  const stats = computePlayerReportStats(db, 'Alice');
  assertDeepEqual(stats.totalPoints, 6, 'Alice totalPoints');
  assertDeepEqual(stats.correct, 2, 'Alice correct');
  assertDeepEqual(stats.totalPredictions, 3, 'Alice totalPredictions');
  assertDeepEqual(stats.accuracy, 66.7, 'Alice accuracy');
  assertDeepEqual(stats.currentRank, 1, 'Alice currentRank');
  assertDeepEqual(stats.highestRank, 1, 'Alice highestRank');
  assertDeepEqual(stats.highestRankDate, '2026-06-03T00:00:00.000Z', 'Alice highestRankDate (most recent frame at peak rank, M3)');
  assertDeepEqual(stats.gamesAtHighestRank, 3, 'Alice gamesAtHighestRank (rank 1 in all 3 frames)');
  assertDeepEqual(stats.currentStreak, 1, 'Alice currentStreak (broke at M2, resumed at M3)');
  assertDeepEqual(stats.bestStreak, 1, 'Alice bestStreak (never had 2 in a row)');
  assertDeepEqual(stats.bestStreakStartMatch, '3', 'Alice bestStreakStartMatch (most recent tying run, M3)');
  assertDeepEqual(stats.bestStreakEndMatch, '3', 'Alice bestStreakEndMatch (M3)');
}

// Test #2: a player who never scores has null ranks and a 0 streak
console.log("\nTest #2: player with zero points across all resolved matches");
{
  const db = {
    users: [{ name: 'Dave' }, { name: 'Eve' }],
    matches: [
      { matchNumber: '1', homeTeam: 'A', awayTeam: 'B', matchType: 'KO', kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Eve'], away: ['Dave'], draw: [] }, boosters: {}, bonusPicks: {} }
    ]
  };
  const stats = computePlayerReportStats(db, 'Dave');
  assertDeepEqual(stats.totalPoints, 0, 'Dave totalPoints');
  assertDeepEqual(stats.totalPredictions, 1, 'Dave totalPredictions (voted, even though wrong)');
  assertDeepEqual(stats.accuracy, 0, 'Dave accuracy');
  assertDeepEqual(stats.highestRank, 2, 'Dave highestRank (behind Eve, who scored)');
  assertDeepEqual(stats.highestRankDate, '2026-06-01T00:00:00.000Z', 'Dave highestRankDate');
  assertDeepEqual(stats.gamesAtHighestRank, 1, 'Dave gamesAtHighestRank (only 1 frame, at rank 2)');
  assertDeepEqual(stats.currentStreak, 0, 'Dave currentStreak');
  assertDeepEqual(stats.bestStreak, 0, 'Dave bestStreak');
  assertDeepEqual(stats.bestStreakStartMatch, null, 'Dave bestStreakStartMatch (never scored, no run)');
  assertDeepEqual(stats.bestStreakEndMatch, null, 'Dave bestStreakEndMatch');
}

// Test #3: a player with zero resolved matches at all -> null ranks, zero everything
console.log("\nTest #3: player with no resolved matches involvement");
{
  const db = { users: [{ name: 'Frank' }], matches: [] };
  const stats = computePlayerReportStats(db, 'Frank');
  assertDeepEqual(stats.totalPoints, 0, 'Frank totalPoints');
  assertDeepEqual(stats.totalPredictions, 0, 'Frank totalPredictions');
  assertDeepEqual(stats.accuracy, 0, 'Frank accuracy');
  assertDeepEqual(stats.currentRank, null, 'Frank currentRank');
  assertDeepEqual(stats.highestRank, null, 'Frank highestRank');
  assertDeepEqual(stats.highestRankDate, null, 'Frank highestRankDate');
  assertDeepEqual(stats.gamesAtHighestRank, 0, 'Frank gamesAtHighestRank');
  assertDeepEqual(stats.currentStreak, 0, 'Frank currentStreak');
  assertDeepEqual(stats.bestStreak, 0, 'Frank bestStreak');
  assertDeepEqual(stats.bestStreakStartMatch, null, 'Frank bestStreakStartMatch');
  assertDeepEqual(stats.bestStreakEndMatch, null, 'Frank bestStreakEndMatch');
}

// Test #4: bonus-only points (team pick wrong, bonus pick correct) still count
// toward totalPoints and the streak, and correct-team-pick stays 0.
console.log("\nTest #4: bonus-only correct pick");
{
  const db = {
    users: [{ name: 'Gina' }, { name: 'Hank' }],
    matches: [
      {
        matchNumber: '97', homeTeam: 'X', awayTeam: 'Y', matchType: 'KO',
        bracketRound: 'QUARTER_FINALS',
        kickoff: '2026-06-01T00:00:00.000Z', status: 'resolved', outcome: 'home',
        decidedBy: 'EXTRA_TIME',
        votes: { home: ['Hank'], away: ['Gina'], draw: [] },
        boosters: {},
        bonusPicks: { Gina: 'EXTRA_TIME', Hank: 'REGULAR' }
      }
    ]
  };
  // Gina picked away (wrong team, 0 team points) but her bonus pick EXTRA_TIME
  // matches decidedBy -> +5 bonus, correctTeam=false so it's the 5-point case,
  // not the 10-point case. Her total points go 0 -> 5, a positive-points frame,
  // so it counts as a streak hit even though her team pick was wrong. Hank
  // gets 2 team points (1 away voter + 1) but 0 bonus (REGULAR != EXTRA_TIME),
  // so Gina (5) outranks Hank (2) -> Gina is rank 1.
  const stats = computePlayerReportStats(db, 'Gina');
  assertDeepEqual(stats.totalPoints, 5, 'Gina totalPoints (bonus-only)');
  assertDeepEqual(stats.correct, 0, 'Gina correct (team pick was wrong)');
  assertDeepEqual(stats.totalPredictions, 1, 'Gina totalPredictions');
  assertDeepEqual(stats.highestRank, 1, 'Gina highestRank (bonus points still outrank Hank)');
  assertDeepEqual(stats.highestRankDate, '2026-06-01T00:00:00.000Z', 'Gina highestRankDate');
  assertDeepEqual(stats.gamesAtHighestRank, 1, 'Gina gamesAtHighestRank (only 1 frame, at rank 1)');
  assertDeepEqual(stats.currentStreak, 1, 'Gina currentStreak (bonus points still count as a hit)');
  assertDeepEqual(stats.bestStreak, 1, 'Gina bestStreak');
  assertDeepEqual(stats.bestStreakStartMatch, '97', 'Gina bestStreakStartMatch');
  assertDeepEqual(stats.bestStreakEndMatch, '97', 'Gina bestStreakEndMatch');
}

// Test #5: a multi-match streak (start != end) that later breaks, verifying
// the reported best-streak match range spans the correct matches and stops
// updating once the streak breaks.
console.log("\nTest #5: multi-match streak range (start != end match)");
{
  const db = {
    users: [{ name: 'Ian' }, { name: 'Jill' }],
    matches: [
      { matchNumber: '10', homeTeam: 'A', awayTeam: 'B', matchType: 'KO', kickoff: '2026-06-10T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Ian'], away: ['Jill'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '11', homeTeam: 'C', awayTeam: 'D', matchType: 'KO', kickoff: '2026-06-11T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Ian'], away: ['Jill'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '12', homeTeam: 'E', awayTeam: 'F', matchType: 'KO', kickoff: '2026-06-12T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Ian'], away: ['Jill'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '13', homeTeam: 'G', awayTeam: 'H', matchType: 'KO', kickoff: '2026-06-13T00:00:00.000Z', status: 'resolved', outcome: 'away', votes: { home: ['Ian'], away: ['Jill'], draw: [] }, boosters: {}, bonusPicks: {} }
    ]
  };
  // Ian wins M10-M12 (each +2, since Jill is the lone opposing voter each
  // time), a 3-match streak, then loses M13 (Jill scores instead) which
  // breaks it. Ian stays rank 1 throughout (6 pts vs Jill's 2 even after M13).
  const stats = computePlayerReportStats(db, 'Ian');
  assertDeepEqual(stats.totalPoints, 6, 'Ian totalPoints');
  assertDeepEqual(stats.currentStreak, 0, 'Ian currentStreak (broken by M13 loss)');
  assertDeepEqual(stats.bestStreak, 3, 'Ian bestStreak (M10-M12)');
  assertDeepEqual(stats.bestStreakStartMatch, '10', 'Ian bestStreakStartMatch');
  assertDeepEqual(stats.bestStreakEndMatch, '12', 'Ian bestStreakEndMatch');
  assertDeepEqual(stats.highestRank, 1, 'Ian highestRank (stayed on top throughout)');
  assertDeepEqual(stats.highestRankDate, '2026-06-13T00:00:00.000Z', 'Ian highestRankDate (still rank 1 at the most recent frame, M13)');
  assertDeepEqual(stats.gamesAtHighestRank, 4, 'Ian gamesAtHighestRank (rank 1 in all 4 frames)');
}

// Test #6: peak rank improves partway through -> gamesAtHighestRank must
// reset when a strictly better rank is reached, not keep counting games
// spent at the old (worse) peak.
console.log("\nTest #6: gamesAtHighestRank resets when the peak rank improves");
{
  const db = {
    users: [{ name: 'X' }, { name: 'Y' }],
    matches: [
      // M20-M21: Y pulls ahead each time, X sits at rank 2 both times.
      { matchNumber: '20', homeTeam: 'A', awayTeam: 'B', matchType: 'KO', kickoff: '2026-06-20T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Y'], away: ['X'], draw: [] }, boosters: {}, bonusPicks: {} },
      { matchNumber: '21', homeTeam: 'C', awayTeam: 'D', matchType: 'KO', kickoff: '2026-06-21T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['Y'], away: ['X'], draw: [] }, boosters: {}, bonusPicks: {} },
      // M22: X overtakes Y (4 extra "away" voters inflate X's points enough
      // to jump ahead) -> X reaches rank 1 for the first time.
      { matchNumber: '22', homeTeam: 'E', awayTeam: 'F', matchType: 'KO', kickoff: '2026-06-22T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['X'], away: ['D1', 'D2', 'D3', 'D4'], draw: [] }, boosters: {}, bonusPicks: {} },
      // M23: X extends the lead -> still rank 1, ties the (now) best rank.
      { matchNumber: '23', homeTeam: 'G', awayTeam: 'H', matchType: 'KO', kickoff: '2026-06-23T00:00:00.000Z', status: 'resolved', outcome: 'home', votes: { home: ['X'], away: ['D5', 'D6', 'D7', 'D8'], draw: [] }, boosters: {}, bonusPicks: {} }
    ]
  };
  // X: M20 0pts (rank 2) -> M21 0pts (rank 2, tie) -> M22 +5=5pts (rank 1,
  // NEW peak, count resets to 1) -> M23 +5=10pts (rank 1, ties peak, count=2).
  // Y: 2pts after M20, 4pts after M21-23 (unchanged) -> never above rank 2
  // once X overtakes.
  const stats = computePlayerReportStats(db, 'X');
  assertDeepEqual(stats.currentRank, 1, 'X currentRank (overtook Y)');
  assertDeepEqual(stats.highestRank, 1, 'X highestRank');
  assertDeepEqual(stats.highestRankDate, '2026-06-23T00:00:00.000Z', 'X highestRankDate (most recent frame at rank 1, M23)');
  assertDeepEqual(stats.gamesAtHighestRank, 2, 'X gamesAtHighestRank (only M22+M23 count, not the earlier rank-2 games)');
}

if (failed) {
  console.error("\n=== SOME TESTS FAILED ===");
  process.exit(1);
} else {
  console.log("\n=== ALL TESTS PASSED ===");
}
