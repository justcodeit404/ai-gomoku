// Rapfi 引擎二进制路径解析
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const RAPFI_EXE_NAME = 'Rapfi.exe';
const RAPFI_DIR_NAME = 'rapfi';

function candidateDirs() {
  const dirs = [];
  if (app && app.isPackaged) {
    dirs.push(path.join(process.resourcesPath, RAPFI_DIR_NAME));
  }
  dirs.push(path.join(__dirname, '..', 'release', RAPFI_DIR_NAME));
  dirs.push(path.join(__dirname, '..', 'release'));
  return dirs;
}

function tryExists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function findFirstFile(name) {
  for (const d of candidateDirs()) {
    const p = path.join(d, name);
    try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return null;
}

function findRapfiBinary() {
  // 1) 优先使用我们重命名的 Rapfi.exe
  const named = findFirstFile(RAPFI_EXE_NAME);
  if (named) return named;

  // 2) 否则匹配 release/rapfi 下的 pbrain-rapfi-windows-*.exe，优先 sse（兼容最广）
  for (const d of candidateDirs()) {
    const rapfiDir = path.join(d, RAPFI_DIR_NAME);
    const dir = tryExists(rapfiDir) ? rapfiDir : d;
    try {
      const files = fs.readdirSync(dir);
      const candidates = files
        .filter((f) => /^pbrain-rapfi(_windows)?[-_].+\.exe$/i.test(f))
        .sort((a, b) => {
          // sse 最兼容，排最前；avx 次之，avx2 再次之
          const getPriority = (s) => {
            if (/sse/i.test(s)) return 0;
            if (/[_-]avx\.exe$/i.test(s) && !/avx2/i.test(s)) return 1;
            if (/avx2/i.test(s)) return 2;
            if (/avxvnni/i.test(s)) return 3;
            if (/avx512vnni/i.test(s)) return 4;
            if (/avx512/i.test(s)) return 5;
            return 6;
          };
          return getPriority(a) - getPriority(b);
        });
      if (candidates.length > 0) return path.join(dir, candidates[0]);
    } catch (_) { /* ignore */ }
  }
  return null;
}

function resolveRapfiBinary() {
  if (_rapfiCache === null) _rapfiCache = findRapfiBinary();
  return _rapfiCache;
}

function getRapfiDir() {
  const binary = resolveRapfiBinary();
  return binary ? path.dirname(binary) : null;
}

// 缓存：运行期路径不会变，第一次解析后复用
let _rapfiCache = null;

module.exports = {
  resolveRapfiBinary,
  getRapfiDir,
  EXE_NAME: RAPFI_EXE_NAME,
};
