// ===================== TOURNAMENT LOGIC =====================
// Tournament state, schedule generation, standings, match lifecycle.
// All data operations go through the server via sync (WebSocket).
// The server is the single source of truth; aquila-session.json is the
// persistent store. This file holds only in-memory state and UI helpers.

// ── Active Tournament State ──────────────────────────────────
let activeTournament = null;

function getActiveTournament() {
  return activeTournament;
}

function setActiveTournament(t) {
  activeTournament = t;
  // Sync to all other devices on the network
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.pushTournament(t);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ── Create Tournament ────────────────────────────────────────
// Creates a tournament object in memory and tells the server to persist it.
function createTournament(config) {
  const tournament = {
    id: generateId('tourn'),
    name: config.name || 'New Tournament',
    format: config.format || 'single-elimination',
    roundRobinSemiMode: config.roundRobinSemiMode || '1v4-2v3',
    setsToWin: config.setsToWin || 2,
    maxSubs: config.maxSubs || 6,
    status: 'setup',
    teams: [],
    schedule: [],
    createdAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString()
  };

  activeTournament = tournament;
  // Tell the server to persist it
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentCreate(tournament);
  }
  return tournament;
}

// ── Team Management ──────────────────────────────────────────
// All team operations send a message to the server, which persists
// the change and broadcasts the updated tournament to all devices.

function addTeamToTournament(tournamentId, teamData) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentAddTeam(tournamentId, teamData);
  } else {
    // Offline fallback: update in-memory only
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return null;
    const team = {
      id: generateId('team'),
      tournamentId,
      name: teamData.name || 'New Team',
      color: teamData.color || '#888888',
      players: []
    };
    t.teams.push(team);
    activeTournament = t;
    return team;
  }
  return null; // Server will broadcast the updated tournament
}

function removeTeamFromTournament(tournamentId, teamId) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentRemoveTeam(tournamentId, teamId);
  } else {
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return;
    t.teams = t.teams.filter(tm => tm.id !== teamId);
    activeTournament = t;
  }
}

function updateTeamInTournament(tournamentId, teamId, updates) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentUpdateTeam(tournamentId, teamId, updates);
  } else {
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return;
    const team = t.teams.find(tm => tm.id === teamId);
    if (!team) return;
    if (updates.name !== undefined) team.name = updates.name;
    if (updates.color !== undefined) team.color = updates.color;
    activeTournament = t;
  }
}

function reorderTeams(tournamentId, teamIds) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentReorderTeams(tournamentId, teamIds);
  } else {
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return;
    const ordered = [];
    for (const id of teamIds) {
      const team = t.teams.find(tm => tm.id === id);
      if (team) ordered.push(team);
    }
    t.teams = ordered;
    activeTournament = t;
  }
}

// ── Player Management (within tournament team) ───────────────
function addPlayerToTeam(tournamentId, teamId, playerData) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentAddPlayer(tournamentId, teamId, playerData);
  } else {
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return null;
    const team = t.teams.find(tm => tm.id === teamId);
    if (!team) return null;
    const player = {
      id: teamId + ':' + playerData.jersey,
      tournamentId,
      teamId,
      jersey: playerData.jersey,
      name: playerData.name || '',
      libero: playerData.libero || false
    };
    const existingIdx = team.players.findIndex(p => String(p.jersey) === String(playerData.jersey));
    if (existingIdx >= 0) team.players[existingIdx] = player;
    else team.players.push(player);
    activeTournament = t;
    return player;
  }
  return null;
}

function removePlayerFromTeam(tournamentId, teamId, jersey) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentRemovePlayer(tournamentId, teamId, jersey);
  } else {
    const t = activeTournament;
    if (!t || t.id !== tournamentId) return;
    const team = t.teams.find(tm => tm.id === teamId);
    if (!team) return;
    team.players = team.players.filter(p => String(p.jersey) !== String(jersey));
    activeTournament = t;
  }
}

// ── Start Tournament ─────────────────────────────────────────
// Tells the server to generate the schedule and persist everything.
function startTournament(tournamentId) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentStart(tournamentId);
  }
  // Server will broadcast the updated tournament with schedule
}

// ── Reset Tournament ─────────────────────────────────────────
function resetTournament() {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentReset();
  }
  activeTournament = null;
}

// ── Complete Match (delegated to server) ─────────────────────
// The client sends the match result to the server. The server updates
// the tournament (match status, bracket advance, standings) and
// broadcasts the updated tournament to all devices.
function completeTournamentMatchOnServer(tournamentId, matchId, matchResult) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendTournamentMatchComplete(tournamentId, matchId, matchResult);
  }
}

// ── Swiss Pairings ───────────────────────────────────────────
function requestSwissPairings(tournamentId, round) {
  if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
    sync.sendSwissGeneratePairings(tournamentId, round);
  }
}

// ── Load Tournament from File ────────────────────────────────
// Imports a tournament from a JSON file. The parsed data is sent to
// the server which persists it and broadcasts to all devices.
function loadTournamentFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const json = JSON.parse(e.target.result);
        // Send to server for persistence
        if (typeof sync !== 'undefined' && sync.shouldConnect() && sync.isConnected()) {
          sync.sendTournamentCreate(json.tournament || json);
        }
        const tournament = json.tournament || json;
        activeTournament = tournament;
        resolve(tournament);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ── Export Tournament ────────────────────────────────────────
function exportTournamentToFile(tournamentId) {
  const t = activeTournament;
  if (!t) return;
  const data = { tournament: t };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = 'volleyref-tournament-' + (t.name || 'export').replace(/\s+/g, '-') + '-' + stamp + '.json';
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Auto-save tournament (no-op when server-backed) ──────────
// When running with a server, the server auto-saves. This is kept
// as a no-op for backward compatibility.
function autoSaveTournament() {
  // Server handles persistence automatically
}
