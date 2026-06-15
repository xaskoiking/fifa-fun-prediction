// server.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

// ── GCS persistence (used when running on Cloud Run) ──────────────────────────
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || '';
const GCS_OBJECT_NAME = 'data.json';
let gcsClient = null;
let gcsBucket = null;

if (GCS_BUCKET_NAME) {
  const { Storage } = require('@google-cloud/storage');
  gcsClient = new Storage();
  gcsBucket = gcsClient.bucket(GCS_BUCKET_NAME);
  console.log(`[GCS] Using bucket: gs://${GCS_BUCKET_NAME}/${GCS_OBJECT_NAME}`);
} else {
  console.log('[DATA] GCS_BUCKET_NAME not set — using local data.json');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── Admin / default-credential configuration ─────────────────────────────────
// For production, set ADMIN_PASSCODE in the environment. When set, it overrides
// the adminPasscode stored in data.json (which ships as the placeholder below).
const ADMIN_PASSCODE_ENV = process.env.ADMIN_PASSCODE || '';
// The default admin account seeded into a fresh database. Override via env vars.
// IMPORTANT: change these placeholder credentials before going live.
const DEFAULT_ADMIN_NAME = (process.env.DEFAULT_ADMIN_NAME || 'ADMIN').toUpperCase();
const DEFAULT_ADMIN_SECRET = (process.env.DEFAULT_ADMIN_SECRET || 'ADMN').toUpperCase();
const DEFAULT_ADMIN_PASSCODE = ADMIN_PASSCODE_ENV || 'CHANGE_ME';
// Cleanup legacy backups folder and history CSV file
const BACKUPS_DIR = path.join(__dirname, 'backups');
const AUDIT_LOG_FILE = path.join(__dirname, 'history_log.csv');

try {
  if (fs.existsSync(AUDIT_LOG_FILE)) {
    fs.unlinkSync(AUDIT_LOG_FILE);
    console.log('[CLEANUP] Deleted legacy history_log.csv');
  }
  if (fs.existsSync(BACKUPS_DIR)) {
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    console.log('[CLEANUP] Deleted legacy backups directory');
  }
} catch (err) {
  console.error('[CLEANUP] Error deleting legacy backups/logs:', err);
}

// Append log action in database history array
function logAuditAction(db, action, details, recoveryData = '') {
  if (!Array.isArray(db.history)) {
    db.history = [];
  }
  db.history.push({
    timestamp: new Date().toISOString(),
    action,
    details,
    recoveryData: recoveryData ? (typeof recoveryData === 'object' ? JSON.stringify(recoveryData) : String(recoveryData)) : ''
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to generate a unique 4-character passcode (avoiding easily confused chars like I, O, 1, 0)
function generateSecret() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let secret = '';
  for (let i = 0; i < 4; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

function generateUniqueSecret(existingUsers) {
  const existingSecrets = new Set((existingUsers || []).map(u => u.secret));
  let secret;
  do {
    secret = generateSecret();
  } while (existingSecrets.has(secret));
  return secret;
}

// Database helper functions with automatic database schema migration
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initialData = {
        matches: [],
        users: [],
        adminPasscode: DEFAULT_ADMIN_PASSCODE
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const db = JSON.parse(raw);

    // Migration logic: convert array of string names to objects { name, secret }
    let migrated = false;
    if (Array.isArray(db.users)) {
      const formattedUsers = [];
      db.users.forEach(user => {
        if (typeof user === 'string') {
          migrated = true;
          formattedUsers.push({
            name: user,
            secret: generateUniqueSecret(formattedUsers.concat(db.users.filter(u => typeof u === 'object'))),
            isAdmin: user.toUpperCase() === DEFAULT_ADMIN_NAME
          });
        } else if (user && typeof user === 'object' && user.name && user.secret) {
          const expectedIsAdmin = user.name.toUpperCase() === DEFAULT_ADMIN_NAME ? true : (user.isAdmin === true);
          if (user.isAdmin !== expectedIsAdmin) {
            migrated = true;
            formattedUsers.push({ ...user, isAdmin: expectedIsAdmin });
          } else {
            formattedUsers.push(user);
          }
        }
      });
      db.users = formattedUsers;
    } else {
      db.users = [];
      migrated = true;
    }

    // Ensure the default admin user exists
    const defaultAdminExists = db.users.some(u => u.name.toUpperCase() === DEFAULT_ADMIN_NAME);
    if (!defaultAdminExists) {
      migrated = true;
      const secret = generateUniqueSecret(db.users);
      db.users.push({
        name: DEFAULT_ADMIN_NAME,
        secret: secret,
        isAdmin: true
      });
      console.log('\n==============================================');
      console.log(`[INIT] Created default admin '${DEFAULT_ADMIN_NAME}'`);
      console.log(`[INIT] Login passcode for '${DEFAULT_ADMIN_NAME}': ${secret}`);
      console.log('[INIT] Change this and the admin passcode before going live.');
      console.log('==============================================\n');
    }

    // Match migration logic: ensure matchNumber, group, votingLocked, voteLog exist
    if (Array.isArray(db.matches)) {
      db.matches = db.matches.map((match, index) => {
        let updated = { ...match };
        let changed = false;
        if (match.matchNumber === undefined || match.group === undefined) {
          changed = true;
          updated.matchNumber = match.matchNumber !== undefined ? match.matchNumber : String(index + 1);
          updated.group = match.group !== undefined ? match.group : (match.matchType === 'KO' ? 'KO' : 'League');
        }
        if (updated.votingLocked === undefined) {
          changed = true;
          updated.votingLocked = false;
        }
        // Ensure per-vote timestamp log exists
        if (!Array.isArray(updated.voteLog)) {
          changed = true;
          updated.voteLog = [];
        }
        // Ensure votingExtendedUntil field exists (null = no extension active)
        if (!('votingExtendedUntil' in updated)) {
          changed = true;
          updated.votingExtendedUntil = null;
        }
        if (changed) migrated = true;
        return updated;
      });
    }

    // Ensure history array exists
    if (!Array.isArray(db.history)) {
      db.history = [];
      migrated = true;
    }

    if (migrated) {
      writeData(db);
    }
    return db;
  } catch (err) {
    console.error('Error reading/migrating data file, initializing clean database:', err);
    return { matches: [], users: [], adminPasscode: DEFAULT_ADMIN_PASSCODE, history: [] };
  }
}

// ── In-memory write-through cache ────────────────────────────────────────────
// readData() is called synchronously throughout the codebase.
// We keep db in memory and flush async writes to GCS or disk in the background.
let _dbCache = null;

// Async load from GCS (called once at startup)
async function loadDataFromGCS() {
  if (!gcsBucket) return null;
  try {
    const file = gcsBucket.file(GCS_OBJECT_NAME);
    const [exists] = await file.exists();
    if (!exists) {
      console.log('[GCS] data.json not found in bucket — starting fresh.');
      return null;
    }
    const [contents] = await file.download();
    console.log('[GCS] Loaded data.json from bucket.');
    return JSON.parse(contents.toString('utf8'));
  } catch (err) {
    console.error('[GCS] Failed to load data.json from bucket:', err);
    return null;
  }
}

// Async save to GCS (fire-and-forget — won't block request handlers)
function saveDataToGCS(data) {
  if (!gcsBucket) return;
  const json = JSON.stringify(data, null, 2);
  const file = gcsBucket.file(GCS_OBJECT_NAME);
  file.save(json, { contentType: 'application/json' }).catch(err => {
    console.error('[GCS] Failed to save data.json to bucket:', err);
  });
}

function readData() {
  // Return from in-memory cache if populated
  if (_dbCache) return _dbCache;

  // Local fallback (dev mode)
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initialData = {
        matches: [],
        users: [
          { name: DEFAULT_ADMIN_NAME, secret: DEFAULT_ADMIN_SECRET, isAdmin: true }
        ],
        adminPasscode: DEFAULT_ADMIN_PASSCODE,
        history: []
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
      _dbCache = initialData;
      console.log('\n==============================================');
      console.log(`[INIT] Created data.json with default admin '${DEFAULT_ADMIN_NAME}'`);
      console.log(`[INIT] Login passcode: ${DEFAULT_ADMIN_SECRET}  |  Admin passcode: ${DEFAULT_ADMIN_PASSCODE}`);
      console.log('[INIT] Change these placeholder credentials before going live.');
      console.log('==============================================\n');
      return initialData;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    _dbCache = JSON.parse(raw);
    return _dbCache;
  } catch (err) {
    console.error('Error reading local data file:', err);
    return { matches: [], users: [], adminPasscode: DEFAULT_ADMIN_PASSCODE, history: [] };
  }
}

function writeData(data) {
  // Always update in-memory cache immediately
  _dbCache = data;

  if (gcsBucket) {
    // Cloud Run: async write to GCS
    saveDataToGCS(data);
  } else {
    // Local dev: sync write to disk
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error writing local data file:', err);
    }
  }
}

// Points Calculation Engine
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

// Build cumulative leaderboard snapshots after each resolved match, in
// chronological order (for the racing leaderboard chart)
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

// Middleware: Authenticate user secret and get username
function authenticateSecret(req, res, next) {
  const secret = req.headers['x-user-secret'];
  if (!secret) {
    return res.status(401).json({ error: 'User passcode is required in headers.' });
  }
  
  const db = readData();
  const user = db.users.find(u => u.secret === secret.trim().toUpperCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid player passcode.' });
  }
  
  req.username = user.name;
  req.userSecret = user.secret;
  next();
}

// Middleware: Verify Admin Passcode
function verifyAdmin(req, res, next) {
  const passcode = req.headers['x-admin-passcode'];
  const userSecret = req.headers['x-user-secret'];
  const db = readData();
  const expectedPasscode = ADMIN_PASSCODE_ENV || db.adminPasscode;

  if (!passcode || passcode !== expectedPasscode) {
    return res.status(401).json({ error: 'Unauthorized. Invalid admin passcode.' });
  }

  if (!userSecret) {
    return res.status(401).json({ error: 'Unauthorized. User passcode header (x-user-secret) is required.' });
  }

  const user = db.users.find(u => u.secret === userSecret.trim().toUpperCase());
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden. Only designated admins are allowed to perform administrative tasks.' });
  }

  req.adminUsername = user.name;
  next();
}

// =================== USER ENDPOINTS ===================

// Login via Passcode
app.post('/api/login', (req, res) => {
  const { secret } = req.body;
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return res.status(400).json({ error: 'Passcode is required.' });
  }
  const cleanSecret = secret.trim().toUpperCase();
  const db = readData();

  const user = db.users.find(u => u.secret === cleanSecret);
  if (!user) {
    return res.status(401).json({ error: 'Invalid passcode. Please check with your group administrator.' });
  }

  res.json({ success: true, name: user.name, secret: user.secret, isAdmin: !!user.isAdmin });
});

// List Matches (Requires Passcode validation)
app.get('/api/matches', authenticateSecret, (req, res) => {
  const username = req.username;
  const db = readData();
  const now = new Date();

  // Process matches to respect privacy rules
  const processedMatches = db.matches.map(match => {
    const kickoffTime = new Date(match.kickoff);
    const hasStarted = kickoffTime <= now;
    
    // Determine if a voting extension is currently active
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;
    const extensionActive = extendedUntil && extendedUntil > now;

    // Find what the current user voted
    let myVote = null;
    if (match.votes.home.includes(username)) myVote = 'home';
    else if (match.votes.away.includes(username)) myVote = 'away';
    else if (match.votes.draw && match.votes.draw.includes(username)) myVote = 'draw';

    // Core Privacy Logic
    if (hasStarted || match.status === 'resolved') {
      // If started but extension is active, treat it like a pre-kickoff open match for voting
      return {
        ...match,
        hasStarted: true,
        extensionActive: !!extensionActive,
        votingExtendedUntil: match.votingExtendedUntil || null,
        myVote,
        voteCounts: {
          home: match.votes.home.length,
          away: match.votes.away.length,
          draw: match.votes.draw ? match.votes.draw.length : 0
        },
        voters: match.votes
      };
    } else {
      // Hide details before kickoff
      return {
        id: match.id,
        matchNumber: match.matchNumber,
        group: match.group,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        matchType: match.matchType,
        kickoff: match.kickoff,
        status: match.status,
        outcome: match.outcome,
        votingLocked: !!match.votingLocked,
        hasStarted: false,
        extensionActive: false,
        votingExtendedUntil: null,
        myVote,
        voteCounts: {
          home: null,
          away: null,
          draw: null
        },
        voters: null
      };
    }
  });

  res.json(processedMatches);
});

// Submit a prediction (Requires Passcode validation)
app.post('/api/predict', authenticateSecret, (req, res) => {
  const username = req.username;
  const { matchId, prediction } = req.body; // prediction: 'home', 'away', or 'draw'
  
  if (!matchId || !prediction) {
    return res.status(400).json({ error: 'matchId and prediction are required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  const now = new Date();
  const hasStarted = new Date(match.kickoff) <= now;

  // Check if match already started — unless an active extension is in place
  if (hasStarted) {
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;
    const extensionActive = extendedUntil && extendedUntil > now;
    if (!extensionActive) {
      return res.status(400).json({ error: 'Voting is locked. Match has already started.' });
    }
  }

  // Check if admin has manually locked this match
  if (match.votingLocked) {
    return res.status(400).json({ error: 'Voting is locked by the administrator for this match.' });
  }

  // Check validation of draw option
  if (prediction === 'draw' && match.matchType === 'KO') {
    return res.status(400).json({ error: 'Draw predictions are not allowed for Knockout matches.' });
  }

  if (!['home', 'away', 'draw'].includes(prediction)) {
    return res.status(400).json({ error: 'Invalid prediction option.' });
  }

  // Remove existing vote by this user in this match (ensure we don't duplicate votes)
  match.votes.home = match.votes.home.filter(u => u !== username);
  match.votes.away = match.votes.away.filter(u => u !== username);
  if (match.votes.draw) {
    match.votes.draw = match.votes.draw.filter(u => u !== username);
  } else {
    match.votes.draw = [];
  }

  // Ensure voteLog exists
  if (!Array.isArray(match.voteLog)) match.voteLog = [];

  // Add new prediction
  match.votes[prediction].push(username);

  // Record timestamped vote log entry
  match.voteLog.push({
    timestamp: new Date().toISOString(),
    player: username,
    vote: prediction
  });

  logAuditAction(db, 'PREDICTION', `${username} voted "${prediction}" for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);

  writeData(db);

  res.json({ success: true, matchId, prediction });
});

// Leaderboard calculation
app.get('/api/leaderboard', (req, res) => {
  const db = readData();
  const now = new Date();

  // A match is "live" (open for voting) when it isn't resolved, isn't admin-locked,
  // and either hasn't kicked off yet or has an active voting extension.
  const isLive = (match) => {
    if (match.status === 'resolved') return false;
    if (match.votingLocked) return false;
    const kickoff = new Date(match.kickoff);
    const extendedUntil = match.votingExtendedUntil ? new Date(match.votingExtendedUntil) : null;
    const extensionActive = extendedUntil && extendedUntil > now;
    return kickoff > now || extensionActive;
  };
  const liveMatches = db.matches.filter(isLive);

  const votedIn = (match, user) => {
    return (match.votes.home || []).includes(user)
      || (match.votes.away || []).includes(user)
      || (match.votes.draw || []).includes(user);
  };

  // Initialize scoreboard for all registered users
  const standings = {};
  const ensureStanding = (name) => {
    if (!standings[name]) {
      standings[name] = { name, points: 0, correct: 0, totalPredictions: 0, liveNotVoted: 0 };
    }
    return standings[name];
  };
  db.users.forEach(user => ensureStanding(user.name));

  // Calculate scores. totalPredictions now counts ONLY resolved matches the user voted on.
  db.matches.forEach(match => {
    const isResolved = match.status === 'resolved';
    if (!isResolved) return;

    const votersInMatch = [
      ...(match.votes.home || []),
      ...(match.votes.away || []),
      ...(match.votes.draw || [])
    ];
    votersInMatch.forEach(user => {
      ensureStanding(user).totalPredictions += 1;
    });

    const pointsAllocated = calculatePointsForMatch(match.votes, match.outcome, match.matchType);
    Object.keys(pointsAllocated).forEach(user => {
      const pts = pointsAllocated[user];
      if (pts > 0) {
        ensureStanding(user).points += pts;
        ensureStanding(user).correct += 1;
      }
    });
  });

  // Count how many currently-live matches each player has NOT voted on yet.
  Object.keys(standings).forEach(name => {
    standings[name].liveNotVoted = liveMatches.reduce(
      (count, match) => count + (votedIn(match, name) ? 0 : 1), 0
    );
  });

  // Convert map to list and sort
  const leaderboard = Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points; // Sort by points desc
    }
    if (b.correct !== a.correct) {
      return b.correct - a.correct; // Tiebreaker 1: correct predictions desc
    }
    return a.name.localeCompare(b.name); // Tiebreaker 2: alphabetical
  });

  res.json(leaderboard);
});

// Leaderboard history (cumulative standings after each resolved match, for the racing chart)
app.get('/api/leaderboard/history', (req, res) => {
  const db = readData();
  res.json(buildLeaderboardHistory(db));
});

// =================== ADMIN ENDPOINTS ===================

// Validate Admin Passcode
app.get('/api/admin/verify', verifyAdmin, (req, res) => {
  res.json({ success: true });
});

// List all players with their secret passcodes (Admin Only)
app.get('/api/admin/users', verifyAdmin, (req, res) => {
  const db = readData();
  res.json(db.users);
});

// Toggle Admin privileges for a player (Admin Only)
app.post('/api/admin/users/toggle-admin', verifyAdmin, (req, res) => {
  const { name, isAdmin } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Player name is required.' });
  }

  // Prevent self-demotion
  if (req.adminUsername === name && !isAdmin) {
    return res.status(400).json({ error: 'You cannot revoke your own administrator privileges.' });
  }

  const db = readData();
  const user = db.users.find(u => u.name === name);

  if (!user) {
    return res.status(404).json({ error: 'Player not found.' });
  }

  user.isAdmin = !!isAdmin;
  logAuditAction(db, 'TOGGLE_ADMIN', `Admin ${req.adminUsername} set admin role for user "${name}" to ${user.isAdmin}`, JSON.stringify(user));
  writeData(db);

  res.json({ success: true, user });
});

// Get Audit Logs & History (Admin Only)
app.get('/api/admin/history', verifyAdmin, (req, res) => {
  const db = readData();
  res.json(db.history || []);
});

// Create a new player (Admin Only)
app.post('/api/admin/users', verifyAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Player name is required.' });
  }
  const cleanName = name.trim();
  const db = readData();

  // Check for duplicate name
  const exists = db.users.find(u => u.name.toLowerCase() === cleanName.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: `Player name "${cleanName}" already exists.` });
  }

  // Generate unique secret code
  const secret = generateUniqueSecret(db.users);
  const newUser = { name: cleanName, secret, isAdmin: false };
  
  logAuditAction(db, 'CREATE_PLAYER', `Admin ${req.adminUsername} created player "${newUser.name}" with passcode "${newUser.secret}"`);
  db.users.push(newUser);
  writeData(db);

  res.json({ success: true, user: newUser });
});

// Delete a player (Admin Only)
app.post('/api/admin/users/delete', verifyAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Player name is required.' });
  }

  const db = readData();
  const initialCount = db.users.length;
  const deletedUser = db.users.find(u => u.name === name);

  if (!deletedUser) {
    return res.status(404).json({ error: 'Player not found.' });
  }

  logAuditAction(db, 'DELETE_PLAYER', `Admin ${req.adminUsername} deleted player "${name}"`, JSON.stringify(deletedUser));
  db.users = db.users.filter(u => u.name !== name);
  writeData(db);

  res.json({ success: true });
});

// Add a Match
app.post('/api/admin/match', verifyAdmin, (req, res) => {
  const { homeTeam, awayTeam, matchType, kickoff, matchNumber, group } = req.body;
  if (!homeTeam || !awayTeam || !matchType || !kickoff) {
    return res.status(400).json({ error: 'homeTeam, awayTeam, matchType, and kickoff are required.' });
  }

  if (!['League', 'KO'].includes(matchType)) {
    return res.status(400).json({ error: 'matchType must be League or KO.' });
  }

  const kickoffDate = new Date(kickoff);
  if (isNaN(kickoffDate.getTime())) {
    return res.status(400).json({ error: 'Invalid kickoff date.' });
  }

  const db = readData();

  const newMatch = {
    id: 'match_' + Date.now(),
    matchNumber: matchNumber ? String(matchNumber).trim() : String(db.matches.length + 1),
    group: group ? String(group).trim() : (matchType === 'KO' ? 'KO' : 'League'),
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    matchType,
    kickoff: kickoffDate.toISOString(),
    status: 'scheduled',
    votingLocked: false,
    outcome: null,
    voteLog: [],
    votes: {
      home: [],
      away: [],
      draw: []
    }
  };

  logAuditAction(db, 'CREATE_MATCH', `Admin ${req.adminUsername} created Match #${newMatch.matchNumber} [${newMatch.group}]: ${newMatch.homeTeam} vs ${newMatch.awayTeam}`);
  db.matches.push(newMatch);
  writeData(db);

  res.json({ success: true, match: newMatch });
});

// Lock / Unlock Voting for a Match (Admin Only)
app.post('/api/admin/lock', verifyAdmin, (req, res) => {
  const { matchId, locked } = req.body;
  if (!matchId || typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'matchId and locked (boolean) are required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  if (match.status === 'resolved') {
    return res.status(400).json({ error: 'Cannot change lock state for a resolved match.' });
  }

  match.votingLocked = locked;
  const action = locked ? 'LOCK_VOTING' : 'UNLOCK_VOTING';
  const actionText = locked ? 'locked' : 'unlocked';
  logAuditAction(db, action, `Admin ${req.adminUsername} ${actionText} voting for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
  writeData(db);

  res.json({ success: true, match });
});

// Extend Voting Window for a Started Match (Admin Only)
// Allows an admin to reopen voting for X minutes on a match past its kickoff time.
app.post('/api/admin/extend-voting', verifyAdmin, (req, res) => {
  const { matchId, minutes } = req.body;
  if (!matchId || typeof minutes !== 'number' || minutes <= 0 || minutes > 120) {
    return res.status(400).json({ error: 'matchId and minutes (1–120) are required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  if (match.status === 'resolved') {
    return res.status(400).json({ error: 'Cannot extend voting for a resolved match.' });
  }

  // Only makes sense for matches that have already started
  if (new Date(match.kickoff) > new Date()) {
    return res.status(400).json({ error: 'Match has not started yet — voting is still naturally open.' });
  }

  // Set the extension expiry timestamp
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  match.votingExtendedUntil = expiresAt.toISOString();
  // Also ensure it's not manually locked
  match.votingLocked = false;

  logAuditAction(db, 'EXTEND_VOTING', `Admin ${req.adminUsername} extended voting for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam}) by ${minutes} minute(s) until ${expiresAt.toLocaleTimeString()}`);
  writeData(db);

  res.json({ success: true, match, expiresAt: expiresAt.toISOString() });
});

// Get Vote Log - who voted for what and when (Admin Only)
app.get('/api/admin/votes', verifyAdmin, (req, res) => {
  const db = readData();

  const voteEntries = [];

  db.matches.forEach(match => {
    const matchLabel = `#${match.matchNumber} [${match.group}] ${match.homeTeam} vs ${match.awayTeam}`;

    // Build vote entries from voteLog (timestamped)
    if (Array.isArray(match.voteLog) && match.voteLog.length > 0) {
      // Get the latest vote per player (they may have changed vote)
      const latestVotes = {};
      match.voteLog.forEach(entry => {
        latestVotes[entry.player] = entry; // overwrite with latest
      });

      // Also include all historical changes
      match.voteLog.forEach(entry => {
        const choiceText = entry.vote === 'home' ? match.homeTeam
                         : entry.vote === 'away' ? match.awayTeam
                         : 'Draw';
        const isLatest = latestVotes[entry.player] === entry;
        voteEntries.push({
          timestamp: entry.timestamp,
          player: entry.player,
          matchId: match.id,
          matchNumber: match.matchNumber,
          matchLabel,
          vote: entry.vote,
          voteText: choiceText,
          isLatest,
          matchStatus: match.status
        });
      });
    } else {
      // Fallback: derive from votes array (no timestamp available)
      const allVotes = [
        ...match.votes.home.map(p => ({ player: p, vote: 'home', voteText: match.homeTeam })),
        ...match.votes.away.map(p => ({ player: p, vote: 'away', voteText: match.awayTeam })),
        ...(match.votes.draw || []).map(p => ({ player: p, vote: 'draw', voteText: 'Draw' }))
      ];
      allVotes.forEach(v => {
        voteEntries.push({
          timestamp: null,
          player: v.player,
          matchId: match.id,
          matchNumber: match.matchNumber,
          matchLabel,
          vote: v.vote,
          voteText: v.voteText,
          isLatest: true,
          matchStatus: match.status
        });
      });
    }
  });

  // Sort newest first
  voteEntries.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  res.json(voteEntries);
});

// Resolve a Match
app.post('/api/admin/resolve', verifyAdmin, (req, res) => {
  const { matchId, outcome } = req.body; // outcome: 'home', 'away', or 'draw'
  if (!matchId || !outcome) {
    return res.status(400).json({ error: 'matchId and outcome are required.' });
  }

  if (!['home', 'away', 'draw'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be home, away, or draw.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  if (outcome === 'draw' && match.matchType === 'KO') {
    return res.status(400).json({ error: 'Draw outcomes are not allowed for Knockout matches.' });
  }

  match.status = 'resolved';
  match.outcome = outcome;

  const winnerText = outcome === 'home' ? match.homeTeam 
                   : outcome === 'away' ? match.awayTeam 
                   : 'Draw';
  logAuditAction(db, 'RESOLVE_MATCH', `Admin ${req.adminUsername} resolved Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam}) as ${winnerText.toUpperCase()}`);
  writeData(db);

  res.json({ success: true, match });
});

// Unresolve a Match (Undo Resolution)
app.post('/api/admin/unresolve', verifyAdmin, (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId is required.' });
  }

  const db = readData();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  match.status = 'scheduled';
  match.outcome = null;

  logAuditAction(db, 'UNDO_RESOLUTION', `Admin ${req.adminUsername} undid resolution for Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`);
  writeData(db);

  res.json({ success: true, match });
});

// Delete a Match
app.post('/api/admin/delete', verifyAdmin, (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId is required.' });
  }

  const db = readData();
  const initialCount = db.matches.length;
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  logAuditAction(db, 'DELETE_MATCH', `Admin ${req.adminUsername} deleted Match #${match.matchNumber} (${match.homeTeam} vs ${match.awayTeam})`, JSON.stringify(match));
  db.matches = db.matches.filter(m => m.id !== matchId);
  writeData(db);

  res.json({ success: true });
});

// =================== FIXTURES PROXY ===================

// In-memory cache for fixtures (5-minute TTL to respect the free-tier rate limit)
let _fixturesCache = null;
let _fixturesCacheTime = 0;
const FIXTURES_CACHE_TTL = 5 * 60 * 1000;

// Tournament stages in order. Used to label fixtures and to let admins control
// which stages are currently open for the "Create Match" button (see
// /api/admin/settings) without requiring a code change/deploy as the
// tournament progresses.
const TOURNAMENT_STAGES = [
  { code: 'GROUP_STAGE',    label: 'Group Stage' },
  { code: 'LAST_32',        label: 'Round of 32' },
  { code: 'LAST_16',        label: 'Round of 16' },
  { code: 'QUARTER_FINALS', label: 'Quarter-finals' },
  { code: 'SEMI_FINALS',    label: 'Semi-finals' },
  { code: 'THIRD_PLACE',    label: 'Third Place' },
  { code: 'FINAL',          label: 'Final' }
];

const STAGE_LABELS = TOURNAMENT_STAGES.reduce((acc, s) => {
  if (s.code !== 'GROUP_STAGE') acc[s.code] = s.label;
  return acc;
}, {});

// Ensure db.settings.openMatchStages exists, defaulting to Group Stage only.
function ensureSettings(db) {
  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = {};
  }
  if (!Array.isArray(db.settings.openMatchStages)) {
    db.settings.openMatchStages = ['GROUP_STAGE'];
  }
  return db.settings;
}

// Get which tournament stages are currently open for "Create Match"
app.get('/api/admin/settings', verifyAdmin, (req, res) => {
  const db = readData();
  const settings = ensureSettings(db);
  res.json({ openMatchStages: settings.openMatchStages, availableStages: TOURNAMENT_STAGES });
});

// Update which tournament stages are open for "Create Match"
app.post('/api/admin/settings', verifyAdmin, (req, res) => {
  const { openMatchStages } = req.body;
  if (!Array.isArray(openMatchStages) || !openMatchStages.every(s => typeof s === 'string')) {
    return res.status(400).json({ error: 'openMatchStages must be an array of stage codes.' });
  }

  const validCodes = new Set(TOURNAMENT_STAGES.map(s => s.code));
  const filtered = openMatchStages.filter(s => validCodes.has(s));

  const db = readData();
  const settings = ensureSettings(db);
  settings.openMatchStages = filtered;
  logAuditAction(db, 'Update Match Stage Settings', `Admin ${req.adminUsername} set open stages for Create Match: ${filtered.join(', ') || 'none'}`);
  writeData(db);

  res.json({ openMatchStages: filtered, availableStages: TOURNAMENT_STAGES });
});

app.get('/api/admin/fixtures', verifyAdmin, async (req, res) => {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'FOOTBALL_DATA_API_KEY environment variable is not set on the server.' });
  }

  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  if (!forceRefresh && _fixturesCache && (now - _fixturesCacheTime) < FIXTURES_CACHE_TTL) {
    return res.json(_fixturesCache);
  }

  try {
    const apiRes = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': apiKey }
    });
    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({ error: `football-data.org responded with ${apiRes.status}: ${text}` });
    }

    const data = await apiRes.json();
    const fixtures = (data.matches || [])
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .map((m, i) => {
        const isGroup = m.stage === 'GROUP_STAGE';
        const matchType = isGroup ? 'League' : 'KO';
        const group = isGroup && m.group
          ? m.group.replace('GROUP_', 'Group ')
          : (STAGE_LABELS[m.stage] || m.stage || 'KO');
        const ft = (m.score || {}).fullTime || {};
        const finished = m.status === 'FINISHED';
        const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
        return {
          apiId: m.id,
          matchNumber: String(i + 1),
          homeTeam: m.homeTeam?.name || 'TBD',
          awayTeam: m.awayTeam?.name || 'TBD',
          matchType,
          group,
          stage: m.stage,
          kickoff: m.utcDate,
          status: m.status,
          scoreHome: (finished || live) ? ft.home : null,
          scoreAway: (finished || live) ? ft.away : null,
          matchday: m.matchday
        };
      });

    _fixturesCache = fixtures;
    _fixturesCacheTime = Date.now();
    res.json(fixtures);
  } catch (err) {
    console.error('[FIXTURES] Error fetching from football-data.org:', err);
    res.status(500).json({ error: 'Failed to fetch fixtures from football-data.org.' });
  }
});

// Start Server — pre-load data from GCS before accepting requests
async function startServer() {
  if (gcsBucket) {
    // Cloud Run: load data from GCS into in-memory cache before binding port
    const gcsData = await loadDataFromGCS();
    if (gcsData) {
      // Run migration logic by loading through readData with cache pre-seeded
      _dbCache = gcsData;
      // Trigger migration (readData will detect and fix schema issues)
      const migrated = readData();
      // If migration changed anything, persist it back
      if (JSON.stringify(migrated) !== JSON.stringify(gcsData)) {
        writeData(migrated);
      }
    }
  }

  app.listen(PORT, () => {
    console.log(`FIFA Predictions Server running on http://localhost:${PORT}`);
    if (GCS_BUCKET_NAME) {
      console.log(`[GCS] Persistence enabled: gs://${GCS_BUCKET_NAME}/${GCS_OBJECT_NAME}`);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
