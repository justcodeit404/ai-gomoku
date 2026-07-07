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

- `src/preload.js` — exposes `window.engineAPI` via `contextBridge` (probe, start, begin, move, undo, stop, end, on, setupBoard, triggerAiAfterSetup)
- `src/bridge.js` — thin client wrapping `window.engineAPI`; handles coordinate conversion (app: i=row,j=col ↔ engine: x=col,y=row) and role mapping (app: 1/-1 ↔ engine: 1/2)
- `electron-main/ipc-handlers.js` — registers all `ipcMain.handle('engine:*')` channels, manages `RapfiBridge` lifecycle
- `electron-main/rapfi-bridge.js` — spawns Rapfi child process, speaks Gomocup pbrain + Yixin extensions
- `electron-main/engine-paths.js` — resolves `Rapfi.exe` from `release/rapfi/`

### Rapfi protocol quirks (hard-won lessons)

- **YXBOARD = silent load, must pair with TURN**. YXBOARD装入后引擎**静默不输出任何响应**(不 think),必须再发 `TURN x,y` 才会 search + 应手。
- **Rapfi 不支持 INFO color 命令**。selfColor 完全由**首子**决定：首子 role=1 → Rapfi 执黑；首子 role=2 → Rapfi 执白。
- **TURN 坐标必须是空位**。Rapfi 把 TURN x,y 视为"OPPO 刚下的最后一步"并试图落子,TURN 到已有子的坐标会触发 Rapfi 内部 assert 崩溃(exit 3221225477)。
- **PASS 不计入 history step**。Rapfi 装入时自动 insert PASS 翻转 sideToMove,PASS 是虚着,history 步数不变。this.history 不需要 push PASS 占位。
- **摆棋协议**:`YXBOARD + <history> + DONE` 装入 → `TURN <空位>` 触发应手。Role 由首子决定,不固定。
- **BOARD vs YXBOARD**:BOARD 装入完立即应手(清空 hash,棋力弱);YXBOARD+TURN 保留 hash 命中(实测 VC 32.9% vs 27.1%)。

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
7. **摆棋 (board setup)** — `setupBoard(history, nextPlayer)` 走 YXBOARD 装入;人接手 (nextPlayer=1) 等用户走第一手走 `_moveViaBoard`;AI 接手 (nextPlayer=2) 等用户点"AI 接手"按钮走 `triggerAiMoveAfterSetup` 走 YXBOARD+TURN

### Coordinate system

App uses `(i=row, j=col)` internally; Rapfi engine uses `(x=col, y=row)`. Role mapping: app `1/-1` ↔ engine `1/2`. The bridge handles all conversions.

## Coding Style

Follow `AGENTS.md`: YAGNI, reuse existing helpers, minimize new code. Prefer deletion over addition. No new dependencies unless unavoidable. Mark intentional simplifications with `ponytail:` comments.
