# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 五子棋 (Gomoku) — a desktop gomoku game built with React 18 + Redux Toolkit + Electron, powered by the Rapfi C++ engine (Gomocup/pbrain protocol). The browser version uses a minimax JS AI; the desktop version uses Rapfi via Electron IPC for much stronger play.

## Commands

```bash
npm install          # Install dependencies (Node v18+)
npm start            # Dev server (react-app-rewired)
npm run build        # Production build → build/
npm run dist         # Build + Electron portable exe → release/AI五子棋.exe
npm test             # Unit tests (react-app-rewired test)
```

Packaging requires `release/rapfi/Rapfi.exe` and its DLLs/weights to exist. If Electron download is slow, set `ELECTRON_CACHE` env var and use `.npmrc` mirror config.

## Architecture

### Three-layer IPC stack

```
渲染进程 (React)     主进程 (Electron)       Rapfi 引擎 (C++ child_process)
  src/bridge.js   →  electron-main/        →  release/rapfi/Rapfi.exe
  (window.engineAPI)   ipc-handlers.js         rapfi-bridge.js (pbrain protocol)
  src/preload.js       engine-paths.js
```

- `src/preload.js` — exposes `window.engineAPI` via `contextBridge` (probe, start, begin, move, undo, stop, end, on)
- `src/bridge.js` — thin client wrapping `window.engineAPI`; handles coordinate conversion (app: i=row,j=col ↔ engine: x=col,y=row) and role mapping (app: 1/-1 ↔ engine: 1/2)
- `electron-main/ipc-handlers.js` — registers all `ipcMain.handle('engine:*')` channels, manages `RapfiBridge` lifecycle
- `electron-main/rapfi-bridge.js` — spawns Rapfi child process, speaks Gomocup pbrain protocol (BEGIN/BOARD/TURN/END commands)
- `electron-main/engine-paths.js` — resolves `Rapfi.exe` from `release/rapfi/`

### Redux state (`src/store/gameSlice.js`)

Single slice manages all game state. Key fields:
- `board` (15×15 array), `history` (move log with elapsed time), `currentPlayer` (1=black, -1=white)
- `status` (IDLE/GAMING), `winner`, `winningLine`, `showResultModal`
- `blackTimeMs`/`whiteTimeMs` — per-side countdown clocks
- `engine` — `{ kind, bundled, binary, lastError }`

Async thunks: `startGame`, `movePiece`, `undoMove`, `endGame`, `restoreGame`, `probeEngine`

Key helpers: `commitMove` (place piece + deduct time), `settleWinner` (check + set terminal state), `resetMatch`, `applyStart`

### AI logic (`src/ai/index.js`)

Minimal module — only UI-facing helpers (no search):
- `checkFiveAt` / `getWinningLine` — detect five-in-a-row at a position
- `isForbidden` / `buildWalledBoard` — forbidden move detection (black-only rules)
- `formatGameRecord` / `formatCoordinate` — export game record as text

### UI components (`src/components/`)

- `board.js` — 15×15 grid with click-to-place, hover preview, winning line SVG, star points, coordinate labels
- `ui/ActionBar.js` — start/undo/resign/restart buttons (Ant Design Modal confirmations)
- `ui/GameResultModal.js` — overlay shown after game ends; close preserves board, "再来一局" restarts
- `ui/SettingsPanel.js` — AI first, time limit, forbidden rules, show move numbers, debug toggle
- `ui/TurnIndicator.js` / `AIProgressBar.js` / `TimeClock.js` — real-time game status display
- `ui/ScreenshotRestoreModal.js` — restore game state from a screenshot by clicking corners

### Game flow

1. User clicks "开始对局" → `startGame` thunk → bridge.start() → engine IPC
2. If AI first: bridge.start() calls engine.begin() to get first move
3. Player clicks board → `tempMove` (optimistic, sync) + `movePiece` (engine response, async)
4. Engine responds with AI move → `applyYixinMove` reducer
5. Winner detected by `settleWinner` after each move; result modal shown
6. Undo: engine.undo(2) pops both AI + player moves

### Coordinate system

App uses `(i=row, j=col)` internally; Rapfi engine uses `(x=col, y=row)`. Role mapping: app `1/-1` ↔ engine `1/2`. The bridge handles all conversions.

## Coding Style

Follow `AGENTS.md`: YAGNI, reuse existing helpers, minimize new code. Prefer deletion over addition. No new dependencies unless unavoidable. Mark intentional simplifications with `ponytail:` comments.
