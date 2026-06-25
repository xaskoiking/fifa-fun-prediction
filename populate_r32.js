// populate_r32.js
// One-time script to fetch Round of 32 fixtures from football-data.org
// and write them into data.json as LAST_32 bracket matches.
//
// Usage:
//   FOOTBALL_DATA_API_KEY=your_key node populate_r32.js
//
// Safe to re-run: skips slots that already have a LAST_32 match.

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const DATA_FILE = path.join(__dirname, 'data.json');

if (!API_KEY) {
  console.error('Error: FOOTBALL_DATA_API_KEY environment variable is not set.');
  process.exit(1);
}

// football-data.org stage name for Round of 32
const R32_STAGE = 'ROUND_OF_32';

async function main() {
  console.log('Fetching fixtures from football-data.org...');
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': API_KEY }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`API error ${res.status}: ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  const r32Matches = (data.matches || [])
    .filter(m => m.stage === R32_STAGE)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (r32Matches.length === 0) {
    console.error(`No matches found with stage "${R32_STAGE}". Available stages:`);
    const stages = [...new Set((data.matches || []).map(m => m.stage))];
    stages.forEach(s => console.log(' ', s));
    process.exit(1);
  }

  console.log(`Found ${r32Matches.length} ROUND_OF_32 matches.`);

  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // Find existing LAST_32 slots already in the DB
  const existingSlots = new Set(
    db.matches
      .filter(m => m.bracketRound === 'LAST_32')
      .map(m => m.bracketSlot)
  );

  // Highest existing matchNumber
  const maxMatchNum = Math.max(
    0,
    ...db.matches.map(m => Number(m.matchNumber)).filter(n => !isNaN(n))
  );

  let added = 0;
  let skipped = 0;

  r32Matches.forEach((m, i) => {
    const bracketSlot = i; // sorted by kickoff → slot 0..15

    if (existingSlots.has(bracketSlot)) {
      console.log(`  slot ${bracketSlot}: already exists, skipping`);
      skipped++;
      return;
    }

    const homeTeam = m.homeTeam?.name || 'TBD';
    const awayTeam = m.awayTeam?.name || 'TBD';
    const kickoff = m.utcDate;
    const matchNumber = String(maxMatchNum + added + 1);

    const newMatch = {
      id: `match_${Date.now()}_${bracketSlot}`,
      matchNumber,
      group: 'KO',
      homeTeam,
      awayTeam,
      matchType: 'KO',
      kickoff,
      status: 'upcoming',
      votingLocked: false,
      outcome: null,
      voteLog: [],
      votes: { home: [], away: [], draw: [] },
      bracketRound: 'LAST_32',
      bracketSlot
    };

    db.matches.push(newMatch);
    added++;
    console.log(`  slot ${bracketSlot}: ${homeTeam} vs ${awayTeam} (${kickoff})`);
  });

  if (added > 0) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    console.log(`\nDone. Added ${added} LAST_32 matches${skipped > 0 ? `, skipped ${skipped} existing` : ''}.`);
  } else {
    console.log('\nNothing to add — all slots already populated.');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
