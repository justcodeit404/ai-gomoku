// 注册 IPC 通道：渲染进程 ↔ 主进程 ↔ Rapfi 引擎
const { ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { RapfiBridge } = require('./rapfi-bridge');
const { resolveRapfiBinary } = require('./engine-paths');
const log = require('./logger');

// 统一错误处理：所有 handler 经此返回 {ok, ...payload, error?}
function wrap(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, ...(result || {}) };
    } catch (e) {
      log.warn('IPC error:', e.message);
      return { ok: false, error: e.message };
    }
  };
}

function registerEngineIpc(getMainWindow) {
  let bridge = null;

  function getHistoryPath() {
    return path.join(app.getPath('userData'), 'history.json');
  }

  async function readHistory() {
    const p = getHistoryPath();
    try {
      const raw = await fs.promises.readFile(p, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  async function writeHistory(records) {
    const p = getHistoryPath();
    await fs.promises.writeFile(p, JSON.stringify(records, null, 2), 'utf8');
  }

  async function ensureBridge() {
    if (bridge?.ready()) return bridge;
    if (bridge) {
      await bridge.end().catch(() => {});
      bridge = null;
    }
    log.log('ensureBridge: resolving binary...');
    const binaryPath = resolveRapfiBinary();
    log.log('ensureBridge: binaryPath =', binaryPath);
    if (!binaryPath) {
      throw new Error('Rapfi engine binary not found (looked in release/rapfi/)');
    }
    bridge = new RapfiBridge({
      binaryPath,
      onCrash: (err) => {
        log.warn('crash:', err.message);
        sendEvent('crash', { message: err.message });
      },
      onForbidden: (payload) => sendEvent('forbid', payload),
      onMessage: (payload) => sendEvent('message', payload),
    });
    return bridge;
  }

  function sendEvent(kind, payload) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('engine:event', { kind, ...(payload || {}) });
    }
  }

  ipcMain.handle('engine:probe', wrap(async () => {
    const binary = resolveRapfiBinary();
    return {
      binary,
      bundled: !!binary,
      kind: binary ? 'rapfi' : 'unavailable',
    };
  }));

  ipcMain.handle('engine:start', wrap(async (_e, opts) => {
    const b = await ensureBridge();
    const result = await b.start(opts || {});
    return { kind: b.engineKind(), firstMove: result?.firstMove || null };
  }));

  ipcMain.handle('engine:begin', wrap(async () => {
    const b = await ensureBridge();
    return b.begin();
  }));

  ipcMain.handle('engine:move', wrap(async (_e, { x, y, history } = {}) => {
    const b = await ensureBridge();
    const move = await b.move(x, y, history);
    return { move };
  }));

  ipcMain.handle('engine:undo', wrap(async (_e, { steps, history } = {}) => {
    const b = await ensureBridge();
    const popped = await b.undo(steps || 1, history);
    return { popped };
  }));

  ipcMain.handle('engine:stop', wrap(async () => {
    const b = await ensureBridge();
    return b.forceStop();
  }));

  ipcMain.handle('engine:forbid', wrap(async () => {
    const b = await ensureBridge();
    const points = await b.showForbid();
    return { points };
  }));

  ipcMain.handle('engine:hint', wrap(async (_e, { opts, history } = {}) => {
    const binaryPath = resolveRapfiBinary();
    if (!binaryPath) {
      throw new Error('Rapfi engine binary not found (looked in release/rapfi/)');
    }
    const b = new RapfiBridge({ binaryPath });
    try {
      await b.start(opts || {});
      const move = await b.hint(history || []);
      return { move };
    } finally {
      await b.end().catch(() => {});
    }
  }));

  ipcMain.handle('engine:setupBoard', wrap(async (_e, { history, nextPlayer } = {}) => {
    const b = await ensureBridge();
    const result = await b.setupBoard(history || [], nextPlayer || 1);
    return result;
  }));

  // "AI 接手"按钮触发:用哨兵空位取 AI 应手(PASS 翻转已由 setupBoard 完成)。
  // sentinelPos: {x, y} 引擎坐标。
  ipcMain.handle('engine:triggerAiMoveAfterSetup', wrap(async (_e, { sentinelPos } = {}) => {
    if (!sentinelPos || typeof sentinelPos.x !== 'number' || typeof sentinelPos.y !== 'number') {
      throw new Error('triggerAiMoveAfterSetup: missing sentinelPos');
    }
    const b = await ensureBridge();
    return await b.triggerAiMoveAfterSetup(sentinelPos);
  }));

  ipcMain.handle('history:list', wrap(async () => {
    const records = await readHistory();
    return { records };
  }));

  ipcMain.handle('history:add', wrap(async (_e, { record } = {}) => {
    if (!record || !record.id) throw new Error('record id required');
    const records = await readHistory();
    records.unshift(record);
    const limited = records.slice(0, 200);
    await writeHistory(limited);
    return { count: limited.length };
  }));

  ipcMain.handle('history:delete', wrap(async (_e, { id } = {}) => {
    const records = await readHistory();
    const filtered = records.filter((r) => r.id !== id);
    await writeHistory(filtered);
    return { count: filtered.length };
  }));

  ipcMain.handle('dialog:saveRecord', wrap(async (_e, { content, defaultName } = {}) => {
    const win = getMainWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || '棋谱.json',
      filters: [
        { name: 'JSON 棋谱', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { path: result.filePath };
  }));

  ipcMain.handle('engine:end', wrap(async () => {
    if (bridge) await bridge.end().catch(() => {});
    bridge = null;
    return { ok: true };
  }));

  return {
    shutdown: async () => {
      if (bridge) {
        try { await bridge.end(); } catch (_) {}
        bridge = null;
      }
    },
  };
}

module.exports = { registerEngineIpc };
