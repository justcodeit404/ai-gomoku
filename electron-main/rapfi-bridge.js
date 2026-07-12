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
    // AI 执子的绝对色:1=黑 2=白。BOARD 协议 field 是相对色(1=己方 2=对方),必须用 selfRole 映射。
    this.selfRole = 2;
    // fromSetup:下一手人走须走 _moveViaBoard(BOARD)。
    // setupGame:整局源自摆棋,undo 不可用 BEGIN/TURN 重放(开局子不是对弈走出来的)。
    this.fromSetup = false;
    this.setupGame = false;
    this._setupNextPlayer = 1;
    // 摆棋首应手后跳过一次防御性同步。
    this._lastMoveFromSetup = false;
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
    // aiFirst=true → AI 执黑(1); false → AI 执白(2)。摆棋路径会再强制 selfRole=2。
    this.selfRole = this.aiFirst ? 1 : 2;
    this.fromSetup = false;
    this.setupGame = false;
    this._setupNextPlayer = 1;
    this._lastMoveFromSetup = false;
    this.history = [];
    // 保存最后一次 start 配置，供 undo 后恢复。
    this._lastStartOpts = {
      size, rule, forbidden, timeoutTurnMs, timeoutMatchMs, timeLeftMs, maxDepth, aiFirst: this.aiFirst,
    };

    await this._sendStartAndConfig();
    await this._replayHistory(history);

    this.cachedForbid = null;
    const firstMove = this.aiFirst && this.history.length > 0 ? this.history[0] : null;
    return { ok: true, firstMove };
  }

  // 用户走了一步 (x, y)。返回引擎的回应 {x, y, role:1|-1}
  // 注意:UI 的 tempMove 已经把用户那一步加进 state.history;
  // 这里维护的引擎侧 history(role 1|2)由用户步 + 引擎回应两步组成,
  // 用于 undo 弹正确步数和 respawn 重放。
  async move(x, y, uiHistory) {
    if (this.fromSetup) {
      return this._moveViaBoard(x, y, uiHistory);
    }

    const wasReady = this.ready();
    await this._respawnIfNeeded();

    // 摆棋场景下 triggerAiAfterSetup 后,引擎侧 this.history 与 UI history 应该完全一致
    // (YXBOARD+TURN 协议不走哨兵、不 push PASS)。但 Rapfi 自动 PASS 翻转 sideToMove 时
    // 内部会 insert 1 个 PASS step,所以引擎侧 history 可能比 UI 多 1 个 PASS 占位。
    // 修复:从 fromSetup 刚被 triggerAiAfterSetup 置 false 后,跳过"防御性同步"避免
    // _syncToHistory 重启引擎丢失 PASS 翻转,导致 Rapfi 应手基于错误局面(撞子 bug)。
    const skipSync = this._lastMoveFromSetup === true;
    if (skipSync) this._lastMoveFromSetup = false;

    // 防御性同步:用 UI history 校验引擎侧历史,若不一致则重放。
    // uiHistory 包含用户刚下的那一步;引擎侧应与之相差最后一步。
    if (!skipSync && uiHistory && Array.isArray(uiHistory)) {
      const expected = uiHistory
        .slice(0, -1)
        .map((h) => ({ x: h.j, y: h.i, role: appRoleToEng(h.role) }));
      const engineHist = this.history;
      const strictMatch = expected.length === engineHist.length
        && expected.every((m, i) =>
          m.x === engineHist[i].x && m.y === engineHist[i].y && m.role === engineHist[i].role);
      // 容差:Rapfi 内部 PASS 不算 history step,但某些路径可能 push 了 PASS 占位,
      // 引擎侧多 1 个 {x:-1,y:-1} PASS 占位也算正常。
      const isPassExtra = engineHist.length === expected.length + 1
        && engineHist[expected.length]?.x === -1 && engineHist[expected.length]?.y === -1
        && engineHist.slice(0, expected.length).every((m, i) =>
          m.x === expected[i].x && m.y === expected[i].y && m.role === expected[i].role);
      if (!strictMatch && !isPassExtra) {
        log.warn('engine history mismatch, resyncing before move',
          'expected=', JSON.stringify(expected), 'this.history=', JSON.stringify(engineHist));
        // 摆棋局不能 BEGIN/TURN 重放开局子,改走 BOARD 全量路径
        if (this.setupGame) {
          this.history = expected;
          return this._moveViaBoard(x, y, uiHistory);
        }
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

  // 用标准 Piskvork BOARD 命令获取当前局面的下一步提示。
  // history 为引擎格式绝对色 [{x, y, role:1|2}]；selfRole 是要提示的那一方绝对色。
  // BOARD field 必须相对 selfRole(1=己 2=敌)。hint 在独立进程,不污染对局。
  async hint(history, selfRole = 1) {
    if (!this.ready()) throw new Error('engine not ready');
    this.selfRole = selfRole === 2 ? 2 : 1;
    const reply = await this._placeBoardAndReply(history || []);
    const [rx, ry] = reply.split(',').map(Number);
    return { x: rx, y: ry };
  }

  // 摆棋接管。
  // 关键:Gomocup BOARD 的 field 是相对色(1=己方 2=对方),不是黑白绝对色。
  // 摆棋后 UI 固定 AI 执白(selfRole=2),装入时必须把白→1、黑→2,否则引擎按执黑搜索。
  // 分路径:
  //   nextPlayer=1 (人接手,黑该走): fromSetup=true,等用户第一手 → _moveViaBoard 走 BOARD 应手
  //   nextPlayer=2 (AI 接手,白该走): fromSetup=true + aiTriggerReady,用户点"AI 接手"后 BOARD 应手
  // history: [{x, y, role:1|2}...] 绝对色黑/白
  // nextPlayer: 1=黑走, 2=白走
  async setupBoard(history, nextPlayer) {
    if (!this.ready()) throw new Error('engine not ready');
    this.history = history.map((h) => ({ x: h.x, y: h.y, role: Number(h.role) }));
    this.cachedForbid = null;
    // 摆棋后引擎固定执白(与 gameSlice aiFirst=false 一致)
    this.selfRole = 2;
    this.aiFirst = false;
    this._setupNextPlayer = nextPlayer === 2 ? 2 : 1;
    this.fromSetup = true;
    this.setupGame = true;

    if (nextPlayer === 2) {
      return { aiMove: null, aiTriggerReady: true };
    }
    return { aiMove: null };
  }

  // "AI 接手":用 BOARD(相对色,AI=白=己方)装入当前局面并立即应手。
  // 不再用 YXBOARD+TURN 空位哨兵——那会让 selfColor 跟首子走,执白局面却按执黑想。
  // 返回: { aiMove: {x, y, role: -1|1} }
  async triggerAiMoveAfterSetup() {
    if (!this.ready()) throw new Error('engine not ready');
    if (!this.fromSetup) throw new Error('engine not in fromSetup state');

    this.selfRole = 2;
    const reply = await this._placeBoardAndReply(this.history);
    const [rx, ry] = reply.split(',').map(Number);
    const aiRole = this.selfRole;
    this.history.push({ x: rx, y: ry, role: aiRole });
    this.fromSetup = false;
    this.cachedForbid = null;
    this._lastMoveFromSetup = true;
    return { aiMove: { x: rx, y: ry, role: engRoleToApp(aiRole) } };
  }

  // ===== BOARD 装入 =====
  // Gomocup BOARD field: 1=己方 2=对方(相对 selfRole),不是黑白绝对色。

  async _sendStartAndConfig() {
    await this._sendAndExpect(`START ${this.size}`, /^OK$/);
    this._sendConfig({
      rule: this.rule,
      timeoutTurnMs: this.timeoutTurnMs,
      timeoutMatchMs: this.timeoutMatchMs,
      timeLeftMs: this.timeLeftMs,
      maxDepth: this.maxDepth,
    });
  }

  async _ensureEngineStarted() {
    const respawned = await this._respawnIfNeeded();
    if (!respawned) return;
    await this._sendStartAndConfig();
  }

  // app/engine history 项 → {x,y,role:1|2} 绝对色
  _toAbsMove(h) {
    if (h.i !== undefined || h.j !== undefined) {
      return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
    }
    const role = Number(h.role);
    return { x: h.x, y: h.y, role: role === 1 ? 1 : 2 };
  }

  // BOARD 命令行(相对 selfRole)。不等待响应。
  _sendBoardLines(historyOrUiHistory) {
    const lines = ['BOARD'];
    const self = this.selfRole === 1 ? 1 : 2;
    for (const h of historyOrUiHistory) {
      const m = this._toAbsMove(h);
      if (m.role !== 1 && m.role !== 2) continue;
      const field = m.role === self ? 1 : 2;
      lines.push(`${m.x},${m.y},${field}`);
    }
    lines.push('DONE');
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    this._sendLine(lines.join('\n'));
  }

  async _expectLine(expect, timeoutMs, label = '<expect>') {
    if (!this.ready()) return Promise.reject(new Error('engine not ready'));
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const entry = { seq, expect, resolve, reject, sent: true, timer: null };
      this.inflight.set(seq, entry);
      entry.timer = setTimeout(() => this._onTimeout(seq, label), timeoutMs || DEFAULT_TIMEOUT_MS);
    });
  }

  // BOARD+DONE 装入并取应手。摆棋/hint/undo 非法序共用。
  async _placeBoardAndReply(historyOrUiHistory) {
    await this._ensureEngineStarted();
    this._sendBoardLines(historyOrUiHistory);
    return this._expectLine(/^\d+,\d+$/, this._stepTimeout(), 'board-reply');
  }

  // 摆棋局下 human 的【第一手】：BOARD(相对色)+DONE 装入"摆棋+人这一手",AI(selfRole)应手,
  // 然后切回 TURN 模式。
  async _moveViaBoard(x, y, uiHistory) {
    // uiHistory 已含用户刚下的这一步(tempMove 已 push)；以此为真源 BOARD 装入。
    const src = (uiHistory && uiHistory.length > 0) ? uiHistory : this.history;
    // 摆棋路径 AI 固定执白;兜底用 selfRole
    this.selfRole = this.selfRole === 1 ? 1 : 2;
    const reply = await this._placeBoardAndReply(src);
    const [rx, ry] = reply.split(',').map(Number);

    // 同步引擎侧 history：uiHistory 已含用户步,只再 push AI 应手(不要 double-push 用户步)。
    const aiRole = this.selfRole;
    this.history = (uiHistory || this.history).map((h) => this._toAbsMove(h));
    this.history.push({ x: rx, y: ry, role: aiRole });
    this.cachedForbid = null;

    this.fromSetup = false;
    this._lastMoveFromSetup = true;

    return { x: rx, y: ry, role: engRoleToApp(aiRole) };
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
    this.selfRole = this.aiFirst ? 1 : 2;

    await this.end();
    await this._respawnIfNeeded();
    await this._sendStartAndConfig();

    // 摆棋整局 / 非交替序：不能 BEGIN/TURN 重放(开局子不是对弈走出,TURN 会错边或卡死)。
    // 一律 BOARD(相对色)装入 remaining,消费并丢弃引擎应手,fromSetup=true 让下一手走 _moveViaBoard。
    // 正常对局且交替合法 → TURN 重放保 hash。
    if (!this.setupGame && this._isAlternatingHistory(remaining)) {
      await this._replayHistory(remaining);
      this.fromSetup = false;
    } else {
      if (remaining.length > 0) {
        await this._placeBoardAndReply(remaining);
      }
      this.fromSetup = true;
    }
    this.history = remaining;
    this.cachedForbid = null;
    return popped;
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
    if (this.ready()) return false;
    log.warn('engine died, respawning', this.proc?.exitCode);
    this._cleanup();
    this._spawn();
    // Rapfi 启动后会先输出 MESSAGE 与 ABOUT 信息，延迟不固定；
    // 等待一小段时间让引擎完成初始化，避免延迟回复污染后续命令匹配。
    await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));
    log.log('engine ready:', this.binaryPath);
    return true;
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
    if (line.startsWith('DEBUG ')) {
      log.log('[debug]', line.slice(6));
    } else if (line.startsWith('ERROR ')) {
      log.warn('[error]', line.slice(6));
    } else if (line === 'UNKNOWN' || line.startsWith('UNKNOWN ')) {
      log.warn('[unknown]', line);
    } else if (line.startsWith('FORBID ')) {
      try {
        this.cachedForbid = this._parseForbid(line);
      } catch (e) {
        log.warn('parse forbid failed', e.message);
      }
    } else if (line.startsWith('MESSAGE ')) {
      // Rapfi 的聊天式输出(开局协议、xy 提示等)目前不向渲染端推送,
      // 留在 log 里供 main 进程日志查阅。
      log.log('[message]', line.slice(8));
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
          log.warn(`replay begin mismatch: got (${rx},${ry}), expected (${first.x},${first.y})`);
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
        log.warn(`replay move mismatch: got (${rx},${ry}), expected (${expectedAi.x},${expectedAi.y})`);
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
    await this._sendStartAndConfig();
    await this._replayHistory(expected);
  }

  // 判断 history 是否为合法交替走序（黑→白→黑→白…），用于 undo 选择 TURN 重放还是 BOARD 装入。
  // 交替性是 TURN 重放的必要条件：Rapfi 对连下同色会卡死。这里只用于选 undo 路径，不用于切模式。
  _isAlternatingHistory(history) {
    for (let i = 1; i < history.length; i++) {
      if (history[i].role === history[i - 1].role) return false;
    }
    return true;
  }

  _stepTimeout() {
    // ponytail: floor 是 15s,GRACE_MS=5s。所以用户选 1s/3s/5s/10s 时实际都拍到 15s;
    // 选 30s 时返回 35s = 30 + grace。这是为了给 Rapfi 启动+首步 search 留余量,
    // 否则会过早 yxstop 拍停导致首步一直落在钝角/均势点。
    // 升级路径:把 yxstop 后的兜底超时做成 INFO timeout_turn 实际值 + GRACE,
    //          让短限时用户能感知到 AI 真的切到快模式。
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
