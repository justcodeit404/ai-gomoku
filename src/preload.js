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
  // 探测引擎可用性 / 二进制位置
  probe: () => invoke('engine:probe'),

  // 引擎控制
  start: (opts) => invoke('engine:start', opts),
  begin: () => invoke('engine:begin'),
  move: (x, y, history) => invoke('engine:move', { x, y, history }),
  undo: (steps = 1, history) => invoke('engine:undo', { steps, history }),
  stop: () => invoke('engine:stop'),
  forbid: () => invoke('engine:forbid'),
  hint: (opts, history) => invoke('engine:hint', { opts, history }),
  end: () => invoke('engine:end'),

  // 事件订阅（crash / forbid / message），返回取消订阅函数
  on: (handler) => {
    const wrap = (_event, payload) => {
      try { handler(payload); } catch (_) { /* swallow handler errors */ }
    };
    ipcRenderer.on('engine:event', wrap);
    return () => ipcRenderer.removeListener('engine:event', wrap);
  },
});
