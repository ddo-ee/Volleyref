// ===================== STATE =====================
const SAVE_KEY = 'volleyref-match-state';
const SAVE_VERSION = 1;

function saveState() {
  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: state,
      liberoSelectionMode: liberoSelectionMode,
      selectedEfficiencySkill: selectedEfficiencySkill,
      subRegistry: subRegistry,
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
function refreshSetupDropdowns() {
  const teams = loadAllTeams();
  ['A','B'].forEach(slot => {
    const sel = document.getElementById('team' + slot + '-saved-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Manual Entry —</option>' +
      teams.map(t => `<option value="${t.id}"${t.id === current ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('');
  });
}

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
  refreshSetupDropdowns();
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
       refreshSetupDropdowns();
       const panel = document.getElementById('team-editor-panel');
       if (panel) panel.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:24px 0">Select a team on the left, or create a new one.</div>';
     }}
  ]);
}

const _pendingFullSquad = { A: [], B: [] };

function loadSavedTeamIntoSetup(slot, teamId) {
  if (!teamId) {
    _pendingFullSquad[slot] = [];
    buildSetupPositionCells(slot, []);
    return;
  }
  const teams = loadAllTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  _pendingFullSquad[slot] = (team.players || []).map(p => String(p.jersey));

  const nameEl = document.getElementById('team' + slot + '-name');
  if (nameEl) nameEl.value = team.name;

  buildSetupPositionCells(slot, team.players || []);

  const liberoPlayer = (team.players || []).find(p => p.libero);
  if (liberoPlayer) {
    const libEl = document.getElementById('team' + slot + '-libero');
    if (libEl) libEl.value = liberoPlayer.jersey;
  }
}

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

      const pickerBtn = document.createElement('button');
      pickerBtn.type = 'button';
      pickerBtn.className = 'player-picker-trigger';
      pickerBtn.textContent = 'v';
      pickerBtn.setAttribute('aria-label', 'Choose player for position ' + i);
      pickerBtn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.setup-player-picker.open').forEach(el => {
          if (el !== pickerWrap) el.classList.remove('open');
        });
        pickerWrap.classList.toggle('open');
        inp.focus();
      });
      inp.addEventListener('focus', () => pickerWrap.classList.add('open'));
      inp.addEventListener('input', () => pickerWrap.classList.remove('open'));

      pickerWrap.appendChild(inp);
      pickerWrap.appendChild(pickerBtn);
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
  refreshSetupDropdowns();

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

function endMatch() {
  if (state.matchEnded) {
    closeModal();
    switchView('summary');
    updateSummary();
    return;
  }
  state.matchEnded = true;
  state.gameStarted = false;
  if (!state.summaryExported) {
    exportMatchSummary();
    reserveNextMatchNumber();
    state.summaryExported = true;
  }
  closeModal();
  switchView('summary');
  updateSummary();
  showAlert('Match summary exported to JSON.', 'success');
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
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>K</th><th>Err</th><th>In</th><th>Succ</th><th>Eff</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.kills}</td><td>${r.stats.errors}</td><td>${r.stats.inPlay}</td><td>${formatPct(r.stats.inPlay + r.stats.kills, r.stats.attempts)}</td><td>${formatEff(r.stats.kills - r.stats.errors, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'serve') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Ace</th><th>Err</th><th>In</th><th>Succ</th><th>Ace%</th><th>Eff</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.aces}</td><td>${r.stats.errors}</td><td>${r.stats.inPlay}</td><td>${formatPct(r.stats.aces + r.stats.inPlay, r.stats.attempts)}</td><td>${formatPct(r.stats.aces, r.stats.attempts)}</td><td>${formatEff(r.stats.aces - r.stats.errors, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else if (skill === 'reception') {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Pos</th><th>Poor</th><th>Err</th><th>Eff</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.positive}</td><td>${r.stats.poor}</td><td>${r.stats.errors}</td><td>${formatEff(r.stats.positive - r.stats.poor, r.stats.attempts)}</td></tr>`).join('') +
      '</tbody></table>';
  } else {
    el.innerHTML = `<table class="efficiency-table"><thead><tr><th>Player</th><th>Att</th><th>Exc</th><th>Still</th><th>Fault</th><th>Succ</th><th>Eff</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${getTeamState(r.team).name} #${escHtml(r.jersey)}</td><td>${r.stats.attempts}</td><td>${r.stats.excellent}</td><td>${r.stats.still}</td><td>${r.stats.faults}</td><td>${formatPct(r.stats.excellent + r.stats.still, r.stats.attempts)}</td><td>${formatEff(r.stats.excellent - r.stats.faults, r.stats.attempts)}</td></tr>`).join('') +
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
      set: getEfficiencyRows('set')
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
  document.getElementById('modal-body').textContent = body;
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
  document.querySelectorAll('.setup-player-picker.open').forEach(el => el.classList.remove('open'));
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
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => {
    if ((t.getAttribute('onclick') || '').includes("'" + name + "'")) t.classList.add('active');
  });
  if (name === 'summary') updateSummary();
  if (name === 'court') { renderCourts(); updateCourtScores(); renderPlayerStats(); }
  if (name === 'efficiency') renderEfficiencyView();
  if (name === 'teams') { renderTeamsList(); if (editingTeamId) renderTeamEditor(editingTeamId); }
  if (name === 'setup') refreshSetupDropdowns();
}

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

// ===================== INIT =====================
initSetupUI();

// Attempt to restore a saved match
if (loadState() && state.gameStarted && !state.matchEnded) {
  switchView('game');
  renderAll();
  try {
    const savedRaw = localStorage.getItem(SAVE_KEY);
    const savedTime = savedRaw ? JSON.parse(savedRaw).savedAt : null;
    const timeStr = savedTime ? ' (last saved: ' + new Date(savedTime).toLocaleTimeString() + ')' : '';
    showAlert('Match restored from auto-save' + timeStr, 'success');
  } catch(e) { /* ignore */ }
}
