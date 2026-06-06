// ===================== STATE =====================
const SAVE_KEY = 'volleyref-match-state';
const SAVE_VERSION = 1;
let currentTournamentMatch = null; // { tournamentId, matchId, matchNumber }

function saveState() {
  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: state,
      liberoSelectionMode: liberoSelectionMode,
      selectedEfficiencySkill: selectedEfficiencySkill,
      subRegistry: subRegistry,
      currentTournamentMatch: currentTournamentMatch,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) { /* quota exceeded or private browsing — silently ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload || !payload.state) return false;
    state = payload.state;
    liberoSelectionMode = payload.liberoSelectionMode || null;
    selectedEfficiencySkill = payload.selectedEfficiencySkill || 'attack';
    subRegistry = payload.subRegistry || { A: {}, B: {} };
    currentTournamentMatch = payload.currentTournamentMatch || null;
    return true;
  } catch (e) { return false; }
}

function clearSavedState() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// ===================== UNDO SNAPSHOTS =====================
const MAX_UNDO = 50;
let undoStack = [];

function pushUndoSnapshot() {
  try {
    undoStack.push({
      state: JSON.parse(JSON.stringify(state)),
      liberoSelectionMode: liberoSelectionMode,
      selectedEfficiencySkill: selectedEfficiencySkill,
      subRegistry: JSON.parse(JSON.stringify(subRegistry)),
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch (e) { /* quota / serialization issue — silently ignore */ }
}

function popUndoSnapshot() {
  if (undoStack.length === 0) return false;
  const snap = undoStack.pop();
  state = snap.state;
  liberoSelectionMode = snap.liberoSelectionMode;
  selectedEfficiencySkill = snap.selectedEfficiencySkill;
  subRegistry = snap.subRegistry;
  return true;
}

let state = {
  teamA: { name: 'Team A', roster: [1,2,3,4,5,6], fullSquad: [], libero: 0,
    rotation: [1,2,3,4,5,6], timeouts: 2, subsUsed: 0, subsLog: [],
    totalPts: 0, setsWon: 0, toUsed: 0, totalSubs: 0 },
  teamB: { name: 'Team B', roster: [1,2,3,4,5,6], fullSquad: [], libero: 0,
    rotation: [1,2,3,4,5,6], timeouts: 2, subsUsed: 0, subsLog: [],
    totalPts: 0, setsWon: 0, toUsed: 0, totalSubs: 0 },
  scoreA: 0, scoreB: 0,
  currentSet: 1,
  matchNumber: 1,
  serving: 'A',
  firstServer: 'A',
  setHistory: [],
  allSubsLog: [],
  pointLog: [],
  skillEfficiencyLog: [],
  playerPoints: {}, // "A:12" -> scored points
  playerStats: {}, // "A:12" -> kills/aces/blocks/errors
  maxSubs: 6,
  setsToWin: 3,
  ptsPerSet: 25,
  gameStarted: false,
  matchEnded: false,
  summaryExported: false,
  currentSubTeam: null,
  lastTouchPlayer: null,
  lastTouchTeam: null,
  effTouchPlayer: null,
  effTouchTeam: null,
  courtSwapped: false,
};

let liberoSelectionMode = null;
let selectedEfficiencySkill = 'attack';

const TEAM_COLORS = [
  '#00c2fd', // Team A blue
  '#00cfad', // Team B teal
  '#00bb19', // Success green
  '#e0a020', // Warning orange
  '#e04040', // Danger red
  '#6ab0e0', // Light blue
  '#a0e040', // Light green
  '#e040a0', // Magenta
];

const TEAM_LAYOUTS = {
  A: {
    courtPositions: {
      pos1: { x: 55,  y: 220 },
      pos2: { x: 245, y: 220 },
      pos3: { x: 245, y: 140 },
      pos4: { x: 245, y: 60  },
      pos5: { x: 55,  y: 60  },
      pos6: { x: 55,  y: 140 }
    },
    rotationGrid: {
      headers: ['Back ◀', '▶ Net'],
      order: ['pos5', 'pos4', 'pos6', 'pos3', 'pos1', 'pos2']
    }
  },
  B: {
    courtPositions: {
      pos1: { x: 480, y: 60  },
      pos2: { x: 315, y: 60  },
      pos3: { x: 315, y: 140 },
      pos4: { x: 315, y: 220 },
      pos5: { x: 480, y: 220 },
      pos6: { x: 480, y: 140 }
    },
    rotationGrid: {
      headers: ['◀ Net','Back ▶'],
      order: ['pos2', 'pos1', 'pos3', 'pos6', 'pos4', 'pos5']
    }
  }
};

// Sub tracking: jerseys that have been sub'd in/out per team per set
let subRegistry = { A: {}, B: {} };
const MATCH_NUMBER_KEY = 'volleyref-next-match-number';

function getTeamState(team) {
  return team === 'A' ? state.teamA : state.teamB;
}

function getNextMatchNumber() {
  const stored = parseInt(localStorage.getItem(MATCH_NUMBER_KEY), 10);
  return Number.isFinite(stored) && stored > 0 ? stored : 1;
}

function reserveNextMatchNumber() {
  localStorage.setItem(MATCH_NUMBER_KEY, String(state.matchNumber + 1));
}

function getPointsTargetForSet(setNumber) {
  const decidingSet = state.setsToWin === 2 ? 3 : 5;
  return setNumber === decidingSet ? 15 : 25;
}

function updatePointsPerSetInfo() {
  const el = document.getElementById('pts-per-set-info');
  if (!el) return;
  el.textContent = state.setsToWin === 2
    ? 'Sets 1-2: 25 points, Set 3: 15 points'
    : 'Sets 1-4: 25 points, Set 5: 15 points';
}

function getPositionIndex(posKey) {
  return parseInt(posKey.replace('pos', ''), 10) - 1;
}

function getCourtPositionList(team) {
  const layout = getCourtLayoutForTeam(team).courtPositions;
  return [
    layout.pos1,
    layout.pos2,
    layout.pos3,
    layout.pos4,
    layout.pos5,
    layout.pos6
  ];
}

function getCourtLayoutForTeam(team) {
  const layoutTeam = state.courtSwapped ? (team === 'A' ? 'B' : 'A') : team;
  return TEAM_LAYOUTS[layoutTeam];
}

// ===================== TEAM COMPOSITIONS =====================
const TEAMS_STORAGE_KEY = 'volleyref-team-compositions';

let editingTeamId = null;

function loadAllTeams() {
  try {
    return JSON.parse(localStorage.getItem(TEAMS_STORAGE_KEY) || '[]');
  } catch(e) { return []; }
}

function saveAllTeams(teams) {
  localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(teams));
}

function generateTeamId() {
  return 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ── Teams list (left panel) ──
function renderTeamsList() {
  const teams = loadAllTeams();
  const el = document.getElementById('teams-list-items');
  if (!el) return;
  if (teams.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No teams saved yet. Press + New Team to start.</div>';
    return;
  }
  el.innerHTML = teams.map(t => `
    <div class="team-list-item${editingTeamId === t.id ? ' active' : ''}" onclick="openTeamEditor('${t.id}')">
      <div class="team-color-dot" style="background:${t.color || '#888'}"></div>
      <div class="team-list-name">${escHtml(t.name || 'Unnamed')}</div>
      <div class="team-list-count">${(t.players || []).length}p</div>
    </div>`).join('');
}

// ── Refresh the "Load Saved Team" dropdowns on Setup tab ──
// ── Open / create editor ──
function createNewTeam() {
  const teams = loadAllTeams();
  const newTeam = {
    id: generateTeamId(),
    name: 'New Team',
    color: TEAM_COLORS[teams.length % TEAM_COLORS.length],
    players: []
  };
  teams.push(newTeam);
  saveAllTeams(teams);
  editingTeamId = newTeam.id;
  renderTeamsList();
  renderTeamEditor(newTeam.id);
}

function openTeamEditor(id) {
  editingTeamId = id;
  renderTeamsList();
  renderTeamEditor(id);
}

function renderTeamEditor(id) {
  const panel = document.getElementById('team-editor-panel');
  if (!panel) return;
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team) { panel.innerHTML = '<div style="color:var(--text-muted);padding:24px 0;text-align:center">Team not found.</div>'; return; }

  const rows = (team.players || []).map((p, i) => `
    <div class="player-roster-row">
      <div class="row-num">${i + 1}</div>
      <input class="jersey-input" type="number" min="0" max="999" value="${p.jersey}" placeholder=" " oninput="updatePlayerField('${id}',${i},'jersey',this.value)" style="width:100%"/>
      <input type="text" value="${escHtml(p.name)}" placeholder="Player name" oninput="updatePlayerField('${id}',${i},'name',this.value)" style="width:100%"/>
      <button class="remove-player-btn" onclick="removePlayer('${id}',${i})">✕</button>
    </div>`).join('');

  panel.innerHTML = `
    <div class="team-editor-header">
      <div style="font-family:var(--font-display);font-size:17px;color:${team.color || 'var(--court-line)'}">${escHtml(team.name || 'Unnamed')}</div>
      <button class="resource-btn btn-danger" onclick="deleteTeam('${id}')">Delete Team</button>
    </div>

    <div class="field-row" style="margin-bottom:12px">
      <label>Team Name</label>
      <input id="te-name" style="width:100%;background:var(--bg-dark);border:1px solid var(--border);color:var(--text-input_field);padding:6px 8px;font-family:var(--font-main);font-size:15px"
        value="${escHtml(team.name)}" oninput="updateTeamName('${id}',this.value)" placeholder="Team name"/>
    </div>

    <div class="field-row" style="margin-bottom:14px">
      <label>Team Color</label>
      <input type="color" id="te-color" value="${team.color || '#00c2fd'}"
        style="width:100%;height:36px;border:1px solid var(--border);background:var(--bg-dark);cursor:pointer;padding:2px 4px;"
        oninput="setTeamColor('${id}',this.value)"/>
    </div>

    <div class="panel-title">Roster (${(team.players || []).length} players)</div>
    <div style="display:grid;grid-template-columns:28px 80px 1fr 28px;gap:6px;padding:4px 8px;margin-bottom:2px">
      <div></div>
      <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Jersey</div>
      <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Name</div>
      <div></div>
    </div>
    <div class="player-roster-grid" id="roster-rows">${rows}</div>
    ${team.players.length === 0 ? '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">No players yet.</div>' : ''}
    <button class="resource-btn btn-success" style="margin-top:10px;width:100%;padding:8px" onclick="addPlayer('${id}')">+ Add Player</button>
  `;
}

function updateTeamName(id, val) {
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team) return;
  team.name = val;
  saveAllTeams(teams);
  renderTeamsList();
  const header = document.querySelector('#team-editor-panel .team-editor-header div');
  if (header) { header.textContent = val || 'Unnamed'; header.style.color = team.color || 'var(--court-line)'; }
}

function setTeamColor(id, color) {
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team) return;
  team.color = color;
  saveAllTeams(teams);
  renderTeamsList();
  const header = document.querySelector('#team-editor-panel .team-editor-header div');
  if (header) header.style.color = color || 'var(--court-line)';
}

function updatePlayerField(id, idx, field, val) {
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team || !team.players[idx]) return;
  if (field === 'jersey') team.players[idx].jersey = parseInt(val, 10) || 0;
  else team.players[idx][field] = val;
  saveAllTeams(teams);
  const countEl = document.querySelector('#team-editor-panel .panel-title');
  if (countEl) countEl.textContent = `Roster (${team.players.length} players)`;
}

function addPlayer(id) {
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team) return;
  team.players.push({ jersey: 0, name: '' });
  saveAllTeams(teams);
  renderTeamEditor(id);
  renderTeamsList();
}

function removePlayer(id, idx) {
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === id);
  if (!team) return;
  team.players.splice(idx, 1);
  saveAllTeams(teams);
  renderTeamEditor(id);
  renderTeamsList();
}

function deleteTeam(id) {
  showModal('Delete Team', 'This will permanently delete this team composition. Are you sure?',
    [{ label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
     { label: 'Delete', cls: 'btn-danger', fn: () => {
       const teams = loadAllTeams().filter(t => t.id !== id);
       saveAllTeams(teams);
       editingTeamId = null;
       closeModal();
       renderTeamsList();
     
       const panel = document.getElementById('team-editor-panel');
       if (panel) panel.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Select a team on the left, or create a new one.</div>';
     }}
  ]);
}

const _pendingFullSquad = { A: [], B: [] };

function jerseyStr(v) { return String(v).trim(); }

function buildSetupPositionCells(slot, roster) {
  const container = document.getElementById('team' + slot + '-players');
  if (!container) return;
  container.innerHTML = '';
  const listId = 'roster-list-' + slot;

  let dl = document.getElementById(listId);
  if (dl) dl.remove();
  dl = document.createElement('datalist');
  dl.id = listId;
  roster.forEach(p => {
    const opt = document.createElement('option');
    opt.value = jerseyStr(p.jersey);
    opt.label = '#' + jerseyStr(p.jersey) + ' ' + (p.name || '');
    dl.appendChild(opt);
  });
  container.appendChild(dl);

  for (let i = 1; i <= 6; i++) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

    const label = document.createElement('div');
    label.className = 'player-num-label';
    label.textContent = 'Pos ' + i;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.className = 'player-num-input';
    inp.id = 'p' + slot + i;
    inp.placeholder = roster.length > 0 ? 'Pick' : '';
    inp.autocomplete = 'off';
    if (roster.length > 0) inp.setAttribute('list', listId);

    inp.addEventListener('blur', () => deduplicateSetupSlot(slot, i));

    wrap.appendChild(label);
    if (roster.length > 0) {
      const pickerWrap = document.createElement('div');
      pickerWrap.className = 'setup-player-picker';

      const pickerMenu = document.createElement('div');
      pickerMenu.className = 'player-picker-menu';
      roster.forEach(p => {
        const jersey = jerseyStr(p.jersey);
        const playerName = p.name || 'Unnamed player';
        const optionBtn = document.createElement('button');
        optionBtn.type = 'button';
        optionBtn.className = 'player-picker-option';
        optionBtn.innerHTML = '<strong>#' + escHtml(jersey) + '</strong><span>' + escHtml(playerName) + '</span>';
        optionBtn.addEventListener('click', () => {
          inp.value = jersey;
          pickerWrap.classList.remove('open');
          deduplicateSetupSlot(slot, i);
          inp.focus();
        });
        pickerMenu.appendChild(optionBtn);
      });

      inp.addEventListener('focus', () => {
        pickerWrap.classList.add('open');
        pickerWrap.closest('.setup-panel').classList.add('has-open-picker');
      });
      inp.addEventListener('input', () => pickerWrap.classList.remove('open'));

      pickerWrap.appendChild(inp);
      pickerWrap.appendChild(pickerMenu);
      wrap.appendChild(pickerWrap);
    } else {
      wrap.appendChild(inp);
    }
    container.appendChild(wrap);
  }
}

function deduplicateSetupSlot(slot, changedPos) {
  const changedEl = document.getElementById('p' + slot + changedPos);
  if (!changedEl) return;
  const val = changedEl.value.trim();
  if (val === '' || val === '0') return;
  for (let j = 1; j <= 6; j++) {
    if (j === changedPos) continue;
    const other = document.getElementById('p' + slot + j);
    if (other && other.value.trim() === val) {
      other.value = '';
    }
  }
}

function getPositionJersey(slot, i) {
  const el = document.getElementById('p' + slot + i);
  if (!el) return String(i);
  return el.value.trim() || String(i);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===================== SETUP =====================
function initSetupUI() {
  const setsToWinEl = document.getElementById('sets-to-win');
  if (setsToWinEl) {
    setsToWinEl.onchange = () => {
      state.setsToWin = parseInt(setsToWinEl.value, 10) || 3;
      updatePointsPerSetInfo();
    };
  }
  state.setsToWin = parseInt(document.getElementById('sets-to-win').value, 10) || 3;
  updatePointsPerSetInfo();

  ['A','B'].forEach(t => {
    buildSetupPositionCells(t, []);
  });

  ['A', 'B'].forEach(t => {
    const el = document.getElementById('next-team' + t + '-players');
    el.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
      const div = document.createElement('div');
      div.innerHTML = `<div class="player-num-label">Pos ${i}</div>
        <input class="player-num-input" type="text" inputmode="numeric" id="n${t}${i}" value="${i}" placeholder=" " autocomplete="off"/>`;
      el.appendChild(div);
      const inp = div.querySelector('input');
      const pos = i;
      const team = t;
      inp.addEventListener('blur', () => deduplicateNextSetSlot(team, pos));
    }
  });
}

function startGame() {
  undoStack = [];
  state.teamA.name = document.getElementById('teamA-name').value || 'Team A';
  state.teamB.name = document.getElementById('teamB-name').value || 'Team B';
  state.teamA.libero = parseInt(document.getElementById('teamA-libero').value) || 0;
  state.teamB.libero = parseInt(document.getElementById('teamB-libero').value) || 0;
  state.setsToWin = parseInt(document.getElementById('sets-to-win').value);
  state.ptsPerSet = getPointsTargetForSet(1);
  state.maxSubs = parseInt(document.getElementById('max-subs').value);
  state.firstServer = document.getElementById('first-server').value;
  state.matchNumber = getNextMatchNumber();

  let rA = [], rB = [];
  for (let i = 1; i <= 6; i++) {
    const ja = getPositionJersey('A', i); rA.push(ja !== '' ? ja : String(i));
    const jb = getPositionJersey('B', i); rB.push(jb !== '' ? jb : String(i));
  }
  state.teamA.roster = [...rA];
  state.teamB.roster = [...rB];
  state.teamA.rotation = [...rA];
  state.teamB.rotation = [...rB];
  
  state.teamA.fullSquad = _pendingFullSquad.A.length > 0 ? [..._pendingFullSquad.A] : [...rA];
  state.teamB.fullSquad = _pendingFullSquad.B.length > 0 ? [..._pendingFullSquad.B] : [...rB];
  
  state.teamA.totalPts = 0;
  state.teamB.totalPts = 0;
  state.teamA.setsWon = 0;
  state.teamB.setsWon = 0;
  state.teamA.toUsed = 0;
  state.teamB.toUsed = 0;
  state.teamA.totalSubs = 0;
  state.teamB.totalSubs = 0;
  
  state.setHistory = [];
  state.allSubsLog = [];
  state.pointLog = [];
  state.skillEfficiencyLog = [];
  state.playerPoints = {};
  state.playerStats = {};
  state.serving = state.firstServer;
  state.currentSet = 1;
  state.matchEnded = false;
  state.summaryExported = false;

  state.gameStarted = true;
  resetSetState();
  switchView('game');
  renderAll();
  showAlert('Match started! ' + state.teamA.name + ' vs ' + state.teamB.name, 'success');
  saveState();
}

// ===================== GAME LOGIC =====================
function resetSetState() {
  state.scoreA = 0; state.scoreB = 0;
  state.teamA.timeouts = 2; state.teamB.timeouts = 2;
  state.teamA.subsUsed = 0; state.teamB.subsUsed = 0;
  state.teamA.subsLog = []; state.teamB.subsLog = [];
  state.teamA.liberoStatus = {in: false, replaced: null};
  state.teamB.liberoStatus = {in: false, replaced: null};
  state.teamA.sanctions = [];
  state.teamB.sanctions = [];
  liberoSelectionMode = null;

  state.pointLog = [];
  subRegistry = { A: {}, B: {} };
  
  state.effTouchPlayer = null;
  state.effTouchTeam = null;
}

function addPoint(team, options = {}) {
  if (!state.gameStarted) { showAlert('Start match first!', 'warn'); return; }
  pushUndoSnapshot();

  const scorerInfo = options.scorerInfo || null;
  const statEvents = options.statEvents || [];

  if (team === 'A') {
    state.scoreA++;
    state.teamA.totalPts++;
  } else {
    state.scoreB++;
    state.teamB.totalPts++;
  }

  if (scorerInfo) trackPlayerPoint(scorerInfo.team, scorerInfo.jersey);
  statEvents.forEach(event => incrementPlayerStat(event.team, event.jersey, event.stat));

  let wasServing = state.serving;
  let rotatedTeam = null;

  if (team !== state.serving) {
    rotateTeamState(team);
    state.serving = team;
    rotatedTeam = team; 
  }

  state.pointLog.push({ 
      scoreA: state.scoreA, 
      scoreB: state.scoreB, 
      team, 
      set: state.currentSet,
      scorerInfo: scorerInfo,
      statEvents: statEvents,
      actionType: options.actionType || null,
      actionLabel: options.actionLabel || null,
      responsiblePlayer: options.responsiblePlayer || null,
      wasServing: wasServing,
      rotatedTeam: rotatedTeam
  });
  
  const actionEl = document.getElementById('last-action');
  if (actionEl) actionEl.textContent = 'Point to ' + (team==='A'?state.teamA.name:state.teamB.name) + ' (' + state.scoreA + '-' + state.scoreB + ')';
  
  checkSetWin();
  renderAll();
  saveState();
}

function getPlayerKey(team, jersey) {
  return team + ':' + normalizeJerseyValue(jersey);
}

function trackPlayerPoint(team, jersey) {
  const key = getPlayerKey(team, jersey);
  state.playerPoints[key] = (state.playerPoints[key] || 0) + 1;
}

function ensurePlayerStats(team, jersey) {
  const key = getPlayerKey(team, jersey);
  if (!state.playerStats) state.playerStats = {};
  if (!state.playerStats[key]) {
    state.playerStats[key] = { kills: 0, aces: 0, blocks: 0, attackErrors: 0, serveErrors: 0, faults: 0 };
  }
  return state.playerStats[key];
}

function incrementPlayerStat(team, jersey, stat) {
  const stats = ensurePlayerStats(team, jersey);
  stats[stat] = (stats[stat] || 0) + 1;
}

function decrementPlayerStat(team, jersey, stat) {
  if (!state.playerStats) return;
  const key = getPlayerKey(team, jersey);
  const stats = state.playerStats[key];
  if (!stats || !stats[stat]) return;
  stats[stat]--;
  if (stats.kills <= 0 && stats.aces <= 0 && stats.blocks <= 0 && stats.attackErrors <= 0 && stats.serveErrors <= 0 && stats.faults <= 0) {
    delete state.playerStats[key];
  }
}

function undoLastPoint() {
  if (state.pointLog.length === 0) { showAlert('Nothing to undo', 'warn'); return; }
  state.pointLog.pop();
  if (!popUndoSnapshot()) {
    showAlert('Nothing to undo', 'warn');
    return;
  }
  renderAll();
  showAlert('Last point undone', 'warn');
  saveState();
}

function checkSetWin() {
  const pts = state.ptsPerSet;
  const minLead = 2;
  const aWin = state.scoreA >= pts && state.scoreA - state.scoreB >= minLead;
  const bWin = state.scoreB >= pts && state.scoreB - state.scoreA >= minLead;
  if (aWin || bWin) {
    const winner = aWin ? 'A' : 'B';
    state.setHistory.push({ set: state.currentSet, a: state.scoreA, b: state.scoreB, winner });
    if (aWin) state.teamA.setsWon++; else state.teamB.setsWon++;
    showModal('Set ' + state.currentSet + ' Complete!',
      (aWin ? state.teamA.name : state.teamB.name) + ' wins the set ' + state.scoreA + '-' + state.scoreB + '.',
      [{ label: 'Next Set', cls: 'btn-success', fn: newSet },
       { label: 'End Match', cls: 'btn-warn', fn: endMatch }]);

    if (state.teamA.setsWon >= state.setsToWin || state.teamB.setsWon >= state.setsToWin) {
      endMatch();
    }
  }
}

function newSet() {
  if (state.teamA.setsWon >= state.setsToWin || state.teamB.setsWon >= state.setsToWin) {
    endMatch(); return;
  }
  closeModal();
  openSetConfigModal();
}

async function endMatch() {
  if (state.matchEnded) {
    closeModal();
    switchView('summary');
    updateSummary();
    return;
  }
  state.matchEnded = true;
  state.gameStarted = false;
  if (!state.summaryExported) {
    if (!currentTournamentMatch) {
      exportMatchSummary();
      reserveNextMatchNumber();
    }
    state.summaryExported = true;
  }

  // ── Tournament Match Completion ─────────────────────────────
  let tournamentResultSaved = false;
  if (currentTournamentMatch) {
    const winnerCode = getWinnerTeamCode();
    const setsA = state.teamA.setsWon;
    const setsB = state.teamB.setsWon;

    // Build set scores from set history
    const setScores = state.setHistory.map(function(s) { return { a: s.a, b: s.b }; });

    const matchResult = {
      score: { setsA, setsB, setScores },
      matchData: buildMatchSummary()
    };

    // Resolve the winner by matching team NAMES (not A/B slots).
    // The game's state.teamA might not correspond to the tournament's teamA
    // (e.g. after "Change Court" or manual lineup changes).
    const tournament = getActiveTournament();
    if (tournament) {
      const match = tournament.schedule.find(function(m) { return m.id === currentTournamentMatch.matchId; });
      if (match && winnerCode) {
        const gameWinnerName = winnerCode === 'A' ? state.teamA.name : state.teamB.name;
        const gameLoserName = winnerCode === 'A' ? state.teamB.name : state.teamA.name;

        // Match game team names to tournament team names to get correct IDs
        const tournTeamA = tournament.teams.find(function(tm) { return tm.id === match.teamAId; });
        const tournTeamB = tournament.teams.find(function(tm) { return tm.id === match.teamBId; });
        const tournNameA = tournTeamA ? tournTeamA.name : match.teamAName;
        const tournNameB = tournTeamB ? tournTeamB.name : match.teamBName;

        let winnerTeamId = null;
        if (gameWinnerName === tournNameA) {
          winnerTeamId = match.teamAId;
        } else if (gameWinnerName === tournNameB) {
          winnerTeamId = match.teamBId;
        }
        // Fallback: if names don't match (user renamed in setup), use slot-based mapping
        if (!winnerTeamId) {
          winnerTeamId = winnerCode === 'A' ? match.teamAId : match.teamBId;
        }

        matchResult.winnerId = winnerTeamId;

        await completeTournamentMatch(currentTournamentMatch.tournamentId, currentTournamentMatch.matchId, matchResult);

        // Auto-advance winner in bracket
        await advanceTournamentWinner(currentTournamentMatch.tournamentId, currentTournamentMatch.matchId);

        // Mark match as in-schedule on the banner
        const bannerText = document.getElementById('tourney-banner-text');
        tournamentResultSaved = true;
        bannerText.textContent = '✅ Match ' + currentTournamentMatch.matchNumber + ' completed — ' + gameWinnerName + ' wins ' + setsA + '-' + setsB;
      }
    }
  }

  closeModal();
  if (tournamentResultSaved) {
    document.getElementById('tourney-banner').classList.add('tourney-banner-hidden');
    currentTournamentMatch = null;
    switchMenu('admin');
    switchView('schedule');
    showAlert('Match result saved to tournament. Winner advanced.', 'success');
  } else {
    switchView('summary');
    updateSummary();
    showAlert('Match summary exported to JSON.', 'success');
  }

  clearSavedState();
  undoStack = [];
}

// ===================== ROTATION =====================
function performRotation(team, dir) {
  const t = getTeamState(team);
  
  if (t.liberoStatus && t.liberoStatus.in) {
    const liberoIdx = t.rotation.findIndex(j => String(j) === String(t.libero));
    
    if (dir === 'fwd' && liberoIdx === 4) {
      showAlert(`Libero rotated to front row! Auto-swapped for #${t.liberoStatus.replaced}.`, 'warn');
      t.rotation[liberoIdx] = t.liberoStatus.replaced;
      t.liberoStatus = { in: false, replaced: null };
    } 
    else if (dir === 'back' && liberoIdx === 0) {
      showAlert(`Libero rotated to front row! Auto-swapped for #${t.liberoStatus.replaced}.`, 'warn');
      t.rotation[liberoIdx] = t.liberoStatus.replaced;
      t.liberoStatus = { in: false, replaced: null };
    }
  }

  if (dir === 'fwd') {
    const first = t.rotation.shift();
    t.rotation.push(first);
  } else {
    const last = t.rotation.pop();
    t.rotation.unshift(last);
  }
}

function rotateTeamState(team) {
  performRotation(team, 'fwd');
}

function rotateTeam(team, dir) {
  pushUndoSnapshot();
  performRotation(team, dir);
  renderAll();
  checkRotationValidity();
  saveState();
}

function toggleCourtSides() {
  pushUndoSnapshot();
  state.courtSwapped = !state.courtSwapped;
  renderAll();
  showAlert('Court sides changed.', 'success');
  saveState();
}

function updateGameCourtSides() {
  const scoreHeader = document.getElementById('score-header');
  if (scoreHeader) {
    const blockA = scoreHeader.querySelector('[data-score-team="A"]');
    const blockB = scoreHeader.querySelector('[data-score-team="B"]');
    const center = document.getElementById('center-info');
    if (blockA && blockB && center) {
      blockA.style.gridColumn = '';
      blockB.style.gridColumn = '';
      center.style.gridColumn = '';
      if (state.courtSwapped) {
        scoreHeader.insertBefore(blockB, center); 
        scoreHeader.appendChild(blockA);           
      } else {
        scoreHeader.insertBefore(blockA, center); 
        scoreHeader.appendChild(blockB);           
      }
    }
  }

  const scoreActions = document.querySelector('.game-score-actions');
  if (scoreActions) {
    const btnA = scoreActions.querySelector('[data-point-team="A"]');
    const btnB = scoreActions.querySelector('[data-point-team="B"]');
    if (btnA && btnB) {
      btnA.style.gridColumn = '';
      btnB.style.gridColumn = '';
      if (state.courtSwapped) {
        scoreActions.appendChild(btnA); 
      } else {
        scoreActions.insertBefore(btnA, btnB); 
      }
    }
  }

  const courtPanel = document.querySelector('.game-court-panel');
  if (courtPanel) {
    const sideA = courtPanel.querySelector('[data-game-side="A"]');
    const sideB = courtPanel.querySelector('[data-game-side="B"]');
    const netDiv = courtPanel.querySelector('.game-net-divider');
    if (sideA && sideB && netDiv) {
      sideA.style.gridColumn = '';
      sideB.style.gridColumn = '';
      sideA.style.textAlign = '';
      sideB.style.textAlign = '';
      sideA.querySelectorAll('.game-team-row').forEach(r => r.style.flexDirection = '');
      sideB.querySelectorAll('.game-team-row').forEach(r => r.style.flexDirection = '');
      sideA.querySelectorAll('.game-team-head, .game-team-rotation').forEach(s => {
        s.style.textAlign = ''; s.style.alignItems = '';
      });
      sideB.querySelectorAll('.game-team-head, .game-team-rotation').forEach(s => {
        s.style.textAlign = ''; s.style.alignItems = '';
      });

      if (state.courtSwapped) {
        courtPanel.insertBefore(sideB, netDiv); 
        courtPanel.appendChild(sideA);           
      } else {
        courtPanel.insertBefore(sideA, netDiv); 
        courtPanel.appendChild(sideB);           
      }
    }
  }

  const nameA = document.getElementById('combined-nameA');
  const nameB = document.getElementById('combined-nameB');
  if (nameA) nameA.textContent = state.teamA.name;
  if (nameB) nameB.textContent = state.teamB.name;

  const labelA = document.getElementById('svg-labelA');
  const labelB = document.getElementById('svg-labelB');
  if (labelA) labelA.setAttribute('x', state.courtSwapped ? '420' : '140');
  if (labelB) labelB.setAttribute('x', state.courtSwapped ? '140' : '420');

  const effLabelA = document.getElementById('eff-svg-labelA');
  const effLabelB = document.getElementById('eff-svg-labelB');
  if (effLabelA) effLabelA.setAttribute('x', state.courtSwapped ? '420' : '140');
  if (effLabelB) effLabelB.setAttribute('x', state.courtSwapped ? '140' : '420');

  const btnText = state.courtSwapped ? '⇄ Court: Swapped' : '⇄ Change Court';
  const gameBtn = document.getElementById('game-change-court-btn');
  const courtBtn = document.getElementById('court-change-court-btn');
  if (gameBtn) gameBtn.textContent = btnText;
  if (courtBtn) courtBtn.textContent = btnText;
}

function checkRotationValidity() {
  const rotStatusEl = document.getElementById('rotation-status');
  if (rotStatusEl) rotStatusEl.innerHTML = '● Valid <span style="color:var(--text-muted);font-size:10px">(positional check)</span>';
}

// ===================== TIMEOUT =====================
function useTimeout(team) {
  if (state.gameStarted === false) { showAlert('Start match first!', 'warn'); return; }
  pushUndoSnapshot();
  const t = team === 'A' ? state.teamA : state.teamB;
  if (t.timeouts <= 0) {
    showAlert((team==='A'?state.teamA.name:state.teamB.name) + ' has no timeouts left!', 'danger');
    return;
  }
  t.timeouts--;
  t.toUsed++;
  showAlert('Timeout called for ' + (team==='A'?state.teamA.name:state.teamB.name) + '. Remaining: ' + t.timeouts, 'warn');
  renderAll();
  saveState();
}

// ===================== SUBSTITUTION =====================
function openSubModal(team) {
  state.currentSubTeam = team;
  const t = getTeamState(team);
  const remaining = state.maxSubs - t.subsUsed;
  const subIn = document.getElementById('sub-in-jersey');

  document.getElementById('sub-modal-title').textContent = 'Substitution — ' + t.name;
  document.getElementById('sub-modal-info').textContent = remaining + ' substitutions remaining this set.';
  document.getElementById('sub-validation-msg').textContent = '';
  subIn.value = '';
  subIn.readOnly = false;

  const sel = document.getElementById('sub-out');
  sel.innerHTML = '';
  t.rotation.forEach((jersey, idx) => {
    const opt = document.createElement('option');
    opt.value = jersey;
    opt.textContent = '#' + jersey + ' (Pos ' + (idx+1) + ')';
    sel.appendChild(opt);
  });
  sel.onchange = updateSubModalBuddyHint;

  if (remaining <= 0) {
    document.getElementById('sub-modal-info').innerHTML = '<span style="color:var(--danger)">No substitutions remaining!</span>';
    document.querySelector('#sub-overlay button.btn-success').disabled = true;
  } else {
    document.querySelector('#sub-overlay button.btn-success').disabled = false;
  }

  document.getElementById('sub-overlay').style.display = 'flex';
  updateSubModalBuddyHint();
}

function closeSubModal() {
  document.getElementById('sub-overlay').style.display = 'none';
}

function getSubBuddy(team, jersey) {
  return subRegistry[team][String(jersey)] || null;
}

function normalizeJerseyValue(value) {
  return String(value ?? '').trim();
}

function isValidJerseyValue(value) {
  return /^\d+$/.test(value);
}

function rotationHasJersey(rotation, jersey) {
  const target = normalizeJerseyValue(jersey);
  return rotation.some(value => normalizeJerseyValue(value) === target);
}

function findRotationIndex(rotation, jersey) {
  const target = normalizeJerseyValue(jersey);
  return rotation.findIndex(value => normalizeJerseyValue(value) === target);
}

function updateSubModalBuddyHint() {
  const team = state.currentSubTeam;
  if (!team) return;

  const t = getTeamState(team);
  const outJersey = normalizeJerseyValue(document.getElementById('sub-out').value);
  const inInput = document.getElementById('sub-in-jersey');
  const msg = document.getElementById('sub-validation-msg');
  const info = document.getElementById('sub-modal-info');
  const remaining = state.maxSubs - t.subsUsed;
  const buddy = getSubBuddy(team, outJersey);

  msg.textContent = '';
  info.textContent = remaining + ' substitutions remaining this set.';
  inInput.readOnly = false;

  if (buddy) {
    inInput.value = buddy;
    inInput.readOnly = true;
    info.innerHTML = '#' + outJersey + ' is tied to #' + buddy + ' for this set. Only this buddy substitution is allowed.';
    if (rotationHasJersey(t.rotation, buddy)) {
      msg.innerHTML = '<span style="color:var(--danger)">#' + buddy + ' is already on court, so #' + outJersey + ' cannot be substituted right now.</span>';
    }
  } else {
    inInput.value = '';
  }
}

function confirmSub() {
  pushUndoSnapshot();
  const team = state.currentSubTeam;
  const t = getTeamState(team);
  const outJersey = normalizeJerseyValue(document.getElementById('sub-out').value);
  const inJersey = normalizeJerseyValue(document.getElementById('sub-in-jersey').value);
  const msg = document.getElementById('sub-validation-msg');

  if (!isValidJerseyValue(inJersey)) {
    msg.innerHTML = '<span style="color:var(--danger)">Invalid jersey number.</span>';
    return;
  }
  if (rotationHasJersey(t.rotation, inJersey)) {
    msg.innerHTML = '<span style="color:var(--danger)">Player #' + inJersey + ' is already on court.</span>';
    return;
  }

  const reg = subRegistry[team];
  const outBuddy = reg[outJersey];
  const inBuddy = reg[inJersey];
  if (outBuddy && outBuddy !== inJersey) {
    msg.innerHTML = '<span style="color:var(--danger)">Invalid: #' + outJersey + ' is tied to #' + outBuddy + ' for this set.</span>';
    return;
  }
  if (inBuddy && inBuddy !== outJersey) {
    msg.innerHTML = '<span style="color:var(--danger)">Invalid: #' + inJersey + ' is tied to #' + inBuddy + ' for this set.</span>';
    return;
  }
  if (reg[inJersey] && reg[inJersey] !== outJersey) {
    msg.innerHTML = '<span style="color:var(--danger)">Invalid: #' + inJersey + ' can only replace #' + (reg[inJersey]||'—') + ' per FIVB rules.</span>';
    return;
  }

  if (t.subsUsed >= state.maxSubs) {
    msg.innerHTML = '<span style="color:var(--danger)">Substitution limit reached!</span>';
    return;
  }

  const idx = findRotationIndex(t.rotation, outJersey);
  if (idx === -1) {
    msg.innerHTML = '<span style="color:var(--danger)">Player #' + outJersey + ' is not currently on court.</span>';
    return;
  }
  t.rotation[idx] = inJersey;
  t.subsUsed++;
  t.totalSubs++;
  reg[inJersey] = outJersey;
  reg[outJersey] = inJersey;

  const logEntry = {
    set: state.currentSet,
    out: outJersey, in: inJersey,
    pos: idx + 1,
    score: state.scoreA + '-' + state.scoreB,
    valid: true
  };
  t.subsLog.push(logEntry);
  state.allSubsLog.push({ ...logEntry, team, tname: t.name });

  closeSubModal();
  renderAll();
  showAlert('Sub: #' + inJersey + ' IN for #' + outJersey + ' (Pos ' + (idx+1) + ')', 'success');
  saveState();
}

function openSetConfigModal() {
  document.getElementById('set-config-title').textContent = 'Configure Set ' + (state.currentSet + 1);
  document.getElementById('next-teamA-title').textContent = state.teamA.name;
  document.getElementById('next-teamB-title').textContent = state.teamB.name;
  document.getElementById('next-teamA-libero').value = state.teamA.libero || 0;
  document.getElementById('next-teamB-libero').value = state.teamB.libero || 0;
  document.getElementById('next-set-serving').value = state.serving;
  document.getElementById('set-config-validation-msg').textContent = '';

  ['A', 'B'].forEach(team => {
    const t = getTeamState(team);
    const rotation = t.rotation;
    const container = document.getElementById('next-team' + team + '-players');
    if (!container) return;

    const listId = 'next-roster-list-' + team;
    let dl = document.getElementById(listId);
    if (dl) dl.remove();
    dl = document.createElement('datalist');
    dl.id = listId;
    const pool = (t.fullSquad && t.fullSquad.length > 0) ? t.fullSquad : (t.roster || rotation);
    pool.forEach(jersey => {
      const opt = document.createElement('option');
      opt.value = String(jersey);
      dl.appendChild(opt);
    });
    container.appendChild(dl);

    rotation.forEach((jersey, idx) => {
      const inp = document.getElementById('n' + team + (idx + 1));
      if (inp) {
        inp.setAttribute('list', listId);
        inp.value = String(jersey);
      }
    });
  });

  document.getElementById('set-config-overlay').style.display = 'flex';
}

function closeSetConfigModal() {
  document.getElementById('set-config-overlay').style.display = 'none';
}

function readNextSetLineup(team) {
  const jerseys = [];
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById('n' + team + i);
    const raw = el ? el.value.trim() : '';
    if (raw === '') return null;
    jerseys.push(raw); 
  }
  return jerseys;
}

function validateUniqueLineup(lineup) {
  return new Set(lineup.map(String)).size === lineup.length;
}

function deduplicateNextSetSlot(team, changedPos) {
  const changedEl = document.getElementById('n' + team + changedPos);
  if (!changedEl) return;
  const val = changedEl.value.trim();
  if (val === '') return;
  for (let j = 1; j <= 6; j++) {
    if (j === changedPos) continue;
    const other = document.getElementById('n' + team + j);
    if (other && other.value.trim() === val) other.value = '';
  }
}

function confirmNextSetSetup() {
  pushUndoSnapshot();
  const msg = document.getElementById('set-config-validation-msg');
  const nextA = readNextSetLineup('A');
  const nextB = readNextSetLineup('B');
  const liberoA = parseInt(document.getElementById('next-teamA-libero').value, 10) || 0;
  const liberoB = parseInt(document.getElementById('next-teamB-libero').value, 10) || 0;

  if (!nextA || !nextB) {
    msg.innerHTML = '<span style="color:var(--danger)">Every position must have a valid jersey number.</span>';
    return;
  }
  if (!validateUniqueLineup(nextA) || !validateUniqueLineup(nextB)) {
    msg.innerHTML = '<span style="color:var(--danger)">Each team lineup must contain 6 unique jersey numbers.</span>';
    return;
  }

  state.currentSet++;
  state.teamA.rotation = [...nextA];
  state.teamB.rotation = [...nextB];
  state.teamA.roster = [...nextA];
  state.teamB.roster = [...nextB];
  state.teamA.libero = liberoA;
  state.teamB.libero = liberoB;
  state.serving = document.getElementById('next-set-serving').value;
  state.ptsPerSet = getPointsTargetForSet(state.currentSet);

  resetSetState();
  closeSetConfigModal();
  renderAll();
  showAlert('Set ' + state.currentSet + ' lineup configured.', 'success');
  saveState();
}

// ===================== COURT / TOUCH TRACKING =====================
function renderCourts() {
  const svgMain = document.getElementById('court-players');
  const svgEff = document.getElementById('eff-court-players');
  if (svgMain) svgMain.innerHTML = '';
  if (svgEff) svgEff.innerHTML = '';

  state.lastTouchPlayer = state.lastTouchPlayer || null;
  state.effTouchPlayer = state.effTouchPlayer || null;

  const lblA = document.getElementById('svg-labelA');
  const lblB = document.getElementById('svg-labelB');
  if (lblA) lblA.textContent = (state.teamA.name || 'Team A').toUpperCase();
  if (lblB) lblB.textContent = (state.teamB.name || 'Team B').toUpperCase();
  
  const effLblA = document.getElementById('eff-svg-labelA');
  const effLblB = document.getElementById('eff-svg-labelB');
  if (effLblA) effLblA.textContent = (state.teamA.name || 'Team A').toUpperCase();
  if (effLblB) effLblB.textContent = (state.teamB.name || 'Team B').toUpperCase();

  const positionsA = getCourtPositions('A');
  const positionsB = getCourtPositions('B');

  positionsA.forEach(p => {
    if (svgMain) drawPlayerOnCourt(svgMain, p.x, p.y, p.jersey, 'A', p.isLibero, p.posIdx, 'main');
    if (svgEff) drawPlayerOnCourt(svgEff, p.x, p.y, p.jersey, 'A', p.isLibero, p.posIdx, 'eff');
  });

  positionsB.forEach(p => {
    if (svgMain) drawPlayerOnCourt(svgMain, p.x, p.y, p.jersey, 'B', p.isLibero, p.posIdx, 'main');
    if (svgEff) drawPlayerOnCourt(svgEff, p.x, p.y, p.jersey, 'B', p.isLibero, p.posIdx, 'eff');
  });
}

function getCourtPositions(team) {
  const t = getTeamState(team);
  const rot = t.rotation;
  const orderedPositions = getCourtPositionList(team);
  return rot.map((jersey, i) => ({
    x: orderedPositions[i].x, y: orderedPositions[i].y,
    jersey, isLibero: normalizeJerseyValue(jersey) === normalizeJerseyValue(t.libero) && Number(t.libero) > 0,
    posIdx: i
  }));
}

function drawPlayerOnCourt(svg, x, y, jersey, team, isLibero, posIdx, courtType) {
  const color = team === 'A' ? '#0057ff' : '#00b86b';
  const liberoColor = '#9060d0';
  const fill = isLibero ? liberoColor : color;
  
  let isSelected = false;
  if (courtType === 'main') {
      isSelected = normalizeJerseyValue(state.lastTouchPlayer) === normalizeJerseyValue(jersey) && state.lastTouchTeam === team;
  } else {
      isSelected = normalizeJerseyValue(state.effTouchPlayer) === normalizeJerseyValue(jersey) && state.effTouchTeam === team;
  }
  
  const isSelectable = liberoSelectionMode === team && (posIdx === 0 || posIdx === 4 || posIdx === 5);
  const r = 25;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  let classNames = 'player-circle';
  if (isSelected) classNames += ' selected';
  if (isSelectable) classNames += ' libero-selectable';
  
  g.setAttribute('class', classNames);
  g.style.cursor = 'pointer';
  
  g.onclick = () => {
    if (isSelectable) {
      executeLiberoSwap(team, posIdx);
    } else {
      if (courtType === 'main') selectPlayerTouch(jersey, team);
      else selectEffPlayerTouch(jersey, team);
    }
  };

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', x);
  circle.setAttribute('cy', y);
  circle.setAttribute('r', r);
  circle.setAttribute('fill', isSelected ? '#ffffff' : fill);
  circle.setAttribute('stroke', isSelected ? '#ffff00' : (isLibero ? '#b090f0' : fill));
  circle.setAttribute('stroke-width', isSelected ? '3' : '1.5');
  circle.setAttribute('opacity', '0.9');

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', x);
  text.setAttribute('y', y + 6);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '16');
  text.setAttribute('font-weight', 'bold');
  text.setAttribute('fill', isSelected ? fill : '#ffffff');
  text.setAttribute('font-family', 'Courier New');
  text.textContent = '#' + jersey;

  g.appendChild(circle);
  g.appendChild(text);
  svg.appendChild(g);
}

function selectPlayerTouch(jersey, team) {
  state.lastTouchPlayer = jersey;
  state.lastTouchTeam = team;
  const tName = team === 'A' ? state.teamA.name : state.teamB.name;
  document.getElementById('last-touch-val').textContent = '#' + jersey;
  document.getElementById('last-touch-val').style.color = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  document.getElementById('last-touch-team').textContent = tName;
  setCourtActionButtonsDisabled(false);
  renderCourts();
}

function setCourtActionButtonsDisabled(disabled) {
  document.querySelectorAll('[data-court-action]').forEach(btn => { btn.disabled = disabled; });
}

function clearTouch() {
  state.lastTouchPlayer = null;
  state.lastTouchTeam = null;
  document.getElementById('last-touch-val').textContent = '—';
  document.getElementById('last-touch-val').style.color = 'var(--text-primary)';
  document.getElementById('last-touch-team').textContent = 'Tap a player on court';
  setCourtActionButtonsDisabled(true);
  renderCourts();
}

function selectEffPlayerTouch(jersey, team) {
  state.effTouchPlayer = jersey;
  state.effTouchTeam = team;
  const tName = team === 'A' ? state.teamA.name : state.teamB.name;
  document.getElementById('eff-touch-val').textContent = '#' + jersey;
  document.getElementById('eff-touch-val').style.color = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  document.getElementById('eff-touch-team').textContent = tName;
  setEffActionButtonsDisabled(false);
  renderCourts();
}

function clearEffTouch() {
  state.effTouchPlayer = null;
  state.effTouchTeam = null;
  document.getElementById('eff-touch-val').textContent = '—';
  document.getElementById('eff-touch-val').style.color = 'var(--text-primary)';
  document.getElementById('eff-touch-team').textContent = 'Tap a player on court';
  setEffActionButtonsDisabled(true);
  renderCourts();
}

function setEffActionButtonsDisabled(disabled) {
  document.querySelectorAll('.skill-result-btn').forEach(btn => { btn.disabled = disabled; });
}

const COURT_ACTIONS = {
  kill: { label: 'Kill', stat: 'kills', pointTo: 'selected' },
  ace: { label: 'Ace', stat: 'aces', pointTo: 'selected' },
  block: { label: 'Block', stat: 'blocks', pointTo: 'selected' },
  attackError: { label: 'Attack Error', stat: 'attackErrors', pointTo: 'opponent' },
  serveError: { label: 'Serve Error', stat: 'serveErrors', pointTo: 'opponent' },
  fault: { label: 'Fault', stat: 'faults', pointTo: 'opponent' }
};

function getOpponentTeam(team) {
  return team === 'A' ? 'B' : 'A';
}

function recordCourtAction(actionType) {
  if (!state.lastTouchPlayer || !state.lastTouchTeam) return;
  pushUndoSnapshot();
  const action = COURT_ACTIONS[actionType];
  if (!action) return;
  const playerTeam = state.lastTouchTeam;
  const pointTeam = action.pointTo === 'opponent' ? getOpponentTeam(playerTeam) : playerTeam;
  const player = normalizeJerseyValue(state.lastTouchPlayer);
  const scorerInfo = action.pointTo === 'selected' ? { team: playerTeam, jersey: player } : null;
  addPoint(pointTeam, {
    scorerInfo,
    statEvents: [{ team: playerTeam, jersey: player, stat: action.stat }],
    actionType,
    actionLabel: action.label,
    responsiblePlayer: { team: playerTeam, jersey: player }
  });
  clearTouch();
  updateCourtScores();
  renderPlayerStats();
}

function updateCourtScores() {
  document.getElementById('court-scoreA').textContent = state.scoreA;
  document.getElementById('court-scoreB').textContent = state.scoreB;
  document.getElementById('court-set').textContent = state.currentSet;
  document.getElementById('court-nameA').textContent = state.teamA.name;
  document.getElementById('court-nameB').textContent = state.teamB.name;
}

function renderPlayerStats() {
  const el = document.getElementById('player-stats');
  const entries = Object.entries(state.playerStats || {})
    .filter(([, stats]) => (stats.kills || 0) + (stats.aces || 0) + (stats.blocks || 0) + (stats.attackErrors || 0) + (stats.serveErrors || 0) + (stats.faults || 0) > 0)
    .sort((a,b) => {
      const aScore = (a[1].kills || 0) + (a[1].aces || 0) + (a[1].blocks || 0);
      const bScore = (b[1].kills || 0) + (b[1].aces || 0) + (b[1].blocks || 0);
      return bScore - aScore;
    });
  if (entries.length === 0) { el.innerHTML = '<div style="color:var(--text-muted)">No player stats yet</div>'; return; }
  el.innerHTML = entries.map(([key,stats]) => {
    const [team, j] = key.split(':');
    const color = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
      <span style="color:${color}">#${j} (${team==='A'?state.teamA.name:state.teamB.name})</span>
      <span style="font-weight:bold">K ${stats.kills || 0} | A ${stats.aces || 0} | B ${stats.blocks || 0}</span>
    </div>`;
  }).join('');
}

// ===================== SKILL EFFICIENCY =====================
const EFFICIENCY_SKILLS = {
  attack: {
    label: 'Attack',
    results: [
      { value: 'attempt', label: 'Attempt' },
      { value: 'kill', label: 'Kill' },
      { value: 'error', label: 'Attack Error' },
      { value: 'inPlay', label: 'In Play / Continued' }
    ]
  },
  serve: {
    label: 'Serve',
    results: [
      { value: 'attempt', label: 'Serve Attempt' },
      { value: 'ace', label: 'Ace' },
      { value: 'error', label: 'Serve Error' },
      { value: 'inPlay', label: 'In Play' }
    ]
  },
  reception: {
    label: 'Reception',
    results: [
      { value: 'attempt', label: 'Reception Attempt' },
      { value: 'positive', label: 'Positive Pass' },
      { value: 'poor', label: 'Poor Pass' },
      { value: 'error', label: 'Reception Error' }
    ]
  },
  set: {
    label: 'Set',
    results: [
      { value: 'attempt', label: 'Set Attempt' },
      { value: 'excellent', label: 'Excellent Set' },
      { value: 'fault', label: 'Faults' },
      { value: 'still', label: 'Still Sets' }
    ]
  },
  block: {
    label: 'Block',
    results: [
      { value: 'attempt', label: 'Block Attempt' },
      { value: 'blockTouch', label: 'Block Touch' },
      { value: 'killBlock', label: 'Kill Block' },
      { value: 'blockError', label: 'Block Error' }
    ]
  },
  dig: {
    label: 'Dig',
    results: [
      { value: 'digAttempt', label: 'Dig Attempt' },
      { value: 'perfectDig', label: 'Perfect Dig' },
      { value: 'playableDig', label: 'Playable Dig' },
      { value: 'errorDig', label: 'Error Dig' }
    ]
  }
};

function renderEfficiencyControls() {
  const modeGrid = document.getElementById('skill-mode-grid');
  const resultGrid = document.getElementById('skill-result-grid');
  if (!modeGrid || !resultGrid) return;
  modeGrid.innerHTML = Object.entries(EFFICIENCY_SKILLS).map(([key, skill]) =>
    `<button class="resource-btn skill-mode-btn${selectedEfficiencySkill === key ? ' active' : ''}" onclick="selectEfficiencySkill('${key}')">${skill.label}</button>`
  ).join('');

  const skill = EFFICIENCY_SKILLS[selectedEfficiencySkill];
  const disabledAttr = (state.effTouchPlayer) ? '' : ' disabled';

  resultGrid.innerHTML = skill.results.map(result =>
    `<button class="resource-btn btn-success skill-result-btn" onclick="recordSkillEfficiency('${result.value}')"${disabledAttr}>${result.label}</button>`
  ).join('');
}

function selectEfficiencySkill(skill) {
  selectedEfficiencySkill = skill;
  renderEfficiencyControls();
}

function recordSkillEfficiency(result) {
  if (!state.gameStarted) { showAlert('Start match first!', 'warn'); return; }
  pushUndoSnapshot();
  const team = state.effTouchTeam;
  const player = normalizeJerseyValue(state.effTouchPlayer);
  if (!player || !team) { showAlert('Select a player on the court first.', 'warn'); return; }
  const skill = EFFICIENCY_SKILLS[selectedEfficiencySkill];
  const resultMeta = skill.results.find(r => r.value === result);
  if (!resultMeta) return;

  state.skillEfficiencyLog.push({
    set: state.currentSet,
    team,
    jersey: player,
    skill: selectedEfficiencySkill,
    result,
    label: resultMeta.label,
    timestamp: new Date().toISOString()
  });

  renderEfficiencyTables();
  showAlert(skill.label + ': ' + resultMeta.label + ' recorded for #' + player, 'success');
  saveState();
}

function undoLastSkillEfficiency() {
  if (!state.skillEfficiencyLog || state.skillEfficiencyLog.length === 0) {
    showAlert('No skill entry to undo.', 'warn');
    return;
  }
  state.skillEfficiencyLog.pop();
  renderEfficiencyTables();
  showAlert('Last skill entry undone.', 'warn');
  saveState();
}

function emptyEfficiencyStats(skill) {
  const base = { attempts: 0 };
  if (skill === 'attack') return { ...base, kills: 0, errors: 0, inPlay: 0 };
  if (skill === 'serve') return { ...base, aces: 0, errors: 0, inPlay: 0 };
  if (skill === 'reception') return { ...base, positive: 0, poor: 0, errors: 0 };
  if (skill === 'block') return { ...base, blockTouch: 0, killBlock: 0, blockError: 0 };
  if (skill === 'dig') return { ...base, perfectDig: 0, playableDig: 0, errorDig: 0, digAttempt: 0 };
  return { ...base, excellent: 0, still: 0, faults: 0 };
}

function applyEfficiencyResult(stats, skill, result) {
  stats.attempts++;
  if (skill === 'attack') {
    if (result === 'kill') stats.kills++;
    if (result === 'error') stats.errors++;
    if (result === 'inPlay') stats.inPlay++;
  } else if (skill === 'serve') {
    if (result === 'ace') stats.aces++;
    if (result === 'error') stats.errors++;
    if (result === 'inPlay') stats.inPlay++;
  } else if (skill === 'reception') {
    if (result === 'positive') stats.positive++;
    if (result === 'poor') stats.poor++;
    if (result === 'error') stats.errors++;
  } else if (skill === 'set') {
    if (result === 'excellent') stats.excellent++;
    if (result === 'still') stats.still++;
    if (result === 'fault') stats.faults++;
  } else if (skill === 'block') {
    if (result === 'blockTouch') stats.blockTouch++;
    if (result === 'killBlock') stats.killBlock++;
    if (result === 'blockError') stats.blockError++;
  } else if (skill === 'dig') {
    if (result === 'perfectDig') stats.perfectDig++;
    if (result === 'playableDig') stats.playableDig++;
    if (result === 'errorDig') stats.errorDig++;
    if (result === 'digAttempt') stats.digAttempt++;
  }
}

function getEfficiencyRows(skill, scope = 'match') {
  const rows = {};
  (state.skillEfficiencyLog || []).forEach(entry => {
    if (entry.skill !== skill) return;
    if (scope === 'current' && entry.set !== state.currentSet) return;
    const key = entry.team + ':' + entry.jersey;
    if (!rows[key]) rows[key] = { team: entry.team, jersey: entry.jersey, stats: emptyEfficiencyStats(skill) };
    applyEfficiencyResult(rows[key].stats, skill, entry.result);
  });
  return Object.values(rows).sort((a, b) => b.stats.attempts - a.stats.attempts || a.jersey.localeCompare(b.jersey));
}

function formatPct(num, den) {
  if (!den) return '-';
  return ((num / den) * 100).toFixed(1) + '%';
}

function formatEff(num, den) {
  if (!den) return '-';
  return (num / den).toFixed(3);
}

function renderEfficiencyTable(skill, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const scope = 'match'; 
  const rows = getEfficiencyRows(skill, scope);
  if (rows.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px">No entries yet</div>';
    return;
  }

  if (skill === 'attack') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>K</th><th>Err</th><th>In</th><th>Succ%</th><th>Eff%</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.kills}</td><td>${r.stats.errors}</td><td>${r.stats.inPlay}</td><td>${formatPct(r.stats.inPlay + r.stats.kills, r.stats.attempts)}</td><td>${formatPct(r.stats.kills - r.stats.errors, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'serve') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Ace</th><th>Err</th><th>In</th><th>Succ%</th><th>Ace%</th><th>Eff%</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.aces}</td><td>${r.stats.errors}</td><td>${r.stats.inPlay}</td><td>${formatPct(r.stats.aces + r.stats.inPlay, r.stats.attempts)}</td><td>${formatPct(r.stats.aces, r.stats.attempts)}</td><td>${formatPct(r.stats.aces - r.stats.errors, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'reception') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Pos</th><th>Poor</th><th>Err</th><th>Eff%</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.positive}</td><td>${r.stats.poor}</td><td>${r.stats.errors}</td><td>${formatPct(r.stats.positive - r.stats.poor, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'block') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>BT</th><th>KB</th><th>Err</th><th>Kill Blks</th><th>Blk Eff%</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.blockTouch}</td><td>${r.stats.killBlock}</td><td>${r.stats.blockError}</td><td>${r.stats.killBlock}</td><td>${formatPct(r.stats.killBlock, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'dig') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>PD</th><th>PLD</th><th>Err</th><th>Digs</th><th>Dig Succ%</th><th>Dig Eff%</th></tr></thead><tbody>` +
      rows.map(r => {
        const digs = r.stats.perfectDig + r.stats.playableDig + r.stats.digAttempt;
        const totalAttempts = r.stats.attempts;
        const digSuccess = formatPct(r.stats.perfectDig + r.stats.playableDig + r.stats.digAttempt, totalAttempts);
        const digEff = formatPct((r.stats.perfectDig + r.stats.playableDig) - r.stats.errorDig, totalAttempts);
        return `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.perfectDig}</td><td>${r.stats.playableDig}</td><td>${r.stats.errorDig}</td><td>${digs}</td><td>${digSuccess}</td><td>${digEff}</td></tr>`;
      }).join('') +
      '</tbody></table>';
  } else {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Exc</th><th>Still</th><th>Fault</th><th>Succ%</th><th>Eff%</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.excellent}</td><td>${r.stats.still}</td><td>${r.stats.faults}</td><td>${formatPct(r.stats.excellent + r.stats.still, r.stats.attempts)}</td><td>${formatPct(r.stats.excellent - r.stats.faults, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  }
}

function renderSkillEfficiencyLog() {
  const el = document.getElementById('skill-efficiency-log');
  if (!el) return;
  const recent = [...(state.skillEfficiencyLog || [])].reverse().slice(0, 30);
  el.innerHTML = recent.map(entry => {
    const color = entry.team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    return `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="color:${color}">${getTeamState(entry.team).name} #${escHtml(entry.jersey)}</span>
      Set ${entry.set} | ${EFFICIENCY_SKILLS[entry.skill].label} - ${escHtml(entry.label)}
    </div>`;
  }).join('') || '<div style="color:var(--text-muted)">No skill entries recorded</div>';
}

function renderEfficiencyTables() {
  renderEfficiencyTable('attack', 'attack-efficiency-table');
  renderEfficiencyTable('serve', 'serve-efficiency-table');
  renderEfficiencyTable('reception', 'reception-efficiency-table');
  renderEfficiencyTable('set', 'set-efficiency-table');
  renderEfficiencyTable('block', 'block-efficiency-table');
  renderEfficiencyTable('dig', 'dig-efficiency-table');
  renderSkillEfficiencyLog();
}

function renderEfficiencyView() {
  renderEfficiencyControls();
  renderEfficiencyTables();
}

// ===================== RENDER =====================
function renderAll() {
  // Score
  document.getElementById('scoreA-big').textContent = state.scoreA;
  document.getElementById('scoreB-big').textContent = state.scoreB;
  document.getElementById('setsA').textContent = state.teamA.setsWon;
  document.getElementById('setsB').textContent = state.teamB.setsWon;
  document.getElementById('set-display').textContent = state.currentSet;
  document.getElementById('display-nameA').textContent = state.teamA.name;
  document.getElementById('display-nameB').textContent = state.teamB.name;
  document.getElementById('point-btn-A').textContent = '+ POINT — ' + state.teamA.name;
  document.getElementById('point-btn-B').textContent = '+ POINT — ' + state.teamB.name;

  // Serve indicator
  const servingTeam = state.serving === 'A' ? state.teamA : state.teamB;
  const serverJersey = servingTeam.rotation[0];
  document.getElementById('serve-indicator').textContent = '● Serving: ' + servingTeam.name + ' #' + serverJersey;
  document.getElementById('serve-indicator').style.color = state.serving === 'A' ? 'var(--team-a)' : 'var(--team-b)';

  // Rotations
  renderRotation('A');
  renderRotation('B');

  // Timeouts
  renderTimeouts('A');
  renderTimeouts('B');

  // Subs count
  document.getElementById('subsA-count').textContent = state.teamA.subsUsed;
  document.getElementById('subsB-count').textContent = state.teamB.subsUsed;

  // Sub logs
  renderSubLog('A');
  renderSubLog('B');

  // Point log
  renderPointLog();

  // Court
  renderCourts();
  updateCourtScores();
  renderPlayerStats();
  updateGameCourtSides();
  renderSanctions();
  renderEfficiencyView();
}

function renderRotation(team) {
  const el = document.getElementById('rot'+team);
  const t = getTeamState(team);
  const libero = t.libero;
  const gridLayout = getCourtLayoutForTeam(team).rotationGrid;
  el.innerHTML = '';

  const hdr1 = document.createElement('div');
  hdr1.style.cssText = 'font-size:8px;color:var(--text-muted);text-align:center;align-self:end;padding-bottom:2px;letter-spacing:1px;';
  hdr1.textContent = gridLayout.headers[0];
  el.appendChild(hdr1);
  const hdr2 = document.createElement('div');
  hdr2.style.cssText = 'font-size:8px;color:var(--text-muted);text-align:center;align-self:end;padding-bottom:2px;letter-spacing:1px;';
  hdr2.textContent = gridLayout.headers[1];
  el.appendChild(hdr2);

  gridLayout.order.forEach((posKey) => {
    const posIdx = getPositionIndex(posKey);
    const jersey = t.rotation[posIdx];
    const isLib = String(jersey) === String(libero) && libero > 0;
    const isServing = posIdx === 0 && state.serving === team;

    const isSelectable = liberoSelectionMode === team && (posIdx === 0 || posIdx === 4 || posIdx === 5);

    const div = document.createElement('div');
    div.className = 'pos-cell' + (isLib ? ' is-libero' : '') + (isServing ? ' serving' : '') + (isSelectable ? ' libero-selectable' : '');

    div.onclick = () => {
      if (liberoSelectionMode === team) executeLiberoSwap(team, posIdx);
    };

    div.innerHTML = `<span class="pos-num-label">${posIdx+1}</span><span class="pnum">#${jersey}</span>`;
    if (isServing) {
      const srv = document.createElement('span');
      srv.style.cssText = 'font-size:8px;color:var(--warn);position:absolute;bottom:2px;right:3px;';
      srv.textContent = '●';
      div.style.position = 'relative';
      div.appendChild(srv);
    }
    el.appendChild(div);
  });

  el.style.gridTemplateRows = 'auto repeat(3, 1fr)';
}

function renderTimeouts(team) {
  const t = team === 'A' ? state.teamA : state.teamB;
  const el = document.getElementById('to'+team+'-dots');
  el.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot ' + (i < t.timeouts ? 'available' : 'used-'+team.toLowerCase());
    el.appendChild(dot);
  }
}

function renderSubLog(team) {
  const t = team === 'A' ? state.teamA : state.teamB;
  const el = document.getElementById('sublog-'+team);
  if (t.subsLog.length === 0) { el.innerHTML = '<div style="font-size:10px;color:var(--text-muted)">No subs this set</div>'; return; }
  el.innerHTML = t.subsLog.map(s =>
    `<div class="sub-item">${s.score} | #${s.in} IN for #${s.out} (Pos ${s.pos}) <span class="${s.valid?'sub-valid':'sub-invalid'}">${s.valid?'✓ Valid':'✗ Invalid'}</span></div>`
  ).join('');
}

function renderPointLog() {
  const el = document.getElementById('score-log');
  const recent = [...state.pointLog].reverse().slice(0, 20);
  el.innerHTML = recent.map((p,i) =>
    `<div class="log-item">
      <span class="${p.team==='A'?'log-tag-a':'log-tag-b'}">${p.team==='A'?state.teamA.name:state.teamB.name}</span>
      <span>${p.scoreA} — ${p.scoreB}</span>
    </div>`
  ).join('') || '<div style="color:var(--text-muted);font-size:11px;padding:4px">No points yet</div>';
}

function getWinnerTeamCode() {
  if (state.teamA.setsWon >= state.setsToWin) return 'A';
  if (state.teamB.setsWon >= state.setsToWin) return 'B';
  return null;
}

function getTeamLeaderboard(team) {
  return Object.entries(state.playerPoints)
    .filter(([key]) => key.startsWith(team + ':'))
    .sort((a, b) => b[1] - a[1])
    .map(([key, points]) => {
      const jersey = key.split(':')[1];
      return { jersey, points };
    });
}

function renderLeaderboard(team, elementId) {
  const el = document.getElementById(elementId);
  const entries = getTeamLeaderboard(team).slice(0, 6);
  const teamName = getTeamState(team).name;
  const color = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  el.innerHTML = entries.map(({ jersey, points }) =>
    `<div class="stat-row"><span class="stat-label">${teamName} #${jersey}</span><span style="color:${color};font-weight:bold">${points} pts</span></div>`
  ).join('') || '<div style="color:var(--text-muted);font-size:11px">No stats yet</div>';
}

function getTeamSkillStats(team) {
  return Object.entries(state.playerStats || {})
    .filter(([key]) => key.startsWith(team + ':'))
    .map(([key, stats]) => {
      const kills = stats.kills || 0;
      const aces = stats.aces || 0;
      const blocks = stats.blocks || 0;
      const attackErrors = stats.attackErrors || 0;
      const serveErrors = stats.serveErrors || 0;
      const faults = stats.faults || 0;
      
      const totalErrors = attackErrors + serveErrors + faults;

      return {
        jersey: key.split(':')[1],
        kills,
        aces,
        blocks,
        attackErrors,
        serveErrors,
        faults,
        totalErrors
      };
    })
    .filter(row => row.kills + row.aces + row.blocks + row.totalErrors > 0)
    .sort((a, b) => (b.kills + b.aces + b.blocks) - (a.kills + a.aces + a.blocks));
}

function renderSkillStats(team, elementId) {
  const el = document.getElementById(elementId);
  const rows = getTeamSkillStats(team);
  const teamName = getTeamState(team).name;
  const color = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  el.innerHTML = rows.map(row =>
    `<div class="stat-row">
      <span class="stat-label" style="color:${color}">${teamName} #${row.jersey}</span>
      <span style="font-weight:bold">K ${row.kills} | Ace ${row.aces} | Blk ${row.blocks} | Err ${row.totalErrors}</span>
    </div>`
  ).join('') || '<div style="color:var(--text-muted);font-size:11px">No skill stats yet</div>';
}

function buildMatchSummary() {
  const winnerCode = getWinnerTeamCode();
  return {
    gameNumber: state.matchNumber,
    setsPlayed: state.setHistory.length,
    winner: winnerCode ? getTeamState(winnerCode).name : null,
    firstServer: getTeamState(state.firstServer).name,
    teams: {
      A: {
        name: state.teamA.name,
        setsWon: state.teamA.setsWon,
        totalPoints: state.teamA.totalPts,
        timeoutsUsed: state.teamA.toUsed,
        substitutionsUsed: state.teamA.totalSubs,
        leaderboard: getTeamLeaderboard('A'),
        skillStats: getTeamSkillStats('A')
      },
      B: {
        name: state.teamB.name,
        setsWon: state.teamB.setsWon,
        totalPoints: state.teamB.totalPts,
        timeoutsUsed: state.teamB.toUsed,
        substitutionsUsed: state.teamB.totalSubs,
        leaderboard: getTeamLeaderboard('B'),
        skillStats: getTeamSkillStats('B')
      }
    },
    setHistory: state.setHistory.map(s => ({
      set: s.set,
      teamA: s.a,
      teamB: s.b,
      winner: getTeamState(s.winner).name
    })),
    substitutionLog: state.allSubsLog,
    pointLog: state.pointLog,
    skillEfficiency: {
      attack: getEfficiencyRows('attack'),
      serve: getEfficiencyRows('serve'),
      reception: getEfficiencyRows('reception'),
      set: getEfficiencyRows('set'),
      block: getEfficiencyRows('block'),
      dig: getEfficiencyRows('dig')
    },
    skillEfficiencyLog: state.skillEfficiencyLog
  };
}

function exportMatchSummary() {
  const summary = buildMatchSummary();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `volleyref-match-${String(state.matchNumber).padStart(3, '0')}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ===================== SUMMARY =====================
function updateSummary() {
  document.getElementById('sum-setsA').textContent = state.teamA.setsWon;
  document.getElementById('sum-setsB').textContent = state.teamB.setsWon;
  document.getElementById('sum-ptsA').textContent = state.teamA.totalPts;
  document.getElementById('sum-ptsB').textContent = state.teamB.totalPts;
  document.getElementById('sum-toA').textContent = state.teamA.toUsed;
  document.getElementById('sum-toB').textContent = state.teamB.toUsed;
  document.getElementById('sum-subA').textContent = state.teamA.totalSubs;
  document.getElementById('sum-subB').textContent = state.teamB.totalSubs;
  document.getElementById('sum-game-number').textContent = state.matchNumber;
  document.getElementById('sum-sets-played').textContent = state.setHistory.length;
  document.getElementById('sum-first-server').textContent = getTeamState(state.firstServer).name;

  // Winner
  const wb = document.getElementById('winner-banner');
  const winnerCode = getWinnerTeamCode();
  if (winnerCode) {
    wb.style.display = 'block';
    const winner = getTeamState(winnerCode).name;
    document.getElementById('winner-name').textContent = winner;
    document.getElementById('sum-winner').textContent = winner;
  } else {
    wb.style.display = 'none';
    document.getElementById('sum-winner').textContent = '-';
  }

  // Set history
  const sh = document.getElementById('set-history-rows');
  sh.innerHTML = state.setHistory.map(s =>
    `<div class="set-history-row">
      <span style="color:var(--text-muted)">Set ${s.set}</span>
      <span style="color:${s.winner==='A'?'var(--team-a)':'var(--text-secondary)'}">${s.a}</span>
      <span style="color:${s.winner==='B'?'var(--team-b)':'var(--text-secondary)'}">${s.b}</span>
    </div>`
  ).join('') || '<div style="color:var(--text-muted);font-size:11px">No completed sets</div>';

  document.getElementById('leaderboard-title-a').textContent = state.teamA.name;
  document.getElementById('leaderboard-title-b').textContent = state.teamB.name;
  renderLeaderboard('A', 'top-scorers-a');
  renderLeaderboard('B', 'top-scorers-b');
  document.getElementById('skill-stats-title-a').textContent = state.teamA.name;
  document.getElementById('skill-stats-title-b').textContent = state.teamB.name;
  renderSkillStats('A', 'skill-stats-a');
  renderSkillStats('B', 'skill-stats-b');

  // Full sub log
  const fl = document.getElementById('full-sub-log');
  const allSubs = state.allSubsLog;
  fl.innerHTML = allSubs.map(s =>
    `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="color:${s.team==='A'?'var(--team-a)':'var(--team-b)'}">${s.tname}</span>
      Set ${s.set} | #${s.in} IN for #${s.out} @ ${s.score}
    </div>`
  ).join('') || '<div style="color:var(--text-muted)">No substitutions recorded</div>';
  
  // Renders the efficiency tables inside the Summary Tab
  renderEfficiencyTables();
}

// ===================== MODAL =====================
function showModal(title, body, actions) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  const acts = document.getElementById('modal-actions');
  acts.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'resource-btn ' + a.cls;
    btn.textContent = a.label;
    btn.onclick = a.fn;
    acts.appendChild(btn);
  });
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}
document.getElementById('modal-overlay').onclick = function(e) {
  if (e.target === this) closeModal();
};

document.addEventListener('click', function(e) {
  if (e.target.closest('.setup-player-picker')) return;
  document.querySelectorAll('.setup-player-picker.open').forEach(el => {
    el.classList.remove('open');
    el.closest('.setup-panel').classList.remove('has-open-picker');
  });
});

// ===================== ALERT =====================
let alertTimer;
function showAlert(msg, type='warn') {
  const el = document.getElementById('alert-bar');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.borderColor = type==='success'?'var(--success)':type==='danger'?'var(--danger)':'var(--warn)';
  el.style.color = type==='success'?'var(--success)':type==='danger'?'var(--danger)':'var(--warn)';
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ===================== NAVIGATION =====================
// ===================== RESET =====================
function generateFreshTeamState(existingTeamState) {
  return {
    name: existingTeamState.name,
    roster: existingTeamState.roster,
    fullSquad: existingTeamState.fullSquad || [...existingTeamState.roster],
    libero: existingTeamState.libero,
    rotation: [...existingTeamState.roster],
    timeouts: 2,
    subsUsed: 0,
    subsLog: [],
    totalPts: 0,
    setsWon: 0,
    toUsed: 0,
    totalSubs: 0,
    liberoStatus: { in: false, replaced: null }, 
    sanctions: []                                
  };
}

function resetAll() {
  showModal('Reset Match', 'This will clear all match data. Are you sure?',
    [{ label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
     { label: 'Reset', cls: 'btn-danger', fn: () => {
       pushUndoSnapshot();
       state = {
         teamA: generateFreshTeamState(state.teamA),
         teamB: generateFreshTeamState(state.teamB),
         scoreA: 0, scoreB: 0, currentSet: 1, matchNumber: getNextMatchNumber(), serving: state.firstServer,
         firstServer: state.firstServer,
         setHistory: [], allSubsLog: [], pointLog: [], skillEfficiencyLog: [], playerPoints: {}, playerStats: {},
         maxSubs: state.maxSubs, setsToWin: state.setsToWin, ptsPerSet: getPointsTargetForSet(1),
         gameStarted: true, matchEnded: false, summaryExported: false,
         currentSubTeam: null, lastTouchPlayer: null, lastTouchTeam: null,
         effTouchPlayer: null, effTouchTeam: null,
         courtSwapped: state.courtSwapped
       };
       subRegistry = { A: {}, B: {} };
       liberoSelectionMode = null;
       closeModal();
       renderAll();
       showAlert('Match reset!', 'warn');
       clearSavedState();
     }}
  ]);
}

function handleLiberoAction(team) {
  const t = getTeamState(team);
  if (!t.libero || t.libero == 0) {
    showAlert('No Libero assigned for ' + t.name, 'warn');
    return;
  }

  if (t.liberoStatus.in) {
    swapLiberoOut(team);
  } else {
    if (liberoSelectionMode === team) {
      liberoSelectionMode = null;
      renderAll();
    } else {
      liberoSelectionMode = team;
      renderAll();
      showAlert('Select a back-row player (Pos 1, 5, or 6) to replace.', 'success');
    }
  }
}

function executeLiberoSwap(team, posIdx) {
  pushUndoSnapshot();
  const t = getTeamState(team);
  if (posIdx !== 0 && posIdx !== 4 && posIdx !== 5) {
    showAlert('Libero can only replace back-row players!', 'danger');
    return;
  }

  const targetJersey = t.rotation[posIdx];
  t.liberoStatus = { in: true, replaced: targetJersey };
  t.rotation[posIdx] = String(t.libero);
  liberoSelectionMode = null;
  
  const actionEl = document.getElementById('last-action');
  if (actionEl) actionEl.textContent = `Libero IN for #${targetJersey}`;
  renderAll();
  saveState();
}

function swapLiberoOut(team) {
  pushUndoSnapshot();
  const t = getTeamState(team);
  const idx = t.rotation.findIndex(j => String(j) === String(t.libero));
  
  if (idx !== -1 && t.liberoStatus.replaced) {
     t.rotation[idx] = String(t.liberoStatus.replaced);
     const actionEl = document.getElementById('last-action');
     if (actionEl) actionEl.textContent = `Libero OUT, #${t.liberoStatus.replaced} IN`;
  }
  
  t.liberoStatus = { in: false, replaced: null };
  renderAll();
  saveState();
}

function addSanction(type) {
  pushUndoSnapshot();
  const tSelect = document.getElementById('sanction-team').value;
  const jInput = document.getElementById('sanction-jersey').value.trim();
  const t = getTeamState(tSelect);
  
  let target = jInput ? `#${jInput}` : 'Bench';
  const entry = { type, target, set: state.currentSet };
  t.sanctions.push(entry);
  
  document.getElementById('sanction-jersey').value = '';
  renderSanctions();
  showAlert(`${type} Warning/Penalty issued to ${t.name} ${target}`, type === 'Yellow' ? 'warn' : 'danger');
  saveState();
}

function renderSanctions() {
  const log = document.getElementById('sanction-log');
  if (!log || !state.teamA.sanctions) return;
  
  const all = [
    ...state.teamA.sanctions.map(s => ({...s, team: 'A'})),
    ...state.teamB.sanctions.map(s => ({...s, team: 'B'}))
  ];
  
  if (all.length === 0) {
    log.innerHTML = 'No active sanctions.';
    return;
  }
  
  log.innerHTML = all.map(s => {
    const color = s.type === 'Yellow' ? '#ffcc00' : (s.type === 'Red' ? 'var(--danger)' : 'var(--text-secondary)');
    const tName = s.team === 'A' ? state.teamA.name : state.teamB.name;
    return `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
      <strong style="color:${color}">${s.type}</strong> - ${tName} ${s.target} 
      <span style="color:var(--text-muted);font-size:9px">(Set ${s.set})</span>
    </div>`;
  }).join('');
}

// ===================== TOURNAMENT UI =====================
// (Defined BEFORE init — switchView is used during match restore)

var currentMenu = 'committee'; // 'admin' | 'committee'

// ── Side Panel Navigation ────────────────────────────────────
function toggleSidePanel() {
  var panel = document.getElementById('side-panel');
  var overlay = document.getElementById('side-panel-overlay');
  if (panel.classList.contains('side-panel-closed')) {
    panel.classList.remove('side-panel-closed');
    panel.classList.add('side-panel-open');
    overlay.classList.add('side-panel-overlay-visible');
  } else {
    closeSidePanel();
  }
}

function closeSidePanel() {
  var panel = document.getElementById('side-panel');
  var overlay = document.getElementById('side-panel-overlay');
  panel.classList.remove('side-panel-open');
  panel.classList.add('side-panel-closed');
  overlay.classList.remove('side-panel-overlay-visible');
}

function switchMenu(group) {
  currentMenu = group;
  var adminTabs = document.getElementById('admin-tabs');
  var committeeTabs = document.getElementById('committee-tabs');
  var adminNav = document.getElementById('side-nav-admin');
  var committeeNav = document.getElementById('side-nav-committee');

  if (group === 'admin') {
    adminTabs.classList.remove('tab-bar-hidden');
    committeeTabs.classList.add('tab-bar-hidden');
    if (adminNav) adminNav.classList.add('active');
    if (committeeNav) committeeNav.classList.remove('active');
  } else {
    adminTabs.classList.add('tab-bar-hidden');
    committeeTabs.classList.remove('tab-bar-hidden');
    if (adminNav) adminNav.classList.remove('active');
    if (committeeNav) committeeNav.classList.add('active');
  }
}

// Unified switchView — handles both admin and committee tabs
// Defined as var so it's hoisted and available during init
var switchView = function(name) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });

  var view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(function(t) {
    if (t.getAttribute('data-tab') === name) t.classList.add('active');
  });

  if (name === 'summary') updateSummary();
  if (name === 'court') { renderCourts(); updateCourtScores(); renderPlayerStats(); }
  if (name === 'efficiency') renderEfficiencyView();
  if (name === 'teams') { renderTeamsList(); if (editingTeamId) renderTeamEditor(editingTeamId); }
  if (name === 'config') tcRender();
  if (name === 'tteams') tteamsRender();
  if (name === 'schedule') schedRender();
  if (name === 'standings') standingsRender();
  if (name === 'tstats') tstatsRender();
};

// ===================== INIT =====================
initSetupUI();
const dbReady = db.init(); // Initialize IndexedDB

// Attempt to restore a saved match
if (loadState() && state.gameStarted && !state.matchEnded) {
  switchView('game');
  renderAll();
  try {
    var savedRaw = localStorage.getItem(SAVE_KEY);
    var savedTime = savedRaw ? JSON.parse(savedRaw).savedAt : null;
    var timeStr = savedTime ? ' (last saved: ' + new Date(savedTime).toLocaleTimeString() + ')' : '';
    showAlert('Match restored from auto-save' + timeStr, 'success');
  } catch(e) { /* ignore */ }
}

dbReady.then(async function() {
  if (!getActiveTournament()) {
    const localTournament = restoreTournamentLocal();
    if (localTournament && localTournament.id) {
      const storedTournament = await db.getTournament(localTournament.id);
      setActiveTournament(storedTournament || localTournament);
    }
  }
  if (!currentTournamentMatch) return;
  const tournament = await db.getTournament(currentTournamentMatch.tournamentId);
  if (!tournament) return;
  setActiveTournament(tournament);
  const match = (tournament.schedule || []).find(function(m) { return m.id === currentTournamentMatch.matchId; });
  if (!match) return;
  const banner = document.getElementById('tourney-banner');
  banner.classList.remove('tourney-banner-hidden');
  document.getElementById('tourney-banner-text').textContent = tournament.name + ' - Match ' + match.matchNumber + ': ' + (match.teamAName || 'TBD') + ' vs ' + (match.teamBName || 'TBD');
}).catch(function() { /* ignore restore failures */ });

['tc-name', 'tc-format', 'tc-semi-mode'].forEach(function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener(id === 'tc-name' ? 'input' : 'change', tcAutoSaveConfigChange);
});

// ── Tournament Config Tab ────────────────────────────────────
const TEAM_COLORS_CYCLE = ['#00c2fd','#00cfad','#00bb19','#e0a020','#e04040','#6ab0e0','#a0e040','#e040a0','#ff6b6b','#4ecdc4','#45b7d1','#f9ca24'];

function tcGetTeamColor(index) {
  return TEAM_COLORS_CYCLE[index % TEAM_COLORS_CYCLE.length];
}

async function tcAutoSaveConfigChange() {
  const t = getActiveTournament();
  if (!t) return;
  const nameEl = document.getElementById('tc-name');
  const formatEl = document.getElementById('tc-format');
  const semiEl = document.getElementById('tc-semi-mode');
  t.name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : t.name;
  t.format = formatEl ? formatEl.value : t.format;
  if (semiEl) {
    t.roundRobinSemiMode = semiEl.value || '1v4-2v3';
  }
  setActiveTournament(t);
  await autoSaveTournament();
  const statusEl = document.getElementById('tc-status');
  if (statusEl) statusEl.textContent = 'Status: ' + t.status + ' | Last saved: ' + new Date(t.lastSavedAt || Date.now()).toLocaleString();
}

function tcRender() {
  const t = getActiveTournament();
  if (!t) {
    document.getElementById('tc-status').textContent = 'No tournament loaded. Create a new one or load from file.';
    document.getElementById('tc-name').value = '';
    document.getElementById('tc-format').value = 'single-elimination';
    const semiEl = document.getElementById('tc-semi-mode');
    if (semiEl) semiEl.value = '1v4-2v3';
    tcRenderTeamsList();
    return;
  }

  document.getElementById('tc-name').value = t.name;
  document.getElementById('tc-format').value = t.format;
  const semiEl = document.getElementById('tc-semi-mode');
  if (semiEl) semiEl.value = t.roundRobinSemiMode || '1v4-2v3';
  document.getElementById('tc-status').textContent = 'Status: ' + t.status + ' | Last saved: ' + (t.lastSavedAt ? new Date(t.lastSavedAt).toLocaleString() : '—');
  tcRenderTeamsList();
}

function tcRenderTeamsList() {
  const t = getActiveTournament();
  const container = document.getElementById('tc-teams-list');
  const countEl = document.getElementById('tc-team-count');

  if (!t || !t.teams || t.teams.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No teams added yet. Use the form below to add teams.</div>';
    countEl.textContent = '(0 teams)';
    return;
  }

  countEl.textContent = '(' + t.teams.length + ' team' + (t.teams.length !== 1 ? 's' : '') + ')';
  container.innerHTML = t.teams.map(function(team, idx) {
    return '<div class="tc-team-row" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)">'
      + '<input type="color" value="' + team.color + '" style="width:28px;height:28px;flex-shrink:0;border:1px solid var(--border);background:var(--bg-dark);cursor:pointer;padding:2px 3px" onchange="tcUpdateTeamColor(\'' + team.id + '\',this.value)"/>'
      + '<span style="flex:1;font-weight:600;color:var(--text-primary)">' + escHtml(team.name) + '</span>'
      + '<span style="font-size:10px;color:var(--text-muted)">' + (team.players || []).length + ' players</span>'
      + '<button class="resource-btn btn-danger" style="padding:2px 8px;font-size:10px" onclick="tcRemoveTeam(\'' + team.id + '\')">✕</button>'
      + '</div>';
  }).join('');
}

async function tcAddTeam() {
  const nameInput = document.getElementById('tc-new-team-name');
  const colorInput = document.getElementById('tc-new-team-color');
  const name = nameInput.value.trim();
  if (!name) { showAlert('Enter a team name.', 'warn'); return; }

  let tournament = getActiveTournament();
  if (!tournament) {
    tournament = await createTournament({
      name: document.getElementById('tc-name').value || 'New Tournament',
      format: document.getElementById('tc-format').value,
    });
  }

  const color = colorInput.value;
  await addTeamToTournament(tournament.id, { name, color });

  nameInput.value = '';
  const currentIdx = TEAM_COLORS_CYCLE.indexOf(color);
  colorInput.value = tcGetTeamColor(currentIdx + 1);

  tcRender();
  showAlert('Team "' + name + '" added.', 'success');
}

async function tcRemoveTeam(teamId) {
  const t = getActiveTournament();
  if (!t) return;
  await removeTeamFromTournament(t.id, teamId);
  tcRender();
}

async function tcUpdateTeamColor(teamId, color) {
  const t = getActiveTournament();
  if (!t) return;
  await updateTeamInTournament(t.id, teamId, { color });
  tcRender();
}

async function tcSaveTournament() {
  const name = document.getElementById('tc-name').value.trim() || 'Tournament';
  const format = document.getElementById('tc-format').value;
  let tournament = getActiveTournament();
  if (!tournament) {
    tournament = await createTournament({ name, format });
  } else {
    tournament.name = name;
    tournament.format = format;
    await db.saveTournament(tournament);
    setActiveTournament(tournament);
  }

  tcRender();
  showAlert('Tournament saved.', 'success');
}

function tcExportTournament() {
  const t = getActiveTournament();
  if (!t) { showAlert('No tournament to export.', 'warn'); return; }
  exportTournamentToFile(t.id);
}

function tcImportTournament() {
  document.getElementById('tc-import-file').click();
}

async function tcImportTournamentFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const tournament = await loadTournamentFromFile(file);
    tcRender();
    showAlert('Tournament "' + tournament.name + '" loaded. Status: ' + tournament.status, 'success');
  } catch (e) {
    showAlert('Failed to load tournament: ' + e.message, 'danger');
  }
  event.target.value = '';
}

async function tcStartTournament() {
  let tournament = getActiveTournament();
  if (!tournament) { showAlert('Save the tournament first.', 'warn'); return; }
  if (tournament.teams.length < 2) { showAlert('Need at least 2 teams to start.', 'warn'); return; }

  showModal('Start Tournament', 'Generate schedule for "' + tournament.name + '" with ' + tournament.teams.length + ' teams (' + tournament.format + ')?',
    [
      { label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
      { label: 'Start', cls: 'btn-success', fn: async function() {
        closeModal();
        const tcSemiEl = document.getElementById('tc-semi-mode');
        tournament.roundRobinSemiMode = tcSemiEl ? tcSemiEl.value : (tournament.roundRobinSemiMode || '1v4-2v3');
        await db.saveTournament(tournament);
        const started = await startTournament(tournament.id);
        if (started) {
          tcRender();
          showAlert('Tournament started! ' + started.schedule.length + ' matches generated.', 'success');
          switchView('schedule');
        }
      }}
    ]
  );
}

async function tcResetTournament() {
  const t = getActiveTournament();
  const hasData = t && (t.teams.length > 0 || (t.schedule && t.schedule.length > 0));
  if (!hasData) { showAlert('No tournament data to reset.', 'warn'); return; }

  showModal('⚠ Reset Tournament',
    'This will permanently delete all tournament data for "' + (t ? t.name : 'this tournament') + '" including teams, schedule, match results, and standings stored in this browser. This cannot be undone.\n\nAre you sure?',
    [
      { label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
      { label: 'Reset Everything', cls: 'btn-danger', fn: async function() {
        closeModal();
        if (t) {
          await db.deleteTournament(t.id);
        }
        setActiveTournament(null);
        currentTournamentMatch = null;
        document.getElementById('tourney-banner').classList.add('tourney-banner-hidden');
        tcRender();
        switchMenu('committee');
        switchView('setup');
        showAlert('Tournament data cleared. You can now create a new one.', 'success');
      }}
    ]
  );
}

// ── Tournament Teams Tab ─────────────────────────────────────
let tteamsEditingTeamId = null;

function tteamsRender() {
  const t = getActiveTournament();
  const noTourney = document.getElementById('tteams-no-tourney');
  const content = document.getElementById('tteams-content');

  if (!t) { noTourney.style.display = 'block'; content.style.display = 'none'; return; }
  noTourney.style.display = 'none'; content.style.display = 'block';

  const listEl = document.getElementById('tteams-list-items');
  if (t.teams.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No teams in this tournament.</div>';
    return;
  }

  listEl.innerHTML = t.teams.map(function(team) {
    return '<div class="team-list-item' + (tteamsEditingTeamId === team.id ? ' active' : '') + '" onclick="tteamsOpenTeam(\'' + team.id + '\')">'
      + '<div class="team-color-dot" style="background:' + (team.color || '#888') + '"></div>'
      + '<div class="team-list-name">' + escHtml(team.name || 'Unnamed') + '</div>'
      + '<div class="team-list-count">' + (team.players || []).length + 'p</div>'
      + '</div>';
  }).join('');
}

function tteamsOpenTeam(teamId) {
  tteamsEditingTeamId = teamId;
  tteamsRender();
  tteamsRenderEditor(teamId);
}

function tteamsRenderEditor(teamId) {
  const panel = document.getElementById('tteams-editor-panel');
  const t = getActiveTournament();
  if (!t) return;
  const team = t.teams.find(function(tm) { return tm.id === teamId; });
  if (!team) { panel.innerHTML = '<div style="color:var(--text-muted);padding:24px 0;text-align:center">Team not found.</div>'; return; }

  const players = team.players || [];
  const rows = players.map(function(p, i) {
    return '<div class="player-roster-row">'
      + '<div class="row-num">' + (i + 1) + '</div>'
      + '<input class="jersey-input" type="number" min="0" max="999" value="' + p.jersey + '" placeholder=" " onchange="tteamsUpdatePlayer(\'' + teamId + '\',' + i + ',\'jersey\',this.value)" style="width:100%"/>'
      + '<input type="text" value="' + escHtml(p.name) + '" placeholder="Player name" onchange="tteamsUpdatePlayer(\'' + teamId + '\',' + i + ',\'name\',this.value)" style="width:100%"/>'
      + '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);white-space:nowrap"><input type="checkbox" ' + (p.libero ? 'checked' : '') + ' onchange="tteamsUpdatePlayer(\'' + teamId + '\',' + i + ',\'libero\',this.checked)"/> Lib</label>'
      + '<button class="remove-player-btn" onclick="tteamsRemovePlayer(\'' + teamId + '\',' + i + ')">✕</button>'
      + '</div>';
  }).join('');

  panel.innerHTML = '<div class="team-editor-header"><div style="font-family:var(--font-display);font-size:17px;color:' + (team.color || 'var(--court-line)') + '">' + escHtml(team.name || 'Unnamed') + '</div></div>'
    + '<div class="panel-title">Roster (' + players.length + ' players)</div>'
    + '<div style="display:grid;grid-template-columns:28px 80px 1fr 40px 28px;gap:6px;padding:4px 8px;margin-bottom:2px">'
    + '<div></div><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Jersey</div>'
    + '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Name</div>'
    + '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Lib</div><div></div></div>'
    + '<div class="player-roster-grid">' + rows + '</div>'
    + (players.length === 0 ? '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">No players yet.</div>' : '')
    + '<button class="resource-btn btn-success" style="margin-top:10px;width:100%;padding:8px" onclick="tteamsAddPlayer(\'' + teamId + '\')">+ Add Player</button>';
}

async function tteamsAddPlayer(teamId) {
  const t = getActiveTournament();
  if (!t) return;
  const team = t.teams.find(function(tm) { return tm.id === teamId; });
  if (!team) return;

  const existingJerseys = (team.players || []).map(function(p) { return parseInt(p.jersey) || 0; });
  let nextJersey = 1;
  while (existingJerseys.includes(nextJersey)) nextJersey++;

  await addPlayerToTeam(t.id, teamId, { jersey: nextJersey, name: '', libero: false });
  tteamsRender();
  tteamsRenderEditor(teamId);
}

async function tteamsUpdatePlayer(teamId, idx, field, value) {
  const t = getActiveTournament();
  if (!t) return;
  const team = t.teams.find(function(tm) { return tm.id === teamId; });
  if (!team || !team.players[idx]) return;

  if (field === 'jersey') team.players[idx].jersey = parseInt(value) || 0;
  else if (field === 'name') team.players[idx].name = value;
  else if (field === 'libero') team.players[idx].libero = value;

  await db.saveTournament(t);
  setActiveTournament(t);
}

async function tteamsRemovePlayer(teamId, idx) {
  const t = getActiveTournament();
  if (!t) return;
  const team = t.teams.find(function(tm) { return tm.id === teamId; });
  if (!team || !team.players[idx]) return;

  const jersey = team.players[idx].jersey;
  await removePlayerFromTeam(t.id, teamId, jersey);
  tteamsRender();
  tteamsRenderEditor(teamId);
}

// ── Schedule Tab ─────────────────────────────────────────────
let schedCardView = true;
let schedDraggedMatchId = null;

function schedRender() {
  const t = getActiveTournament();
  const noTourney = document.getElementById('sched-no-tourney');
  const content = document.getElementById('sched-content');

  if (!t) { noTourney.style.display = 'block'; content.style.display = 'none'; return; }
  if (!t.schedule || t.schedule.length === 0) { noTourney.style.display = 'block'; content.style.display = 'none'; return; }

  noTourney.style.display = 'none'; content.style.display = 'block';

  if (schedCardView) { schedRenderCards(t); } else { schedRenderBracket(t); schedDrawBracketConnectors(); }
}

function schedToggleView() {
  schedCardView = !schedCardView;
  document.getElementById('sched-toggle-btn').textContent = schedCardView ? '🔀 Bracket View' : '📋 Card View';
  schedRender();
}

function schedDragStart(event, matchId) {
  schedDraggedMatchId = matchId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', matchId);
  }
}

function schedDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

async function schedDrop(event, targetMatchId) {
  event.preventDefault();
  const sourceMatchId = schedDraggedMatchId || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
  schedDraggedMatchId = null;
  if (!sourceMatchId || sourceMatchId === targetMatchId) return;

  const t = getActiveTournament();
  if (!t || t.format !== 'round-robin') return;
  const source = t.schedule.find(function(m) { return m.id === sourceMatchId; });
  const target = t.schedule.find(function(m) { return m.id === targetMatchId; });
  if (!source || !target || source.status === 'completed' || target.status === 'completed') return;

  const sourcePosition = source.position;
  const sourceMatchNumber = source.matchNumber;
  source.position = target.position;
  source.matchNumber = target.matchNumber;
  target.position = sourcePosition;
  target.matchNumber = sourceMatchNumber;
  t.schedule.sort(function(a, b) { return a.position - b.position; });
  await db.saveTournament(t);
  await db.saveMatch(source);
  await db.saveMatch(target);
  setActiveTournament(t);
  schedRender();
}


function schedRenderCards(t) {
  const container = document.getElementById('sched-card-view');
  const bracketView = document.getElementById('sched-bracket-view');
  bracketView.style.display = 'none';
  container.style.display = 'block';

  if (t.format === 'double-elimination') {
    schedRenderDoubleElimCards(t, container);
    return;
  }
  if (t.format === 'round-robin') {
    schedRenderRoundRobinCards(t, container);
    return;
  }

  const rounds = {};
  for (const m of t.schedule) {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  }

  let html = '';
  const roundKeys = Object.keys(rounds).sort(function(a, b) { return a - b; });
  for (const round of roundKeys) {
    html += '<div style="font-family:var(--font-display);font-size:16px;color:var(--court-line);margin:16px 0 8px">Round ' + round + '</div>';
    html += '<div class="sched-card-grid">';
    for (const m of rounds[round]) {
      html += schedMatchCardHtml(t, m);
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function getFinalMatch(t) {
  if (!t || !t.schedule) return null;
  var maxRound = Math.max.apply(null, t.schedule.map(function(m) { return m.round; }));
  // Round Robin final
  var rrFinal = t.schedule.find(function(m) { return (m.stage || 'round-robin') === 'final'; });
  if (rrFinal) return rrFinal;
  // Double Elimination grand final
  var deFinal = t.schedule.find(function(m) { return m.bracket === 'final'; });
  if (deFinal) return deFinal;
  // Swiss playoff final (highest round playoff match)
  if (t.format === 'swiss') {
    var playoffMatches = t.schedule.filter(function(m) { return m.stage === 'playoffs'; });
    if (playoffMatches.length > 0) {
      var maxPlayoffRound = Math.max.apply(null, playoffMatches.map(function(m) { return m.round; }));
      return playoffMatches.find(function(m) { return m.round === maxPlayoffRound; });
    }
  }
  // Single Elimination final (highest round match)
  if (t.format === 'single-elimination') {
    return t.schedule.filter(function(m) { return m.round === maxRound; })[0] || null;
  }
  return null;
}

function isFinalMatch(t, m) {
  if (!t || !m || m.status === 'completed') return false;
  var final = getFinalMatch(t);
  return final && final.id === m.id;
}

async function schedSetFinalsSeries(matchId, gamesToWin) {
  var t = getActiveTournament();
  if (!t) return;
  var match = t.schedule.find(function(m) { return m.id === matchId; });
  if (!match) return;
  gamesToWin = parseInt(gamesToWin, 10);
  if (gamesToWin < 1 || gamesToWin > 3) return;

  var oldGamesToWin = match.finalsGamesToWin || 1;
  if (oldGamesToWin === gamesToWin) { schedRender(); return; }

  // Remove any previously generated finals game slots beyond game 1
  var toRemove = t.schedule.filter(function(m) { return m.finalsParentId === match.id; });
  toRemove.forEach(function(rm) { db.deleteMatch(rm.id); });
  t.schedule = t.schedule.filter(function(m) { return m.finalsParentId !== match.id; });

  // The base match becomes Game 1 of the series
  match.finalsGamesToWin = gamesToWin;
  match.finalsGameNumber = 1;
  delete match.finalsParentId;
  match.status = 'scheduled';
  match.winnerId = null;
  match.score = { setsA: 0, setsB: 0, setScores: [] };
  match.matchData = null;
  await db.saveMatch(match);

  if (gamesToWin > 1) {
    // Find the current highest round and matchNumber in the tournament
    var maxRound = Math.max.apply(null, t.schedule.map(function(m) { return m.round; }));
    var maxMatchNum = Math.max.apply(null, t.schedule.map(function(m) { return m.matchNumber; }));
    var finalRound = match.round;

    var maxGames = gamesToWin * 2 - 1;
    for (var g = 2; g <= maxGames; g++) {
      maxMatchNum++;
      var gameMatch = {
        id: generateId('match'),
        tournamentId: t.id,
        round: finalRound,
        position: maxMatchNum,
        matchNumber: maxMatchNum,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        teamAName: match.teamAName,
        teamBName: match.teamBName,
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        stage: match.stage,
        bracket: match.bracket,
        finalsParentId: match.id,
        finalsGameNumber: g,
        finalsGamesToWin: gamesToWin
      };
      t.schedule.push(gameMatch);
      await db.saveMatch(gameMatch);
    }
  }

  await db.saveTournament(t);
  setActiveTournament(t);
  schedRender();
}

function schedMatchCardHtml(t, m) {
  const statusClass = m.status === 'completed' ? 'sched-card-done' : m.status === 'in-progress' ? 'sched-card-live' : '';
  const canStart = m.status === 'scheduled' && m.teamAId && m.teamBId;
  const isDone = m.status === 'completed';
  const isLive = m.status === 'in-progress';
  const winnerA = isDone && m.winnerId === m.teamAId;
  const winnerB = isDone && m.winnerId === m.teamBId;
  const tbdA = !m.teamAId;
  const tbdB = !m.teamBId;
  const nameA = tbdA ? (m.teamAName && m.teamAName !== 'TBD' ? m.teamAName : 'TBD') : m.teamAName;
  const nameB = tbdB ? (m.teamBName && m.teamBName !== 'TBD' ? m.teamBName : 'TBD') : m.teamBName;
  const scoreDisplay = isDone ? '<span class="sched-card-score">' + m.score.setsA + ' - ' + m.score.setsB + '</span>' : '';
  const liveBadge = isLive ? '<span style="color:var(--active-color);font-size:9px;margin-left:4px">â— LIVE</span>' : '';
  const dragAttrs = t.format === 'round-robin' && (m.stage || 'round-robin') === 'round-robin' ? ' draggable="true" ondragstart="schedDragStart(event,\'' + m.id + '\')" ondragover="schedDragOver(event)" ondrop="schedDrop(event,\'' + m.id + '\')"' : '';

  // Finals series selector — only on the base final match (not generated game slots)
  const finalMatch = isFinalMatch(t, m) && !m.finalsParentId;
  var seriesSelectorHtml = '';
  if (finalMatch && m.status !== 'completed') {
    var currentGames = m.finalsGamesToWin || 1;
    var selHtml = '';
    [{ v: 1, l: 'Do or Die (1 Game)' }, { v: 2, l: 'Best of 3' }, { v: 3, l: 'Best of 5' }].forEach(function(o) {
      selHtml += '<option value="' + o.v + '"' + (currentGames === o.v ? ' selected' : '') + '>' + o.l + '</option>';
    });
    seriesSelectorHtml = '<div style="margin-top:6px;text-align:center;">'
      + '<label style="font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:3px">Finals Series</label>'
      + '<select onchange="schedSetFinalsSeries(\'' + m.id + '\',this.value)" style="width:100%;max-width:180px;background:var(--bg-dark);border:1px solid var(--border);color:var(--text-primary);padding:4px 6px;font-size:11px;cursor:pointer">'
      + selHtml
      + '</select></div>';
  }

  // Show game number label for finals series games
  var gameLabel = '';
  if (m.finalsParentId && m.finalsGameNumber) {
    gameLabel = '<div style="font-size:9px;color:var(--active-color);text-align:center;margin-top:2px">Game ' + m.finalsGameNumber + ' of ' + (m.finalsGamesToWin || 1) + '</div>';
  }

  return '<div class="sched-card ' + statusClass + '"' + dragAttrs + '>'
    + '<div class="sched-card-header"><span class="sched-card-num">Match ' + m.matchNumber + '</span><span class="sched-card-status">' + m.status + liveBadge + '</span></div>'
    + '<div class="sched-card-teams">'
    + '<div class="sched-card-team' + (winnerA ? ' sched-card-winner' : '') + (tbdA ? ' sched-card-tbd' : '') + '">' + escHtml(nameA) + (winnerA ? ' ' : '') + '</div>'
    + '<div class="sched-card-vs">vs</div>'
    + '<div class="sched-card-team' + (winnerB ? ' sched-card-winner' : '') + (tbdB ? ' sched-card-tbd' : '') + '">' + escHtml(nameB) + (winnerB ? ' ' : '') + '</div>'
    + '</div>'
    + scoreDisplay
    + gameLabel
    + seriesSelectorHtml
    + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
    + (canStart ? '<button class="resource-btn btn-success" style="flex:1" onclick="schedStartMatch(\'' + m.id + '\')">Start</button>' : '')
    + (isDone && m.matchData ? '<button class="resource-btn btn-neutral" style="flex:1" onclick="schedViewResult(\'' + m.id + '\')">Result</button>' : '')
    + (!isDone ? '<button class="resource-btn btn-neutral" style="padding:4px 8px;font-size:10px" onclick="schedEditMatch(\'' + m.id + '\')">Edit</button>' : '')
    + (m.status === 'scheduled' && !canStart ? '<div style="width:100%;text-align:center;font-size:10px;color:var(--text-muted);padding:4px 0">Waiting for teams</div>' : '')
    + '</div>'
    + '</div>';
}

function schedRenderDoubleElimCards(t, container) {
  let html = '';
  [
    { key: 'winners', label: 'Upper Bracket' },
    { key: 'losers', label: 'Lower Bracket' },
    { key: 'final', label: 'Grand Final' }
  ].forEach(function(section) {
    const matches = t.schedule.filter(function(m) {
      if (section.key === 'winners') return m.bracket === 'winners' || !m.bracket;
      return m.bracket === section.key;
    }).sort(function(a, b) { return a.round === b.round ? a.position - b.position : a.round - b.round; });
    if (matches.length === 0) return;
    html += '<div style="margin:18px 0 8px;padding-top:10px;border-top:1px solid var(--border)">'
      + '<div style="font-family:var(--font-display);font-size:18px;color:var(--court-line);margin-bottom:10px">' + section.label + '</div>';
    const rounds = {};
    matches.forEach(function(m) { if (!rounds[m.round]) rounds[m.round] = []; rounds[m.round].push(m); });
    Object.keys(rounds).sort(function(a, b) { return a - b; }).forEach(function(round) {
      html += '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:12px 0 8px">Round ' + round + '</div>';
      html += '<div class="sched-card-grid">';
      rounds[round].forEach(function(m) { html += schedMatchCardHtml(t, m); });
      html += '</div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

function schedRenderRoundRobinCards(t, container) {
  const sections = [
    { stage: 'round-robin', label: 'Round Robin' },
    { stage: 'semifinal', label: 'Semi-Finals' },
    { stage: 'final', label: 'Final' }
  ];
  let html = '';
  sections.forEach(function(section) {
    const matches = t.schedule.filter(function(m) { return (m.stage || 'round-robin') === section.stage; }).sort(function(a, b) { return a.position - b.position; });
    if (matches.length === 0) return;
    html += '<div style="margin:18px 0 8px;padding-top:10px;border-top:1px solid var(--border)">'
      + '<div style="font-family:var(--font-display);font-size:18px;color:var(--court-line);margin-bottom:10px">' + section.label + '</div>'
      + '<div class="sched-card-grid">';
    matches.forEach(function(m) { html += schedMatchCardHtml(t, m); });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function schedBracketMatchHtml(t, m, left, top, width, height) {
  const done = m.status === 'completed';
  const live = m.status === 'in-progress';
  const canStart = m.status === 'scheduled' && m.teamAId && m.teamBId;
  const winnerA = done && m.winnerId === m.teamAId;
  const winnerB = done && m.winnerId === m.teamBId;
  const tbdA = !m.teamAId;
  const tbdB = !m.teamBId;
  const nameA = tbdA ? (m.teamAName && m.teamAName !== 'TBD' ? m.teamAName : 'TBD') : m.teamAName;
  const nameB = tbdB ? (m.teamBName && m.teamBName !== 'TBD' ? m.teamBName : 'TBD') : m.teamBName;
  var headerLabel = 'Match ' + m.matchNumber;
  if (m.finalsGameNumber && m.finalsGamesToWin && m.finalsGamesToWin > 1) {
    headerLabel = 'G' + m.finalsGameNumber + '/' + m.finalsGamesToWin + ' (M' + m.matchNumber + ')';
  }
  let html = '<div class="sched-bracket-match ' + (done ? 'sched-bracket-done' : '') + (live ? ' sched-bracket-live' : '') + '" style="width:' + width + 'px;min-height:' + height + 'px" data-match-id="' + m.id + '">';
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">' + headerLabel + '</div>';
  html += '<div class="sched-bracket-team' + (winnerA ? ' sched-bracket-winner' : '') + (tbdA ? ' sched-bracket-tbd' : '') + '">' + escHtml(nameA) + (winnerA ? ' ' : '') + '</div>';
  html += '<div class="sched-bracket-team' + (winnerB ? ' sched-bracket-winner' : '') + (tbdB ? ' sched-bracket-tbd' : '') + '">' + escHtml(nameB) + (winnerB ? ' ' : '') + '</div>';
  if (done) html += '<div class="sched-bracket-score">' + m.score.setsA + '-' + m.score.setsB + '</div>';
  if (m.finalsGameNumber && m.finalsGamesToWin && m.finalsGamesToWin > 1) {
    html += '<div style="font-size:8px;color:var(--active-color);text-align:center;margin-top:2px">Game ' + m.finalsGameNumber + ' of ' + m.finalsGamesToWin + '</div>';
  }
  html += '<div style="display:flex;gap:4px;margin-top:4px">';
  if (canStart) html += '<button class="resource-btn btn-success" style="flex:1;padding:3px;font-size:9px" onclick="schedStartMatch(\'' + m.id + '\')">Start</button>';
  if (done && m.matchData) html += '<button class="resource-btn btn-neutral" style="flex:1;padding:3px;font-size:9px" onclick="schedViewResult(\'' + m.id + '\')">Result</button>';
  if (!done) html += '<button class="resource-btn btn-neutral" style="padding:3px 6px;font-size:9px" onclick="schedEditMatch(\'' + m.id + '\')">Edit</button>';
  html += '</div></div>';
  return html;
}

function schedBracketSectionHtml(t, title, matches, options) {
  if (!matches || matches.length === 0) return '';
  const cardW = 180;
  const cardH = 86;
  const colGap = 55;
  const rowGap = 16;
  const padX = 18;
  const padY = 10;
  const rounds = {};
  matches.forEach(function(m) {
    const key = m.stage === 'final' ? 'Final' : String(m.round);
    if (!rounds[key]) rounds[key] = [];
    rounds[key].push(m);
  });
  const roundKeys = Object.keys(rounds).sort(function(a, b) {
    if (a === 'Final') return 1;
    if (b === 'Final') return -1;
    return parseInt(a) - parseInt(b);
  });
  roundKeys.forEach(function(r) { rounds[r].sort(function(a, b) { return a.position - b.position; }); });

  // Build flexbox layout: each round is a column, whole thing is a row
  var roundHtml = [];
  var roundData = [];
  roundKeys.forEach(function(r, ri) {
    var list = rounds[r];
    var label = r === 'Final' ? 'Final' : (options && options.roundPrefix ? options.roundPrefix : 'Round ') + r;
    var cardsHtml = list.map(function(m) {
      return schedBracketMatchHtml(t, m, 0, 0, cardW, cardH);
    }).join('');
    roundHtml.push('<div class="sched-bracket-round-col" data-round-idx="' + ri + '">'
      + '<div class="sched-bracket-round-label" style="width:' + cardW + 'px;margin:0 auto 8px">' + label + '</div>'
      + '<div class="sched-bracket-round-cards" style="display:flex;flex-direction:column;gap:' + rowGap + 'px;align-items:stretch;width:' + cardW + 'px;justify-content:center;min-height:' + cardH + 'px">'
      + cardsHtml
      + '</div></div>');
    roundData.push({ key: r, list: list });
  });

  // Pairing connector data for post-render SVG drawing
  var connectorPairs = [];
  for (var ri = 0; ri < roundData.length - 1; ri++) {
    var current = roundData[ri].list;
    for (var mi = 0; mi < current.length; mi++) {
      var next = roundData[ri + 1].list;
      var targetIdx = Math.min(Math.floor(mi / 2), next.length - 1);
      connectorPairs.push({ fromRi: ri, fromMi: mi, toRi: ri + 1, toMi: targetIdx });
    }
  }
  var connectorJson = JSON.stringify(connectorPairs).replace(/"/g, '&quot;');

  return '<div style="margin:18px 0 26px">'
    + '<div style="font-family:var(--font-display);font-size:18px;color:var(--court-line);margin-bottom:10px">' + title + '</div>'
    + '<div class="sched-bracket-flex" data-connectors="' + connectorJson + '" style="display:flex;flex-direction:row;align-items:stretch;gap:' + colGap + 'px;padding:' + padY + 'px ' + padX + 'px;overflow-x:auto;position:relative">'
    + roundHtml.join('')
    + '</div></div>';
}

function schedDrawBracketConnectors() {
  document.querySelectorAll('.sched-bracket-flex').forEach(function(bracket) {
    var oldSvg = bracket.querySelector('svg.bracket-connectors');
    if (oldSvg) oldSvg.remove();

    var pairs;
    try { pairs = JSON.parse(bracket.getAttribute('data-connectors') || '[]'); } catch(e) { return; }
    if (!pairs.length) return;

    var bracketRect = bracket.getBoundingClientRect();

    var cardMap = {};
    bracket.querySelectorAll('.sched-bracket-round-col').forEach(function(col) {
      var ri = parseInt(col.getAttribute('data-round-idx'), 10);
      if (isNaN(ri)) return;
      col.querySelectorAll('.sched-bracket-match').forEach(function(cardEl, mi) {
        cardMap[ri + ':' + mi] = cardEl;
      });
    });

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bracket-connectors');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible';

    pairs.forEach(function(pair) {
      var fromEl = cardMap[pair.fromRi + ':' + pair.fromMi];
      var toEl = cardMap[pair.toRi + ':' + pair.toMi];
      if (!fromEl || !toEl) return;
      var r1 = fromEl.getBoundingClientRect();
      var r2 = toEl.getBoundingClientRect();
      var x1 = r1.right - bracketRect.left;
      var x2 = r2.left - bracketRect.left;
      var y1 = r1.top + r1.height / 2 - bracketRect.top;
      var y2 = r2.top + r2.height / 2 - bracketRect.top;
      var mid = x1 + (x2 - x1) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' L ' + mid + ' ' + y1 + ' L ' + mid + ' ' + y2 + ' L ' + x2 + ' ' + y2);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(255,255,255,0.22)');
      path.setAttribute('stroke-width', '1.5');
      svg.appendChild(path);
    });

    bracket.insertBefore(svg, bracket.firstChild);
  });
}

function schedRenderDoubleElimBracket(t, container) {
  const upper = t.schedule.filter(function(m) { return m.bracket === 'winners' || !m.bracket; });
  const lower = t.schedule.filter(function(m) { return m.bracket === 'losers'; });
  const finalMatches = t.schedule.filter(function(m) { return m.bracket === 'final'; });
  container.innerHTML =
    schedBracketSectionHtml(t, 'Upper Bracket', upper, { roundPrefix: 'UB Round ' })
    + schedBracketSectionHtml(t, 'Lower Bracket', lower, { roundPrefix: 'LB Round ' })
    + schedBracketSectionHtml(t, 'Grand Final', finalMatches, { roundPrefix: '' });
}

function schedRenderRoundRobinBracket(t, container) {
  const pool = t.schedule.filter(function(m) { return (m.stage || 'round-robin') === 'round-robin'; });
  const semis = t.schedule.filter(function(m) { return m.stage === 'semifinal'; });
  const finals = t.schedule.filter(function(m) { return m.stage === 'final'; });
  container.innerHTML =
    schedBracketSectionHtml(t, 'Round Robin', pool, { roundPrefix: 'Pool ' })
    + schedBracketSectionHtml(t, 'Semi-Finals', semis, { roundPrefix: 'Semi ' })
    + schedBracketSectionHtml(t, 'Final', finals, { roundPrefix: '' });
}

function schedRenderBracket(t) {
  const container = document.getElementById('sched-bracket-view');
  const cardView = document.getElementById('sched-card-view');
  cardView.style.display = 'none';
  container.style.display = 'block';

  if (t.format === 'double-elimination') {
    schedRenderDoubleElimBracket(t, container);
    return;
  }
  if (t.format === 'round-robin') {
    schedRenderRoundRobinBracket(t, container);
    return;
  }

  // Single Elimination & Swiss: filter main bracket matches
  const mainMatches = t.schedule.filter(function(m) {
    return m.bracket !== 'losers' && m.bracket !== 'final' && m.bracket !== 'final-reset';
  });

  if (mainMatches.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center">No bracket matches generated yet.</div>';
    return;
  }

  const isSwiss = t.format === 'swiss';
  var title = isSwiss ? 'Swiss System' : 'Single Elimination';

  var html = schedBracketSectionHtml(t, title, mainMatches);

  if (isSwiss) {
    const playoffMatches = t.schedule.filter(function(m) { return m.stage === 'playoffs'; });
    if (playoffMatches.length > 0) {
      html += schedBracketSectionHtml(t, 'Playoffs', playoffMatches, { roundPrefix: '' });
    }
  }

  container.innerHTML = html;
}

function schedGenerate() {
  const t = getActiveTournament();
  if (!t) { showAlert('No tournament loaded.', 'warn'); return; }
  if (t.status !== 'setup') { showAlert('Tournament already started.', 'warn'); return; }
  if (t.teams.length < 2) { showAlert('Need at least 2 teams.', 'warn'); return; }

  showModal('Generate Schedule', 'Generate ' + t.format + ' schedule for ' + t.teams.length + ' teams?',
    [
      { label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
      { label: 'Generate', cls: 'btn-success', fn: async function() {
        closeModal();
        if (t.format === 'round-robin' || t.format === 'swiss' || t.format === 'single-elimination' || t.format === 'double-elimination') {
          const semiModeEl = document.getElementById('tc-semi-mode');
          t.roundRobinSemiMode = semiModeEl ? semiModeEl.value : (t.roundRobinSemiMode || '1v4-2v3');
          await db.saveTournament(t);
        }
        const started = await startTournament(t.id);
        if (started) { showAlert('Schedule generated! ' + started.schedule.length + ' matches.', 'success'); schedRender(); }
      }}
    ]
  );
}

function schedStartMatch(matchId) {
  showModal('Start Match', 'Switch to Technical Committee menu and populate Setup tab?',
    [
      { label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
      { label: 'Start', cls: 'btn-success', fn: function() { closeModal(); _startTournamentMatch(matchId); }}
    ]
  );
}

function schedEditMatch(matchId) {
  const t = getActiveTournament();
  if (!t) return;
  const match = t.schedule.find(function(m) { return m.id === matchId; });
  if (!match) return;

  if (match.status === 'completed') {
    showAlert('Cannot edit a completed match. The result is already recorded.', 'warn');
    return;
  }

  var teamOptions = '<option value="">-- Select Team --</option>';
  t.teams.forEach(function(team) {
    teamOptions += '<option value="' + team.id + '">' + escHtml(team.name) + '</option>';
  });

  function selHtml(id, currentId) {
    return '<select id="' + id + '" style="width:100%;background:var(--bg-dark);border:1px solid var(--border);color:var(--text-primary);padding:8px;font-size:13px">'
      + teamOptions.replace('value="' + currentId + '"', 'value="' + currentId + '" selected') + '</select>';
  }

  var body = '<div style="display:flex;flex-direction:column;gap:12px">';
  body += '<div><label style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:4px">Team A</label>';
  body += selHtml('edit-teamA', match.teamAId || '') + '</div>';
  body += '<div><label style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:4px">Team B</label>';
  body += selHtml('edit-teamB', match.teamBId || '') + '</div>';
  body += '<div><label style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:4px">Status</label>';
  body += '<select id="edit-status" style="width:100%;background:var(--bg-dark);border:1px solid var(--border);color:var(--text-primary);padding:8px;font-size:13px">';
  body += '<option value="scheduled"' + (match.status === 'scheduled' ? ' selected' : '') + '>Scheduled</option>';
  body += '<option value="in-progress"' + (match.status === 'in-progress' ? ' selected' : '') + '>In Progress</option>';
  body += '</select></div>';
  body += '</div>';

  showModal('Edit Match ' + match.matchNumber, body, [
    { label: 'Cancel', cls: 'btn-neutral', fn: closeModal },
    { label: 'Save', cls: 'btn-success', fn: async function() {
      closeModal();
      var teamAId = document.getElementById('edit-teamA').value;
      var teamBId = document.getElementById('edit-teamB').value;
      var newStatus = document.getElementById('edit-status').value;

      var teamA = t.teams.find(function(tm) { return tm.id === teamAId; });
      var teamB = t.teams.find(function(tm) { return tm.id === teamBId; });

      var oldWinnerId = match.winnerId;
      var oldTeamAId = match.teamAId;
      var oldTeamBId = match.teamBId;

      match.teamAId = teamAId || null;
      match.teamBId = teamBId || null;
      match.teamAName = teamA ? teamA.name : 'TBD';
      match.teamBName = teamB ? teamB.name : 'TBD';
      match.status = newStatus;

      // Sync bracket: if teams changed and this match feeds into other matches, update downstream references
      if ((oldTeamAId !== match.teamAId || oldTeamBId !== match.teamBId) && t.schedule) {
        t.schedule.forEach(function(other) {
          if (other.id === match.id) return;
          if (other.sourceMatchA === match.matchNumber || other.winSourceMatchA === match.matchNumber || other.lossSourceMatchA === match.matchNumber) {
            if (other.teamAId === oldTeamAId || other.teamAId === oldTeamBId) {
              other.teamAId = match.teamAId;
              other.teamAName = match.teamAName;
            }
            if (other.teamBId === oldTeamAId || other.teamBId === oldTeamBId) {
              other.teamBId = match.teamAId;
              other.teamBName = match.teamAName;
            }
          }
          if (other.sourceMatchB === match.matchNumber || other.winSourceMatchB === match.matchNumber || other.lossSourceMatchB === match.matchNumber) {
            if (other.teamAId === oldTeamAId || other.teamAId === oldTeamBId) {
              other.teamAId = match.teamBId;
              other.teamAName = match.teamBName;
            }
            if (other.teamBId === oldTeamAId || other.teamBId === oldTeamBId) {
              other.teamBId = match.teamBId;
              other.teamBName = match.teamBName;
            }
          }
          // If this match was previously completed and had a winner that advanced, clear the advanced winner if teams changed
          if (other.teamAId === oldWinnerId && (oldTeamAId !== match.teamAId || oldTeamBId !== match.teamBId)) {
            if (other.sourceMatchA === match.matchNumber || other.winSourceMatchA === match.matchNumber) {
              other.teamAId = match.winnerId || match.teamAId;
              other.teamAName = match.winnerId ? (match.teamAId === match.winnerId ? match.teamAName : match.teamBName) : match.teamAName;
            }
          }
          if (other.teamBId === oldWinnerId && (oldTeamAId !== match.teamAId || oldTeamBId !== match.teamBId)) {
            if (other.sourceMatchB === match.matchNumber || other.winSourceMatchB === match.matchNumber) {
              other.teamBId = match.winnerId || match.teamBId;
              other.teamBName = match.winnerId ? (match.teamBId === match.winnerId ? match.teamBName : match.teamAName) : match.teamBName;
            }
          }
        });
      }

      await db.saveTournament(t);
      await db.saveMatch(match);
      setActiveTournament(t);
      schedRender();
      showAlert('Match ' + match.matchNumber + ' updated.', 'success');
    }}
  ]);
}

function schedViewResult(matchId) {
  const t = getActiveTournament();
  if (!t) return;
  const match = t.schedule.find(function(m) { return m.id === matchId; });
  if (!match || !match.matchData) { showAlert('No result data for this match.', 'warn'); return; }

  const d = match.matchData;
  const winnerName = d.winner || '—';
  const setsA = d.teams.A.setsWon;
  const setsB = d.teams.B.setsWon;
  const setScore = setsA + '-' + setsB;
  const isAWinner = escHtml(d.teams.A.name) === escHtml(winnerName);
  const winTeamCode = isAWinner ? 'A' : 'B';
  const loseTeamCode = isAWinner ? 'B' : 'A';
  const winTeam = d.teams[winTeamCode];
  const loseTeam = d.teams[loseTeamCode];

  // ── Build skill lookup for best performer tiebreaker ──
  function skillLookup(teamCode) {
    var map = {};
    var arr = d.teams[teamCode].skillStats || [];
    arr.forEach(function(s) { map[s.jersey] = s; });
    return map;
  }
  var winSkill = skillLookup(winTeamCode);

  // ── Best performer: highest points, tiebreak: blocks → aces → kills → fewest errors ──
  var bestPerf = null;
  var winLeaderboard = winTeam.leaderboard || [];
  if (winLeaderboard.length > 0) {
    var topPts = winLeaderboard[0].points;
    var tied = winLeaderboard.filter(function(e) { return e.points === topPts; });
    tied.sort(function(a, b) {
      var sa = winSkill[a.jersey] || {};
      var sb = winSkill[b.jersey] || {};
      var blocksDiff = (sb.blocks || 0) - (sa.blocks || 0);
      if (blocksDiff !== 0) return blocksDiff;
      var acesDiff = (sb.aces || 0) - (sa.aces || 0);
      if (acesDiff !== 0) return acesDiff;
      var killsDiff = (sb.kills || 0) - (sa.kills || 0);
      if (killsDiff !== 0) return killsDiff;
      var errA = (sa.attackErrors || 0) + (sa.serveErrors || 0) + (sa.faults || 0);
      var errB = (sb.attackErrors || 0) + (sb.serveErrors || 0) + (sb.faults || 0);
      return errA - errB;
    });
    bestPerf = tied[0];
    bestPerf._skill = winSkill[bestPerf.jersey] || {};
  }

  // ── Skill efficiency helpers ──
  function effStats(teamCode, jersey) {
    var totals = { attempts: 0, kills: 0, errors: 0 };
    var skills = d.skillEfficiency || {};
    ['attack','serve','block','dig','reception','set'].forEach(function(sk) {
      var rows = skills[sk] || [];
      rows.forEach(function(r) {
        if (r.team === teamCode && String(r.jersey) === String(jersey)) {
          var s = r.stats || {};
          totals.attempts += s.attempts || 0;
          if (sk === 'attack') totals.kills += s.kills || 0;
          if (sk === 'block') totals.kills += s.kills || 0;
          if (sk === 'serve') totals.kills += s.aces || 0;
          totals.errors += s.errors || 0;
        }
      });
    });
    return totals;
  }

  var body = '';

  // ── Winner banner ──
  body += '<div style="text-align:center;padding:16px;background:linear-gradient(135deg,rgba(46,204,113,0.12),rgba(46,204,113,0.04));border:1px solid rgba(46,204,113,0.3);margin-bottom:16px">';
  body += '<div style="font-size:10px;color:var(--success);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Winner</div>';
  body += '<div style="font-family:var(--font-display);font-size:24px;color:var(--success)">' + escHtml(winnerName) + '</div>';
  body += '<div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-top:4px">' + setScore + '</div>';
  body += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">';
  if (d.setHistory) {
    body += d.setHistory.map(function(s) { return 'Set ' + s.set + ': ' + s.teamA + '-' + s.teamB; }).join(' &middot; ');
  }
  body += '</div></div>';

  // ── Set history detail ──
  if (d.setHistory && d.setHistory.length > 0) {
    body += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
    d.setHistory.forEach(function(s) {
      var setWinnerColor = escHtml(s.winner) === escHtml(d.teams.A.name) ? 'var(--team-a)' : 'var(--team-b)';
      body += '<div style="flex:1;min-width:100px;text-align:center;padding:8px;background:var(--bg-card);border:1px solid var(--border)">';
      body += '<div style="font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase">Set ' + s.set + '</div>';
      body += '<div style="font-size:16px;font-weight:700;color:var(--text-primary)">' + s.teamA + '<span style="color:var(--text-muted)"> - </span>' + s.teamB + '</div>';
      body += '<div style="font-size:10px;color:' + setWinnerColor + ';font-weight:600">' + escHtml(s.winner) + '</div>';
      body += '</div>';
    });
    body += '</div>';
  }

  // ── Team comparison ──
  body += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  [{code:'A',team:d.teams.A,isWin:isAWinner},{code:'B',team:d.teams.B,isWin:!isAWinner}].forEach(function(item) {
    var hc = item.code === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    var badge = item.isWin ? ' <span style="font-size:9px;background:rgba(46,204,113,0.15);color:var(--success);padding:1px 6px;border-radius:3px;letter:1px">WIN</span>' : '';
    body += '<div style="padding:12px;background:var(--bg-card);border:1px solid var(' + (item.isWin ? 'rgba(46,204,113,0.3)' : '--border') + ')">';
    body += '<div style="font-weight:700;color:' + hc + ';margin-bottom:6px;font-size:14px">' + escHtml(item.team.name) + badge + '</div>';
    body += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px">';
    body += '<div><span style="color:var(--text-muted)">Sets:</span> <b>' + item.team.setsWon + '</b></div>';
    body += '<div><span style="color:var(--text-muted)">Points:</span> <b>' + item.team.totalPoints + '</b></div>';
    body += '<div><span style="color:var(--text-muted)">Timeouts:</span> ' + item.team.timeoutsUsed + '</div>';
    body += '<div><span style="color:var(--text-muted)">Subs:</span> ' + item.team.substitutionsUsed + '</div>';
    body += '</div>';
    // Top 3 players
    var lb = (item.team.leaderboard || []).slice(0, 3);
    if (lb.length > 0) {
      body += '<div style="margin-top:8px;font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Top Players</div>';
      lb.forEach(function(p, idx) {
        var medals = ['🥇','🥈','🥉'];
        body += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">';
        body += '<span>' + (medals[idx] || '&bull;') + ' #' + escHtml(p.jersey) + '</span>';
        body += '<span style="font-weight:600;color:' + hc + '">' + p.points + ' pts</span>';
        body += '</div>';
      });
    }
    body += '</div>';
  });
  body += '</div>';

  // ── Best performer highlight ──
  if (bestPerf) {
    var sk = bestPerf._skill;
    var effData = effStats(winTeamCode, bestPerf.jersey);
    body += '<div style="padding:12px;background:linear-gradient(135deg,rgba(241,196,15,0.08),rgba(241,196,15,0.02));border:1px solid rgba(241,196,15,0.3);margin-bottom:14px">';
    body += '<div style="font-size:9px;color:var(--accent,#f1c40f);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">⭐ Best Performer &mdash; ' + escHtml(winTeam.name) + '</div>';
    body += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
    body += '<div style="font-family:var(--font-display);font-size:28px;color:var(--text-primary)">#' + escHtml(bestPerf.jersey) + '</div>';
    body += '<div>';
    body += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Points: <b style="color:var(--text-primary)">' + bestPerf.points + '</b></div>';
    body += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px">';
    if (sk.kills) body += '<span style="background:rgba(231,76,60,0.12);color:#e74c3c;padding:2px 6px;border-radius:3px">' + sk.kills + ' kills</span>';
    if (sk.aces) body += '<span style="background:rgba(52,152,219,0.12);color:#3498db;padding:2px 6px;border-radius:3px">' + sk.aces + ' aces</span>';
    if (sk.blocks) body += '<span style="background:rgba(46,204,113,0.12);color:#2ecc71;padding:2px 6px;border-radius:3px">' + sk.blocks + ' blocks</span>';
    if (sk.attackErrors) body += '<span style="color:var(--text-muted)">' + sk.attackErrors + ' atk err</span>';
    if (sk.serveErrors) body += '<span style="color:var(--text-muted)">' + sk.serveErrors + ' svc err</span>';
    if (sk.faults) body += '<span style="color:var(--text-muted)">' + sk.faults + ' faults</span>';
    body += '</div>';
    if (effData.attempts > 0) {
      body += '<div style="font-size:9px;color:var(--text-muted);margin-top:4px">Total actions: ' + effData.attempts + ' | Efficiency: ' + ((effData.kills / effData.attempts) * 100).toFixed(1) + '%</div>';
    }
    body += '</div></div></div>';
  }

  // ── Substitution log summary ──
  if (d.substitutionLog && d.substitutionLog.length > 0) {
    var subCountByTeam = {};
    d.substitutionLog.forEach(function(sub) {
      var tc = sub.team || (sub.teamCode) || '?';
      subCountByTeam[tc] = (subCountByTeam[tc] || 0) + 1;
    });
    body += '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:8px 0;border-top:1px solid var(--border)">';
    body += 'Total substitutions: ' + d.substitutionLog.length;
    if (subCountByTeam['A']) body += ' &middot; ' + escHtml(d.teams.A.name) + ': ' + subCountByTeam['A'];
    if (subCountByTeam['B']) body += ' &middot; ' + escHtml(d.teams.B.name) + ': ' + subCountByTeam['B'];
    body += '</div>';
  }

  showModal('Match ' + match.matchNumber + ' Result', body, [{ label: 'Close', cls: 'btn-neutral', fn: closeModal }]);
}

// ── Tournament Match Context ─────────────────────────────────
// Tracks which tournament match is currently being played.

async function _startTournamentMatch(matchId) {
  const t = getActiveTournament();
  if (!t) return;
  const match = t.schedule.find(function(m) { return m.id === matchId; });
  if (!match) return;

  switchMenu('committee');

  const teamA = t.teams.find(function(tm) { return tm.id === match.teamAId; });
  const teamB = t.teams.find(function(tm) { return tm.id === match.teamBId; });
  if (!teamA || !teamB) { showAlert('Both teams must be assigned.', 'warn'); return; }
  match.status = 'in-progress';
  await db.saveTournament(t);
  await db.saveMatch(match);
  setActiveTournament(t);

  document.getElementById('teamA-name').value = teamA.name;
  document.getElementById('teamB-name').value = teamB.name;
  document.getElementById('sets-to-win').value = String(t.setsToWin);
  document.getElementById('max-subs').value = String(t.maxSubs);
  document.documentElement.style.setProperty('--team-a', teamA.color || '#00c2fd');
  document.documentElement.style.setProperty('--team-b', teamB.color || '#00cfad');
  var dotA = document.getElementById('setup-dot-a');
  var dotB = document.getElementById('setup-dot-b');
  if (dotA) dotA.style.background = teamA.color || '#00c2fd';
  if (dotB) dotB.style.background = teamB.color || '#00cfad';
  var titleA = document.getElementById('setup-title-a');
  var titleB = document.getElementById('setup-title-b');
  if (titleA) titleA.style.color = teamA.color || 'var(--team-a)';
  if (titleB) titleB.style.color = teamB.color || 'var(--team-b)';

  // Load team rosters into the Setup tab so player dropdowns work
  const rosterA = teamA.players || [];
  const rosterB = teamB.players || [];
  _pendingFullSquad.A = rosterA.map(function(p) { return String(p.jersey); });
  _pendingFullSquad.B = rosterB.map(function(p) { return String(p.jersey); });
  buildSetupPositionCells('A', rosterA);
  buildSetupPositionCells('B', rosterB);

  // Set liberos from tournament roster
  const libA = rosterA.find(function(p) { return p.libero; });
  const libB = rosterB.find(function(p) { return p.libero; });
  if (libA) document.getElementById('teamA-libero').value = String(libA.jersey);
  if (libB) document.getElementById('teamB-libero').value = String(libB.jersey);

  // Store tournament match context so endMatch can save results
  currentTournamentMatch = {
    tournamentId: t.id,
    matchId: match.id,
    matchNumber: match.matchNumber
  };
  saveState();

  const banner = document.getElementById('tourney-banner');
  banner.classList.remove('tourney-banner-hidden');
  var bannerLabel = 'Match ' + match.matchNumber;
  if (match.finalsGameNumber && match.finalsGamesToWin && match.finalsGamesToWin > 1) {
    bannerLabel = 'Finals Game ' + match.finalsGameNumber + ' of ' + match.finalsGamesToWin;
  }
  document.getElementById('tourney-banner-text').textContent = '🏆 ' + t.name + ' — ' + bannerLabel + ': ' + teamA.name + ' vs ' + teamB.name;

  switchView('setup');
  showAlert('Match loaded: ' + teamA.name + ' vs ' + teamB.name + '. Configure lineup and start.', 'success');
}

function backToTournament() {
  document.getElementById('tourney-banner').classList.add('tourney-banner-hidden');
  currentTournamentMatch = null;
  switchMenu('admin');
  switchView('schedule');
  schedRender();
}

// ── Advance Winner in Bracket ───────────────────────────────
async function advanceTournamentWinner(tournamentId, matchId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const match = tournament.schedule.find(function(m) { return m.id === matchId; });
  if (!match || match.status !== 'completed' || !match.winnerId) return;

  const winnerName = match.winnerId === match.teamAId ? match.teamAName : match.teamBName;
  const loserId = match.winnerId === match.teamAId ? match.teamBId : match.teamAId;
  const loserName = match.winnerId === match.teamAId ? match.teamBName : match.teamAName;

  // ── Single Elimination: advance winner to next WB round ─────
  if (tournament.format === 'single-elimination') {
    const nextRound = match.round + 1;
    const wbNextMatches = tournament.schedule.filter(function(m) { return m.round === nextRound && !m.bracket; });
    const wbCurrentMatches = tournament.schedule.filter(function(m) { return m.round === match.round && !m.bracket; });

    if (wbNextMatches.length > 0 && wbCurrentMatches.length > 0) {
      const currentSorted = wbCurrentMatches.sort(function(a, b) { return a.position - b.position; });
      const matchIdx = currentSorted.findIndex(function(m) { return m.id === matchId; });
      if (matchIdx >= 0) {
        const nextMatchIdx = Math.floor(matchIdx / 2);
        const nextSorted = wbNextMatches.sort(function(a, b) { return a.position - b.position; });
        const nextMatch = nextSorted[nextMatchIdx];
        if (nextMatch) {
          if (matchIdx % 2 === 0) {
            nextMatch.teamAId = match.winnerId;
            nextMatch.teamAName = winnerName;
          } else {
            nextMatch.teamBId = match.winnerId;
            nextMatch.teamBName = winnerName;
          }
          await db.saveMatch(nextMatch);
        }
      }
    }
  }

  // ── Double Elimination: WB winner advances, loser drops to LB ─
  if (tournament.format === 'double-elimination') {
    if (match.bracket !== 'losers' && match.bracket !== 'final') {
      // WB match: winner advances in WB, loser drops to LB
      const nextWbRound = match.round + 1;
      const wbNextMatches = tournament.schedule.filter(function(m) { return m.round === nextWbRound && m.bracket !== 'losers' && m.bracket !== 'final'; });
      const wbCurrentMatches = tournament.schedule.filter(function(m) { return m.round === match.round && m.bracket !== 'losers' && m.bracket !== 'final'; });

      // Advance WB winner
      if (wbNextMatches.length > 0 && wbCurrentMatches.length > 0) {
        const currentSorted = wbCurrentMatches.sort(function(a, b) { return a.position - b.position; });
        const matchIdx = currentSorted.findIndex(function(m) { return m.id === matchId; });
        if (matchIdx >= 0) {
          const nextMatchIdx = Math.floor(matchIdx / 2);
          const nextSorted = wbNextMatches.sort(function(a, b) { return a.position - b.position; });
          const nextMatch = nextSorted[nextMatchIdx];
          if (nextMatch) {
            if (matchIdx % 2 === 0) {
              nextMatch.teamAId = match.winnerId;
              nextMatch.teamAName = winnerName;
            } else {
              nextMatch.teamBId = match.winnerId;
              nextMatch.teamBName = winnerName;
            }
            await db.saveMatch(nextMatch);
          }
        }
      } else if (wbNextMatches.length === 0) {
        var gfFromWb = tournament.schedule.find(function(m) { return m.bracket === 'final'; });
        if (gfFromWb && !gfFromWb.teamAId) {
          gfFromWb.teamAId = match.winnerId;
          gfFromWb.teamAName = winnerName;
          await db.saveMatch(gfFromWb);
        }
      }

      // Drop loser to LB: find the LB match in the same WB round number
      // LB rounds correspond to WB rounds: WB round r feeds into LB round r
      const lbRound = match.round;
      const lbMatches = tournament.schedule.filter(function(m) { return m.bracket === 'losers' && m.round === lbRound; });
      if (lbMatches.length > 0) {
        // Find an open slot in the LB round
        var openLb = lbMatches.find(function(m) { return !m.teamAId || !m.teamBId; });
        if (!openLb) {
          // All slots filled in this LB round, try next LB round
          openLb = tournament.schedule.find(function(m) { return m.bracket === 'losers' && m.round === lbRound + 1 && (!m.teamAId || !m.teamBId); });
        }
        if (openLb) {
          if (!openLb.teamAId) { openLb.teamAId = loserId; openLb.teamAName = loserName; }
          else { openLb.teamBId = loserId; openLb.teamBName = loserName; }
          await db.saveMatch(openLb);
        }
      }
    } else if (match.bracket === 'losers') {
      // LB match: winner advances in LB
      const nextLbRound = match.round + 1;
      const lbNextMatches = tournament.schedule.filter(function(m) { return m.bracket === 'losers' && m.round === nextLbRound; });
      const lbCurrentMatches = tournament.schedule.filter(function(m) { return m.bracket === 'losers' && m.round === match.round; });

      if (lbNextMatches.length > 0 && lbCurrentMatches.length > 0) {
        const currentSorted = lbCurrentMatches.sort(function(a, b) { return a.position - b.position; });
        const matchIdx = currentSorted.findIndex(function(m) { return m.id === matchId; });
        if (matchIdx >= 0) {
          const nextMatchIdx = Math.floor(matchIdx / 2);
          const nextSorted = lbNextMatches.sort(function(a, b) { return a.position - b.position; });
          const nextMatch = nextSorted[nextMatchIdx];
          if (nextMatch) {
            if (matchIdx % 2 === 0) {
              nextMatch.teamAId = match.winnerId;
              nextMatch.teamAName = winnerName;
            } else {
              nextMatch.teamBId = match.winnerId;
              nextMatch.teamBName = winnerName;
            }
            await db.saveMatch(nextMatch);
          }
        }
      } else if (lbNextMatches.length === 0) {
        // No more LB rounds — advance to grand final
        var gf = tournament.schedule.find(function(m) { return m.bracket === 'final'; });
        if (gf && !gf.teamBId) {
          gf.teamBId = match.winnerId;
          gf.teamBName = winnerName;
          await db.saveMatch(gf);
        }
      }
    }
    // Grand final: no further advancement needed
  }

  // ── Swiss Playoffs: advance winner through bracket (uses sourceMatchA/sourceMatchB links) ──
  if (tournament.format === 'swiss' && match.stage === 'playoffs') {
    const nextMatch = tournament.schedule.find(function(m) {
      return m.stage === 'playoffs' &&
        (m.sourceMatchA === match.matchNumber || m.sourceMatchB === match.matchNumber);
    });
    if (nextMatch) {
      const isTargetA = nextMatch.sourceMatchA === match.matchNumber;
      if (isTargetA) {
        if (nextMatch.teamAId !== match.winnerId) {
          nextMatch.teamAId = match.winnerId;
          nextMatch.teamAName = winnerName;
          await db.saveMatch(nextMatch);
        }
      } else {
        if (nextMatch.teamBId !== match.winnerId) {
          nextMatch.teamBId = match.winnerId;
          nextMatch.teamBName = winnerName;
          await db.saveMatch(nextMatch);
        }
      }
    }
  }

  await db.saveTournament(tournament);
  setActiveTournament(tournament);
}

// ── Standings Tab ────────────────────────────────────────────
async function standingsRender() {
  const t = getActiveTournament();
  const noTourney = document.getElementById('standings-no-tourney');
  const content = document.getElementById('standings-content');

  if (!t) { noTourney.style.display = 'block'; content.style.display = 'none'; return; }
  noTourney.style.display = 'none'; content.style.display = 'block';

  const standings = await recalculateStandings(t.id);
  const tbody = document.getElementById('standings-body');

  if (!standings || standings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:16px">No standings data yet.</td></tr>';
    document.getElementById('standings-last-updated').textContent = '';
    return;
  }

  tbody.innerHTML = standings.map(function(s, i) {
    const setRatio = s.setsLost ? (s.setsWon / s.setsLost).toFixed(3) : (s.setsWon ? '∞' : '—');
    const ptRatio = s.pointsLost ? (s.pointsWon / s.pointsLost).toFixed(3) : (s.pointsWon ? '∞' : '—');
    return '<tr>'
      + '<td style="font-weight:bold">' + (i + 1) + '</td>'
      + '<td><span style="color:' + s.color + ';font-weight:600">' + escHtml(s.teamName) + '</span></td>'
      + '<td>' + s.wins + '</td><td>' + s.losses + '</td>'
      + '<td style="font-weight:bold;color:var(--success)">' + s.points + '</td>'
      + '<td>' + s.setsWon + '</td><td>' + s.setsLost + '</td><td>' + setRatio + '</td>'
      + '<td>' + s.pointsWon + '</td><td>' + s.pointsLost + '</td><td>' + ptRatio + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('standings-last-updated').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
}

// ── Tournament Stats Tab ─────────────────────────────────────
async function tstatsRender() {
  const t = getActiveTournament();
  const noTourney = document.getElementById('tstats-no-tourney');
  const content = document.getElementById('tstats-content');

  if (!t) { noTourney.style.display = 'block'; content.style.display = 'none'; return; }
  noTourney.style.display = 'none'; content.style.display = 'block';

  // Refresh from DB to get latest match data
  const tournament = await db.getTournament(t.id);
  if (!tournament) return;
  setActiveTournament(tournament);

  const completedMatches = (tournament.schedule || []).filter(function(m) { return m.status === 'completed'; });
  const total = (tournament.schedule || []).length;
  const completed = completedMatches.length;

  // ── Overview ────────────────────────────────────────────────
  const totalSets = completedMatches.reduce(function(sum, m) {
    return sum + (m.score.setScores ? m.score.setScores.length : 0);
  }, 0);
  const totalPoints = completedMatches.reduce(function(sum, m) {
    return sum + (m.score.setScores || []).reduce(function(s, sc) { return s + (sc.a || 0) + (sc.b || 0); }, 0);
  }, 0);
  document.getElementById('tstats-overview').innerHTML = '<div class="summary-meta">'
    + '<div class="summary-meta-item"><span class="stat-label">Tournament</span><span>' + escHtml(tournament.name) + '</span></div>'
    + '<div class="summary-meta-item"><span class="stat-label">Format</span><span>' + tournament.format + '</span></div>'
    + '<div class="summary-meta-item"><span class="stat-label">Matches</span><span>' + completed + ' / ' + total + ' completed</span></div>'
    + '<div class="summary-meta-item"><span class="stat-label">Teams</span><span>' + tournament.teams.length + '</span></div>'
    + '<div class="summary-meta-item"><span class="stat-label">Total Sets</span><span>' + totalSets + '</span></div>'
    + '<div class="summary-meta-item"><span class="stat-label">Total Points</span><span>' + totalPoints + '</span></div>'
    + '</div>';

  // ── Aggregate data from all completed matches ───────────────
  // leaderboard: "teamId:jersey" -> { teamId, teamName, jersey, points }
  const leaderboard = {};
  // skillStats: "teamId:jersey" -> { teamId, teamName, jersey, kills, aces, blocks, attackErrors, serveErrors, faults }
  const skillStats = {};
  // efficiency: skill -> "teamId:jersey" -> { attempts, kills, aces, errors, inPlay, ... }
  const efficiency = { attack: {}, serve: {}, reception: {}, set: {}, block: {}, dig: {} };
  const allSetHistory = [];
  const allSubstitutions = [];

  for (const match of completedMatches) {
    if (!match.matchData) continue;
    const d = match.matchData;

    // Leaderboard — aggregate points per player
    ['A', 'B'].forEach(function(code) {
      const teamData = d.teams[code];
      if (!teamData || !teamData.leaderboard) return;
      teamData.leaderboard.forEach(function(entry) {
        const teamId = code === 'A' ? match.teamAId : match.teamBId;
        const key = teamId + ':' + entry.jersey;
        if (!leaderboard[key]) {
          leaderboard[key] = { teamId, teamName: teamData.name, jersey: entry.jersey, points: 0 };
        }
        leaderboard[key].points += entry.points || 0;
      });
    });

    // Skill stats — aggregate per player
    ['A', 'B'].forEach(function(code) {
      const teamData = d.teams[code];
      if (!teamData || !teamData.skillStats) return;
      teamData.skillStats.forEach(function(entry) {
        const teamId = code === 'A' ? match.teamAId : match.teamBId;
        const key = teamId + ':' + entry.jersey;
        if (!skillStats[key]) {
          skillStats[key] = { teamId, teamName: teamData.name, jersey: entry.jersey, kills: 0, aces: 0, blocks: 0, attackErrors: 0, serveErrors: 0, faults: 0 };
        }
        skillStats[key].kills += entry.kills || 0;
        skillStats[key].aces += entry.aces || 0;
        skillStats[key].blocks += entry.blocks || 0;
        skillStats[key].attackErrors += entry.attackErrors || 0;
        skillStats[key].serveErrors += entry.serveErrors || 0;
        skillStats[key].faults += entry.faults || 0;
      });
    });

    // Efficiency — aggregate per player from skillEfficiencyLog
    if (d.skillEfficiencyLog) {
      d.skillEfficiencyLog.forEach(function(entry) {
        var skill = entry.skill;
        if (!efficiency[skill]) return;
        var teamId = entry.team === 'A' ? match.teamAId : match.teamBId;
        var key = teamId + ':' + entry.jersey;
        if (!efficiency[skill][key]) {
          efficiency[skill][key] = { teamId, teamName: (entry.team === 'A' ? d.teams.A.name : d.teams.B.name), jersey: entry.jersey, attempts: 0, kills: 0, aces: 0, errors: 0, inPlay: 0, succ: 0, total: 0 };
        }
        var r = efficiency[skill][key];
        r.attempts++;
        if (entry.result === 'kill' || entry.result === 'ace' || entry.result === 'block') r.succ++;
        if (entry.result === 'error' || entry.result === 'attackError' || entry.result === 'serveError') r.errors++;
        if (skill === 'attack' && entry.result === 'kill') r.kills++;
        if (skill === 'serve' && entry.result === 'ace') r.aces++;
        if (entry.result === 'inPlay') r.inPlay++;
      });
    }

    (d.setHistory || []).forEach(function(setEntry) {
      allSetHistory.push({
        matchNumber: match.matchNumber,
        teamAName: match.teamAName,
        teamBName: match.teamBName,
        set: setEntry.set,
        teamA: setEntry.teamA,
        teamB: setEntry.teamB,
        winner: setEntry.winner
      });
    });

    (d.substitutionLog || []).forEach(function(subEntry) {
      allSubstitutions.push({
        matchNumber: match.matchNumber,
        teamName: subEntry.tname || (subEntry.team === 'A' ? match.teamAName : match.teamBName),
        team: subEntry.team,
        out: subEntry.out,
        in: subEntry.in,
        set: subEntry.set,
        score: subEntry.score
      });
    });
  }

  // ── Build player name lookup from tournament teams ───────────
  var playerNameMap = {}; // "teamId:jersey" -> name
  (tournament.teams || []).forEach(function(team) {
    (team.players || []).forEach(function(p) {
      if (p.jersey) playerNameMap[team.id + ':' + p.jersey] = p.name || '';
    });
  });

  // ── Render Leaderboard (combined top 10) ────────────────────
  const lbEl = document.getElementById('tstats-leaderboard');
  const lbRows = Object.values(leaderboard).sort(function(a, b) { return b.points - a.points; });
  if (lbRows.length === 0) {
    lbEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Play matches to see aggregate leaderboard.</div>';
  } else {
    var top10 = lbRows.slice(0, 10);
    var lbHtml = '<table class="standings-table"><thead><tr><th>Rank</th><th>Team</th><th>#</th><th>Player</th><th>Points</th></tr></thead><tbody>';
    top10.forEach(function(p, idx) {
      var medals = ['🥇','🥈','🥉'];
      var rank = medals[idx] || (idx + 1);
      var pName = playerNameMap[p.teamId + ':' + p.jersey] || '';
      lbHtml += '<tr><td style="text-align:center;font-size:14px">' + rank + '</td><td>' + escHtml(p.teamName) + '</td><td>' + escHtml(p.jersey) + '</td><td>' + (pName ? escHtml(pName) : '<span style="color:var(--text-muted)">—</span>') + '</td><td style="font-weight:bold;color:var(--success)">' + p.points + '</td></tr>';
    });
    lbHtml += '</tbody></table>';
    if (lbRows.length > 10) {
      lbHtml += '<div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:6px">Showing top 10 of ' + lbRows.length + ' players</div>';
    }
    lbEl.innerHTML = lbHtml;
  }

  // ── Render Skill Stats (sortable + scrollable) ──────────────
  const ssEl = document.getElementById('tstats-skill-stats');
  const ssRows = Object.values(skillStats);
  if (ssRows.length === 0) {
    ssEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Play matches to see aggregate skill stats.</div>';
  } else {
    var skillCats = [
      { key: 'kills', label: 'K', color: '#e74c3c', sortFn: function(a, b) { return b.kills - a.kills; } },
      { key: 'aces', label: 'Ace', color: '#3498db', sortFn: function(a, b) { return b.aces - a.aces; } },
      { key: 'blocks', label: 'Blk', color: '#2ecc71', sortFn: function(a, b) { return b.blocks - a.blocks; } },
      { key: 'errors', label: 'Err', color: '#e67e22', sortFn: function(a, b) { return ((b.attackErrors||0)+(b.serveErrors||0)+(b.faults||0)) - ((a.attackErrors||0)+(a.serveErrors||0)+(a.faults||0)); } }
    ];
    var skillBodyId = 'tstats-skill-body';
    var btnsHtml = '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
    skillCats.forEach(function(cat, idx) {
      var active = idx === 0 ? 'background:var(--success);color:#000' : 'background:var(--bg-card);color:var(--text-secondary)';
      btnsHtml += '<button class="resource-btn" id="tstats-skill-btn-' + cat.key + '" style="font-size:11px;padding:5px 12px;' + active + '" onclick="tstatsSortSkillCat(\'' + cat.key + '\')">' + cat.label + '</button>';
    });
    btnsHtml += '</div>';
    window._tstatsSkillRows = ssRows;
    window._tstatsSkillCats = skillCats;
    window._tstatsPlayerNameMap = playerNameMap;
    var initialSorted = [...ssRows].sort(skillCats[0].sortFn);
    window._tstatsSkillSorted = initialSorted;
    window._tstatsSkillExpanded = false;
    ssEl.innerHTML = btnsHtml + '<div id="' + skillBodyId + '"></div>';
    tstatsRenderSkillTable();
  }

  // ── Render Efficiency (leaderboard per skill, top 10 + show more) ──
  const effEl = document.getElementById('tstats-efficiency');
  var effHtml = '';
  var effSkills = ['attack','serve','reception','set','block','dig'];
  var effLabels = { attack: 'Attack', serve: 'Serve', reception: 'Reception', set: 'Set', block: 'Block', dig: 'Dig' };
  var effColors = { attack: '#e74c3c', serve: '#3498db', reception: '#9b59b6', set: '#1abc9c', block: '#2ecc71', dig: '#f39c12' };
  window._tstatsEffData = {};
  window._tstatsEffExpanded = {};
  effSkills.forEach(function(skill) {
    var rows = Object.values(efficiency[skill] || {}).filter(function(r) { return r.attempts > 0; });
    if (rows.length === 0) return;
    rows.sort(function(a, b) {
      var effA = a.attempts ? ((a.succ - a.errors) / a.attempts) : -999;
      var effB = b.attempts ? ((b.succ - b.errors) / b.attempts) : -999;
      return effB - effA;
    });
    window._tstatsEffData[skill] = rows;
    window._tstatsEffExpanded[skill] = false;
    var displayRows = rows.slice(0, 10);
    var skColor = effColors[skill];
    effHtml += '<div class="panel" style="margin-bottom:12px"><div class="panel-title" style="color:' + skColor + '">' + effLabels[skill] + ' Efficiency</div>';
    effHtml += '<div id="tstats-eff-body-' + skill + '">';
    effHtml += tstatsBuildEffTable(skill, displayRows, false);
    effHtml += '</div>';
    effHtml += '</div>';
  });
  if (!effHtml) {
    effEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Play matches and record skill entries to see aggregate efficiency.</div>';
  } else {
    effEl.innerHTML = effHtml;
  }
  const setHistoryEl = document.getElementById('tstats-set-history');
  if (allSetHistory.length === 0) {
    setHistoryEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Completed tournament match sets will appear here.</div>';
  } else {
    var setHtml = '<table class="standings-table"><thead><tr><th>Match</th><th>Set</th><th>Teams</th><th>Score</th><th>Winner</th></tr></thead><tbody>';
    allSetHistory.forEach(function(s) {
      setHtml += '<tr><td>' + s.matchNumber + '</td><td>' + s.set + '</td><td>' + escHtml(s.teamAName) + ' vs ' + escHtml(s.teamBName) + '</td><td>' + s.teamA + '-' + s.teamB + '</td><td>' + escHtml(s.winner || '') + '</td></tr>';
    });
    setHtml += '</tbody></table>';
    setHistoryEl.innerHTML = setHtml;
  }

  const subLogEl = document.getElementById('tstats-substitution-log');
  if (allSubstitutions.length === 0) {
    subLogEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px">Tournament substitutions will appear here.</div>';
  } else {
    var subHtml = '<table class="standings-table"><thead><tr><th>Match</th><th>Set</th><th>Team</th><th>Out</th><th>In</th><th>Score</th></tr></thead><tbody>';
    allSubstitutions.forEach(function(s) {
      subHtml += '<tr><td>' + s.matchNumber + '</td><td>' + (s.set || '-') + '</td><td>' + escHtml(s.teamName || s.team || '') + '</td><td>#' + escHtml(s.out || '') + '</td><td>#' + escHtml(s.in || '') + '</td><td>' + escHtml(s.score || '') + '</td></tr>';
    });
    subHtml += '</tbody></table>';
    subLogEl.innerHTML = subHtml;
  }
}

// ── Skill Stats Helpers ──────────────────────────────────────
function tstatsSortSkillCat(catKey) {
  var cats = window._tstatsSkillCats || [];
  cats.forEach(function(c) {
    var btn = document.getElementById("tstats-skill-btn-" + c.key);
    if (!btn) return;
    if (c.key === catKey) {
      btn.style.background = "var(--success)";
      btn.style.color = "#000";
    } else {
      btn.style.background = "var(--bg-card)";
      btn.style.color = "var(--text-secondary)";
    }
  });
  var sortFn = cats.find(function(c) { return c.key === catKey; }).sortFn;
  window._tstatsSkillSorted = [].concat(window._tstatsSkillRows || []).sort(sortFn);
  window._tstatsSkillExpanded = false;
  tstatsRenderSkillTable();
}

function tstatsToggleSkillExpand() {
  window._tstatsSkillExpanded = !window._tstatsSkillExpanded;
  tstatsRenderSkillTable();
}

function tstatsRenderSkillTable() {
  var data = window._tstatsSkillSorted || [];
  var nameMap = window._tstatsPlayerNameMap || {};
  var expanded = window._tstatsSkillExpanded;
  var displayRows = expanded ? data : data.slice(0, 10);
  var html = '<table class="standings-table"><thead><tr><th>Rank</th><th>Team</th><th>#</th><th>Player</th><th style="color:#e74c3c">K</th><th style="color:#3498db">Ace</th><th style="color:#2ecc71">Blk</th><th style="color:#e67e22">Err</th></tr></thead><tbody>';
  displayRows.forEach(function(p, idx) {
    var medals = ["🥇","🥈","🥉"];
    var rank = medals[idx] || (idx + 1);
    var pName = nameMap[p.teamId + ":" + p.jersey] || "";
    var totalErr = (p.attackErrors||0) + (p.serveErrors||0) + (p.faults||0);
    html += '<tr><td style="text-align:center;font-size:14px">' + rank + '</td><td>' + escHtml(p.teamName) + '</td><td>' + escHtml(p.jersey) + '</td><td>' + (pName ? escHtml(pName) : '<span style="color:var(--text-muted)">—</span>') + '</td><td style="color:#e74c3c;font-weight:600">' + p.kills + '</td><td style="color:#3498db;font-weight:600">' + p.aces + '</td><td style="color:#2ecc71;font-weight:600">' + p.blocks + '</td><td style="color:#e67e22;font-weight:600">' + totalErr + '</td></tr>';
  });
  html += "</tbody></table>";
  if (data.length > 10) {
    var arrow = expanded ? "▲ Show Less" : "▼ Show More (" + (data.length - 10) + " more)";
    html += '<div style="text-align:center;padding:8px;cursor:pointer;font-size:11px;color:var(--court-line);border-top:1px solid var(--border);margin-top:4px" onclick="tstatsToggleSkillExpand()">' + arrow + '</div>';
  }
  var bodyEl = document.getElementById("tstats-skill-body");
  if (bodyEl) bodyEl.innerHTML = html;
}


  // ── Efficiency Helpers ───────────────────────────────────────
  function tstatsBuildEffTable(skill, rows, expanded) {
    var nameMap = window._tstatsPlayerNameMap || {};
    var data = rows || window._tstatsEffData[skill] || [];
    var displayRows = expanded ? data : data.slice(0, 10);
    var html = '<table class="standings-table"><thead><tr><th>Rank</th><th>Team</th><th>#</th><th>Player</th><th>Att</th><th>Succ</th><th>Err</th><th>Succ%</th><th>Eff%</th></tr></thead><tbody>';
    displayRows.forEach(function(r, idx) {
      var medals = ['🥇','🥈','🥉'];
      var rank = medals[idx] || (idx + 1);
      var pName = nameMap[r.teamId + ':' + r.jersey] || '';
      var succPct = r.attempts ? ((r.succ / r.attempts) * 100).toFixed(1) + '%' : '-';
      var effPct = r.attempts ? (((r.succ - r.errors) / r.attempts) * 100).toFixed(1) + '%' : '-';
      html += '<tr><td style="text-align:center;font-size:14px">' + rank + '</td><td>' + escHtml(r.teamName) + '</td><td>' + escHtml(r.jersey) + '</td><td>' + (pName ? escHtml(pName) : '<span style="color:var(--text-muted)">—</span>') + '</td><td>' + r.attempts + '</td><td>' + r.succ + '</td><td style="color:var(--danger)">' + r.errors + '</td><td>' + succPct + '</td><td style="font-weight:700">' + effPct + '</td></tr>';
    });
    html += '</tbody></table>';
    if (data.length > 10) {
      var arrow = expanded ? '▲ Show Less' : '▼ Show More (' + (data.length - 10) + ' more)';
      html += '<div style="text-align:center;padding:6px;cursor:pointer;font-size:10px;color:var(--court-line);border-top:1px solid var(--border)" onclick="tstatsToggleEff(\'' + skill + '\')">' + arrow + '</div>';
    }
    return html;
  }

  function tstatsToggleEff(skill) {
    window._tstatsEffExpanded[skill] = !window._tstatsEffExpanded[skill];
    var expanded = window._tstatsEffExpanded[skill];
    var data = window._tstatsEffData[skill] || [];
    var bodyEl = document.getElementById('tstats-eff-body-' + skill);
    if (bodyEl) bodyEl.innerHTML = tstatsBuildEffTable(skill, data, expanded);
  }

function tstatsExport() {
  const t = getActiveTournament();
  if (!t) { showAlert('No tournament to export.', 'warn'); return; }
  exportTournamentToFile(t.id);
}
