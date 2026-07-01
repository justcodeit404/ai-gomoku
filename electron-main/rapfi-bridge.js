// Rapfi Gomoku engine bridge
// - 单进程长连：spawn 一次复用整个 App 生命周期
// - 协议：Piskvork/Gomocup（BEGIN/TURN/BOARD/END）
// - 崩溃自动 respawn + 用 BEGIN/TURN 重放 history
// - FIFO 请求队列 + 超时 + yxstop 兜底
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const { app } = require('electron');
const log = require('./logger');
const enginePaths = require('./engine-paths');
const resolveRapfiBinary = enginePaths.resolveRapfiBinary || (() => null);
const getRapfiDir = enginePaths.getRapfiDir || (() => null);

log.log('enginePaths loaded:', typeof enginePaths, 'resolveRapfiBinary:', typeof resolveRapfiBinary);

// 引擎坐标：(x=col, y=row, role=1|2)，1=黑、2=白
// App 坐标：(i=row, j=col, role=1|-1)
const appRoleToEng = (role) => (role === 1 ? 1 : 2);
const engRoleToApp = (role) => (role === 1 ? 1 : -1);

// 默认配置（常量化，外部无需覆盖）
const DEFAULT_TIMEOUT_MS = 15000;
const GRACE_MS = 5000;
const STOP_GRACE_MS = 250;
const STARTUP_GRACE_MS = 1200;

class RapfiBridge {
  constructor(opts = {}) {
    this.binaryPath = opts.binaryPath;
    this.onCrash = opts.onCrash || (() => {});
    this.onForbidden = opts.onForbidden || (() => {});
    this.onMessage = opts.onMessage || (() => {});

    this.proc = null;
    this.rl = null;

    this.seq = 0;
    this.inflight = new Map(); // seq -> {resolve, reject, expect, timer, sent}

    // 引擎侧 history（role 1|2）
    this.history = [];
    this.size = 15;
    this.rule = 1;
    this.forbiddenOn = false;
    this.timeLeftMs = 0;
    this.timeoutTurnMs = DEFAULT_TIMEOUT_MS;
    this.timeoutMatchMs = 10 * 60 * 1000;
    this.maxDepth = 0;
    this.cachedForbid = null;
    this.aiFirst = false; // 本局 AI 是否先手
  }

  // ========================== 公开 API ==========================

  ready() {
    return !!(this.proc && this.proc.exitCode === null);
  }

  engineKind() {
    return this.ready() ? 'rapfi' : 'unavailable';
  }

  async start({
    size = 15,
    rule = 1,
    forbidden = false,
    timeoutTurnMs = 5000,
    timeoutMatchMs = 10 * 60 * 1000,
    timeLeftMs = 10 * 60 * 1000,
    maxDepth = 0,
    aiFirst = false,
    history = [],
  }) {
    if (!this.binaryPath) {
      log.log('start: resolving binaryPath via enginePaths');
      this.binaryPath = resolveRapfiBinary();
    }
    if (!this.binaryPath) {
      throw new Error('Rapfi engine binary not found');
    }
    await this._respawnIfNeeded();

    this.size = size;
    this.rule = rule;
    this.forbiddenOn = !!forbidden;
    this.timeLeftMs = timeLeftMs;
    this.timeoutTurnMs = Math.max(100, timeoutTurnMs | 0);
    this.timeoutMatchMs = Math.max(100, timeoutMatchMs | 0);
    this.maxDepth = Math.max(0, maxDepth | 0);
    this.aiFirst = !!aiFirst;
    this.history = [];
    // 保存最后一次 start 配置，供 undo 后恢复。
    this._lastStartOpts = {
      size, rule, forbidden, timeoutTurnMs, timeoutMatchMs, timeLeftMs, maxDepth, aiFirst: this.aiFirst,
    };

    await this._sendAndExpect(`START ${this.size}`, /^OK$/);
    this._sendConfig({
      rule: this.rule,
      timeoutTurnMs: this.timeoutTurnMs,
      timeoutMatchMs: this.timeoutMatchMs,
      timeLeftMs: this.timeLeftMs,
      maxDepth: this.maxDepth,
    });
    await this._replayHistory(history);

    this.cachedForbid = null;
    const firstMove = this.aiFirst && this.history.length > 0 ? this.history[0] : null;
    return { ok: true, firstMove };
  }

  // 用户走了一步 (x, y)。返回引擎的回应 {x, y, role:1|-1}
  // 注意：UI 的 tempMove 已经把用户那一步加进 state.history；
  // 这里维护的引擎侧 history（role 1|2）由用户步 + 引擎回应两步组成，
  // 用于 undo 弹正确步数和 respawn 重放。
  async move(x, y, uiHistory) {
    const wasReady = this.ready();
    await this._respawnIfNeeded();

    // 防御性同步：用 UI history 校验引擎侧历史，若不一致则重放。
    // uiHistory 包含用户刚下的那一步；引擎侧应与之相差最后一步。
    if (uiHistory && Array.isArray(uiHistory)) {
      const expected = uiHistory
        .slice(0, -1)
        .map((h) => ({ x: h.j, y: h.i, role: appRoleToEng(h.role) }));
      const mismatch =
        expected.length !== this.history.length ||
        expected.some((m, i) =>
          m.x !== this.history[i].x ||
          m.y !== this.history[i].y ||
          m.role !== this.history[i].role);
      if (mismatch) {
        log.warn('engine history mismatch, resyncing before move');
        await this._syncToHistory(expected);
      }
    }

    // Rapfi 对 INFO 不回复 OK，直接发送即可。
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);

    const reply = await this._sendAndExpect(
      `TURN ${x},${y}`,
      /^\d+,\d+$/,
      { timeoutMs: this._stepTimeout() },
    );
    const [rx, ry] = reply.split(',').map(Number);

    // 直接从 UI 传入的最近一步拿到用户角色，避免 parity 计算出错。
    const lastUserMove = (uiHistory && uiHistory[uiHistory.length - 1]) || null;
    const userEngineRole = lastUserMove
      ? appRoleToEng(lastUserMove.role)
      : (this.history.length % 2 === 0 ? 1 : 2);
    const engineReplyRole = userEngineRole === 1 ? 2 : 1;
    this.history.push({ x, y, role: userEngineRole });
    this.history.push({ x: rx, y: ry, role: engineReplyRole });
    this.cachedForbid = null;

    return { x: rx, y: ry, role: engRoleToApp(engineReplyRole) };
  }

  // 引擎执黑先行（开局）
  async begin() {
    if (!this.ready()) throw new Error('engine not ready');
    this.aiFirst = true;
    if (this._lastStartOpts) this._lastStartOpts.aiFirst = true;
    // Rapfi 对 INFO 不回复 OK，直接发送即可。
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    const reply = await this._sendAndExpect('BEGIN', /^\d+,\d+$/, { timeoutMs: this._stepTimeout() });
    const [rx, ry] = reply.split(',').map(Number);
    this.history.push({ x: rx, y: ry, role: 1 });
    return { x: rx, y: ry, role: 1 };
  }

  async showForbid() {
    if (!this.ready()) throw new Error('engine not ready');
    if (!this.forbiddenOn) return [];
    const reply = await this._sendAndExpect('yxshowforbid', /^FORBID .+/);
    return this._parseForbid(reply);
  }

  // 用标准 Piskvork BOARD 命令获取当前局面的下一步提示。
  // 调用前需先 start() 配置好 size/rule/time。history 为引擎格式 [{x, y, role}]。
  // 注意：BOARD 只在独立 hint 进程中使用，不进入真实对局，避免状态差异。
  async hint(history) {
    if (!this.ready()) throw new Error('engine not ready');
    const lines = ['BOARD'];
    for (const m of history) {
      const role = Number(m.role);
      if (role === 1 || role === 2) {
        lines.push(`${m.x},${m.y},${role}`);
      }
    }
    lines.push('DONE');
    const reply = await this._sendAndExpect(lines.join('\n'), /^\d+,\d+$/, {
      timeoutMs: 3000,
    });
    const [rx, ry] = reply.split(',').map(Number);
    return { x: rx, y: ry };
  }

  async undo(steps = 1, uiHistory) {
    // UI 一次悔棋撤销 human + AI 两手；引擎 history 与 UI history 一一对应，
    // 因此直接按 UI 步数截取（不再乘以 2）。
    // 关键：以 UI 传入的 history 为准重放，避免 engine history 与 UI history 分叉。
    const n = Math.max(1, steps | 0);
    let remaining;
    if (uiHistory && Array.isArray(uiHistory)) {
      remaining = uiHistory
        .slice(0, Math.max(0, uiHistory.length - n))
        .map((h) => ({ x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 }));
    } else {
      remaining = this.history.slice(0, Math.max(0, this.history.length - n));
    }
    const popped = (uiHistory || this.history).slice(remaining.length);

    // 悔棋后重启一个干净引擎进程，并用 BEGIN/TURN 逐步重放剩余历史。
    // 这样可避免 yxboard/BOARD 设置的局面与真实对局状态不一致。
    const opts = this._lastStartOpts || {};
    this.size = opts.size || this.size || 15;
    this.rule = opts.rule || this.rule || 1;
    this.forbiddenOn = opts.forbidden !== undefined ? !!opts.forbidden : this.forbiddenOn;
    this.timeLeftMs = opts.timeLeftMs || this.timeLeftMs || 10 * 60 * 1000;
    this.timeoutTurnMs = Math.max(100, (opts.timeoutTurnMs || this.timeoutTurnMs || 5000) | 0);
    this.timeoutMatchMs = Math.max(100, (opts.timeoutMatchMs || this.timeoutMatchMs || 10 * 60 * 1000) | 0);
    this.maxDepth = Math.max(0, (opts.maxDepth || this.maxDepth || 0) | 0);
    this.aiFirst = opts.aiFirst !== undefined ? !!opts.aiFirst : this.aiFirst;

    await this.end();
    await this._respawnIfNeeded();
    await this._sendAndExpect(`START ${this.size}`, /^OK$/);
    this._sendConfig({
      rule: this.rule,
      timeoutTurnMs: this.timeoutTurnMs,
      timeoutMatchMs: this.timeoutMatchMs,
      timeLeftMs: this.timeLeftMs,
      maxDepth: this.maxDepth,
    });
    await this._replayHistory(remaining);
    this.cachedForbid = null;
    return popped;
  }

  async forceStop() {
    // 中断引擎当前的搜索，让它立即输出当前最佳着
    if (!this.ready()) throw new Error('engine not ready');
    this._sendLine('yxstop');
    // 等引擎真实响应（最佳着坐标或任意输出），最多 1s
    const reply = await this._waitForLine(1000);
    return { ok: true, reply };
  }

  async end() {
    if (this.proc) {
      try { this._sendLine('END'); } catch (_) { /* swallow */ }
      await new Promise((r) => setTimeout(r, 50));
      this._kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 50));
      if (this.proc && this.proc.exitCode === null) this._kill('SIGKILL');
    }
    this._cleanup();
  }

  // ========================== 内部：进程 ==========================

  async _respawnIfNeeded() {
    if (this.ready()) return;
    log.warn('engine died, respawning', this.proc?.exitCode);
    this._cleanup();
    this._spawn();
    // Rapfi 启动后会先输出 MESSAGE 与 ABOUT 信息，延迟不固定；
    // 等待一小段时间让引擎完成初始化，避免延迟回复污染后续命令匹配。
    await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));
    log.log('engine ready:', this.binaryPath);
  }

  _spawn() {
    log.log('spawning', this.binaryPath);
    // Rapfi 需要读取同目录下的 config.toml 与权重文件，因此 cwd 设为二进制所在目录
    const cwd = getRapfiDir() || path.dirname(this.binaryPath);
    this.proc = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      cwd,
    });
    this.proc.on('error', (err) => {
      log.error('spawn error', err.message);
      this._markDead(err);
    });
    this.proc.on('exit', (code, signal) => {
      log.warn('engine exit', { code, signal });
      this._markDead(new Error(`engine exited code=${code} signal=${signal}`));
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (raw) => this._onLine(raw));
    this.proc.stderr.on('data', (b) => {
      const s = b.toString();
      if (s.trim()) log.warn('[stderr]', s.trim());
    });
  }

  _kill(sig) {
    try {
      if (this.proc && this.proc.exitCode === null) this.proc.kill(sig);
    } catch (_) { /* ignore */ }
  }

  _cleanup() {
    if (this.rl) {
      this.rl.removeAllListeners('line');
      try { this.rl.close(); } catch (_) {}
      this.rl = null;
    }
    this.proc = null;
    // 拒绝所有 inflight
    for (const [, e] of this.inflight) {
      clearTimeout(e.timer);
      e.reject(new Error('engine unavailable'));
    }
    this.inflight.clear();
  }

  _markDead(err) {
    const wasReady = this.ready();
    this._cleanup();
    if (wasReady) {
      try { this.onCrash(err); } catch (_) {}
    }
  }

  _sendLine(line) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('engine stdin closed');
    }
    this.proc.stdin.write(line + '\n');
  }

  _sendRaw(text) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('engine stdin closed');
    }
    this.proc.stdin.write(text);
  }

  // ========================== 内部：协议 ==========================

  _onLine(raw) {
    const line = raw.replace(/\r$/, '');
    if (!line) return;

    // 匹配最早的、未完成的 inflight（已发出且 expect 匹配的）
    const first = this.inflight.values().next().value;
    if (first && first.sent && line.match(first.expect)) {
      this.inflight.delete(first.seq);
      clearTimeout(first.timer);
      first.resolve(line);
      return;
    }

    // 未匹配的旁路
    if (line.startsWith('MESSAGE ')) {
      this.onMessage({ kind: 'message', text: line.slice(8) });
    } else if (line.startsWith('DEBUG ')) {
      log.log('[debug]', line.slice(6));
    } else if (line.startsWith('ERROR ')) {
      log.warn('[error]', line.slice(6));
    } else if (line === 'UNKNOWN' || line.startsWith('UNKNOWN ')) {
      log.warn('[unknown]', line);
    } else if (line.startsWith('FORBID ')) {
      try {
        const pts = this._parseForbid(line);
        this.cachedForbid = pts;
        this.onForbidden({ kind: 'forbid', points: pts });
      } catch (e) {
        log.warn('parse forbid failed', e.message);
      }
    } else {
      log.log('[unmatched]', line);
    }
  }

  // 发一行并期待匹配 expect；返回匹配到的行原文
  _sendAndExpect(line, expect, opts = {}) {
    if (!this.ready()) {
      return Promise.reject(new Error('engine not ready'));
    }
    const seq = ++this.seq;
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const entry = { seq, expect, resolve, reject, sent: false, timer: null };
      this.inflight.set(seq, entry);
      entry.timer = setTimeout(() => this._onTimeout(seq, line), timeoutMs);
      try {
        this._sendLine(line);
        entry.sent = true;
      } catch (e) {
        clearTimeout(entry.timer);
        this.inflight.delete(seq);
        reject(e);
      }
    });
  }

  // 不发命令，只等下一行输出（用于 yxstop 等场景）
  _waitForLine(timeoutMs = STOP_GRACE_MS) {
    return new Promise((resolve) => {
      const seq = ++this.seq;
      const entry = { seq, expect: /^.+$/, resolve, reject: resolve, sent: false, timer: null };
      this.inflight.set(seq, entry);
      entry.timer = setTimeout(() => {
        if (this.inflight.has(seq)) {
          this.inflight.delete(seq);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  _onTimeout(seq, line) {
    const e = this.inflight.get(seq);
    if (!e) return;
    log.warn(`timeout on seq=${seq} line="${line}", sending yxstop`);
    try { this._sendLine('yxstop'); } catch (_) {}
    setTimeout(() => {
      if (this.inflight.has(seq)) {
        this.inflight.delete(seq);
        const err = new Error(`engine timeout after yxstop: ${line}`);
        try { e.reject(err); } catch (_) { /* ignore */ }
        this._markDead(err);
      }
    }, STOP_GRACE_MS);
  }

  _sendConfig({ rule, timeoutTurnMs, timeoutMatchMs, timeLeftMs, maxDepth }) {
    // 一次性批量发送所有 INFO（不阻塞）。
    // Rapfi 对 INFO 不单独回复 OK，因此只发送不等待。
    const lines = [`INFO rule ${rule}`];
    if (rule === 2) lines.push('yxhashclear');
    lines.push(`INFO timeout_turn ${timeoutTurnMs}`);
    lines.push(`INFO timeout_match ${timeoutMatchMs}`);
    lines.push(`INFO time_left ${timeLeftMs}`);
    if (maxDepth > 0) lines.push(`INFO max_depth ${maxDepth}`);
    this._sendRaw(lines.join('\n') + '\n');
  }

  // 用 BEGIN/TURN 逐步重放历史，确保引擎内部状态与真实对局一致。
  // history 为引擎格式 [{x, y, role}]，role=1 黑、role=2 白。
  // 重放时 AI 的应手始终以引擎实际回应为准，避免 this.history 与引擎内部状态脱节。
  async _replayHistory(history) {
    this.history = [];
    let i = 0;

    if (this.aiFirst) {
      this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
      const reply = await this._sendAndExpect('BEGIN', /^\d+,\d+$/, { timeoutMs: this._stepTimeout() });
      const [rx, ry] = reply.split(',').map(Number);
      if (i < history.length) {
        const first = history[i];
        if (rx !== first.x || ry !== first.y) {
          const msg = `replay begin mismatch: got (${rx},${ry}), expected (${first.x},${first.y})`;
          log.warn(msg);
          this.onMessage({ kind: 'message', text: `WARNING ${msg}` });
        }
      }
      // 以引擎真实回应为准，保证后续 TURN 与引擎内部局面一致。
      this.history.push({ x: rx, y: ry, role: 1 });
      i++;
    }

    while (i < history.length) {
      const humanMove = history[i];
      const expectedAi = history[i + 1] || null;
      this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
      const reply = await this._sendAndExpect(
        `TURN ${humanMove.x},${humanMove.y}`,
        /^\d+,\d+$/,
        { timeoutMs: this._stepTimeout() },
      );
      const [rx, ry] = reply.split(',').map(Number);
      if (expectedAi && (rx !== expectedAi.x || ry !== expectedAi.y)) {
        const msg = `replay move mismatch: got (${rx},${ry}), expected (${expectedAi.x},${expectedAi.y})`;
        log.warn(msg);
        this.onMessage({ kind: 'message', text: `WARNING ${msg}` });
      }
      this.history.push({ x: humanMove.x, y: humanMove.y, role: humanMove.role });
      // 以引擎实际回应为准，保证 this.history 与引擎内部状态一致。
      this.history.push({
        x: rx,
        y: ry,
        role: humanMove.role === 1 ? 2 : 1,
      });
      i += 2;
    }
  }

  async _syncToHistory(expected) {
    // 引擎状态与 expected 不一致时，重启引擎并完整重放 expected。
    await this.end();
    await this._respawnIfNeeded();
    await this._sendAndExpect(`START ${this.size}`, /^OK$/);
    this._sendConfig({
      rule: this.rule,
      timeoutTurnMs: this.timeoutTurnMs,
      timeoutMatchMs: this.timeoutMatchMs,
      timeLeftMs: this.timeLeftMs,
      maxDepth: this.maxDepth,
    });
    await this._replayHistory(expected);
  }

  _stepTimeout() {
    return Math.max(DEFAULT_TIMEOUT_MS, this.timeoutTurnMs + GRACE_MS);
  }

  _parseForbid(line) {
    const m = FORBID_RE.exec(line);
    if (!m) return [];
    const digits = m[1].replace(/\.$/, '');
    const out = [];
    for (let i = 0; i + 3 < digits.length; i += 4) {
      const x = parseInt(digits.substr(i, 2), 10);
      const y = parseInt(digits.substr(i + 2, 2), 10);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    }
    return out;
  }
}

// FORBID x1y1x2y2...（数字可能前导零，每 x/y 2 位；末位是 '.'）
const FORBID_RE = /^FORBID (.+)\.?$/;

module.exports = { RapfiBridge };
