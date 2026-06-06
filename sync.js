// ===================== AQUILA LAN SYNC =====================
// Handles real-time communication between all devices.
// Connects to the local Node server via WebSocket.
// Works on local WiFi only — no internet required.
//
// The server (server.js) is the single source of truth for all tournament
// data. It persists everything to aquila-sync.json. This module just sends
// commands to the server and applies the server's responses to local state.

const sync = (function() {

  let ws = null;
  let reconnectTimer = null;
  let isApplyingRemote = false;
  let lastAppliedTimestamp = 0;
  let isConnected = false;

  // ── Determine if we are running from the server ─────────────
  function shouldConnect() {
    return window.location.protocol === 'http:' ||
           window.location.protocol === 'https:';
  }

  // ── Connect to the WebSocket server ─────────────────────────
  function connect() {
    if (!shouldConnect()) {
      console.log('Aquila sync: running as local file, sync disabled.');
      return;
    }

    const serverUrl = 'ws://' + window.location.hostname + ':3001';

    try {
      ws = new WebSocket(serverUrl);
    } catch(e) {
      console.log('Aquila sync: could not create WebSocket connection.');
      scheduleReconnect();
      return;
    }

    ws.onopen = function() {
      isConnected = true;
      clearTimeout(reconnectTimer);
      updateSyncIndicator('connected');
      console.log('Aquila sync: connected to server.');
    };

    ws.onmessage = function(event) {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch(e) {
        return;
      }
      handleIncomingMessage(msg);
    };

    ws.onclose = function() {
      isConnected = false;
      updateSyncIndicator('disconnected');
      console.log('Aquila sync: connection lost. Reconnecting...');
      scheduleReconnect();
    };

    ws.onerror = function() {
      isConnected = false;
      updateSyncIndicator('disconnected');
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  // ── Post-match cleanup: clear state, refresh UI ──────────────
  function finishMatchEndedCleanup() {
    if (typeof state !== 'undefined') {
      state.gameStarted = false;
      state.matchEnded = true;
      state.currentTournamentMatch = null;
    }

    if (typeof currentTournamentMatch !== 'undefined') {
      currentTournamentMatch = null;
    }

    var banner = document.getElementById('tourney-banner');
    if (banner) banner.classList.add('tourney-banner-hidden');

    if (typeof clearSavedState === 'function') clearSavedState();

    setTimeout(function() {
      if (typeof switchMenu === 'function') switchMenu('admin');
      if (typeof switchView === 'function') switchView('schedule');
      if (typeof schedRender === 'function') schedRender();
      if (typeof standingsRender === 'function') standingsRender();
      if (typeof showAlert === 'function') {
        showAlert('Match completed. Schedule updated.', 'success');
      }
    }, 200);
  }

  // ── Handle messages arriving from the server ─────────────────
  function handleIncomingMessage(msg) {

    // FULL_STATE: full sync from server — tournament + optional live match
    if (msg.type === 'FULL_STATE') {
      var payload = msg.payload;

      if (payload.tournament) {
        isApplyingRemote = true;
        setActiveTournament(payload.tournament);
        isApplyingRemote = false;
        refreshAdminViewIfOpen();

        if (payload.currentTournamentMatch) {
          currentTournamentMatch = payload.currentTournamentMatch;
        }

        if (payload.liveMatch) {
          applyIncomingMatchState(payload.liveMatch);
          if (payload.liveMatch.matchEnded) {
            finishMatchEndedCleanup();
          }
        } else {
          if (typeof clearSavedState === 'function') clearSavedState();
          if (typeof state !== 'undefined' && state.gameStarted) {
            state.gameStarted = false;
            state.matchEnded = true;
          }
        }
        return;
      }

      if (payload.currentTournamentMatch) {
        currentTournamentMatch = payload.currentTournamentMatch;
      }
      if (payload.liveMatch) {
        applyIncomingMatchState(payload.liveMatch);
      }
      return;
    }

    // For tournament-level messages, the server includes fullState
    // so all devices can update their local copy
    if (msg.fullState && msg.fullState.tournament) {
      isApplyingRemote = true;
      setActiveTournament(msg.fullState.tournament);
      isApplyingRemote = false;

      if (msg.fullState.currentTournamentMatch) {
        currentTournamentMatch = msg.fullState.currentTournamentMatch;
      } else if (msg.type === 'TOURNAMENT_RESET') {
        currentTournamentMatch = null;
      }

      refreshAdminViewIfOpen();
    }

    // MATCH_ENDED: match is over, tournament updated with result
    if (msg.type === 'MATCH_ENDED') {
      if (msg.payload.matchState) {
        applyIncomingMatchState(msg.payload.matchState);
      }
      // fullState.tournament already applied above if present
      finishMatchEndedCleanup();
      return;
    }

    // TOURNAMENT_UPDATE: schedule changed, standings updated
    if (msg.type === 'TOURNAMENT_UPDATE') {
      isApplyingRemote = true;
      setActiveTournament(msg.payload);
      isApplyingRemote = false;
      refreshAdminViewIfOpen();
      return;
    }

    // MATCH_STATE_UPDATE: a point was scored, sub made, etc.
    if (msg.type === 'MATCH_STATE_UPDATE') {
      applyIncomingMatchState(msg.payload);
      return;
    }

    // MATCH_STARTED: organizer started a match from the schedule
    if (msg.type === 'MATCH_STARTED') {
      if (msg.payload.tournament) {
        isApplyingRemote = true;
        setActiveTournament(msg.payload.tournament);
        isApplyingRemote = false;
      }
      if (msg.payload.matchState) {
        applyIncomingMatchState(msg.payload.matchState);
      }

      if (msg.payload.matchState && msg.payload.tournament) {
        var t = msg.payload.tournament;
        var ms = msg.payload.matchState;
        var bannerEl = document.getElementById('tourney-banner');
        var bannerText = document.getElementById('tourney-banner-text');
        if (bannerEl && bannerText) {
          bannerText.textContent = '🏐 ' + (t.name || 'Tournament') +
            ' — ' + (ms.teamA ? ms.teamA.name : 'Team A') +
            ' vs ' + (ms.teamB ? ms.teamB.name : 'Team B');
          bannerEl.classList.remove('tourney-banner-hidden');
        }
      }
      return;
    }

    // STATE_RESET: match was reset
    if (msg.type === 'STATE_RESET') {
      applyIncomingMatchState(msg.payload);
      return;
    }
  }

  // ── Apply incoming match state to this device ────────────────
  function applyIncomingMatchState(incomingState) {
    if (incomingState._syncTimestamp &&
        incomingState._syncTimestamp <= lastAppliedTimestamp) {
      return;
    }

    if (incomingState._syncTimestamp) {
      lastAppliedTimestamp = incomingState._syncTimestamp;
    }

    var localUIState = {
      lastTouchPlayer: state.lastTouchPlayer,
      lastTouchTeam:   state.lastTouchTeam,
      effTouchPlayer:  state.effTouchPlayer,
      effTouchTeam:    state.effTouchTeam,
      currentSubTeam:  state.currentSubTeam
    };

    isApplyingRemote = true;
    Object.assign(state, incomingState);
    Object.assign(state, localUIState);

    if (state.gameStarted && !state.matchEnded) {
      renderAll();
    }

    isApplyingRemote = false;
  }

  // ── Refresh whichever admin view is currently visible ────────
  function refreshAdminViewIfOpen() {
    var activeView = document.querySelector('.view.active');
    if (!activeView) return;
    var viewId = activeView.id.replace('view-', '');
    var adminViews = ['schedule', 'standings', 'tstats', 'tteams', 'config'];
    if (adminViews.indexOf(viewId) !== -1) {
      setTimeout(function() { switchView(viewId); }, 50);
    }
  }

  // ── Send a message to the server ─────────────────────────────
  function send(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      ws.send(JSON.stringify({ type: type, payload: payload }));
    } catch(e) {
      console.log('Aquila sync: send failed — ' + e.message);
    }
  }

  // ── Public push functions (called from app.js / tournament.js) ─

  function pushMatchState(matchState) {
    if (isApplyingRemote) return;
    if (!isConnected) return;
    var payload = Object.assign({}, matchState, {
      _syncTimestamp: Date.now()
    });
    send('MATCH_STATE_UPDATE', payload);
  }

  function pushTournament(tournament) {
    if (isApplyingRemote) return;
    if (!isConnected) return;
    send('TOURNAMENT_UPDATE', tournament);
  }

  function pushMatchStarted(matchState, tournament, tournamentMatchCtx) {
    if (!isConnected) return;
    send('MATCH_STARTED', {
      matchState: Object.assign({}, matchState, { _syncTimestamp: Date.now() }),
      tournament: tournament,
      currentTournamentMatch: tournamentMatchCtx || null
    });
  }

  function pushMatchEnded(tournament, matchState, tournamentMatchCtx, matchResult) {
    if (!isConnected) return;
    send('MATCH_ENDED', {
      tournament: tournament,
      matchState: matchState ? Object.assign({}, matchState, {
        gameStarted: false,
        matchEnded: true,
        _syncTimestamp: Date.now()
      }) : null,
      currentTournamentMatch: tournamentMatchCtx || null,
      matchResult: matchResult || null
    });
  }

  function pushStateReset(matchState) {
    if (isApplyingRemote) return;
    if (!isConnected) return;
    send('STATE_RESET', Object.assign({}, matchState, {
      _syncTimestamp: Date.now()
    }));
  }

  // ── Tournament CRUD operations (delegated to server) ─────────

  function sendTournamentCreate(tournament) {
    if (!isConnected) return;
    send('TOURNAMENT_CREATE', tournament);
  }

  function sendTournamentAddTeam(tournamentId, teamData) {
    if (!isConnected) return;
    send('TOURNAMENT_ADD_TEAM', { tournamentId: tournamentId, name: teamData.name, color: teamData.color });
  }

  function sendTournamentRemoveTeam(tournamentId, teamId) {
    if (!isConnected) return;
    send('TOURNAMENT_REMOVE_TEAM', { tournamentId: tournamentId, teamId: teamId });
  }

  function sendTournamentUpdateTeam(tournamentId, teamId, updates) {
    if (!isConnected) return;
    send('TOURNAMENT_UPDATE_TEAM', { tournamentId: tournamentId, teamId: teamId, name: updates.name, color: updates.color });
  }

  function sendTournamentAddPlayer(tournamentId, teamId, playerData) {
    if (!isConnected) return;
    send('TOURNAMENT_ADD_PLAYER', {
      tournamentId: tournamentId, teamId: teamId,
      jersey: playerData.jersey, name: playerData.name, libero: playerData.libero
    });
  }

  function sendTournamentRemovePlayer(tournamentId, teamId, jersey) {
    if (!isConnected) return;
    send('TOURNAMENT_REMOVE_PLAYER', { tournamentId: tournamentId, teamId: teamId, jersey: jersey });
  }

  function sendTournamentStart(tournamentId) {
    if (!isConnected) return;
    send('TOURNAMENT_START', { tournamentId: tournamentId });
  }

  function sendTournamentReset() {
    if (!isConnected) return;
    send('TOURNAMENT_RESET', {});
  }

  function sendTournamentReorderTeams(tournamentId, teamIds) {
    if (!isConnected) return;
    send('TOURNAMENT_REORDER_TEAMS', { tournamentId: tournamentId, teamIds: teamIds });
  }

  function sendTournamentMatchComplete(tournamentId, matchId, matchResult) {
    if (!isConnected) return;
    send('MATCH_ENDED', {
      currentTournamentMatch: { tournamentId: tournamentId, matchId: matchId },
      matchResult: matchResult
    });
  }

  function sendSwissGeneratePairings(tournamentId, round) {
    if (!isConnected) return;
    send('SWISS_GENERATE_PAIRINGS', { tournamentId: tournamentId, round: round });
  }

  // ── Sync status indicator ────────────────────────────────────
  function updateSyncIndicator(status) {
    var indicator = document.getElementById('sync-indicator');

    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sync-indicator';
      indicator.style.cssText = [
        'position:fixed',
        'bottom:54px',
        'right:12px',
        'font-size:9px',
        'letter-spacing:1px',
        'text-transform:uppercase',
        'padding:3px 8px',
        'border-radius:10px',
        'z-index:998',
        'pointer-events:none',
        'transition:all 0.3s ease'
      ].join(';');
      document.body.appendChild(indicator);
    }

    if (status === 'connected') {
      indicator.textContent = '● Synced';
      indicator.style.background = 'rgba(0,187,25,0.15)';
      indicator.style.color = 'var(--success)';
      indicator.style.border = '1px solid rgba(0,187,25,0.3)';
    } else {
      indicator.textContent = '○ Offline';
      indicator.style.background = 'rgba(224,64,64,0.15)';
      indicator.style.color = 'var(--danger)';
      indicator.style.border = '1px solid rgba(224,64,64,0.3)';
    }
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    connect:          connect,
    shouldConnect:    shouldConnect,
    isConnected:      function() { return isConnected; },
    pushMatchState:   pushMatchState,
    pushTournament:   pushTournament,
    pushMatchStarted: pushMatchStarted,
    pushMatchEnded:   pushMatchEnded,
    pushStateReset:   pushStateReset,
    // Tournament CRUD
    sendTournamentCreate:        sendTournamentCreate,
    sendTournamentAddTeam:       sendTournamentAddTeam,
    sendTournamentRemoveTeam:    sendTournamentRemoveTeam,
    sendTournamentUpdateTeam:    sendTournamentUpdateTeam,
    sendTournamentAddPlayer:     sendTournamentAddPlayer,
    sendTournamentRemovePlayer:  sendTournamentRemovePlayer,
    sendTournamentStart:         sendTournamentStart,
    sendTournamentReset:         sendTournamentReset,
    sendTournamentReorderTeams:  sendTournamentReorderTeams,
    sendTournamentMatchComplete: sendTournamentMatchComplete,
    sendSwissGeneratePairings:   sendSwissGeneratePairings
  };

})();

// Auto-connect when the page loads
if (sync.shouldConnect()) {
  sync.connect();
}
