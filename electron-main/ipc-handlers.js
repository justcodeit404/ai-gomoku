// 注册 IPC 通道：渲染进程 ↔ 主进程 ↔ Rapfi 引擎
const { ipcMain, dialog, app, BrowserWindow } = require('electron');
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

function registerEngineIpc() {
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
    bridge = new RapfiBridge({ binaryPath });
    return bridge;
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

  ipcMain.handle('engine:hint', wrap(async (_e, { opts, history, selfRole } = {}) => {
    const binaryPath = resolveRapfiBinary();
    if (!binaryPath) {
      throw new Error('Rapfi engine binary not found (looked in release/rapfi/)');
    }
    const b = new RapfiBridge({ binaryPath });
    try {
      await b.start(opts || {});
      // selfRole: 要提示的一方绝对色(1黑/2白);默认跟 aiFirst
      const side = selfRole === 1 || selfRole === 2
        ? selfRole
        : (opts?.aiFirst ? 1 : 2);
      const move = await b.hint(history || [], side);
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

  // "AI 接手":BOARD 相对色装入后立即应手(AI 执白)
  ipcMain.handle('engine:triggerAiMoveAfterSetup', wrap(async () => {
    const b = await ensureBridge();
    return await b.triggerAiMoveAfterSetup();
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
    // 挂到主窗,避免 Windows 上无 parent 对话框沉到后面
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined;
    const opts = {
      defaultPath: defaultName || '棋谱.json',
      filters: [
        { name: 'JSON 棋谱', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
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
