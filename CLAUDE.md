# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on the **Aquila Volleyball Committee System** — a browser-based volleyball match scoring, statistics, and tournament management application.

## How to Run

This is a static web application with no build step. Open `index.html` directly in a browser, or serve it with any static file server:

```bash
# From the project directory:
npx serve .
# or
python -m http.server 8000
```

There are no tests, no linting, and no build pipeline. All code is vanilla JS + CSS.

## Architecture Overview

### File Structure

| File | Purpose |
|---|---|
| `index.html` | Full app shell — all HTML markup, overlays, modals, tab views, and UI panels in one file (~44K) |
| `style.css` | All styling (~49K) — CSS custom properties for theming, dark-mode volleyball aesthetic |
| `app.js` | Main application logic (~3770 lines) — match state, scoring, substitutions, rendering, tournament UI |
| `tournament.js` | Tournament engine (~1219 lines) — schedule generation, bracket logic, standings, Swiss pairing |
| `db.js` | IndexedDB persistence layer (~328 lines) — all CRUD operations for tournaments, matches, teams, players, standings |

### Data Flow

1. **In-memory state** (`state` object in `app.js`) drives the UI. Every user action mutates `state`, then calls `renderAll()` or a targeted render function.
2. **Auto-save** persists `state` to `localStorage` under key `volleyref-match-state` (match-level only).
3. **Tournament data** lives in IndexedDB via `db.js`. The active tournament is held in memory (`activeTournament` in `tournament.js`) and mirrored to `localStorage` under `volleyref-active-tournament`.
4. On page load, `loadState()` restores a match from localStorage, and `db.init()` + `restoreTournamentLocal()` restores tournament context.

### Two-Menu Architecture

The app has two top-level menu groups toggled via side panel:

- **Technical Committee** (default): Match-level operations — Setup, Game, Court, Skill Efficiency, Statistics. Used by referees/scorers during a match.
- **Admin**: Tournament-level operations — Tournament Config, Teams, Schedule, Standings, Tournament Stats. Used by organizers.

Navigation is handled by `switchMenu(group)` (shows the correct tab bar) and `switchView(name)` (shows the correct view panel). Both are in `app.js`.

### Match State (`state` object in `app.js`)

The central state object tracks:
- `teamA` / `teamB`: name, roster, fullSquad, libero, rotation, timeouts, subsUsed, subsLog, totalPts, setsWon, sanctions
- `scoreA` / `scoreB`, `currentSet`, `serving`, `firstServer`
- `setHistory`, `allSubsLog`, `pointLog`, `skillEfficiencyLog`
- `playerPoints`, `playerStats` (keyed by `"A:12"` or `"B:7"`)
- `subRegistry` — tracks substitution buddy pairs per team per set (FIVB rule enforcement)
- `liberoSelectionMode`, `courtSwapped`, `gameStarted`, `matchEnded`

### Rendering Pattern

There is no virtual DOM or framework. Every render function directly manipulates `innerHTML` or DOM nodes:
- `renderAll()` — full re-render of the Game view (score, rotations, timeouts, subs, point log, court, stats)
- `renderCourts()` — SVG-based court with clickable player circles
- `renderEfficiencyTables()` — per-skill efficiency tables (attack, serve, reception, set, block, dig)
- `updateSummary()` — match summary tab
- Tournament views: `tcRender()`, `tteamsRender()`, `schedRender()`, `standingsRender()`, `tstatsRender()`

### Tournament Engine (`tournament.js`)

Supports four formats:
- **Single Elimination** — standard bracket with seed ordering, bye auto-advance
- **Double Elimination** — winners + losers bracket with structural source-match linking, bracket reset final
- **Round Robin** — circle method, with configurable semi-final seeding (`1v4-2v3` or `1v3-2v4`) and finals
- **Swiss** — configurable rounds, backtracking pairing algorithm to avoid rematches, bye handling

Key functions:
- `generateSchedule(tournament)` — dispatches to format-specific generator
- `startTournament(id)` — generates schedule, saves all match slots, initializes standings
- `completeTournamentMatch(id, matchId, result)` — records result, recalculates standings, syncs round-robin playoffs
- `recalculateStandings(id)` — rebuilds standings from all completed matches
- `advanceTournamentWinner(tournamentId, matchId)` — pushes winner to next bracket match (single/double elim)
- `generateSwissPairings(tournamentId, round)` — backtracking pairing with rematch avoidance

### Database Layer (`db.js`)

IndexedDB with 5 object stores: `tournaments`, `matches`, `teams`, `players`, `playerMatchStats`, `standings`. The `db` object exposes a clean async API. The comment at the top of `db.js` notes this layer is designed to be swappable for a PostgreSQL/fetch() backend — function signatures should stay the same.

### Key Constraints & Rules Enforced

- **FIVB substitution rules**: buddy substitutions (each player can only sub with their designated partner within a set), max 6 subs per set (configurable), tracked via `subRegistry`
- **Libero rules**: can only replace back-row players (positions 1, 5, 6), auto-swapped out when rotated to front row
- **Set win**: 25 points (15 for deciding set), must win by 2
- **Court swap**: `courtSwapped` flag flips team layout without changing logical state

### Global Variables to Be Aware Of

- `state` — main match state (app.js)
- `activeTournament` — current tournament object (tournament.js)
- `currentTournamentMatch` — `{ tournamentId, matchId, matchNumber }` when playing a tournament match
- `subRegistry` — `{ A: {}, B: {} }` substitution tracking per set
- `liberoSelectionMode` — which team is currently selecting a libero replacement
- `undoStack` / `MAX_UNDO` — undo history for match actions
- `editingTeamId` / `tteamsEditingTeamId` — which team roster is being edited in each panel
