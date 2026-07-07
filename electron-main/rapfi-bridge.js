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
    // 本局是否源自摆棋：源自摆棋的局，走序可能不合法，不能用 TURN 重放，
    // 一律用 BOARD+DONE 从 UI history 全量重建局面（参照悔棋"以 UI history 为真源"）。
    this.fromSetup = false;
    // triggerAiAfterSetup 完成到下次 move 之间,引擎侧 this.history 比 UI history 多 1 哨兵,
    // move() 路径用此标记跳过"防御性同步"避免 _syncToHistory 重启引擎丢失 PASS 翻转。
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
    this.fromSetup = false;
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

  // 摆棋接管。
  // 关键发现:Rapfi 引擎支持 YXBOARD(Yixin 协议扩展)—— 它与 BOARD 共享同一装入语法,
  // 但装入后**不立即 think() 应手**,保持 sideToMove 等待下一条 TURN 命令。
  // 实测验证:单纯 YXBOARD+DONE 后 Rapfi 静默不输出任何响应,必须再发 TURN x,y 才 search。
  // 与 BOARD+DONE 相比,YXBOARD+TURN 序列能保留 hash 命中,搜索更深、Eval 更真实、棋力不降。
  //
  // 分路径处理(实测确认的方案):
  //   nextPlayer=1 (人接手,黑该走): YXBOARD 装入 → fromSetup=true
  //     → 等用户走第一手 → _moveViaBoard 走 BOARD 装入"摆棋+人第一手"取 AI 应手
  //     → 此时引擎应手时已有 1 个真实走子作为搜索根,搜索更准、Eval 更真实、棋力恢复。
  //   nextPlayer=2 (AI 接手,白该走): YXBOARD 装入 history → fromSetup=true + 返回 sentinelPos
  //     → 让 Rapfi 自动 insert PASS 翻转 sideToMove(YXBOARD 装入时不触发 think,所以 PASS
  //       只是为了内部 sideToMove 标记,不输出应手)。
  //     → 用户点"AI 接手"按钮 → triggerAiMoveAfterSetup 用 YXBOARD 重新装入
  //       "摆棋 history + PASS + 哨兵子"并 TURN 触发应手(走 YXBOARD+TURN 是设计意图,
  //       而不是 YXBOARD+DONE 后再让 Rapfi 立即应手)。
  //     → UI 仅显示 AI 应手;引擎侧 this.history 多 2 步(PASS + 哨兵)作为内部真源。
  // history: [{x, y, role:1|2}...] 已装入棋盘的全部历史子(可能不是真实时序,因为是用户摆的)
  // nextPlayer: 1 或 2,1 表示下一步让黑走,2 表示下一步让白走
  // 返回: { aiMove, sentinelPos?, aiTriggerReady? }
  //   nextPlayer=1: { aiMove: null }    — 等用户走第一手
  //   nextPlayer=2: { aiMove: null, sentinelPos: {x,y}, aiTriggerReady: true }
  //     — 等"AI 接手"按钮触发 triggerAiMoveAfterSetup()
  async setupBoard(history, nextPlayer) {
    if (!this.ready()) throw new Error('engine not ready');
    this.history = history.map((h) => ({ x: h.x, y: h.y, role: Number(h.role) }));
    this.cachedForbid = null;

    if (nextPlayer === 2) {
      // AI 接手(白该走):YXBOARD 装入 history,Rapfi 内部 sideToMove 自然落到白方。
      // 装入完毕 Rapfi 静默不输出,等用户点"AI 接手"按钮触发 triggerAiMoveAfterSetup,
      // 那时再走 YXBOARD+TURN 协议让 AI 应一手。
      // sentinelPos 仅作 UI 占位遮罩用(让用户看到棋盘角落有个"AI 接手"的标记),
      // 不再喂入引擎 history(新方案不需要哨兵)。
      const sentinel = this._pickSentinel();
      await this._placeBoardWithPass(history);
      this.fromSetup = true;
      this.sentinelPos = { x: sentinel.x, y: sentinel.y };
      return {
        aiMove: null,
        sentinelPos: { x: sentinel.x, y: sentinel.y },
        aiTriggerReady: true,
      };
    }

    // 人接手(黑该走):YXBOARD 装入局面不引擎应手,等用户走第一手
    await this._placeBoard(history);
    this.fromSetup = true;
    return { aiMove: null };
  }

  // "AI 接手"按钮触发:用 YXBOARD+TURN 协议让 Rapfi 应一手。
  // YXBOARD 装入摆棋 history,Rapfi 自动 insert PASS 翻转 sideToMove 到 BLACK(执黑 Rapfi 该走)。
  // 然后发 TURN lastWhitePos 触发 Rapfi 应手。
  // sentinelPos 仅作为 UI 占位遮罩,不进入引擎 history。Rapfi 内部 this.history 后续 TURN 会同步。
  // 实测确认:此流程 Eval 立场正确、深度正常、棋力恢复(对比方案 A/B/E2E 错误方案)。
  // 返回: { aiMove: {x, y, role: -1|1} } —— 仅应手。
  async triggerAiMoveAfterSetup(sentinelPos) {
    if (!this.ready()) throw new Error('engine not ready');
    if (!this.fromSetup) throw new Error('engine not in fromSetup state');

    // Rapfi YXBOARD+TURN 协议:
    //   - 装入 history 后 sideToMove 取决于 history 步数奇偶
    //   - TURN x,y 把 x,y 视为"OPPO 刚下的最后一步"。Rapfi 会自动 PASS 翻转 sideToMove
    //     (如果当前 sideToMove 已经是 OPPO 颜色)然后 think 应手。
    //   - TURN 坐标必须是空位 — 实测发现:TURN 已占位坐标会触发 Rapfi 内部 assert 崩溃
    //     (exit 3221225477)。所以用 setupBoard 选的空位哨兵(sentinelPos)作为 TURN 坐标。
    // 验证 sentinelPos 不在 history 中
    const isOccupied = this.history.some((h) => h.x === sentinelPos.x && h.y === sentinelPos.y);
    if (isOccupied) {
      throw new Error(`sentinelPos ${sentinelPos.x},${sentinelPos.y} is occupied by setup history`);
    }

    const reply = await this._yxBoardAndTurn(this.history, sentinelPos);
    const [rx, ry] = reply.split(',').map(Number);

    // 引擎侧 this.history 真源:实测 T2(7,7/8,8 + TURN 8,8)Rapfi 应手 7,5;
    // 实测摆棋 3 步(7,7/8,8/9,9) + TURN 0,0 → Rapfi 应手 9,7。
    // Rapfi 不支持 INFO color 命令,selfColor 由首子决定:
    //   - 首子 role=1 (BLACK) → Rapfi 执黑,应手 role=1
    //   - 首子 role=2 (WHITE) → Rapfi 执白,应手 role=2
    // 不 push PASS(Rapfi 内部 PASS 是虚着,不计 history step)。
    // 这样 this.history 与 Rapfi 内部 history 步数一致,move() 容差比较不会误判。
    const aiRole = this.history.length > 0 ? this.history[0].role : 1;
    this.history.push({ x: rx, y: ry, role: aiRole });
    this.fromSetup = false;
    this.sentinelPos = null;
    this.cachedForbid = null;
    return { aiMove: { x: rx, y: ry, role: engRoleToApp(aiRole) } };
  }

  // 选一个空位作哨兵子:从棋盘角落开始,选第一个不在 history 的点。
  // 哨兵子会进入引擎侧 this.history 但不入 UI history,UI 渲染时由 sentinelPos 屏蔽。
  // 角落 (0,0)/(14,14)/(0,14)/(14,0) 是最不可能撞摆子的位置。
  _pickSentinel() {
    const size = this.size || 15;
    const taken = new Set(this.history.map((h) => `${h.x},${h.y}`));
    const corners = [
      { x: 0, y: 0 },
      { x: size - 1, y: size - 1 },
      { x: 0, y: size - 1 },
      { x: size - 1, y: 0 },
    ];
    for (const c of corners) {
      if (!taken.has(`${c.x},${c.y}`)) return c;
    }
    // 角落都被占了就退而求其次:扫描棋盘找第一个空位(几乎不会发生)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
    throw new Error('no empty cell for sentinel');
  }

  // 用 YXBOARD+DONE 把给定 history 装入引擎。
  // YXBOARD 装入后引擎静默不 think(),等待下一条 TURN 命令触发应手。
  // 用于 nextPlayer=2 摆棋开局:装入 history(奇数步,sideToMove=WHITE)后等 AI 接手按钮。
  // 注意:不再追加 -1,-1 PASS。PASS 让 sideToMove 翻转但触发副作用(Eval 立场错误)。
  // 改成装入完整 history 后让 Rapfi 内部 sideToMove 自然落在白方,triggerAiMoveAfterSetup
  // 再用 YXBOARD+TURN 协议触发应手。
  async _placeBoardWithPass(historyOrUiHistory) {
    const respawned = await this._respawnIfNeeded();
    if (respawned) {
      await this._sendAndExpect(`START ${this.size}`, /^OK$/);
      this._sendConfig({
        rule: this.rule,
        timeoutTurnMs: this.timeoutTurnMs,
        timeoutMatchMs: this.timeoutMatchMs,
        timeLeftMs: this.timeLeftMs,
        maxDepth: this.maxDepth,
      });
    }
    const moves = historyOrUiHistory.map((h) => {
      if (h.i !== undefined || h.j !== undefined) {
        return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
      }
      return { x: h.x, y: h.y, role: Number(h.role) };
    });
    const lines = ['YXBOARD'];
    for (const m of moves) {
      if (m.role === 1 || m.role === 2) lines.push(`${m.x},${m.y},${m.role}`);
    }
    lines.push('DONE');
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    // YXBOARD 装入后引擎不发任何输出(不 think),所以这里不用等任何 expect。
    this._sendLine(lines.join('\n'));
  }

  // 用 YXBOARD+DONE 把给定 history 装入引擎,装入后不引擎应手(不调 think())。
  // history 兼容 app 格式 {i,j,role:1|-1} 与引擎格式 {x,y,role:1|2}。
  // 用于摆棋开局:装入后保持 sideToMove 状态,等待用户 TURN。
  async _placeBoard(historyOrUiHistory) {
    const respawned = await this._respawnIfNeeded();
    if (respawned) {
      await this._sendAndExpect(`START ${this.size}`, /^OK$/);
      this._sendConfig({
        rule: this.rule,
        timeoutTurnMs: this.timeoutTurnMs,
        timeoutMatchMs: this.timeoutMatchMs,
        timeLeftMs: this.timeLeftMs,
        maxDepth: this.maxDepth,
      });
    }
    const moves = historyOrUiHistory.map((h) => {
      if (h.i !== undefined || h.j !== undefined) {
        return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
      }
      return { x: h.x, y: h.y, role: Number(h.role) };
    });
    const lines = ['YXBOARD'];
    for (const m of moves) {
      if (m.role === 1 || m.role === 2) lines.push(`${m.x},${m.y},${m.role}`);
    }
    lines.push('DONE');
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    // YXBOARD 装入后引擎不发任何输出(不 think),所以这里不用等任何 expect。
    this._sendLine(lines.join('\n'));
  }

  // 用 BOARD+DONE 把给定 history(app 格式 {i,j,role:1|-1} 或引擎格式)装入引擎并取应手。
  // 返回引擎应答的原始坐标行(如 "7,8")。每次都全量重建,引擎无内部状态分叉问题。
  // 这是摆棋场景下"以 UI history 为真源重建"的统一入口,被 setupBoard/_moveViaBoard/undo 复用。
  async _placeBoardAndReply(historyOrUiHistory) {
    const respawned = await this._respawnIfNeeded();
    // 摆棋局走序可能非法,引擎可能在任意时刻崩溃重生。重生后的新进程尚未 START,
    // 需先补发 START+config,随后 BOARD+DONE 会把完整局面装回(不能用 _replayHistory)。
    if (respawned) {
      await this._sendAndExpect(`START ${this.size}`, /^OK$/);
      this._sendConfig({
        rule: this.rule,
        timeoutTurnMs: this.timeoutTurnMs,
        timeoutMatchMs: this.timeoutMatchMs,
        timeLeftMs: this.timeLeftMs,
        maxDepth: this.maxDepth,
      });
    }

    // 统一转成引擎格式 {x,y,role:1|2}：兼容 app 格式 {i,j,role:1|-1} 与引擎格式 {x,y,role:1|2}
    const moves = historyOrUiHistory.map((h) => {
      if (h.i !== undefined || h.j !== undefined) {
        return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
      }
      return { x: h.x, y: h.y, role: Number(h.role) };
    });
    const lines = ['BOARD'];
    for (const m of moves) {
      if (m.role === 1 || m.role === 2) lines.push(`${m.x},${m.y},${m.role}`);
    }
    lines.push('DONE');

    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    return this._sendAndExpect(lines.join('\n'), /^\d+,\d+$/, { timeoutMs: this._stepTimeout() });
  }

  // 用 YXBOARD+DONE 装入给定 history(app 格式 {i,j,role:1|-1} 或引擎格式),
  // 然后发 TURN lastOpponentMove 触发引擎应手。这是 Yixin 协议设计意图,
  // 比 BOARD+DONE 棋力更强(hash 命中更准)。仅用于"AI 接手"按钮的 triggerAiMoveAfterSetup。
  // historyOrUiHistory: 摆棋历史 + 哨兵子(role=1)。
  // lastOpponentMove: { x, y } —— 哨兵子的位置,Rapfi 视作"对手(人)刚下的最后一步"。
  async _yxBoardAndTurn(historyOrUiHistory, lastOpponentMove) {
    const respawned = await this._respawnIfNeeded();
    if (respawned) {
      await this._sendAndExpect(`START ${this.size}`, /^OK$/);
      this._sendConfig({
        rule: this.rule,
        timeoutTurnMs: this.timeoutTurnMs,
        timeoutMatchMs: this.timeoutMatchMs,
        timeLeftMs: this.timeLeftMs,
        maxDepth: this.maxDepth,
      });
    }

    const moves = historyOrUiHistory.map((h) => {
      if (h.i !== undefined || h.j !== undefined) {
        return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
      }
      return { x: h.x, y: h.y, role: Number(h.role) };
    });

    // 1) YXBOARD 装入局面 —— Rapfi 装入完毕静默,等待下一条 TURN。
    const yxLines = ['YXBOARD'];
    for (const m of moves) {
      if (m.role === 1 || m.role === 2) yxLines.push(`${m.x},${m.y},${m.role}`);
    }
    yxLines.push('DONE');
    this._sendLine(yxLines.join('\n'));

    // 2) 发 TURN 触发应手。Rapfi 视 lastOpponentMove 为"对手最后一步",然后开始 search。
    this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
    return this._sendAndExpect(
      `TURN ${lastOpponentMove.x},${lastOpponentMove.y}`,
      /^\d+,\d+$/,
      { timeoutMs: this._stepTimeout() }
    );
  }

  // 摆棋局下 human 的【第一手】走子：仅在 nextPlayer=人 时被调用一次。
  // 用 BOARD+DONE 把"摆棋初始局面 + 人这一手"装入引擎,引擎替白(AI)应一手,
  // 然后立即切回 TURN 模式——之后所有人走都走正常 TURN 路径,保留 Rapfi 缓存,棋力正常。
  async _moveViaBoard(x, y, uiHistory) {
    // uiHistory 已含用户刚下的这一步(tempMove 已 push)；以此为真源 BOARD 装入。
    const src = (uiHistory && uiHistory.length > 0) ? uiHistory : this.history;
    const reply = await this._placeBoardAndReply(src);
    const [rx, ry] = reply.split(',').map(Number);

    // 同步引擎侧 history 副本（用于 undo 截断与 ready 判断），真源仍是 UI。
    const lastUser = uiHistory && uiHistory.length > 0 ? uiHistory[uiHistory.length - 1] : null;
    const userRole = lastUser ? (lastUser.role === 1 ? 1 : 2) : (this.history.length % 2 === 0 ? 1 : 2);
    const aiRole = userRole === 1 ? 2 : 1;
    this.history = (uiHistory || this.history).map((h) => ({
      x: h.j !== undefined ? h.j : h.x,
      y: h.i !== undefined ? h.i : h.y,
      role: h.role === 1 ? 1 : 2,
    }));
    this.history.push({ x, y, role: userRole });
    this.history.push({ x: rx, y: ry, role: aiRole });
    this.cachedForbid = null;

    // 第一手完成,局面已是"摆棋初始 + 真实交替走序",后续切回 TURN 保留缓存
    this.fromSetup = false;

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

    // 摆棋局的剩余 history 可能含非法初始走序（黑连下两手等），TURN 重放会让引擎卡死。
    // 用交替性判断选路径：合法交替 → TURN 重放（保留 Rapfi hash 缓存，棋力正常）；
    // 否则 → BOARD 装入 remaining 并消费引擎那手应手，置 fromSetup=true，
    //        让下一手 _moveViaBoard 用 BOARD 装入"remaining+人新一手"取 AI 应手并切回 TURN。
    if (this._isAlternatingHistory(remaining)) {
      await this._replayHistory(remaining);
      this.fromSetup = false;
    } else {
      // BOARD 装入非法局面；DONE 会触发引擎出子，这里消费并丢弃（悔棋后轮到人，不该有 AI 应手）。
      // 丢弃不会污染：下一步 _moveViaBoard 会再次 BOARD 全量重建，引擎内部状态被覆盖。
      const lines = ['BOARD'];
      for (const m of remaining) {
        if (m.role === 1 || m.role === 2) lines.push(`${m.x},${m.y},${m.role}`);
      }
      lines.push('DONE');
      this._sendLine(`INFO time_left ${Math.max(0, this.timeLeftMs | 0)}`);
      await this._sendAndExpect(lines.join('\n'), /^\d+,\d+$/, { timeoutMs: this._stepTimeout() });
      this.fromSetup = true;
    }
    this.history = remaining;
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

  // 判断 history 是否为合法交替走序（黑→白→黑→白…），用于 undo 选择 TURN 重放还是 BOARD 装入。
  // 交替性是 TURN 重放的必要条件：Rapfi 对连下同色会卡死。这里只用于选 undo 路径，不用于切模式。
  _isAlternatingHistory(history) {
    for (let i = 1; i < history.length; i++) {
      if (history[i].role === history[i - 1].role) return false;
    }
    return true;
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
