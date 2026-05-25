// ===================== DATABASE LAYER =====================
// IndexedDB wrapper — all data operations go through here.
// When migrating to PostgreSQL, swap IndexedDB calls for fetch() API calls.
// Function signatures stay the same.

const DB_NAME = 'volleyref-db';
const DB_VERSION = 1;

let dbInstance = null;

// ── Initialize ──────────────────────────────────────────────
function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) { resolve(dbInstance); return; }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Tournaments store
      if (!db.objectStoreNames.contains('tournaments')) {
        const tStore = db.createObjectStore('tournaments', { keyPath: 'id' });
        tStore.createIndex('name', 'name', { unique: false });
        tStore.createIndex('status', 'status', { unique: false });
        tStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Matches store
      if (!db.objectStoreNames.contains('matches')) {
        const mStore = db.createObjectStore('matches', { keyPath: 'id' });
        mStore.createIndex('tournamentId', 'tournamentId', { unique: false });
        mStore.createIndex('status', 'status', { unique: false });
        mStore.createIndex('round', 'round', { unique: false });
      }

      // Teams store
      if (!db.objectStoreNames.contains('teams')) {
        const teamStore = db.createObjectStore('teams', { keyPath: 'id' });
        teamStore.createIndex('tournamentId', 'tournamentId', { unique: false });
        teamStore.createIndex('name', 'name', { unique: false });
      }

      // Players store — key = teamId + ':' + jersey
      if (!db.objectStoreNames.contains('players')) {
        const pStore = db.createObjectStore('players', { keyPath: 'id' });
        pStore.createIndex('teamId', 'teamId', { unique: false });
        pStore.createIndex('tournamentId', 'tournamentId', { unique: false });
      }

      // Player match stats — key = matchId + ':' + teamId + ':' + jersey
      if (!db.objectStoreNames.contains('playerMatchStats')) {
        const pmsStore = db.createObjectStore('playerMatchStats', { keyPath: 'id' });
        pmsStore.createIndex('matchId', 'matchId', { unique: false });
        pmsStore.createIndex('teamId', 'teamId', { unique: false });
        pmsStore.createIndex('tournamentId', 'tournamentId', { unique: false });
      }

      // Standings — key = tournamentId + ':' + teamId
      if (!db.objectStoreNames.contains('standings')) {
        const sStore = db.createObjectStore('standings', { keyPath: 'id' });
        sStore.createIndex('tournamentId', 'tournamentId', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// ── Generic helpers ──────────────────────────────────────────
function put(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function get(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function getAllByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Tournament CRUD ──────────────────────────────────────────
async function saveTournament(tournament) {
  tournament.lastSavedAt = new Date().toISOString();
  await put('tournaments', tournament);
}

async function getTournament(id) {
  return await get('tournaments', id);
}

async function deleteTournament(id) {
  // Cascade delete all related data
  const matches = await getAllByIndex('matches', 'tournamentId', id);
  for (const m of matches) {
    await deleteRecord('matches', m.id);
    const stats = await getAllByIndex('playerMatchStats', 'matchId', m.id);
    for (const s of stats) await deleteRecord('playerMatchStats', s.id);
  }
  const teams = await getAllByIndex('teams', 'tournamentId', id);
  for (const t of teams) {
    await deleteRecord('teams', t.id);
    const players = await getAllByIndex('players', 'teamId', t.id);
    for (const p of players) await deleteRecord('players', p.id);
  }
  const standings = await getAllByIndex('standings', 'tournamentId', id);
  for (const s of standings) await deleteRecord('standings', s.id);

  await deleteRecord('tournaments', id);
}

// ── Match CRUD ───────────────────────────────────────────────
async function saveMatch(match) {
  await put('matches', match);
}

async function getMatch(id) {
  return await get('matches', id);
}

async function getMatchesByTournament(tournamentId) {
  return await getAllByIndex('matches', 'tournamentId', tournamentId);
}

// ── Team CRUD ────────────────────────────────────────────────
async function saveTeam(team) {
  await put('teams', team);
}

async function getTeamsByTournament(tournamentId) {
  return await getAllByIndex('teams', 'tournamentId', tournamentId);
}

async function deleteTeam(teamId) {
  const players = await getAllByIndex('players', 'teamId', teamId);
  for (const p of players) await deleteRecord('players', p.id);
  await deleteRecord('teams', teamId);
}

// ── Player CRUD ──────────────────────────────────────────────
async function savePlayer(player) {
  player.id = player.teamId + ':' + player.jersey;
  await put('players', player);
}

async function getPlayersByTeam(teamId) {
  return await getAllByIndex('players', 'teamId', teamId);
}

async function getPlayersByTournament(tournamentId) {
  return await getAllByIndex('players', 'tournamentId', tournamentId);
}

async function deletePlayer(teamId, jersey) {
  await deleteRecord('players', teamId + ':' + jersey);
}

// ── Player Match Stats CRUD ──────────────────────────────────
async function savePlayerMatchStats(stats) {
  stats.id = stats.matchId + ':' + stats.teamId + ':' + stats.jersey;
  await put('playerMatchStats', stats);
}

async function getPlayerMatchStats(matchId) {
  return await getAllByIndex('playerMatchStats', 'matchId', matchId);
}

async function getPlayerStatsAcrossTournament(tournamentId, teamId, jersey) {
  const allStats = await getAllByIndex('playerMatchStats', 'tournamentId', tournamentId);
  return allStats.filter(s => s.teamId === teamId && String(s.jersey) === String(jersey));
}

// ── Standings CRUD ───────────────────────────────────────────
async function saveStanding(standing) {
  standing.id = standing.tournamentId + ':' + standing.teamId;
  await put('standings', standing);
}

async function getStandings(tournamentId) {
  return await getAllByIndex('standings', 'tournamentId', tournamentId);
}

// ── Export / Import ──────────────────────────────────────────
async function exportTournament(tournamentId) {
  const tournament = await getTournament(tournamentId);
  if (!tournament) return null;

  const teams = await getTeamsByTournament(tournamentId);
  const matches = await getMatchesByTournament(tournamentId);
  const standings = await getStandings(tournamentId);

  // Collect all player data and match stats
  const players = [];
  const playerMatchStats = [];
  for (const team of teams) {
    const teamPlayers = await getPlayersByTeam(team.id);
    players.push(...teamPlayers);
  }
  for (const match of matches) {
    const stats = await getPlayerMatchStats(match.id);
    playerMatchStats.push(...stats);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tournament,
    teams,
    matches,
    standings,
    players,
    playerMatchStats
  };
}

async function importTournament(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !data.tournament) throw new Error('Invalid tournament file');

  // Clear existing data for this tournament if it exists
  try {
    await deleteTournament(data.tournament.id);
  } catch (e) { /* first import, nothing to clear */ }

  // Write all data
  await saveTournament(data.tournament);

  if (data.teams) {
    for (const team of data.teams) await saveTeam(team);
  }
  if (data.players) {
    for (const player of data.players) await savePlayer(player);
  }
  if (data.matches) {
    for (const match of data.matches) await saveMatch(match);
  }
  if (data.playerMatchStats) {
    for (const stats of data.playerMatchStats) await savePlayerMatchStats(stats);
  }
  if (data.standings) {
    for (const standing of data.standings) await saveStanding(standing);
  }

  return data.tournament;
}

// ── Public API ───────────────────────────────────────────────
const db = {
  init: initDB,
  saveTournament,
  getTournament,
  deleteTournament,
  saveMatch,
  deleteMatch: function(id) { return deleteRecord('matches', id); },
  getMatch,
  getMatchesByTournament,
  saveTeam,
  getTeamsByTournament,
  deleteTeam,
  savePlayer,
  getPlayersByTeam,
  getPlayersByTournament,
  deletePlayer,
  savePlayerMatchStats,
  getPlayerMatchStats,
  getPlayerStatsAcrossTournament,
  saveStanding,
  getStandings,
  exportTournament,
  importTournament
};
