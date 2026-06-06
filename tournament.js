// ===================== TOURNAMENT LOGIC =====================
// Tournament state, schedule generation, standings, match lifecycle.
// All data operations go through db.js.

// ── Active Tournament State ──────────────────────────────────
let activeTournament = null;
const TOURNAMENT_AUTOSAVE_KEY = 'volleyref-active-tournament';

function persistTournamentLocal(t) {
  try {
    if (t) localStorage.setItem(TOURNAMENT_AUTOSAVE_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOURNAMENT_AUTOSAVE_KEY);
  } catch (e) { /* ignore storage errors */ }
}

function restoreTournamentLocal() {
  try {
    const raw = localStorage.getItem(TOURNAMENT_AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getActiveTournament() {
  return activeTournament;
}

function setActiveTournament(t) {
  activeTournament = t;
  persistTournamentLocal(t);
}

// ── Helpers ──────────────────────────────────────────────────
function generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ── Create Tournament ────────────────────────────────────────
async function createTournament(config) {
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

  await db.saveTournament(tournament);
  setActiveTournament(tournament);
  return tournament;
}

// ── Team Management ──────────────────────────────────────────
async function addTeamToTournament(tournamentId, teamData) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return null;

  const team = {
    id: generateId('team'),
    tournamentId,
    name: teamData.name || 'New Team',
    color: teamData.color || '#888888',
    players: []
  };

  tournament.teams.push(team);
  await db.saveTournament(tournament);
  await db.saveTeam(team);

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }

  return team;
}

async function removeTeamFromTournament(tournamentId, teamId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  tournament.teams = tournament.teams.filter(t => t.id !== teamId);
  await db.saveTournament(tournament);
  await db.deleteTeam(teamId);

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }
}

async function updateTeamInTournament(tournamentId, teamId, updates) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const team = tournament.teams.find(t => t.id === teamId);
  if (!team) return;

  if (updates.name !== undefined) team.name = updates.name;
  if (updates.color !== undefined) team.color = updates.color;

  await db.saveTournament(tournament);
  await db.saveTeam({ ...team, tournamentId });

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }
}

async function reorderTeams(tournamentId, teamIds) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const ordered = [];
  for (const id of teamIds) {
    const team = tournament.teams.find(t => t.id === id);
    if (team) ordered.push(team);
  }
  tournament.teams = ordered;
  await db.saveTournament(tournament);

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }
}

// ── Player Management (within tournament team) ───────────────
async function addPlayerToTeam(tournamentId, teamId, playerData) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return null;

  const team = tournament.teams.find(t => t.id === teamId);
  if (!team) return null;

  const player = {
    id: teamId + ':' + playerData.jersey,
    tournamentId,
    teamId,
    jersey: playerData.jersey,
    name: playerData.name || '',
    libero: playerData.libero || false
  };

  // Update in-memory team
  const existingIdx = team.players.findIndex(p => String(p.jersey) === String(playerData.jersey));
  if (existingIdx >= 0) {
    team.players[existingIdx] = player;
  } else {
    team.players.push(player);
  }

  await db.saveTournament(tournament);
  await db.savePlayer(player);

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }

  return player;
}

async function removePlayerFromTeam(tournamentId, teamId, jersey) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const team = tournament.teams.find(t => t.id === teamId);
  if (!team) return;

  team.players = team.players.filter(p => String(p.jersey) !== String(jersey));
  await db.saveTournament(tournament);
  await db.deletePlayer(teamId, jersey);

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }
}

// ── Schedule Generation ──────────────────────────────────────

// Round Robin: every team plays every other once
function generateRoundRobin(teams, semiMode) {
  const matches = [];
  let matchNum = 1;
  
  // Clone teams array so we don't mutate the original argument
  const list = [...teams];
  
  // If odd, add a dummy team representing a BYE
  const isOdd = list.length % 2 !== 0;
  if (isOdd) {
    list.push({ id: 'BYE', name: 'BYE' });
  }
  
  const numTeams = list.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;

  // 1. GENERATE TRUE ROUND-ROBIN ROUNDS
  for (let round = 1; round <= numRounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const teamA = list[i];
      const teamB = list[numTeams - 1 - i];

      // Skip scheduling the match if it's against the BYE placeholder
      if (teamA.id === 'BYE' || teamB.id === 'BYE') {
        continue; 
      }

      matches.push({
        id: generateId('match'),
        tournamentId: null,
        round: round, // Now increments accurately (Round 1, Round 2, etc.)
        position: matchNum,
        matchNumber: matchNum,
        teamAId: teamA.id,
        teamBId: teamB.id,
        teamAName: teamA.name,
        teamBName: teamB.name,
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        stage: 'round-robin'
      });
      matchNum++;
    }

    // Circle Method Rotation: Keep element 0 fixed, rotate the rest right
    list.splice(1, 0, list.pop());
  }

  // Calculate the total rounds used by the round-robin stage
  const rrEndRound = isOdd ? numTeams : numTeams - 1;

  // 2. PLAYOFF SEEDING STAGE (Only if 4+ real teams exist)
  const realTeamsCount = teams.length;
  if (realTeamsCount >= 4) {
    semiMode = semiMode || '1v4-2v3';
    const pairs = semiMode === '1v3-2v4' ? [[1, 3], [2, 4]] : [[1, 4], [2, 3]];
    
    const sfMatchNumbers = [];

    // Semifinals
    pairs.forEach(function(pair, idx) {
      const currentSfNum = matchNum;
      sfMatchNumbers.push(currentSfNum);

      matches.push({
        id: generateId('match'),
        tournamentId: null,
        round: rrEndRound + 1, // Progresses sequentially after RR stage
        position: matchNum,
        matchNumber: matchNum,
        teamAId: null,
        teamBId: null,
        teamAName: 'Rank ' + pair[0],
        teamBName: 'Rank ' + pair[1],
        seedA: pair[0],
        seedB: pair[1],
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        stage: 'semifinal'
      });
      matchNum++;
    });

    // Finals
    matches.push({
      id: generateId('match'),
      tournamentId: null,
      round: rrEndRound + 2, 
      position: matchNum,
      matchNumber: matchNum,
      teamAId: null,
      teamBId: null,
      teamAName: 'Winner SF1',
      teamBName: 'Winner SF2',
      sourceMatchA: sfMatchNumbers[0], // Programmatically points to SF1 matchNumber
      sourceMatchB: sfMatchNumbers[1], // Programmatically points to SF2 matchNumber
      status: 'scheduled',
      winnerId: null,
      score: { setsA: 0, setsB: 0, setScores: [] },
      matchData: null,
      stage: 'final'
    });
  }

  return matches;
}

// Keep your excellent seed order generator intact
function generateSeedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const next = [];
    const mirror = seeds.length * 2 + 1;
    seeds.forEach(function(seed) {
      next.push(seed);
      next.push(mirror - seed);
    });
    seeds = next;
  }
  return seeds;
}

function getMatchTeamName(match, teamId) {
  if (!teamId) return 'TBD';
  if (match.teamAId === teamId) return match.teamAName;
  if (match.teamBId === teamId) return match.teamBName;
  return 'TBD';
}

function advanceGeneratedByes(matches) {
  let changed = true;
  while (changed) {
    changed = false;
    
    // ISOLATE Winners Bracket to prevent Losers Bracket matches from colliding by Round Number
    const wbMatches = matches.filter(m => !m.bracket || m.bracket === 'winners');
    const roundNums = Array.from(new Set(wbMatches.map(m => m.round))).sort((a, b) => a - b);
    
    for (let rIdx = 0; rIdx < roundNums.length - 1; rIdx++) {
      const round = roundNums[rIdx];
      const nextRound = roundNums[rIdx + 1];
      
      const current = wbMatches.filter(m => m.round === round).sort((a, b) => a.position - b.position);
      const next = wbMatches.filter(m => m.round === nextRound).sort((a, b) => a.position - b.position);

      current.forEach(function(match, idx) {
        if (match.status !== 'completed' || !match.winnerId) return;
        
        const nextMatch = next.find(m => m.sourceMatchA === match.matchNumber || m.sourceMatchB === match.matchNumber) || next[Math.floor(idx / 2)];
        if (!nextMatch) return;
        
        const winnerName = getMatchTeamName(match, match.winnerId);
        const isTargetA = nextMatch.sourceMatchA === match.matchNumber || (nextMatch.sourceMatchA === null && idx % 2 === 0);
        
        if (isTargetA) {
          if (nextMatch.teamAId !== match.winnerId) {
            nextMatch.teamAId = match.winnerId;
            nextMatch.teamAName = winnerName;
            changed = true;
          }
        } else {
          if (nextMatch.teamBId !== match.winnerId) {
            nextMatch.teamBId = match.winnerId;
            nextMatch.teamBName = winnerName;
            changed = true;
          }
        }
      });
    }
  }
}

function generateSingleElimination(teams, semiMode = '1v4-2v3') {
  const n = teams.length;
  if (n === 0) return [];

  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(n)));
  const slots = new Array(nextPow2).fill(null);
  let seedOrder;

  // For 4-team brackets, adjust seed order based on semiMode
  if (nextPow2 === 4 && semiMode) {
    if (semiMode === '1v3-2v4') {
      seedOrder = [1, 3, 2, 4];
    } else {
      // default to 1v4-2v3
      seedOrder = [1, 4, 2, 3];
    }
  } else {
    seedOrder = generateSeedOrder(nextPow2);
  }

  // CRITICAL FIX: Ensure teams have explicit seed properties 
  // mapping them cleanly to standard tournament position rules
  teams.forEach(function(team, idx) {
    const teamSeed = team.seed || (idx + 1); 
    const slotIndex = seedOrder.indexOf(teamSeed);
    if (slotIndex >= 0) {
      slots[slotIndex] = { type: 'team', team: team };
    }
  });

  const matches = [];
  let matchNum = 1;
  let round = 1;
  
  const firstRoundMatchesCount = nextPow2 / 2;
  const round1MatchesMap = [];

  // 1. GENERATE ROUND 1 MATCHES
  for (let i = 0; i < slots.length; i += 2) {
    const slotA = slots[i];
    const slotB = slots[i + 1];

    const match = {
      id: generateId('match'),
      tournamentId: null,
      round: round,
      position: matchNum,
      matchNumber: matchNum,
      sourceMatchA: null, // First round has no parent matches
      sourceMatchB: null,
      teamAId: slotA && slotA.team ? slotA.team.id : null,
      teamBId: slotB && slotB.team ? slotB.team.id : null,
      teamAName: slotA && slotA.team ? slotA.team.name : 'TBD',
      teamBName: slotB && slotB.team ? slotB.team.name : 'TBD',
      status: 'scheduled',
      winnerId: null,
      score: { setsA: 0, setsB: 0, setScores: [] },
      matchData: null,
      stage: 'single-elimination'
    };

    // Evaluate Byes instantly
    if (slotA && slotA.team && (!slotB || !slotB.team)) {
      match.winnerId = slotA.team.id;
      match.status = 'completed';
    } else if (slotB && slotB.team && (!slotA || !slotA.team)) {
      match.winnerId = slotB.team.id;
      match.status = 'completed';
    }

    matches.push(match);
    round1MatchesMap.push(match);
    matchNum++;
  }

  // 2. GENERATE SUBSEQUENT ROUNDS WITH EXPLICIT RELATIONSHIPS
  let previousRoundMatches = round1MatchesMap;
  let remaining = firstRoundMatchesCount;
  
  while (remaining > 1) {
    remaining = Math.floor(remaining / 2);
    round++;
    const currentRoundMatches = [];
    
    for (let i = 0; i < remaining; i++) {
      const sourceMatchA = previousRoundMatches[i * 2];
      const sourceMatchB = previousRoundMatches[i * 2 + 1];

      const match = {
        id: generateId('match'),
        tournamentId: null,
        round: round,
        position: matchNum,
        matchNumber: matchNum,
        sourceMatchA: sourceMatchA ? sourceMatchA.matchNumber : null, // Links explicitly to upstream parents
        sourceMatchB: sourceMatchB ? sourceMatchB.matchNumber : null,
        teamAId: null,
        teamBId: null,
        teamAName: 'TBD',
        teamBName: 'TBD',
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        stage: 'single-elimination'
      };
      
      matches.push(match);
      currentRoundMatches.push(match);
      matchNum++;
    }
    previousRoundMatches = currentRoundMatches;
  }

  // Run downstream propagation pass safely
  advanceGeneratedByes(matches);
  return matches;
}

function generateDoubleElimination(teams, semiMode) {
  // 1. Generate the Winners Bracket using our fixed Single Elimination script
  const wbMatches = generateSingleElimination(teams, semiMode);
  wbMatches.forEach(function(m) { m.bracket = 'winners'; });
  
  const matches = [...wbMatches];
  const wbRoundsCount = Math.max(...wbMatches.map(m => m.round));
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(teams.length)));
  
  let matchNum = matches.length + 1;
  let lbRound = 1;

  // Track matches round-by-round to create structural dependencies
  const lbMatchesByRound = {};
  const wbMatchesByRound = {};
  for (let r = 1; r <= wbRoundsCount; r++) {
    wbMatchesByRound[r] = wbMatches.filter(m => m.round === r).sort((a, b) => a.position - b.position);
  }

  // 2. Generate Losers Bracket Rounds dynamically based on Winners Bracket structural tiers
  // Losers bracket needs exactly (2 * wbRoundsCount) - 2 rounds
  const totalLbRounds = (2 * wbRoundsCount) - 2;
  let currentLbSize = nextPow2 / 4; // Number of matches in LR1

  for (let lr = 1; lr <= totalLbRounds; lr++) {
    lbMatchesByRound[lr] = [];
    
    for (let i = 0; i < currentLbSize; i++) {
      const match = {
        id: generateId('match'),
        tournamentId: null,
        round: lr,
        position: matchNum,
        matchNumber: matchNum,
        teamAId: null,
        teamBId: null,
        teamAName: 'TBD',
        teamBName: 'TBD',
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        bracket: 'losers',
        // Structural links to handle double elimination routing
        winSourceMatchA: null,
        winSourceMatchB: null,
        lossSourceMatchA: null,
        lossSourceMatchB: null
      };

      matches.push(match);
      lbMatchesByRound[lr].push(match);
      matchNum++;
    }

    // Mathematical balance rule: Reduce the size of the next losers round 
    // ONLY after odd-numbered losers rounds (1, 3, 5...)
    if (lr % 2 === 1) {
      currentLbSize = currentLbSize; // Stays same size for incoming drop-downs
    } else {
      currentLbSize = Math.floor(currentLbSize / 2); // Shrinks by half
    }
  }

  // 3. MAP THE DEPENDENCIES (The structural glue)
  // Connect Winners Bracket drop-downs to Losers Bracket input slots
  for (let lr = 1; lr <= totalLbRounds; lr++) {
    const lrMatches = lbMatchesByRound[lr];

    if (lr === 1) {
      // Losers Round 1 takes losers directly from Winners Round 1
      const wr1Matches = wbMatchesByRound[1] || [];
      lrMatches.forEach((m, idx) => {
        const srcA = wr1Matches[idx * 2];
        const srcB = wr1Matches[idx * 2 + 1];
        if (srcA) m.lossSourceMatchA = srcA.matchNumber;
        if (srcB) m.lossSourceMatchB = srcB.matchNumber;
      });
    } else if (lr % 2 === 0) {
      // Even Losers Rounds (2, 4, 6...) ingest fresh losers from the Winners Bracket
      // Matches up cleanly with corresponding Winners Round: (lr / 2) + 1
      const targetWbRound = (lr / 2) + 1;
      const wbDropMatches = wbMatchesByRound[targetWbRound] || [];
      
      // Invert or reverse the matching order to prevent top seeds from knocking each other out immediately
      const reversedWbDrop = [...wbDropMatches].reverse();

      lrMatches.forEach((m, idx) => {
        const wbSrc = reversedWbDrop[idx];
        if (wbSrc) {
          m.lossSourceMatchB = wbSrc.matchNumber; // Feeds the B slot of this losers match
        }
        
        // Slot A comes from the winner of the previous Losers Round
        const prevLbMatch = lbMatchesByRound[lr - 1][idx];
        if (prevLbMatch) m.winSourceMatchA = prevLbMatch.matchNumber;
      });
    } else {
      // Odd Losers Rounds > 1 (3, 5, 7...) purely pair internal survivors of the previous losers round
      lrMatches.forEach((m, idx) => {
        const prevLbA = lbMatchesByRound[lr - 1][idx * 2];
        const prevLbB = lbMatchesByRound[lr - 1][idx * 2 + 1];
        if (prevLbA) m.winSourceMatchA = prevLbA.matchNumber;
        if (prevLbB) m.winSourceMatchB = prevLbB.matchNumber;
      });
    }
  }

  // 4. THE GRAND FINALS STAGE
  const wbFinalMatch = wbMatchesByRound[wbRoundsCount][0];
  const lbFinalMatch = lbMatchesByRound[totalLbRounds][0];

  const grandFinal1 = {
    id: generateId('match'),
    tournamentId: null,
    round: wbRoundsCount + 1,
    position: matchNum,
    matchNumber: matchNum,
    teamAId: null,
    teamBId: null,
    teamAName: 'WB Winner',
    teamBName: 'LB Winner',
    winSourceMatchA: wbFinalMatch ? wbFinalMatch.matchNumber : null, // From Winners final
    winSourceMatchB: lbFinalMatch ? lbFinalMatch.matchNumber : null, // From Losers final
    status: 'scheduled',
    winnerId: null,
    score: { setsA: 0, setsB: 0, setScores: [] },
    matchData: null,
    bracket: 'final'
  };
  matches.push(grandFinal1);
  matchNum++;

  // 5. BRACKET RESET ("IF NECESSARY" MATCH)
  const grandFinal2 = {
    id: generateId('match'),
    tournamentId: null,
    round: wbRoundsCount + 2,
    position: matchNum,
    matchNumber: matchNum,
    teamAId: null,
    teamBId: null,
    teamAName: 'WB Winner (If Loss)',
    teamBName: 'LB Winner (If Win)',
    status: 'scheduled',
    winnerId: null,
    score: { setsA: 0, setsB: 0, setScores: [] },
    matchData: null,
    bracket: 'final-reset',
    isOptional: true // Your frontend can hide this unless grandFinal1 is won by the LB team
  };
  matches.push(grandFinal2);

  // 6. RUN AUTO-ADVANCE PASS
  // This will cleanly cascade and evaluate all initial Round 1 Byes out of your losers bracket slots instantly!
  advanceDoubleEliminationByes(matches);

  return matches;
}

// Dedicated Double Elimination Bye Propagation Helper
function advanceDoubleEliminationByes(matches) {
  let changed = true;
  while (changed) {
    changed = false;

    matches.forEach(match => {
      if (match.status === 'completed') return;

      // 1. Process Winners dropping down into Losers slots
      if (match.lossSourceMatchA) {
        const src = matches.find(m => m.matchNumber === match.lossSourceMatchA);
        if (src && src.status === 'completed') {
          const loserId = src.winnerId === src.teamAId ? src.teamBId : src.teamAId;
          const loserName = src.winnerId === src.teamAId ? src.teamBName : src.teamAName;
          
          if (!loserId) {
            if (match.teamAId !== 'BYE') {
              match.teamAId = 'BYE';
              match.teamAName = 'BYE';
              changed = true;
            }
          } else if (match.teamAId !== loserId) {
            match.teamAId = loserId;
            match.teamAName = loserName;
            changed = true;
          }
        }
      }
      
      if (match.lossSourceMatchB) {
        const src = matches.find(m => m.matchNumber === match.lossSourceMatchB);
        if (src && src.status === 'completed') {
          const loserId = src.winnerId === src.teamAId ? src.teamBId : src.teamAId;
          const loserName = src.winnerId === src.teamAId ? src.teamBName : src.teamAName;
          
          if (!loserId) {
            if (match.teamBId !== 'BYE') {
              match.teamBId = 'BYE';
              match.teamBName = 'BYE';
              changed = true;
            }
          } else if (match.teamBId !== loserId) {
            match.teamBId = loserId;
            match.teamBName = loserName;
            changed = true;
          }
        }
      }

      // 2. Internal bracket propagation (Losers moving forward, or Grand Final entries)
      if (match.winSourceMatchA) {
        const src = matches.find(m => m.matchNumber === match.winSourceMatchA);
        if (src && src.status === 'completed' && src.winnerId && match.teamAId !== src.winnerId) {
          match.teamAId = src.winnerId;
          match.teamAName = src.winnerId === src.teamAId ? src.teamAName : src.teamBName;
          changed = true;
        }
      }
      if (match.winSourceMatchB) {
        const src = matches.find(m => m.matchNumber === match.winSourceMatchB);
        if (src && src.status === 'completed' && src.winnerId && match.teamBId !== src.winnerId) {
          match.teamBId = src.winnerId;
          match.teamBName = src.winnerId === src.teamAId ? src.teamAName : src.teamBName;
          changed = true;
        }
      }

      // 3. Auto-resolve matches with BYEs instantly
      if (match.bracket === 'losers' && match.status === 'scheduled') {
        const aIsBye = match.teamAId === 'BYE';
        const bIsBye = match.teamBId === 'BYE';

        // If both sides are empty byes, the match resolves as a total BYE
        if (aIsBye && bIsBye) {
          match.winnerId = 'BYE';
          match.status = 'completed';
          changed = true;
        } 
        // If A is a bye, but B is a real team that arrived, B wins instantly
        else if (aIsBye && match.teamBId && !bIsBye && match.teamBName !== 'TBD') {
          match.winnerId = match.teamBId;
          match.status = 'completed';
          changed = true;
        } 
        // If B is a bye, but A is a real team that arrived, A wins instantly
        else if (bIsBye && match.teamAId && !aIsBye && match.teamAName !== 'TBD') {
          match.winnerId = match.teamAId;
          match.status = 'completed';
          changed = true;
        }
      }
    });
  }
}

// Swiss System Generator Engine
function generateSwiss(teams, rounds) {
  const numRounds = rounds || Math.ceil(Math.log2(teams.length));
  const matches = [];
  let matchNum = 1;

  // FIX 1: Use Math.ceil to properly generate an extra slot for the BYE when team count is odd
  const matchesInRound = Math.ceil(teams.length / 2);

  for (let r = 1; r <= numRounds; r++) {
    for (let i = 0; i < matchesInRound; i++) {
      matches.push({
        id: generateId('match'),
        tournamentId: null,
        round: r,
        position: matchNum,
        matchNumber: matchNum,
        teamAId: null,
        teamBId: null,
        teamAName: 'TBD',
        teamBName: 'TBD',
        status: 'scheduled',
        winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] },
        matchData: null,
        stage: 'swiss',
        isByeMatch: false // Added explicit tracking flag
      });
      matchNum++;
    }
  }

  return matches;
}

// ── Swiss Pairing Engine ─────────────────────────────────────
async function generateSwissPairings(tournamentId, round) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const standings = await recalculateStandings(tournamentId);
  if (!standings || standings.length === 0) return;

  const allMatches = await db.getMatchesByTournament(tournamentId);
  
  // Track historical played pairings map
  const playedPairs = {};
  standings.forEach(s => { playedPairs[s.teamId] = new Set(); });
  
  allMatches.filter(m => m.status === 'completed' && m.teamAId && m.teamBId).forEach(m => {
    if (playedPairs[m.teamAId]) playedPairs[m.teamAId].add(m.teamBId);
    if (playedPairs[m.teamBId]) playedPairs[m.teamBId].add(m.teamAId);
  });

  const roundMatches = tournament.schedule.filter(m => m.round === round && m.stage === 'swiss');
  if (roundMatches.length === 0) return;

  const unassigned = roundMatches.filter(m => !m.teamAId && !m.teamBId);
  if (unassigned.length === 0) return; // Round already processed

  const sortedTeams = standings.slice(); 
  const hasBye = sortedTeams.length % 2 !== 0;
  let byeTeam = null;
  let pairTeams = [...sortedTeams];

  // FIX 3: Explicitly look for the 'isByeMatch' property to check for historical byes
  if (hasBye) {
    const hadBye = new Set();
    allMatches.filter(m => m.isByeMatch && m.status === 'completed').forEach(m => {
      if (m.teamAId) hadBye.add(m.teamAId);
    });

    // Find lowest rank that hasn't had a bye yet
    for (let i = sortedTeams.length - 1; i >= 0; i--) {
      if (!hadBye.has(sortedTeams[i].teamId)) {
        byeTeam = sortedTeams[i];
        break;
      }
    }
    if (!byeTeam) {
      byeTeam = sortedTeams[sortedTeams.length - 1]; // Fallback to absolute lowest
    }
    pairTeams = sortedTeams.filter(s => s.teamId !== byeTeam.teamId);
  }

  // FIX 2: Backtracking Pathfinding Pairing Algorithm to actively minimize/prevent rematches
  let pairings = [];
  const teamIdsToPair = pairTeams.map(t => t.teamId);
  
  function backtrack(index, currentPaired, currentPairings) {
    if (index >= teamIdsToPair.length) {
      pairings = [...currentPairings];
      return true;
    }
    
    const teamAId = teamIdsToPair[index];
    if (currentPaired.has(teamAId)) {
      return backtrack(index + 1, currentPaired, currentPairings);
    }
    
    for (let j = index + 1; j < teamIdsToPair.length; j++) {
      const teamBId = teamIdsToPair[j];
      if (currentPaired.has(teamBId)) continue;
      
      // Strict constraint validation check
      const alreadyPlayed = playedPairs[teamAId] && playedPairs[teamAId].has(teamBId);
      if (!alreadyPlayed) {
        currentPaired.add(teamAId);
        currentPaired.add(teamBId);
        
        const teamAObj = pairTeams.find(t => t.teamId === teamAId);
        const teamBObj = pairTeams.find(t => t.teamId === teamBId);
        currentPairings.push({ teamA: teamAObj, teamB: teamBObj });
        
        if (backtrack(index + 1, currentPaired, currentPairings)) return true;
        
        // Backtrack undo state mutation if path hits a dead end
        currentPaired.delete(teamAId);
        currentPaired.delete(teamBId);
        currentPairings.pop();
      }
    }
    return false;
  }

  const pairedSet = new Set();
  const algorithmSuccess = backtrack(0, pairedSet, []);

  // Ultimate Emergency Fallback Rule: If the bracket is mathematically deadlocked,
  // execute standard greedy adjacent matching to ensure the code never locks up
  if (!algorithmSuccess) {
    const fallbackPaired = new Set();
    pairings = [];
    for (let i = 0; i < pairTeams.length; i++) {
      if (fallbackPaired.has(pairTeams[i].teamId)) continue;
      fallbackPaired.add(pairTeams[i].teamId);
      
      let opponent = null;
      for (let j = i + 1; j < pairTeams.length; j++) {
        if (!fallbackPaired.has(pairTeams[j].teamId)) {
          opponent = pairTeams[j];
          break;
        }
      }
      if (opponent) {
        fallbackPaired.add(opponent.teamId);
        pairings.push({ teamA: pairTeams[i], teamB: opponent });
      }
    }
  }

  // 4. MAP TO STRUCTURAL SLOTS
  let matchIdx = 0;
  pairings.forEach(pairing => {
    if (matchIdx >= roundMatches.length) return;
    const m = roundMatches[matchIdx++];
    m.teamAId = pairing.teamA.teamId;
    m.teamAName = pairing.teamA.teamName;
    m.teamBId = pairing.teamB.teamId;
    m.teamBName = pairing.teamB.teamName;
    m.isByeMatch = false;
  });

  // Assign bye to the pre-allocated final match slot seamlessly
  if (byeTeam && matchIdx < roundMatches.length) {
    const byeMatch = roundMatches[matchIdx];
    byeMatch.teamAId = byeTeam.teamId;
    byeMatch.teamAName = byeTeam.teamName;
    byeMatch.teamBId = null;
    byeMatch.teamBName = 'BYE';
    byeMatch.status = 'completed';
    byeMatch.winnerId = byeTeam.teamId;
    byeMatch.score = { setsA: 1, setsB: 0, setScores: [[25, 0]] }; // Standard volleyball default win set score
    byeMatch.isByeMatch = true;
  }

  // Save changes back to system database state
  await db.saveTournament(tournament);
  for (let i = 0; i < roundMatches.length; i++) {
    await db.saveMatch(roundMatches[i]);
  }
}

// Main schedule generator
function generateSchedule(tournament) {
  const teams = tournament.teams;
  if (teams.length < 2) return [];

  let matches;
  switch (tournament.format) {
    case 'round-robin':
      matches = generateRoundRobin(teams, tournament.roundRobinSemiMode);
      break;
    case 'single-elimination':
      matches = generateSingleElimination(teams, tournament.roundRobinSemiMode);
      break;
    case 'double-elimination':
      matches = generateDoubleElimination(teams, tournament.roundRobinSemiMode);
      break;
    case 'swiss':
      matches = generateSwiss(teams);
      break;
    default:
      matches = generateSingleElimination(teams, tournament.roundRobinSemiMode);
  }

  // Set tournamentId on all matches
  matches.forEach(m => { m.tournamentId = tournament.id; });

  return matches;
}

// ── Start Tournament ─────────────────────────────────────────
async function startTournament(tournamentId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return null;
  if (tournament.teams.length < 2) return null;

  tournament.schedule = generateSchedule(tournament);
  tournament.status = 'in-progress';

  // 1. Save base structural matches first
  await db.saveTournament(tournament);
  for (const match of tournament.schedule) {
    await db.saveMatch(match);
  }

  // 2. Initialize standings IMMEDIATELY so pairing engines have data to read
  for (const team of tournament.teams) {
    await db.saveStanding({
      id: tournament.id + ':' + team.id,
      tournamentId: tournament.id,
      teamId: team.id,
      teamName: team.name,
      color: team.color,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      setsWon: 0,
      setsLost: 0,
      pointsWon: 0,
      pointsLost: 0
    });
  }

  // 3. Now run initial Swiss pair-ups safely
  if (tournament.format === 'swiss') {
    await generateSwissPairings(tournamentId, 1);
    const pairedTournament = await db.getTournament(tournamentId);
    if (pairedTournament) {
      setActiveTournament(pairedTournament);
      return pairedTournament;
    }
  }

  setActiveTournament(tournament);
  return tournament;
}

async function syncEliminationBrackets(tournamentId, format) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  if (format === 'single-elimination') {
    advanceGeneratedByes(tournament.schedule);
  } else if (format === 'double-elimination') {
    // Double Elim MUST advance both the Winners tree AND the Losers tree
    advanceGeneratedByes(tournament.schedule); 
    advanceDoubleEliminationByes(tournament.schedule);
  }

  await db.saveTournament(tournament);
  for (const match of tournament.schedule) {
    await db.saveMatch(match);
  }
  return tournament;
}

async function syncSwissNextRounds(tournamentId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament || tournament.format !== 'swiss') return;

  const matches = tournament.schedule;
  
  // Group matches by round to evaluate round completeness
  const roundsMap = {};
  matches.forEach(m => {
    if (!roundsMap[m.round]) roundsMap[m.round] = [];
    roundsMap[m.round].push(m);
  });

  const sortedRounds = Object.keys(roundsMap).map(Number).sort((a, b) => a - b);
  
  for (const currentRound of sortedRounds) {
    const roundMatches = roundsMap[currentRound];
    const isRoundComplete = roundMatches.every(m => m.status === 'completed');

    const nextRound = currentRound + 1;
    if (isRoundComplete && roundsMap[nextRound]) {
      const nextRoundMatches = roundsMap[nextRound];
      const isNextRoundUnassigned = nextRoundMatches.every(m => !m.teamAId && !m.teamBId);

      // Trigger pairings generation for the next round instantly when the previous one finishes
      if (isNextRoundUnassigned) {
        await generateSwissPairings(tournamentId, nextRound);
      }
    }
  }

  // Auto-generate playoffs when all Swiss matches are complete
  const swissMatches = matches.filter(m => m.stage === 'swiss');
  const allSwissComplete = swissMatches.length > 0 && swissMatches.every(m => m.status === 'completed');
  const playoffsExist = matches.some(m => m.stage === 'playoffs');
  if (allSwissComplete && !playoffsExist) {
    await generateSwissPlayoffs(tournamentId, 4);
  }
}

// ── Pointing System ──────────────────────────────────────────
function calculateMatchPoints(setsWon, setsLost, tournamentSetsToWin) {
  const isBO3 = tournamentSetsToWin === 2;
  const totalSets = setsWon + setsLost;

  if (isBO3) {
    // Best of 3
    if (setsWon === 2 && setsLost === 0) return { winner: 3, loser: 0 };
    if (setsWon === 2 && setsLost === 1) return { winner: 2, loser: 1 };
    if (setsWon === 1 && setsLost === 2) return { winner: 1, loser: 2 };
    if (setsWon === 0 && setsLost === 2) return { winner: 0, loser: 3 };
  } else {
    // Best of 5
    if ((setsWon === 3 && setsLost <= 1)) return { winner: 3, loser: 0 };
    if (setsWon === 3 && setsLost === 2) return { winner: 2, loser: 1 };
    if (setsWon === 2 && setsLost === 3) return { winner: 1, loser: 2 };
    if ((setsWon <= 1 && setsLost === 3)) return { winner: 0, loser: 3 };
  }
  return { winner: 0, loser: 0 };
}

// ── Recalculate Standings ────────────────────────────────────
async function recalculateStandings(tournamentId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const matches = await db.getMatchesByTournament(tournamentId);
  const completedMatches = matches.filter(m => m.status === 'completed');

  // Reset standings
  const newStandings = {};
  for (const team of tournament.teams) {
    newStandings[team.id] = {
      id: tournamentId + ':' + team.id,
      tournamentId,
      teamId: team.id,
      teamName: team.name,
      color: team.color,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      setsWon: 0,
      setsLost: 0,
      pointsWon: 0,
      pointsLost: 0
    };
  }

  // Accumulate from completed matches
  for (const match of completedMatches) {
    const teamA = newStandings[match.teamAId];
    const teamB = newStandings[match.teamBId];
    if (!teamA || !teamB) continue;

    const setsA = match.score.setsA;
    const setsB = match.score.setsB;

    // Skip bye matches (0-0 score, no actual play) — they advance the winner
    // but should not count as a played match or award points
    const isBye = (setsA === 0 && setsB === 0 && (!match.score.setScores || match.score.setScores.length === 0));
    if (isBye) continue;

    teamA.played++;
    teamB.played++;

    if (match.winnerId === match.teamAId) {
      teamA.wins++;
      teamB.losses++;
    } else {
      teamB.wins++;
      teamA.losses++;
    }

    // Points from pointing system
    const winnerSets = match.winnerId === match.teamAId ? setsA : setsB;
    const loserSets = match.winnerId === match.teamAId ? setsB : setsA;
    const pts = calculateMatchPoints(winnerSets, loserSets, tournament.setsToWin);
    if (match.winnerId === match.teamAId) {
      teamA.points += pts.winner;
      teamB.points += pts.loser;
    } else {
      teamB.points += pts.winner;
      teamA.points += pts.loser;
    }

    // Sets
    teamA.setsWon += setsA;
    teamA.setsLost += setsB;
    teamB.setsWon += setsB;
    teamB.setsLost += setsA;

    // Points (from set scores)
    for (const setScore of (match.score.setScores || [])) {
      teamA.pointsWon += setScore.a || 0;
      teamA.pointsLost += setScore.b || 0;
      teamB.pointsWon += setScore.b || 0;
      teamB.pointsLost += setScore.a || 0;
    }
  }

  // Save all standings
  for (const teamId of Object.keys(newStandings)) {
    await db.saveStanding(newStandings[teamId]);
  }

  return Object.values(newStandings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aSR = a.setsLost ? a.setsWon / a.setsLost : a.setsWon;
    const bSR = b.setsLost ? b.setsWon / b.setsLost : b.setsWon;
    if (bSR !== aSR) return bSR - aSR;
    const aPR = a.pointsLost ? a.pointsWon / a.pointsLost : a.pointsWon;
    const bPR = b.pointsLost ? b.pointsWon / b.pointsLost : b.pointsWon;
    return bPR - aPR;
  });
}

// ── Generate Swiss Playoffs (Top N Cut) ──────────────────────
async function generateSwissPlayoffs(tournamentId, cutSize = 4) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament || tournament.format !== 'swiss') return null;

  // 1. Safety Check: Ensure all Swiss matches are finished
  const incomplete = tournament.schedule.filter(m => m.status !== 'completed');
  if (incomplete.length > 0) {
    console.warn("Cannot cut to playoffs: There are still unfinished matches.");
    return null; // Your UI can show an error toast here
  }

  // 2. Lock in final standings
  const standings = await recalculateStandings(tournamentId);
  if (standings.length < cutSize) cutSize = standings.length;

  // 3. Extract the Top Teams and assign them absolute seeds based on their rank
  const topTeams = standings.slice(0, cutSize).map((standing, index) => {
    // We fetch the original team object so we don't lose colors/players
    const teamObj = tournament.teams.find(t => t.id === standing.teamId);
    return {
      ...teamObj,
      seed: index + 1 // Rank 1 becomes Seed 1, Rank 2 becomes Seed 2, etc.
    };
  });

  // 4. Find the endpoints of the current Swiss schedule
  // We need to know where to start counting the new playoff rounds and match numbers
  const lastMatchNum = tournament.schedule.reduce((max, m) => m.matchNumber > max ? m.matchNumber : max, 0);
  const lastRoundNum = tournament.schedule.reduce((max, m) => m.round > max ? m.round : max, 0);

  // 5. Generate the raw Playoff Bracket using our existing bulletproof script
  const rawPlayoffMatches = generateSingleElimination(topTeams, tournament.roundRobinSemiMode);

  // 6. The Offset Math: Seamlessly stitch the bracket to the end of the schedule
  rawPlayoffMatches.forEach(m => {
    m.stage = 'playoffs'; // Tag it so your UI can render a "Playoffs" header
    
    // Shift the rounds and match numbers forward
    m.round += lastRoundNum;
    m.position += lastMatchNum;
    m.matchNumber += lastMatchNum;
    
    // Shift the parent pointer links so the bracket connections don't break
    if (m.sourceMatchA) m.sourceMatchA += lastMatchNum;
    if (m.sourceMatchB) m.sourceMatchB += lastMatchNum;
  });

  // 7. Save and update state
  tournament.schedule.push(...rawPlayoffMatches);
  await db.saveTournament(tournament);

  for (const match of rawPlayoffMatches) {
    await db.saveMatch(match);
  }

  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(tournament);
  }

  return tournament;
}

// ── Complete Match ───────────────────────────────────────────
async function syncRoundRobinPlayoffs(tournamentId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament || tournament.format !== 'round-robin') return tournament;
  const semis = (tournament.schedule || []).filter(function(m) { return m.stage === 'semifinal'; }).sort(function(a, b) { return a.position - b.position; });
  const finalMatch = (tournament.schedule || []).find(function(m) { return m.stage === 'final'; });
  if (semis.length === 0) return tournament;

  const poolMatches = tournament.schedule.filter(function(m) { return (m.stage || 'round-robin') === 'round-robin'; });
  const poolComplete = poolMatches.length > 0 && poolMatches.every(function(m) { return m.status === 'completed'; });
  if (poolComplete) {
    const standings = await recalculateStandings(tournamentId);
    semis.forEach(function(match) {
      [['A', match.seedA], ['B', match.seedB]].forEach(function(side) {
        const seeded = standings[side[1] - 1];
        if (!seeded) return;
        if (side[0] === 'A' && !match.teamAId) {
          match.teamAId = seeded.teamId;
          match.teamAName = seeded.teamName;
        }
        if (side[0] === 'B' && !match.teamBId) {
          match.teamBId = seeded.teamId;
          match.teamBName = seeded.teamName;
        }
      });
    });
  }

  if (finalMatch) {
    semis.forEach(function(match, idx) {
      if (match.status !== 'completed' || !match.winnerId) return;
      const winnerName = getMatchTeamName(match, match.winnerId);
      if (idx === 0 && !finalMatch.teamAId) {
        finalMatch.teamAId = match.winnerId;
        finalMatch.teamAName = winnerName;
      }
      if (idx === 1 && !finalMatch.teamBId) {
        finalMatch.teamBId = match.winnerId;
        finalMatch.teamBName = winnerName;
      }
    });
  }

  await db.saveTournament(tournament);
  for (const match of semis) await db.saveMatch(match);
  if (finalMatch) await db.saveMatch(finalMatch);
  if (activeTournament && activeTournament.id === tournamentId) setActiveTournament(tournament);
  return tournament;
}

async function syncFinalsSeries(tournamentId, matchId) {
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;
  const match = tournament.schedule.find(m => m.id === matchId);
  if (!match || !match.finalsParentId) return;
  const gamesToWin = match.finalsGamesToWin || 1;
  if (gamesToWin <= 1) return;
  const parentId = match.finalsParentId;
  const seriesGames = tournament.schedule.filter(m => m.finalsParentId === parentId || m.id === parentId);
  const completedGames = seriesGames.filter(m => m.status === 'completed');
  var winsA = 0, winsB = 0;
  completedGames.forEach(function(g) {
    if (g.winnerId === g.teamAId) winsA++;
    else if (g.winnerId === g.teamBId) winsB++;
  });
  if (winsA >= gamesToWin || winsB >= gamesToWin) {
    seriesGames.forEach(function(g) {
      if (g.status !== 'completed') {
        g.status = 'completed';
        g.winnerId = winsA >= gamesToWin ? g.teamAId : g.teamBId;
        g.score = { setsA: 0, setsB: 0, setScores: [] };
        db.saveMatch(g);
      }
    });
    await db.saveTournament(tournament);
  }
}

async function completeTournamentMatch(tournamentId, matchId, matchResult) {
  // matchResult = { winnerId, score: { setsA, setsB, setScores }, matchData }
  const tournament = await db.getTournament(tournamentId);
  if (!tournament) return;

  const matchIndex = tournament.schedule.findIndex(m => m.id === matchId);
  if (matchIndex === -1) return;

  const match = tournament.schedule[matchIndex];
  match.status = 'completed';
  match.winnerId = matchResult.winnerId;
  match.score = matchResult.score;
  match.matchData = matchResult.matchData;

  // Update team names from tournament teams
  const teamA = tournament.teams.find(t => t.id === match.teamAId);
  const teamB = tournament.teams.find(t => t.id === match.teamBId);
  if (teamA) match.teamAName = teamA.name;
  if (teamB) match.teamBName = teamB.name;

  await db.saveTournament(tournament);
  await db.saveMatch(match);

  // Recalculate standings
  await recalculateStandings(tournamentId);
  let finishedTournamentState = tournament;
  if (tournament.format === 'round-robin') {
    finishedTournamentState = await syncRoundRobinPlayoffs(tournamentId);
  } else if (tournament.format === 'single-elimination' || tournament.format === 'double-elimination') {
    finishedTournamentState = await syncEliminationBrackets(tournamentId, tournament.format);
  } else if (tournament.format === 'swiss') {
    await syncSwissNextRounds(tournamentId);
    finishedTournamentState = await db.getTournament(tournamentId);
  }

  // Sync finals series — check if a finals game just completed and whether the series is decided
  await syncFinalsSeries(tournamentId, matchId);

  // Update application state
  if (activeTournament && activeTournament.id === tournamentId) {
    setActiveTournament(finishedTournamentState || tournament);
  }
}

// ── Load Tournament ──────────────────────────────────────────
async function loadTournamentFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        const tournament = await db.importTournament(json);
        setActiveTournament(tournament);
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
async function exportTournamentToFile(tournamentId) {
  const data = await db.exportTournament(tournamentId);
  if (!data) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `volleyref-tournament-${data.tournament.name.replace(/\s+/g, '-')}-${stamp}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Auto-save tournament (called on every config change) ─────
async function autoSaveTournament() {
  if (!activeTournament) return;
  activeTournament.lastSavedAt = new Date().toISOString();
  await db.saveTournament(activeTournament);
  persistTournamentLocal(activeTournament);
}
