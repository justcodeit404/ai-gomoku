// Electron 主进程 - 集成 Rapfi 引擎的桥接层
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerEngineIpc } = require('./electron-main/ipc-handlers');

// 只允许运行一个实例；重复启动时聚焦到已有窗口
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

let mainWindow = null;
let engineIpc = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    // 等首屏 ready 再显示，避免白屏干等；背景色贴近墨韵主题
    show: false,
    backgroundColor: '#f4f4f5',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'src', 'preload.js'),
      // 渲染进程不需要后台节流以外的花活；关闭拼写检查略减启动开销
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });
  const indexPath = path.join(__dirname, 'build', 'index.html');
  console.log('[Electron] loading', indexPath);
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  engineIpc = registerEngineIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (!engineIpc) return;
  e.preventDefault();
  const shutdownTimeout = setTimeout(() => {
    console.warn('[Electron] engine shutdown timeout, force exit');
    app.exit(0);
  }, 3000);
  try {
    await engineIpc.shutdown();
  } catch (_) {
    // ignore
  }
  clearTimeout(shutdownTimeout);
  engineIpc = null;
  app.quit();
});
