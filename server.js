// ===================== AQUILA LOCAL SERVER =====================
// Run with: node server.js
// All committee devices connect to this via local WiFi.
// No internet required — works entirely on your local network.
//
// This server is the SINGLE SOURCE OF TRUTH for all tournament data.
// All tournament mutations (create, add team, start, complete match, etc.)
// happen here. Clients send requests via WebSocket and receive back the
// updated state. The full state is persisted to aquila-session.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const PORT = 3000;
const SESSION_FILE = path.join(__dirname, 'aquila-session.json');

// ── MIME types for serving static files ───────────────────────
const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

// ── Shared state (all devices share this) ─────────────────────
// This is the single source of truth for the whole system.
let serverState = {
  tournament: null,
  liveMatch: null,
  currentTournamentMatch: null,
  lastUpdated: null
};

function getFreshServerState() {
  return {
    tournament: null,
    liveMatch: null,
    currentTournamentMatch: null,
    lastUpdated: null
  };
}

function normalizeServerState(value) {
  return Object.assign(getFreshServerState(), value || {});
}

function saveServerState(reason) {
  serverState.lastUpdated = Date.now();
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(serverState, null, 2));
    return true;
  } catch(e) {
    console.log('Warning: Could not save session file' + (reason ? ' after ' + reason : '') + ': ' + e.message);
    return false;
  }
}

// ── Pointing System ───────────────────────────────────────────
function calculateMatchPoints(setsWon, setsLost, setsToWin) {
  const bestOfThree = setsToWin === 2;
  if (bestOfThree) {
    if (setsWon === 2 && setsLost === 0) return { winner: 3, loser: 0 };
    if (setsWon === 2 && setsLost === 1) return { winner: 2, loser: 1 };
    if (setsWon === 1 && setsLost === 2) return { winner: 1, loser: 2 };
    if (setsWon === 0 && setsLost === 2) return { winner: 0, loser: 3 };
  } else {
    if (setsWon === 3 && setsLost <= 1) return { winner: 3, loser: 0 };
    if (setsWon === 3 && setsLost === 2) return { winner: 2, loser: 1 };
    if (setsWon === 2 && setsLost === 3) return { winner: 1, loser: 2 };
    if (setsWon <= 1 && setsLost === 3) return { winner: 0, loser: 3 };
  }
  return { winner: 0, loser: 0 };
}

// ── Standings Calculation ─────────────────────────────────────
function recalculateServerStandings(tournament) {
  const standings = {};
  (tournament.teams || []).forEach(function(team) {
    standings[team.id] = {
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
    };
  });

  (tournament.schedule || []).forEach(function(match) {
    if (match.status !== 'completed' || !match.score) return;
    const teamA = standings[match.teamAId];
    const teamB = standings[match.teamBId];
    if (!teamA || !teamB) return;

    const setsA = Number(match.score.setsA) || 0;
    const setsB = Number(match.score.setsB) || 0;
    const setScores = match.score.setScores || [];
    if (setsA === 0 && setsB === 0 && setScores.length === 0) return;

    teamA.played++;
    teamB.played++;

    if (match.winnerId === match.teamAId) {
      teamA.wins++;
      teamB.losses++;
    } else {
      teamB.wins++;
      teamA.losses++;
    }

    const winnerSets = match.winnerId === match.teamAId ? setsA : setsB;
    const loserSets = match.winnerId === match.teamAId ? setsB : setsA;
    const points = calculateMatchPoints(winnerSets, loserSets, tournament.setsToWin);
    if (match.winnerId === match.teamAId) {
      teamA.points += points.winner;
      teamB.points += points.loser;
    } else {
      teamB.points += points.winner;
      teamA.points += points.loser;
    }

    teamA.setsWon += setsA;
    teamA.setsLost += setsB;
    teamB.setsWon += setsB;
    teamB.setsLost += setsA;

    setScores.forEach(function(setScore) {
      teamA.pointsWon += setScore.a || 0;
      teamA.pointsLost += setScore.b || 0;
      teamB.pointsWon += setScore.b || 0;
      teamB.pointsLost += setScore.a || 0;
    });
  });

  return Object.values(standings).sort(function(a, b) {
    if (b.points !== a.points) return b.points - a.points;
    const aSetRatio = a.setsLost ? a.setsWon / a.setsLost : a.setsWon;
    const bSetRatio = b.setsLost ? b.setsWon / b.setsLost : b.setsWon;
    if (bSetRatio !== aSetRatio) return bSetRatio - aSetRatio;
    const aPointRatio = a.pointsLost ? a.pointsWon / a.pointsLost : a.pointsWon;
    const bPointRatio = b.pointsLost ? b.pointsWon / b.pointsLost : b.pointsWon;
    return bPointRatio - aPointRatio;
  });
}

// ── ID Generator ──────────────────────────────────────────────
function generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ── Schedule Generation (ported from tournament.js) ──────────

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

function advanceDoubleEliminationByes(matches) {
  let changed = true;
  while (changed) {
    changed = false;
    matches.forEach(match => {
      if (match.status === 'completed') return;
      if (match.lossSourceMatchA) {
        const src = matches.find(m => m.matchNumber === match.lossSourceMatchA);
        if (src && src.status === 'completed') {
          const loserId = src.winnerId === src.teamAId ? src.teamBId : src.teamAId;
          const loserName = src.winnerId === src.teamAId ? src.teamBName : src.teamAName;
          if (!loserId) {
            if (match.teamAId !== 'BYE') { match.teamAId = 'BYE'; match.teamAName = 'BYE'; changed = true; }
          } else if (match.teamAId !== loserId) {
            match.teamAId = loserId; match.teamAName = loserName; changed = true;
          }
        }
      }
      if (match.lossSourceMatchB) {
        const src = matches.find(m => m.matchNumber === match.lossSourceMatchB);
        if (src && src.status === 'completed') {
          const loserId = src.winnerId === src.teamAId ? src.teamBId : src.teamAId;
          const loserName = src.winnerId === src.teamAId ? src.teamBName : src.teamAName;
          if (!loserId) {
            if (match.teamBId !== 'BYE') { match.teamBId = 'BYE'; match.teamBName = 'BYE'; changed = true; }
          } else if (match.teamBId !== loserId) {
            match.teamBId = loserId; match.teamBName = loserName; changed = true;
          }
        }
      }
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
      if (match.bracket === 'losers' && match.status === 'scheduled') {
        const aIsBye = match.teamAId === 'BYE';
        const bIsBye = match.teamBId === 'BYE';
        if (aIsBye && bIsBye) {
          match.winnerId = 'BYE'; match.status = 'completed'; changed = true;
        } else if (aIsBye && match.teamBId && !bIsBye && match.teamBName !== 'TBD') {
          match.winnerId = match.teamBId; match.status = 'completed'; changed = true;
        } else if (bIsBye && match.teamAId && !aIsBye && match.teamAName !== 'TBD') {
          match.winnerId = match.teamAId; match.status = 'completed'; changed = true;
        }
      }
    });
  }
}

function generateRoundRobin(teams, semiMode) {
  const matches = [];
  let matchNum = 1;
  const list = [...teams];
  const isOdd = list.length % 2 !== 0;
  if (isOdd) list.push({ id: 'BYE', name: 'BYE' });
  const numTeams = list.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;
  for (let round = 1; round <= numRounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const teamA = list[i];
      const teamB = list[numTeams - 1 - i];
      if (teamA.id === 'BYE' || teamB.id === 'BYE') continue;
      matches.push({
        id: generateId('match'), tournamentId: null, round: round, position: matchNum, matchNumber: matchNum,
        teamAId: teamA.id, teamBId: teamB.id, teamAName: teamA.name, teamBName: teamB.name,
        status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'round-robin'
      });
      matchNum++;
    }
    list.splice(1, 0, list.pop());
  }
  const rrEndRound = isOdd ? numTeams : numTeams - 1;
  const realTeamsCount = teams.length;
  if (realTeamsCount >= 4) {
    semiMode = semiMode || '1v4-2v3';
    const pairs = semiMode === '1v3-2v4' ? [[1, 3], [2, 4]] : [[1, 4], [2, 3]];
    const sfMatchNumbers = [];
    pairs.forEach(function(pair) {
      const currentSfNum = matchNum;
      sfMatchNumbers.push(currentSfNum);
      matches.push({
        id: generateId('match'), tournamentId: null, round: rrEndRound + 1, position: matchNum, matchNumber: matchNum,
        teamAId: null, teamBId: null, teamAName: 'Rank ' + pair[0], teamBName: 'Rank ' + pair[1],
        seedA: pair[0], seedB: pair[1], status: 'scheduled', winnerId: null,
        score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'semifinal'
      });
      matchNum++;
    });
    matches.push({
      id: generateId('match'), tournamentId: null, round: rrEndRound + 2, position: matchNum, matchNumber: matchNum,
      teamAId: null, teamBId: null, teamAName: 'Winner SF1', teamBName: 'Winner SF2',
      sourceMatchA: sfMatchNumbers[0], sourceMatchB: sfMatchNumbers[1],
      status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'final'
    });
  }
  return matches;
}

function generateSingleElimination(teams, semiMode) {
  const n = teams.length;
  if (n === 0) return [];
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(n)));
  const slots = new Array(nextPow2).fill(null);
  let seedOrder;
  if (nextPow2 === 4 && semiMode) {
    seedOrder = semiMode === '1v3-2v4' ? [1, 3, 2, 4] : [1, 4, 2, 3];
  } else {
    seedOrder = generateSeedOrder(nextPow2);
  }
  teams.forEach(function(team, idx) {
    const teamSeed = team.seed || (idx + 1);
    const slotIndex = seedOrder.indexOf(teamSeed);
    if (slotIndex >= 0) slots[slotIndex] = { type: 'team', team: team };
  });
  const matches = [];
  let matchNum = 1;
  let round = 1;
  const firstRoundMatchesCount = nextPow2 / 2;
  const round1MatchesMap = [];
  for (let i = 0; i < slots.length; i += 2) {
    const slotA = slots[i];
    const slotB = slots[i + 1];
    const match = {
      id: generateId('match'), tournamentId: null, round: round, position: matchNum, matchNumber: matchNum,
      sourceMatchA: null, sourceMatchB: null,
      teamAId: slotA && slotA.team ? slotA.team.id : null,
      teamBId: slotB && slotB.team ? slotB.team.id : null,
      teamAName: slotA && slotA.team ? slotA.team.name : 'TBD',
      teamBName: slotB && slotB.team ? slotB.team.name : 'TBD',
      status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'single-elimination'
    };
    if (slotA && slotA.team && (!slotB || !slotB.team)) { match.winnerId = slotA.team.id; match.status = 'completed'; }
    else if (slotB && slotB.team && (!slotA || !slotA.team)) { match.winnerId = slotB.team.id; match.status = 'completed'; }
    matches.push(match);
    round1MatchesMap.push(match);
    matchNum++;
  }
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
        id: generateId('match'), tournamentId: null, round: round, position: matchNum, matchNumber: matchNum,
        sourceMatchA: sourceMatchA ? sourceMatchA.matchNumber : null,
        sourceMatchB: sourceMatchB ? sourceMatchB.matchNumber : null,
        teamAId: null, teamBId: null, teamAName: 'TBD', teamBName: 'TBD',
        status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'single-elimination'
      };
      matches.push(match);
      currentRoundMatches.push(match);
      matchNum++;
    }
    previousRoundMatches = currentRoundMatches;
  }
  advanceGeneratedByes(matches);
  return matches;
}

function generateDoubleElimination(teams, semiMode) {
  const wbMatches = generateSingleElimination(teams, semiMode);
  wbMatches.forEach(function(m) { m.bracket = 'winners'; });
  const matches = [...wbMatches];
  const wbRoundsCount = Math.max(...wbMatches.map(m => m.round));
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(teams.length)));
  let matchNum = matches.length + 1;
  const lbMatchesByRound = {};
  const wbMatchesByRound = {};
  for (let r = 1; r <= wbRoundsCount; r++) {
    wbMatchesByRound[r] = wbMatches.filter(m => m.round === r).sort((a, b) => a.position - b.position);
  }
  const totalLbRounds = (2 * wbRoundsCount) - 2;
  let currentLbSize = nextPow2 / 4;
  for (let lr = 1; lr <= totalLbRounds; lr++) {
    lbMatchesByRound[lr] = [];
    for (let i = 0; i < currentLbSize; i++) {
      const match = {
        id: generateId('match'), tournamentId: null, round: lr, position: matchNum, matchNumber: matchNum,
        teamAId: null, teamBId: null, teamAName: 'TBD', teamBName: 'TBD',
        status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null,
        bracket: 'losers', winSourceMatchA: null, winSourceMatchB: null, lossSourceMatchA: null, lossSourceMatchB: null
      };
      matches.push(match);
      lbMatchesByRound[lr].push(match);
      matchNum++;
    }
    if (lr % 2 === 1) { currentLbSize = currentLbSize; }
    else { currentLbSize = Math.floor(currentLbSize / 2); }
  }
  for (let lr = 1; lr <= totalLbRounds; lr++) {
    const lrMatches = lbMatchesByRound[lr];
    if (lr === 1) {
      const wr1Matches = wbMatchesByRound[1] || [];
      lrMatches.forEach((m, idx) => {
        const srcA = wr1Matches[idx * 2];
        const srcB = wr1Matches[idx * 2 + 1];
        if (srcA) m.lossSourceMatchA = srcA.matchNumber;
        if (srcB) m.lossSourceMatchB = srcB.matchNumber;
      });
    } else if (lr % 2 === 0) {
      const targetWbRound = (lr / 2) + 1;
      const wbDropMatches = wbMatchesByRound[targetWbRound] || [];
      const reversedWbDrop = [...wbDropMatches].reverse();
      lrMatches.forEach((m, idx) => {
        const wbSrc = reversedWbDrop[idx];
        if (wbSrc) m.lossSourceMatchB = wbSrc.matchNumber;
        const prevLbMatch = lbMatchesByRound[lr - 1][idx];
        if (prevLbMatch) m.winSourceMatchA = prevLbMatch.matchNumber;
      });
    } else {
      lrMatches.forEach((m, idx) => {
        const prevLbA = lbMatchesByRound[lr - 1][idx * 2];
        const prevLbB = lbMatchesByRound[lr - 1][idx * 2 + 1];
        if (prevLbA) m.winSourceMatchA = prevLbA.matchNumber;
        if (prevLbB) m.winSourceMatchB = prevLbB.matchNumber;
      });
    }
  }
  const wbFinalMatch = wbMatchesByRound[wbRoundsCount][0];
  const lbFinalMatch = lbMatchesByRound[totalLbRounds][0];
  matches.push({
    id: generateId('match'), tournamentId: null, round: wbRoundsCount + 1, position: matchNum, matchNumber: matchNum,
    teamAId: null, teamBId: null, teamAName: 'WB Winner', teamBName: 'LB Winner',
    winSourceMatchA: wbFinalMatch ? wbFinalMatch.matchNumber : null,
    winSourceMatchB: lbFinalMatch ? lbFinalMatch.matchNumber : null,
    status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, bracket: 'final'
  });
  matchNum++;
  matches.push({
    id: generateId('match'), tournamentId: null, round: wbRoundsCount + 2, position: matchNum, matchNumber: matchNum,
    teamAId: null, teamBId: null, teamAName: 'WB Winner (If Loss)', teamBName: 'LB Winner (If Win)',
    status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, bracket: 'final-reset', isOptional: true
  });
  advanceDoubleEliminationByes(matches);
  return matches;
}

function generateSwiss(teams, rounds) {
  const numRounds = rounds || Math.ceil(Math.log2(teams.length));
  const matches = [];
  let matchNum = 1;
  const matchesInRound = Math.ceil(teams.length / 2);
  for (let r = 1; r <= numRounds; r++) {
    for (let i = 0; i < matchesInRound; i++) {
      matches.push({
        id: generateId('match'), tournamentId: null, round: r, position: matchNum, matchNumber: matchNum,
        teamAId: null, teamBId: null, teamAName: 'TBD', teamBName: 'TBD',
        status: 'scheduled', winnerId: null, score: { setsA: 0, setsB: 0, setScores: [] }, matchData: null, stage: 'swiss', isByeMatch: false
      });
      matchNum++;
    }
  }
  return matches;
}

function generateSchedule(tournament) {
  const teams = tournament.teams;
  if (teams.length < 2) return [];
  let matches;
  switch (tournament.format) {
    case 'round-robin': matches = generateRoundRobin(teams, tournament.roundRobinSemiMode); break;
    case 'single-elimination': matches = generateSingleElimination(teams, tournament.roundRobinSemiMode); break;
    case 'double-elimination': matches = generateDoubleElimination(teams, tournament.roundRobinSemiMode); break;
    case 'swiss': matches = generateSwiss(teams); break;
    default: matches = generateSingleElimination(teams, tournament.roundRobinSemiMode);
  }
  matches.forEach(m => { m.tournamentId = tournament.id; });
  return matches;
}

// ── Swiss Pairing Engine ──────────────────────────────────────
function generateSwissPairings(tournament, round) {
  const standings = recalculateServerStandings(tournament);
  if (!standings || standings.length === 0) return;
  const allMatches = tournament.schedule || [];
  const playedPairs = {};
  standings.forEach(s => { playedPairs[s.teamId] = new Set(); });
  allMatches.filter(m => m.status === 'completed' && m.teamAId && m.teamBId).forEach(m => {
    if (playedPairs[m.teamAId]) playedPairs[m.teamAId].add(m.teamBId);
    if (playedPairs[m.teamBId]) playedPairs[m.teamBId].add(m.teamAId);
  });
  const roundMatches = tournament.schedule.filter(m => m.round === round && m.stage === 'swiss');
  if (roundMatches.length === 0) return;
  const unassigned = roundMatches.filter(m => !m.teamAId && !m.teamBId);
  if (unassigned.length === 0) return;
  const sortedTeams = standings.slice();
  const hasBye = sortedTeams.length % 2 !== 0;
  let byeTeam = null;
  let pairTeams = [...sortedTeams];
  if (hasBye) {
    const hadBye = new Set();
    allMatches.filter(m => m.isByeMatch && m.status === 'completed').forEach(m => { if (m.teamAId) hadBye.add(m.teamAId); });
    for (let i = sortedTeams.length - 1; i >= 0; i--) {
      if (!hadBye.has(sortedTeams[i].teamId)) { byeTeam = sortedTeams[i]; break; }
    }
    if (!byeTeam) byeTeam = sortedTeams[sortedTeams.length - 1];
    pairTeams = sortedTeams.filter(s => s.teamId !== byeTeam.teamId);
  }
  let pairings = [];
  const teamIdsToPair = pairTeams.map(t => t.teamId);
  function backtrack(index, currentPaired, currentPairings) {
    if (index >= teamIdsToPair.length) { pairings = [...currentPairings]; return true; }
    const teamAId = teamIdsToPair[index];
    if (currentPaired.has(teamAId)) return backtrack(index + 1, currentPaired, currentPairings);
    for (let j = index + 1; j < teamIdsToPair.length; j++) {
      const teamBId = teamIdsToPair[j];
      if (currentPaired.has(teamBId)) continue;
      const alreadyPlayed = playedPairs[teamAId] && playedPairs[teamAId].has(teamBId);
      if (!alreadyPlayed) {
        currentPaired.add(teamAId); currentPaired.add(teamBId);
        const teamAObj = pairTeams.find(t => t.teamId === teamAId);
        const teamBObj = pairTeams.find(t => t.teamId === teamBId);
        currentPairings.push({ teamA: teamAObj, teamB: teamBObj });
        if (backtrack(index + 1, currentPaired, currentPairings)) return true;
        currentPaired.delete(teamAId); currentPaired.delete(teamBId);
        currentPairings.pop();
      }
    }
    return false;
  }
  const pairedSet = new Set();
  const algorithmSuccess = backtrack(0, pairedSet, []);
  if (!algorithmSuccess) {
    const fallbackPaired = new Set();
    pairings = [];
    for (let i = 0; i < pairTeams.length; i++) {
      if (fallbackPaired.has(pairTeams[i].teamId)) continue;
      fallbackPaired.add(pairTeams[i].teamId);
      let opponent = null;
      for (let j = i + 1; j < pairTeams.length; j++) {
        if (!fallbackPaired.has(pairTeams[j].teamId)) { opponent = pairTeams[j]; break; }
      }
      if (opponent) { fallbackPaired.add(opponent.teamId); pairings.push({ teamA: pairTeams[i], teamB: opponent }); }
    }
  }
  let matchIdx = 0;
  pairings.forEach(pairing => {
    if (matchIdx >= roundMatches.length) return;
    const m = roundMatches[matchIdx++];
    m.teamAId = pairing.teamA.teamId; m.teamAName = pairing.teamA.teamName;
    m.teamBId = pairing.teamB.teamId; m.teamBName = pairing.teamB.teamName;
    m.isByeMatch = false;
  });
  if (byeTeam && matchIdx < roundMatches.length) {
    const byeMatch = roundMatches[matchIdx];
    byeMatch.teamAId = byeTeam.teamId; byeMatch.teamAName = byeTeam.teamName;
    byeMatch.teamBId = null; byeMatch.teamBName = 'BYE';
    byeMatch.status = 'completed'; byeMatch.winnerId = byeTeam.teamId;
    byeMatch.score = { setsA: 1, setsB: 0, setScores: [[25, 0]] }; byeMatch.isByeMatch = true;
  }
}

// ── Elimination Bracket Sync ──────────────────────────────────
function syncEliminationBrackets(tournament, format) {
  if (format === 'single-elimination') {
    advanceGeneratedByes(tournament.schedule);
  } else if (format === 'double-elimination') {
    advanceGeneratedByes(tournament.schedule);
    advanceDoubleEliminationByes(tournament.schedule);
  }
}

// ── Swiss Next Rounds Sync ────────────────────────────────────
function syncSwissNextRounds(tournament) {
  if (tournament.format !== 'swiss') return;
  const matches = tournament.schedule;
  const roundsMap = {};
  matches.forEach(m => { if (!roundsMap[m.round]) roundsMap[m.round] = []; roundsMap[m.round].push(m); });
  const sortedRounds = Object.keys(roundsMap).map(Number).sort((a, b) => a - b);
  for (const currentRound of sortedRounds) {
    const roundMatches = roundsMap[currentRound];
    const isRoundComplete = roundMatches.every(m => m.status === 'completed');
    const nextRound = currentRound + 1;
    if (isRoundComplete && roundsMap[nextRound]) {
      const nextRoundMatches = roundsMap[nextRound];
      const isNextRoundUnassigned = nextRoundMatches.every(m => !m.teamAId && !m.teamBId);
      if (isNextRoundUnassigned) generateSwissPairings(tournament, nextRound);
    }
  }
  const swissMatches = matches.filter(m => m.stage === 'swiss');
  const allSwissComplete = swissMatches.length > 0 && swissMatches.every(m => m.status === 'completed');
  const playoffsExist = matches.some(m => m.stage === 'playoffs');
  if (allSwissComplete && !playoffsExist) {
    generateSwissPlayoffs(tournament, 4);
  }
}

// ── Swiss Playoffs ────────────────────────────────────────────
function generateSwissPlayoffs(tournament, cutSize) {
  if (tournament.format !== 'swiss') return;
  const incomplete = tournament.schedule.filter(m => m.status !== 'completed');
  if (incomplete.length > 0) return;
  const standings = recalculateServerStandings(tournament);
  if (standings.length < cutSize) cutSize = standings.length;
  const topTeams = standings.slice(0, cutSize).map((standing, index) => {
    const teamObj = tournament.teams.find(t => t.id === standing.teamId);
    return { ...teamObj, seed: index + 1 };
  });
  const lastMatchNum = tournament.schedule.reduce((max, m) => m.matchNumber > max ? m.matchNumber : max, 0);
  const lastRoundNum = tournament.schedule.reduce((max, m) => m.round > max ? m.round : max, 0);
  const rawPlayoffMatches = generateSingleElimination(topTeams, tournament.roundRobinSemiMode);
  rawPlayoffMatches.forEach(m => {
    m.stage = 'playoffs';
    m.round += lastRoundNum; m.position += lastMatchNum; m.matchNumber += lastMatchNum;
    if (m.sourceMatchA) m.sourceMatchA += lastMatchNum;
    if (m.sourceMatchB) m.sourceMatchB += lastMatchNum;
  });
  tournament.schedule.push(...rawPlayoffMatches);
}

// ── Round Robin Playoffs Sync ─────────────────────────────────
function syncRoundRobinPlayoffs(tournament) {
  if (tournament.format !== 'round-robin') return;
  const semis = (tournament.schedule || []).filter(m => m.stage === 'semifinal').sort((a, b) => a.position - b.position);
  const finalMatch = (tournament.schedule || []).find(m => m.stage === 'final');
  if (semis.length === 0) return;
  const poolMatches = tournament.schedule.filter(m => (m.stage || 'round-robin') === 'round-robin');
  const poolComplete = poolMatches.length > 0 && poolMatches.every(m => m.status === 'completed');
  if (poolComplete) {
    const standings = recalculateServerStandings(tournament);
    semis.forEach(function(match) {
      [['A', match.seedA], ['B', match.seedB]].forEach(function(side) {
        const seeded = standings[side[1] - 1];
        if (!seeded) return;
        if (side[0] === 'A' && !match.teamAId) { match.teamAId = seeded.teamId; match.teamAName = seeded.teamName; }
        if (side[0] === 'B' && !match.teamBId) { match.teamBId = seeded.teamId; match.teamBName = seeded.teamName; }
      });
    });
  }
  if (finalMatch) {
    semis.forEach(function(match, idx) {
      if (match.status !== 'completed' || !match.winnerId) return;
      const winnerName = getMatchTeamName(match, match.winnerId);
      if (idx === 0 && !finalMatch.teamAId) { finalMatch.teamAId = match.winnerId; finalMatch.teamAName = winnerName; }
      if (idx === 1 && !finalMatch.teamBId) { finalMatch.teamBId = match.winnerId; finalMatch.teamBName = winnerName; }
    });
  }
}

// ── Finals Series Sync ────────────────────────────────────────
function syncFinalsSeries(tournament, matchId) {
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
      }
    });
  }
}

// ── Complete Match (server-side) ──────────────────────────────
function completeServerTournamentMatch(payload) {
  const tournament = serverState.tournament;
  const context = payload.currentTournamentMatch || serverState.currentTournamentMatch;
  const result = payload.matchResult;
  if (!tournament || !context || !result) return false;

  const match = (tournament.schedule || []).find(function(m) { return m.id === context.matchId; });
  if (!match) return false;

  let winnerId = result.winnerId;
  if (!winnerId && result.winnerCode === 'A') winnerId = match.teamAId;
  if (!winnerId && result.winnerCode === 'B') winnerId = match.teamBId;
  if (!winnerId) return false;

  match.status = 'completed';
  match.winnerId = winnerId;
  match.score = result.score || { setsA: 0, setsB: 0, setScores: [] };
  match.matchData = result.matchData || null;

  const teamA = (tournament.teams || []).find(function(team) { return team.id === match.teamAId; });
  const teamB = (tournament.teams || []).find(function(team) { return team.id === match.teamBId; });
  if (teamA) match.teamAName = teamA.name;
  if (teamB) match.teamBName = teamB.name;

  // Recalculate standings
  tournament.standings = recalculateServerStandings(tournament);

  // Format-specific sync
  if (tournament.format === 'round-robin') {
    syncRoundRobinPlayoffs(tournament);
  } else if (tournament.format === 'single-elimination' || tournament.format === 'double-elimination') {
    syncEliminationBrackets(tournament, tournament.format);
  } else if (tournament.format === 'swiss') {
    syncSwissNextRounds(tournament);
  }

  // Sync finals series
  syncFinalsSeries(tournament, match.id);

  // Recalculate standings again after bracket sync (in case byes advanced)
  tournament.standings = recalculateServerStandings(tournament);

  serverState.tournament = tournament;
  return true;
}

// ── Load saved session from previous day if it exists ─────────
if (fs.existsSync(SESSION_FILE)) {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    serverState = normalizeServerState(JSON.parse(raw));
    console.log('');
    console.log('✓ Previous session loaded.');
    if (serverState.tournament) {
      console.log('  Tournament: ' + serverState.tournament.name);
      console.log('  Status:     ' + serverState.tournament.status);
      const schedule = serverState.tournament.schedule || [];
      const done = schedule.filter(function(m) { return m.status === 'completed'; }).length;
      console.log('  Matches:    ' + done + ' of ' + schedule.length + ' completed');
    }
  } catch(e) {
    console.log('Session file found but could not be read. Starting fresh.');
    serverState = getFreshServerState();
  }
} else {
  console.log('No previous session found. Starting fresh.');
  saveServerState('startup');
}

// ── HTTP server — serves your Aquila files to all devices ──────
const httpServer = http.createServer(function(req, res) {
  if (req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(serverState));
    return;
  }
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aquila OK');
    return;
  }
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, urlPath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function(err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('File not found: ' + urlPath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WebSocket server — real-time sync between devices ─────────
const wss = new WebSocket.Server({ port: 3001 });
const connectedClients = new Set();

wss.on('connection', function(ws, req) {
  connectedClients.add(ws);
  const clientIp = req.socket.remoteAddress;
  console.log('Device connected: ' + clientIp + ' | Total devices: ' + connectedClients.size);

  // Immediately send full current state to the newly connected device
  ws.send(JSON.stringify({ type: 'FULL_STATE', payload: serverState }));

  ws.on('message', function(rawData) {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch(e) { console.log('Could not parse message from client'); return; }

    let stateChanged = false;
    let responsePayload = null;

    switch(msg.type) {

      case 'TOURNAMENT_UPDATE':
        // Full tournament replace (config changes, etc.)
        serverState.tournament = msg.payload;
        stateChanged = true;
        break;

      case 'TOURNAMENT_CREATE':
        // Create a new tournament
        serverState.tournament = msg.payload;
        stateChanged = true;
        break;

      case 'TOURNAMENT_ADD_TEAM': {
        // Add a team to the tournament
        const t = serverState.tournament;
        if (t) {
          const team = {
            id: generateId('team'),
            tournamentId: t.id,
            name: msg.payload.name || 'New Team',
            color: msg.payload.color || '#888888',
            players: []
          };
          t.teams.push(team);
          stateChanged = true;
          responsePayload = team;
        }
        break;
      }

      case 'TOURNAMENT_REMOVE_TEAM': {
        const t = serverState.tournament;
        if (t) {
          t.teams = t.teams.filter(tm => tm.id !== msg.payload.teamId);
          stateChanged = true;
        }
        break;
      }

      case 'TOURNAMENT_UPDATE_TEAM': {
        const t = serverState.tournament;
        if (t) {
          const team = t.teams.find(tm => tm.id === msg.payload.teamId);
          if (team) {
            if (msg.payload.name !== undefined) team.name = msg.payload.name;
            if (msg.payload.color !== undefined) team.color = msg.payload.color;
            stateChanged = true;
          }
        }
        break;
      }

      case 'TOURNAMENT_ADD_PLAYER': {
        const t = serverState.tournament;
        if (t) {
          const team = t.teams.find(tm => tm.id === msg.payload.teamId);
          if (team) {
            const player = {
              id: msg.payload.teamId + ':' + msg.payload.jersey,
              tournamentId: t.id,
              teamId: msg.payload.teamId,
              jersey: msg.payload.jersey,
              name: msg.payload.name || '',
              libero: msg.payload.libero || false
            };
            const existingIdx = team.players.findIndex(p => String(p.jersey) === String(msg.payload.jersey));
            if (existingIdx >= 0) team.players[existingIdx] = player;
            else team.players.push(player);
            stateChanged = true;
            responsePayload = player;
          }
        }
        break;
      }

      case 'TOURNAMENT_REMOVE_PLAYER': {
        const t = serverState.tournament;
        if (t) {
          const team = t.teams.find(tm => tm.id === msg.payload.teamId);
          if (team) {
            team.players = team.players.filter(p => String(p.jersey) !== String(msg.payload.jersey));
            stateChanged = true;
          }
        }
        break;
      }

      case 'TOURNAMENT_START': {
        // Generate schedule and start the tournament
        const t = serverState.tournament;
        if (t && t.teams.length >= 2) {
          t.schedule = generateSchedule(t);
          t.status = 'in-progress';
          t.standings = recalculateServerStandings(t);
          // Initialize standings for all teams
          t.standings = (t.teams || []).map(function(team) {
            return {
              id: t.id + ':' + team.id, tournamentId: t.id, teamId: team.id,
              teamName: team.name, color: team.color,
              played: 0, wins: 0, losses: 0, points: 0,
              setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0
            };
          });
          if (t.format === 'swiss') {
            generateSwissPairings(t, 1);
          }
          stateChanged = true;
        }
        break;
      }

      case 'TOURNAMENT_RESET': {
        serverState.tournament = null;
        serverState.liveMatch = null;
        serverState.currentTournamentMatch = null;
        stateChanged = true;
        break;
      }

      case 'TOURNAMENT_REORDER_TEAMS': {
        const t = serverState.tournament;
        if (t && msg.payload.teamIds) {
          const ordered = [];
          for (const id of msg.payload.teamIds) {
            const team = t.teams.find(tm => tm.id === id);
            if (team) ordered.push(team);
          }
          t.teams = ordered;
          stateChanged = true;
        }
        break;
      }

      case 'SWISS_GENERATE_PAIRINGS': {
        const t = serverState.tournament;
        if (t && msg.payload.round) {
          generateSwissPairings(t, msg.payload.round);
          stateChanged = true;
        }
        break;
      }

      case 'MATCH_STATE_UPDATE':
        serverState.liveMatch = msg.payload;
        stateChanged = true;
        break;

      case 'MATCH_STARTED':
        serverState.liveMatch = msg.payload.matchState;
        if (msg.payload.tournament) serverState.tournament = msg.payload.tournament;
        if (msg.payload.currentTournamentMatch) serverState.currentTournamentMatch = msg.payload.currentTournamentMatch;
        stateChanged = true;
        break;

      case 'MATCH_ENDED': {
        // Match is complete — server handles all tournament logic
        serverState.liveMatch = msg.payload.matchState || serverState.liveMatch;
        serverState.currentTournamentMatch = null;

        if (msg.payload.matchResult) {
          // Server-side match completion (the new way)
          completeServerTournamentMatch(msg.payload);
        } else if (msg.payload.tournament) {
          // Fallback: client sent the full resolved tournament (backward compat)
          serverState.tournament = msg.payload.tournament;
        }

        msg.payload.tournament = serverState.tournament;
        msg.payload.matchState = serverState.liveMatch;
        msg.payload.currentTournamentMatch = null;
        stateChanged = true;
        break;
      }

      case 'STATE_RESET':
        serverState.liveMatch = msg.payload;
        stateChanged = true;
        break;

      default:
        break;
    }

    if (stateChanged) {
      saveServerState(msg.type);
    }

    // Build the outgoing message
    // For tournament mutations, include the full tournament so all devices sync
    const outgoingPayload = responsePayload !== null ? responsePayload : msg.payload;
    if (stateChanged && msg.type !== 'MATCH_STATE_UPDATE' && msg.type !== 'STATE_RESET') {
      // For tournament-level changes, broadcast the full server state
      const broadcastPayload = {
        tournament: serverState.tournament,
        liveMatch: serverState.liveMatch,
        currentTournamentMatch: serverState.currentTournamentMatch
      };
      const outgoing = JSON.stringify({ type: msg.type, payload: outgoingPayload, fullState: broadcastPayload });
      connectedClients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(outgoing);
        }
      });
    } else {
      // For match-level updates, just forward the original message
      const outgoing = JSON.stringify({ type: msg.type, payload: outgoingPayload });
      connectedClients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(outgoing);
        }
      });
    }
  });

  ws.on('close', function() {
    connectedClients.delete(ws);
    console.log('Device disconnected. Total devices: ' + connectedClients.size);
  });

  ws.on('error', function(err) {
    console.log('WebSocket error: ' + err.message);
    connectedClients.delete(ws);
  });
});

// ── Auto-save session to disk every 10 seconds ────────────────
setInterval(function() { saveServerState('autosave'); }, 10000);

// ── Also save immediately on Ctrl+C so nothing is lost ────────
process.on('SIGINT', function() {
  console.log('\nShutting down...');
  if (saveServerState('shutdown')) console.log('Session saved. See you tomorrow!');
  process.exit(0);
});

// ── Start the server ──────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', function() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║         AQUILA SERVER RUNNING          ║');
  console.log('╠════════════════════════════════════════╣');
  const nets = os.networkInterfaces();
  const addresses = [];
  Object.values(nets).forEach(function(netList) {
    netList.forEach(function(net) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    });
  });
  if (addresses.length === 0) {
    console.log('║  http://localhost:' + PORT + '                 ║');
  } else {
    addresses.forEach(function(addr) {
      const url = 'http://' + addr + ':' + PORT;
      console.log('║  ' + url.padEnd(38) + '  ║');
    });
  }
  console.log('╠════════════════════════════════════════╣');
  console.log('║  Share the address above with all      ║');
  console.log('║  committee devices on the same WiFi.   ║');
  console.log('║  Press Ctrl+C to stop the server.      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('Waiting for devices to connect...');
  console.log('');
});
