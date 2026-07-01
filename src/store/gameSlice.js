import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { board_size, MATCH_BUDGET_MS } from '../config';
import { STATUS } from '../status';
import { checkFiveAt, getWinningLine } from '../game';

import {
  start, end, move, undo, probe, restore, hint,
} from '../bridge';

export const probeEngine = createAsyncThunk('game/probeEngine', async () => {
  return await probe();
});

export const startGame = createAsyncThunk('game/start', async ({ board_size, aiFirst, depth, timeLimit, forbiddenEnabled }) => {
  return await start(board_size, aiFirst, depth, timeLimit, forbiddenEnabled);
});

export const restoreGame = createAsyncThunk('game/restore', async ({ board_size, history, currentPlayer, timeLimit, forbiddenEnabled, triggerAiMove }, { dispatch, getState }) => {
  const aiFirst = getState().game.aiFirst;
  const data = await restore(board_size, aiFirst, history, currentPlayer, timeLimit, forbiddenEnabled, triggerAiMove);
  if (data?.aiMove) {
    dispatch(applyYixinMove(data.aiMove));
  }
  return data;
});

export const movePiece = createAsyncThunk('game/move', async ({ position }, { dispatch, getState }) => {
  // 如果玩家这步已获胜，状态已被 tempMove 设为结束，不再调用引擎
  const { status } = getState().game;
  if (status === STATUS.IDLE) {
    return { skipped: true, reason: 'game already ended' };
  }
  const data = await move(position, getState().game.history);
  if (data?.yixinDeltaMove) {
    dispatch(applyYixinMove(data.yixinDeltaMove));
  }
  return data;
});

export const endGame = createAsyncThunk('game/end', async () => {
  return await end();
});

export const undoMove = createAsyncThunk('game/undo', async (_arg, { dispatch, getState }) => {
  const uiHistory = getState().game.history;
  const data = await undo(uiHistory);
  if (data?.yixinUndoSteps) {
    dispatch(applyYixinUndo({ steps: data.yixinUndoSteps }));
  }
  return data;
});

export const fetchHint = createAsyncThunk('game/fetchHint', async (_, { getState }) => {
  const state = getState().game;
  if (state.status !== STATUS.GAMING || state.loading || state.history.length === 0) {
    return null;
  }
  return await hint(state.size, state.history, state.forbiddenEnabled);
});

const createEmptyBoard = () => Array.from({ length: board_size }, () => Array(board_size).fill(0));

export const initialState = {
  // ---- 对局内（重开时被重置）----
  board: createEmptyBoard(),
  currentPlayer: null,
  winner: null,
  history: [],
  status: STATUS.IDLE,
  loading: false,
  blackTimeMs: MATCH_BUDGET_MS,
  whiteTimeMs: MATCH_BUDGET_MS,
  turnStartedAt: null,
  winningLine: null,
  showResultModal: false,
  hintMove: null,
  // ---- 用户设置（重开时保留）----
  size: 15,
  aiFirst: true,
  timeLimit: 5000,
  forbiddenEnabled: false,
  showMoveNumbers: false,
  soundEnabled: true,
  showHint: false,
  theme: 'light',
  debug: false,
  engine: {
    kind: 'unavailable',
    bundled: false,
    binary: null,
  },
};

function resetMatch(state) {
  state.board = createEmptyBoard();
  state.currentPlayer = null;
  state.winner = null;
  state.history = [];
  state.status = STATUS.IDLE;
  state.loading = false;
  state.blackTimeMs = MATCH_BUDGET_MS;
  state.whiteTimeMs = MATCH_BUDGET_MS;
  state.turnStartedAt = null;
  state.winningLine = null;
  state.showResultModal = false;
  state.hintMove = null;
}

function deductTime(state, role, elapsedMs) {
  if (role === 1) state.blackTimeMs = Math.max(0, state.blackTimeMs - elapsedMs);
  else if (role === -1) state.whiteTimeMs = Math.max(0, state.whiteTimeMs - elapsedMs);
}

function refundTime(state, role, elapsedMs) {
  if (role === 1) state.blackTimeMs = Math.min(MATCH_BUDGET_MS, state.blackTimeMs + elapsedMs);
  else if (role === -1) state.whiteTimeMs = Math.min(MATCH_BUDGET_MS, state.whiteTimeMs + elapsedMs);
}

function checkLastMoveWinner(board, history) {
  const last = history[history.length - 1];
  if (!last) return null;
  return checkFiveAt(board, last.i, last.j, last.role) ? last.role : null;
}

// 检查最后一步是否获胜，若获胜则设置终局状态并弹出结果弹窗
function settleWinner(state) {
  const winner = checkLastMoveWinner(state.board, state.history);
  if (winner !== null) {
    state.winner = winner;
    state.status = STATUS.IDLE;
    const last = state.history[state.history.length - 1];
    state.winningLine = getWinningLine(state.board, last.i, last.j, last.role);
    state.showResultModal = true;
  }
}

// 落子并切换当前方；同时结算上一位玩家的用时。
// tempMove 走人类步时扣除人类用时并启动 AI 计时；applyYixinMove 走 AI 步时扣除 AI 用时并启动人类计时。
function commitMove(state, role, i, j, now = Date.now()) {
  let elapsedMs = 0;
  if (state.turnStartedAt) {
    elapsedMs = now - state.turnStartedAt;
    deductTime(state, state.currentPlayer, elapsedMs);
  }
  state.board[i][j] = role;
  state.history.push({ i, j, role, elapsedMs });
  state.currentPlayer = -role;
  state.turnStartedAt = now;
}

function applyStart(state, payload) {
  const p = payload || {};
  resetMatch(state);
  state.board = p.board;
  state.currentPlayer = p.current_player;
  state.history = p.history;
  state.status = STATUS.GAMING;
  state.turnStartedAt = Date.now();
  state.hintMove = null;
}

export const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    tempMove: (state, action) => {
      const [i, j] = action.payload;
      commitMove(state, state.currentPlayer, i, j);
      state.hintMove = null;
      settleWinner(state);
    },
    setAiFirst: (state, action) => { state.aiFirst = action.payload; },
    setTimeLimit: (state, action) => { state.timeLimit = Number(action.payload); },
    setShowMoveNumbers: (state, action) => { state.showMoveNumbers = action.payload; },
    setSoundEnabled: (state, action) => { state.soundEnabled = action.payload; },
    setShowHint: (state, action) => { state.showHint = action.payload; },
    setTheme: (state, action) => { state.theme = action.payload; },
    setDebug: (state, action) => { state.debug = action.payload; },
    setHintMove: (state, action) => { state.hintMove = action.payload; },
    clearHint: (state) => { state.hintMove = null; },
    setForbidden: (state, action) => { state.forbiddenEnabled = action.payload; },
    setEngineError: (state, action) => {
      state.engine.lastError = action.payload || 'engine error';
      state.engine.kind = 'unavailable';
    },
    applyYixinMove: (state, action) => {
      const { i, j, role } = action.payload;
      commitMove(state, role, i, j);
      state.hintMove = null;
      settleWinner(state);
      state.loading = false;
    },
    applyYixinUndo: (state, action) => {
      const n = action.payload?.steps || 2;
      let remaining = n;
      while (state.history.length > 0 && remaining > 0) {
        const last = state.history.pop();
        state.board[last.i][last.j] = 0;
        refundTime(state, last.role, last.elapsedMs);
        remaining--;
      }
      const tail = state.history[state.history.length - 1];
      // 悔棋 n 步后，轮到"最后剩下那一步的对手"行棋。
      // 例：撤销"人+AI"两步后剩 [..., 黑, 白]，last=白 → 下一步该黑走。
      state.currentPlayer = tail ? -tail.role : 1;
      state.winner = null;
      state.winningLine = null;
      state.status = STATUS.GAMING;
      state.loading = false;
      state.turnStartedAt = Date.now();
    },
    // 摆棋编辑完成：一次性应用 board/history/currentPlayer
    applyBoardEdit: (state, action) => {
      const p = action.payload || {};
      state.board = p.board;
      state.history = p.history || [];
      state.currentPlayer = p.currentPlayer;
      state.winner = null;
      state.winningLine = null;
      state.status = STATUS.IDLE;
      state.loading = false;
      state.turnStartedAt = Date.now();
      state.showResultModal = false;
    },
    resign: (state) => {
      state.winner = -state.currentPlayer;
      state.status = STATUS.IDLE;
      state.winningLine = null;
      state.showResultModal = true;
    },
    closeResultModal: (state) => {
      state.showResultModal = false;
    },
    restartGame: (state) => { resetMatch(state); },
  },
  extraReducers: (builder) => {
    builder
      .addCase(probeEngine.fulfilled, (state, action) => {
        const p = action.payload || {};
        state.engine.kind = p.kind || 'unavailable';
        state.engine.bundled = !!p.bundled;
        state.engine.binary = p.binary || null;
      })
      .addCase(startGame.pending, (state) => {
        state.loading = true;
        state.engine.lastError = null;
        state.winningLine = null;
      })
      .addCase(startGame.fulfilled, (state, action) => {
        applyStart(state, action.payload);
        state.engine.lastError = null;
      })
      .addCase(startGame.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'engine start failed';
      })
      .addCase(restoreGame.pending, (state) => {
        state.loading = true;
        state.engine.lastError = null;
      })
      .addCase(restoreGame.fulfilled, (state, action) => {
        applyStart(state, action.payload);
        state.engine.lastError = null;
      })
      .addCase(restoreGame.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'engine restore failed';
      })
      .addCase(movePiece.pending, (state) => {
        state.loading = true;
      })
      .addCase(movePiece.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(movePiece.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'engine move failed';
        // 引擎调用失败时，撤销已经画上的 tempMove，避免 UI 与引擎状态分叉。
        if (state.history.length > 0 && state.status === STATUS.GAMING) {
          const last = state.history.pop();
          state.board[last.i][last.j] = 0;
          refundTime(state, last.role, last.elapsedMs);
          const tail = state.history[state.history.length - 1];
          state.currentPlayer = tail ? -tail.role : 1;
          state.turnStartedAt = Date.now();
        }
      })
      .addCase(undoMove.pending, (state) => { state.loading = true; })
      .addCase(undoMove.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(undoMove.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'engine undo failed';
      })
      .addCase(fetchHint.fulfilled, (state, action) => {
        state.hintMove = action.payload;
      })
      .addCase(fetchHint.rejected, (state) => {
        state.hintMove = null;
      })
      .addCase(endGame.fulfilled, (state) => { resetMatch(state); });
  },
});

export const {
  tempMove, setAiFirst, setTimeLimit, setForbidden, setShowMoveNumbers, setSoundEnabled, setShowHint, setTheme, setDebug,
  setEngineError, applyYixinMove, applyYixinUndo, applyBoardEdit,
  setHintMove, clearHint,
  resign, restartGame, closeResultModal,
} = gameSlice.actions;
export default gameSlice.reducer;
