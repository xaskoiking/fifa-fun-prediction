// populate_r32.js
// Fetches Round of 32 fixtures from football-data.org and writes them
// into db.fantasyR32 (separate from db.matches — no conflict with scoring).
//
// Usage:
//   FOOTBALL_DATA_API_KEY=your_key ADMIN_PASSCODE=your_passcode USER_SECRET=your_secret node populate_r32.js
//
// Or write directly to data.json (no server needed):
//   FOOTBALL_DATA_API_KEY=your_key node populate_r32.js --direct
//
// Safe to re-run: existing slots are replaced with updated data.

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;
const USER_SECRET = process.env.USER_SECRET;
const DIRECT = process.argv.includes('--direct');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const DATA_FILE = path.join(__dirname, 'data.json');

const R32_STAGE = 'ROUND_OF_32';

if (!API_KEY) {
  console.error('Error: FOOTBALL_DATA_API_KEY is required.');
  process.exit(1);
}

if (!DIRECT && (!ADMIN_PASSCODE || !USER_SECRET)) {
  console.error('Error: ADMIN_PASSCODE and USER_SECRET are required (or use --direct to write data.json).');
  process.exit(1);
}

async function fetchR32() {
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
  const matches = (data.matches || [])
    .filter(m => m.stage === R32_STAGE)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (matches.length === 0) {
    const stages = [...new Set((data.matches || []).map(m => m.stage))];
    console.error(`No "${R32_STAGE}" matches found. Available stages: ${stages.join(', ')}`);
    process.exit(1);
  }

  console.log(`Found ${matches.length} Round of 32 matches.`);

  return matches.map((m, i) => ({
    bracketSlot: i,
    homeTeam: m.homeTeam?.name || 'TBD',
    awayTeam: m.awayTeam?.name || 'TBD',
    kickoff: m.utcDate
  }));
}

async function main() {
  const fixtures = await fetchR32();
  fixtures.forEach(f => console.log(`  slot ${f.bracketSlot}: ${f.homeTeam} vs ${f.awayTeam} (${f.kickoff})`));

  if (DIRECT) {
    // Write directly into data.json (use when server isn't running)
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(db.fantasyR32)) db.fantasyR32 = [];
    const slotMap = new Map(db.fantasyR32.map(m => [m.bracketSlot, m]));
    fixtures.forEach(m => slotMap.set(m.bracketSlot, m));
    db.fantasyR32 = Array.from(slotMap.values()).sort((a, b) => a.bracketSlot - b.bracketSlot);
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    console.log(`\nDone (direct). fantasyR32 now has ${db.fantasyR32.length} slots.`);
    return;
  }

  // POST via admin API (preferred — server handles persistence)
  console.log(`\nPosting to ${SERVER_URL}/api/admin/fantasy-r32...`);
  const res = await fetch(`${SERVER_URL}/api/admin/fantasy-r32`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': ADMIN_PASSCODE,
      'x-user-secret': USER_SECRET
    },
    body: JSON.stringify({ fixtures })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Server error ${res.status}: ${text}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`Done. fantasyR32 now has ${result.count} slots.`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
