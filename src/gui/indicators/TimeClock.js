// 共享：时间格式化 + 倒计时 hook + TimeClock 显示组件
//
// 设计：所有"需要每秒刷新的倒计时数字"都通过 useCountdowns() 拿值，
// 内部用一个 module-scope setInterval 统一驱动（避免每个组件各起一个）。
// TimeClock 自身不订阅 Redux（由父组件传 role + timeMs 进来），
// 这样计时器更新时只有 TimeClock 子树 re-render，PlayerCard chrome 不动。

import React, { memo, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { STATUS } from '../../status';

export function formatMs(ms) {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- module-scope 单 ticker（每 250ms 通知一次） ----
const TICK_MS = 250;
const listeners = new Set();
let intervalId = null;
function ensureTicker() {
  if (intervalId != null) return;
  intervalId = setInterval(() => listeners.forEach(fn => fn()), TICK_MS);
}
function subscribe(fn) {
  listeners.add(fn);
  ensureTicker();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

// React 18 useSyncExternalStore 安全（SSR / 并发渲染下不会撕裂）
function useTickNow() {
  return useSyncExternalStore(
    subscribe,
    () => Date.now(),
    () => 0,
  );
}

// ---- useCountdowns：返回双方实时剩余毫秒 ----
export function useCountdowns() {
  const turnStartedAt = useSelector(s => s.game.turnStartedAt);
  const currentPlayer = useSelector(s => s.game.currentPlayer);
  const status = useSelector(s => s.game.status);
  const blackTimeMs = useSelector(s => s.game.blackTimeMs);
  const whiteTimeMs = useSelector(s => s.game.whiteTimeMs);
  const now = useTickNow();

  const isGaming = status === STATUS.GAMING;
  const elapsed = (isGaming && turnStartedAt) ? now - turnStartedAt : 0;
  return {
    black: currentPlayer === 1
      ? Math.max(0, blackTimeMs - elapsed)
      : blackTimeMs,
    white: currentPlayer === -1
      ? Math.max(0, whiteTimeMs - elapsed)
      : whiteTimeMs,
  };
}

// ---- TimeClock：单纯展示。isActive 控制是否闪烁/上色；isIdle 显示"未开始" ----
export const TimeClock = memo(function TimeClock({ timeMs, isActive, isIdle }) {
  if (isIdle) {
    return <div className="player-time idle">--:--</div>;
  }
  const cls =
    timeMs <= 10_000 ? 'player-time danger'
    : timeMs <= 30_000 ? 'player-time warn'
    : 'player-time';
  return <div className={cls}>{formatMs(timeMs)}</div>;
});
