// 渲染进程 ↔ Rapfi 引擎桥接（唯一引擎）
//
// 坐标：
//   app (i=row, j=col, role:1|-1) ↔ rapfi (x=col, y=row, role:1|2)
import { MATCH_BUDGET_MS, DEFAULT_DEPTH } from './config';

let activeSession = false;

const api = () => (typeof window !== 'undefined' && window.engineAPI) || null;

// ===== 坐标与角色转换 =====
// app 坐标 (i,j) → engine 坐标 (x=col=j, y=row=i)
const appToEngine = (i, j) => ({ x: j, y: i });
// engine 坐标 (x,y) → app 坐标 (i=row=y, j=col=x)
const engineToApp = (x, y) => ({ i: y, j: x });
// app role (1|-1) ↔ engine role (1|2)
const appRoleToEng = (role) => (role === 1 ? 1 : 2);
const engRoleToApp = (role) => (role === 1 ? 1 : -1);

const createEmptyBoard = (size) => Array.from({ length: size }, () => new Array(size).fill(0));

const toEngineOpts = (size, depth, timeLimit, forbiddenEnabled, aiFirst, history) => ({
  size,
  rule: forbiddenEnabled ? 2 : 1,
  timeoutTurnMs: timeLimit,
  timeoutMatchMs: MATCH_BUDGET_MS,
  timeLeftMs: MATCH_BUDGET_MS,
  maxDepth: depth,
  aiFirst,
  history,
});

function buildBoardData(size, engineFirstMove) {
  const board = createEmptyBoard(size);
  const history = [];
  let currentPlayer = 1;
  if (engineFirstMove) {
    const { i, j } = engineToApp(engineFirstMove.x, engineFirstMove.y);
    const role = engRoleToApp(engineFirstMove.role);
    board[i][j] = role;
    history.push({ i, j, role });
    currentPlayer = -role;
  }
  return {
    board,
    winner: 0,
    current_player: currentPlayer,
    history,
    size,
  };
}

function buildBoardFromHistory(size, history) {
  const board = createEmptyBoard(size);
  for (const h of history || []) {
    if (h.i >= 0 && h.i < size && h.j >= 0 && h.j < size) {
      board[h.i][h.j] = h.role;
    }
  }
  return board;
}

// ===== 公开 API =====

export const probe = async () => {
  const engineAPI = api();
  if (!engineAPI) {
    return { kind: 'unavailable', bundled: false };
  }
  try {
    return await engineAPI.probe();
  } catch (e) {
    return { kind: 'unavailable', bundled: false, error: e.message };
  }
};

export const start = async (board_size, aiFirst, depth, timeLimit, forbiddenEnabled) => {
  const engineAPI = api();
  if (!engineAPI) {
    throw new Error('Rapfi engine API not available');
  }
  const opts = toEngineOpts(board_size, depth, timeLimit, forbiddenEnabled, aiFirst, []);
  const r = await engineAPI.start(opts);
  if (!r || !r.ok) {
    throw new Error(r?.error || 'Rapfi engine failed to start');
  }
  activeSession = true;

  const engineFirst = r.firstMove || null;
  return buildBoardData(board_size, engineFirst);
};

// 根据已有历史局面恢复对局。
// triggerAiMove=true 时，把最后一步当作“用户刚下”发给引擎，让引擎立即回应一步。
export const restore = async (board_size, aiFirst, history, currentPlayer, timeLimit, forbiddenEnabled, triggerAiMove = false) => {
  const engineAPI = api();
  if (!engineAPI) {
    throw new Error('Rapfi engine API not available');
  }
  const full = history || [];
  const feedHistory = triggerAiMove && full.length > 0 ? full.slice(0, -1) : full;
  const engineHistory = feedHistory.map((h) => ({
    x: h.j,
    y: h.i,
    role: appRoleToEng(h.role),
  }));
  const opts = toEngineOpts(board_size, DEFAULT_DEPTH, timeLimit, forbiddenEnabled, aiFirst, engineHistory);
  const r = await engineAPI.start(opts);
  if (!r || !r.ok) {
    throw new Error(r?.error || 'Rapfi engine failed to restore');
  }
  activeSession = true;

  let aiMove = null;
  if (triggerAiMove && full.length > 0) {
    const last = full[full.length - 1];
    const reply = await move([last.i, last.j], feedHistory);
    if (reply?.yixinDeltaMove) {
      aiMove = reply.yixinDeltaMove;
    }
  }

  const finalHistory = aiMove ? [...full, aiMove] : full;
  return {
    board: buildBoardFromHistory(board_size, finalHistory),
    current_player: aiMove ? -aiMove.role : currentPlayer,
    winner: 0,
    history: finalHistory,
    size: board_size,
    aiMove,
  };
};

export const move = async (position, history) => {
  const engineAPI = api();
  if (!engineAPI || !activeSession) {
    throw new Error('Rapfi engine not active');
  }
  const [i, j] = position;
  const { x, y } = appToEngine(i, j);
  const r = await engineAPI.move(x, y, history);
  if (!r || !r.move) {
    throw new Error(r?.error || 'Rapfi engine did not return a move');
  }
  const m = engineToApp(r.move.x, r.move.y);
  return {
    yixinDeltaMove: {
      ...m,
      role: r.move.role,
      eval: r.move.eval,
      winRate: r.move.winRate,
      depth: r.move.depth,
    },
  };
};

export const undo = async (history) => {
  const engineAPI = api();
  if (!engineAPI || !activeSession) {
    throw new Error('Rapfi engine not active');
  }
  const r = await engineAPI.undo(2, history);
  if (!r || !r.ok) {
    throw new Error(r?.error || 'Rapfi engine undo failed');
  }
  return { yixinUndoSteps: 2 };
};

export const end = async () => {
  activeSession = false;
  const engineAPI = api();
  if (engineAPI) {
    try { await engineAPI.end(); } catch (_) {}
  }
  return { ok: true };
};

// 获取当前局面的提示着法（不写入真实对局）。
// currentPlayer: app 1|-1,提示该谁走就以谁为 BOARD 的"己方"。
export const hint = async (board_size, history, forbiddenEnabled, currentPlayer = 1) => {
  const engineAPI = api();
  if (!engineAPI) {
    throw new Error('Rapfi engine API not available');
  }
  const engineHistory = (history || []).map((h) => ({
    x: h.j,
    y: h.i,
    role: appRoleToEng(h.role),
  }));
  const selfRole = appRoleToEng(currentPlayer);
  // aiFirst=false: hint 子进程不要 BEGIN;selfRole 单独传给 BOARD 相对色映射
  const opts = toEngineOpts(board_size, 10, 1000, forbiddenEnabled, false, []);
  const reply = await engineAPI.hint(opts, engineHistory, selfRole);
  // IPC wrap 返回 { ok, move: {x,y} }
  const m = reply?.move || reply;
  if (!m || typeof m.x !== 'number') {
    throw new Error('Rapfi engine did not return a hint');
  }
  return engineToApp(m.x, m.y);
};

// 摆棋接管:标记 fromSetup,等用户走第一手或"AI 接手"按钮再 BOARD 应手。
// history: app 格式 [{i, j, role:1|-1}],currentPlayer: 1|-1(下一步该谁走)
// 返回: { aiMove: null, boardSize, aiTriggerReady?: bool }
export const setupBoard = async (board_size, history, currentPlayer) => {
  const engineAPI = api();
  if (!engineAPI) {
    throw new Error('Rapfi engine API not available');
  }
  const engineHistory = (history || []).map((h) => ({
    x: h.j,
    y: h.i,
    role: appRoleToEng(h.role),
  }));
  const nextPlayerEngine = appRoleToEng(currentPlayer);
  const r = await engineAPI.setupBoard(engineHistory, nextPlayerEngine);
  if (r?.aiTriggerReady) {
    return { aiMove: null, boardSize: board_size, aiTriggerReady: true };
  }
  return { aiMove: null, boardSize: board_size };
};

// 触发"AI 接手":BOARD 相对色(AI 白=己方)装入后立即应手。
// 返回: { aiMove: {i, j, role} }
export const triggerAiMoveAfterSetup = async () => {
  const engineAPI = api();
  if (!engineAPI) {
    throw new Error('Rapfi engine API not available');
  }
  const r = await engineAPI.triggerAiMoveAfterSetup();
  if (!r?.aiMove) {
    throw new Error('Rapfi engine did not return an AI move');
  }
  const m = engineToApp(r.aiMove.x, r.aiMove.y);
  return {
    aiMove: {
      ...m,
      role: r.aiMove.role,
      eval: r.aiMove.eval,
      winRate: r.aiMove.winRate,
      depth: r.aiMove.depth,
    },
  };
};
