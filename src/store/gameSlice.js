import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { board_size, MATCH_BUDGET_MS, DEFAULT_DEPTH } from '../config';
import { STATUS } from '../status';
import { checkFiveAt, getWinningLine } from '../game';

import {
  start, end, move, undo, probe, restore, hint, setupBoard, triggerAiMoveAfterSetup,
} from '../bridge';

export const probeEngine = createAsyncThunk('game/probeEngine', async () => {
  return await probe();
});

export const startGame = createAsyncThunk('game/start', async ({ board_size, aiFirst, depth, timeLimit, forbiddenEnabled }) => {
  return await start(board_size, aiFirst, depth, timeLimit, forbiddenEnabled);
});

export const restoreGame = createAsyncThunk('game/restore', async ({ board_size, history, currentPlayer, timeLimit, forbiddenEnabled, triggerAiMove, aiFirst: aiFirstArg }, { dispatch, getState }) => {
  // 优先用调用方传入的 aiFirst(棋谱/快照),否则回退到当前设置
  const aiFirst = aiFirstArg !== undefined ? !!aiFirstArg : getState().game.aiFirst;
  const data = await restore(board_size, aiFirst, history, currentPlayer, timeLimit, forbiddenEnabled, triggerAiMove);
  if (data?.aiMove) {
    dispatch(applyYixinMove(data.aiMove));
  }
  return { ...data, aiFirst };
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
  // 提示当前行棋方,BOARD 以 currentPlayer 为"己方"
  return await hint(state.size, state.history, state.forbiddenEnabled, state.currentPlayer);
});

const createEmptyBoard = () => Array.from({ length: board_size }, () => Array(board_size).fill(0));

// 提交摆棋结果:用 BOARD 命令把最终局面装入引擎,引擎按下一步该谁走决定是否立即回应。
// aiFirst 由 store.aiFirst 决定。
// nextPlayer=1(人接手,黑该走):引擎装入不思考,等用户走第一手 → _moveViaBoard 触发应手。
// nextPlayer=-1(AI 接手,白该走):不立即出子,返回 aiTriggerReady。
//   用户点"AI 接手"后 triggerAiAfterSetup 走 BOARD(相对色,AI 白=己方)取应手。
export const commitBoardEdit = createAsyncThunk(
  'game/commitBoardEdit',
  async ({ board, history, currentPlayer }, { getState }) => {
    const { size, timeLimit, forbiddenEnabled } = getState().game;
    // 1. aiFirst=false:避免 BEGIN 污染;摆棋后引擎固定执白
    await start(size, /* aiFirst */ false, /* depth */ DEFAULT_DEPTH, timeLimit, forbiddenEnabled);
    // 2. setupBoard 只标记 fromSetup / aiTriggerReady,真正应手等用户或 AI 接手按钮
    const data = await setupBoard(size, history, currentPlayer);
    // bridge 不返回 board/history,显式补上避免 fulfilled 写成 undefined
    return { ...data, board, history, currentPlayer };
  },
);

// "AI 接手"按钮:BOARD 相对色装入后立即应一手(白)。
export const triggerAiAfterSetup = createAsyncThunk(
  'game/triggerAiAfterSetup',
  async () => {
    return await triggerAiMoveAfterSetup();
  },
);

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
  // AI 评估：winRate 为 AI 视角胜率%(0-100)，来自 Rapfi MESSAGE Eval
  aiEval: null, // { eval, winRate, depth } | null
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
  // 摆棋编辑模式开关:true 时 Board 进入"自由摆放"态。
  // 进入 store 让 ActionBar/键盘/SettingsPanel 等都能感知并拒绝误操作。
  editing: false,
  // 摆棋后 AI 接手等待标记。commitBoardEdit.fulfilled 设置,triggerAiAfterSetup 清掉。
  // sentinelPos 已废弃(旧 YXBOARD+TURN 哨兵),保留字段避免旧 persist 炸。
  sentinelPos: null,
  aiTakeOverReady: false,
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
  state.aiEval = null;
  state.editing = false;
  // 摆棋 AI 接手残留:重开/开局/end 都必须清,否则正常对局会冒出"AI 接手"按钮
  state.sentinelPos = null;
  state.aiTakeOverReady = false;
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

// 设置终局四件套：winner / status / winningLine / showResultModal。
// settleWinner(末位成五) 和 settleWinnerFromBoard(全盘扫) 都调它。
function setTerminal(state, i, j, role) {
  state.winner = role;
  state.status = STATUS.IDLE;
  state.winningLine = getWinningLine(state.board, i, j, role);
  state.showResultModal = true;
}

// 检查最后一步是否获胜，若获胜则设置终局状态并弹出结果弹窗
function settleWinner(state) {
  const winner = checkLastMoveWinner(state.board, state.history);
  if (winner !== null) {
    const last = state.history[state.history.length - 1];
    setTerminal(state, last.i, last.j, last.role);
  }
}

// 全盘扫描是否已有五连：摆棋构造的 history 按 (i,j) 自然序排，
// 末位子未必是成五的那颗，故不能用 settleWinner(只看末位)。
// 命中时返回成五的 (i,j,role)，供上层设置终局；否则返回 null。
// 多处成五时优先返回先扫到的（黑先于白，行优先），不影响判定结论。
function scanWinnerFromBoard(board) {
  const size = board.length;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const role = board[i][j];
      if (role !== 1 && role !== -1) continue;
      if (checkFiveAt(board, i, j, role)) {
        return { i, j, role };
      }
    }
  }
  return null;
}

// 摆棋专用的胜负结算：全盘扫五，命中即设终局 + 弹窗
function settleWinnerFromBoard(state) {
  const hit = scanWinnerFromBoard(state.board);
  if (hit) setTerminal(state, hit.i, hit.j, hit.role);
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
    applyYixinMove: (state, action) => {
      const { i, j, role, winRate, eval: evalScore, depth } = action.payload;
      commitMove(state, role, i, j);
      state.hintMove = null;
      settleWinner(state);
      state.loading = false;
      if (winRate != null || evalScore != null) {
        state.aiEval = {
          eval: evalScore ?? state.aiEval?.eval ?? null,
          winRate: winRate ?? state.aiEval?.winRate ?? null,
          depth: depth ?? state.aiEval?.depth ?? null,
        };
      }
    },
    // 搜索过程中实时更新胜率
    setAiEval: (state, action) => {
      const p = action.payload;
      if (!p || (p.winRate == null && p.eval == null)) return;
      state.aiEval = {
        eval: p.eval ?? null,
        winRate: p.winRate ?? null,
        depth: p.depth ?? null,
      };
    },
    clearAiEval: (state) => { state.aiEval = null; },
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
      state.aiEval = null;
    },
    // 摆棋编辑完成：一次性应用 board/history/currentPlayer
    applyBoardEdit: (state, action) => {
      const p = action.payload || {};
      state.board = p.board;
      state.history = p.history || [];
      state.currentPlayer = p.currentPlayer;
      state.winner = null;
      state.winningLine = null;
      // 摆棋完成 → 由 commitBoardEdit thunk 接管后设置 GAMING，
      // 这里只反映"已摆好棋"的中间态；commit 失败时保持 IDLE。
      state.status = STATUS.IDLE;
      state.loading = false;
      state.turnStartedAt = Date.now();
      state.showResultModal = false;
      state.hintMove = null;
      // 重置双方用时：摆棋另起一局,旧局残量无意义
      state.blackTimeMs = MATCH_BUDGET_MS;
      state.whiteTimeMs = MATCH_BUDGET_MS;
      // 退出编辑态;旧 AI 接手标记清掉,等 commitBoardEdit.fulfilled 再设
      state.editing = false;
      state.sentinelPos = null;
      state.aiTakeOverReady = false;
    },
    // 摆棋模式开关
    setEditing: (state, action) => {
      const next = !!action.payload;
      state.editing = next;
      // 进入编辑态时清掉计时与历史显示,避免 TurnIndicator 还在跑旧局倒计时
      if (next) {
        state.hintMove = null;
        state.loading = false;
      }
    },
    // 摆棋过程中同步本地 editBoard 到 store.board,
    // 让 HeaderBar / 其他只读 store 的组件能即时反映当前摆放状态。
    syncEditBoard: (state, action) => {
      const p = action.payload;
      if (p && Array.isArray(p.board)) {
        state.board = p.board;
      }
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
        if (action.payload?.aiFirst !== undefined) {
          state.aiFirst = !!action.payload.aiFirst;
        }
        state.engine.lastError = null;
      })
      .addCase(restoreGame.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'engine restore failed';
      })
      .addCase(commitBoardEdit.pending, (state) => {
        state.loading = true;
        state.engine.lastError = null;
      })
      .addCase(commitBoardEdit.fulfilled, (state, action) => {
        const p = action.payload || {};
        // 关键修复:state.currentPlayer 已经被 applyBoardEdit(同步 dispatch)正确设过
        // 这里不要从 p.current_player 读(bridge.setupBoard 没返回这个字段,旧代码会写成 undefined)
        // 也不要从 p.currentPlayer 读(thunk 的修复让 p.currentPlayer 是正确的,等价的)
        // 直接保留 applyBoardEdit 设的值即可
        state.board = p.board;
        state.history = p.history;
        state.status = STATUS.GAMING;
        state.turnStartedAt = Date.now();
        state.hintMove = null;
        state.editing = false;
        state.loading = false;
        // 摆棋后引擎固定执白，同步 aiFirst 避免 TurnIndicator/提示错位
        state.aiFirst = false;
        // 摆出的局面可能已经五连（且成五那颗未必在 history 末位），用全盘扫描判定
        settleWinnerFromBoard(state);
        if (p.aiMove && state.status === STATUS.GAMING) {
          // nextPlayer=1(人接手)或 nextPlayer=2(AI 立即应手)时引擎已应手
          const { i, j, role } = p.aiMove;
          commitMove(state, role, i, j);
          // AI 子也可能直接成五，用全盘扫描兜底（末位即 AI 子，等价于 settleWinner 但语义统一）
          settleWinnerFromBoard(state);
        }
        // nextPlayer=-1（AI 接手）时不立即应手，等"AI 接手"按钮
        state.sentinelPos = null;
        state.aiTakeOverReady = !!p.aiTriggerReady;
      })
      .addCase(commitBoardEdit.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'board edit commit failed';
        // 引擎接管失败:回编辑态让用户重试或取消(Board 本地 editBoard 在 commit 时已清空,
        // 这里只能靠 store.board 展示已 applyBoardEdit 的局面;用户可再点摆棋重进)
        state.editing = false;
        state.status = STATUS.IDLE;
        state.sentinelPos = null;
        state.aiTakeOverReady = false;
      })
      .addCase(triggerAiAfterSetup.pending, (state) => {
        state.loading = true;
      })
      .addCase(triggerAiAfterSetup.fulfilled, (state, action) => {
        const p = action.payload || {};
        state.loading = false;
        state.sentinelPos = null;
        state.aiTakeOverReady = false;
        if (p.aiMove && state.status === STATUS.GAMING) {
          const { i, j, role, winRate, eval: evalScore, depth } = p.aiMove;
          commitMove(state, role, i, j);
          settleWinnerFromBoard(state);
          if (winRate != null || evalScore != null) {
            state.aiEval = {
              eval: evalScore ?? null,
              winRate: winRate ?? null,
              depth: depth ?? null,
            };
          }
        }
      })
      .addCase(triggerAiAfterSetup.rejected, (state, action) => {
        state.loading = false;
        state.engine.lastError = action.error?.message || 'AI take over failed';
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
  applyYixinMove, applyYixinUndo, applyBoardEdit,
  setHintMove, clearHint, setEditing, syncEditBoard,
  setAiEval, clearAiEval,
  resign, restartGame, closeResultModal,
} = gameSlice.actions;
export default gameSlice.reducer;
