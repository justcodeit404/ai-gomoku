// Preload: 通过 contextBridge 暴露 window.engineAPI 给渲染进程。
// 不暴露 child_process 或 fs，保持 contextIsolation 安全。
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('appAPI', {
  saveRecord: (content, defaultName) => invoke('dialog:saveRecord', { content, defaultName }),
  historyList: () => invoke('history:list'),
  historyAdd: (record) => invoke('history:add', { record }),
  historyDelete: (id) => invoke('history:delete', { id }),
});

contextBridge.exposeInMainWorld('engineAPI', {
  probe: () => invoke('engine:probe'),
  start: (opts) => invoke('engine:start', opts),
  move: (x, y, history) => invoke('engine:move', { x, y, history }),
  undo: (steps = 1, history) => invoke('engine:undo', { steps, history }),
  hint: (opts, history, selfRole) => invoke('engine:hint', { opts, history, selfRole }),
  setupBoard: (history, nextPlayer) => invoke('engine:setupBoard', { history, nextPlayer }),
  triggerAiMoveAfterSetup: () => invoke('engine:triggerAiMoveAfterSetup'),
  end: () => invoke('engine:end'),
});
