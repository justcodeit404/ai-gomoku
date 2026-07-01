import React, { useEffect, useState } from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { engineKindLabel } from './engine-label';

// 采样间隔放宽到 500ms：CSS transition (200ms) 已负责丝滑过渡，
// JS 端无需 10Hz 刷新。
const TICK_MS = 500;

function AIProgressBar() {
  const { loading, timeLimit, engineKind } = useSelector(s => ({
    loading: s.game.loading,
    timeLimit: s.game.timeLimit,
    engineKind: s.game.engine.kind,
  }), shallowEqual);

  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!loading) { setPct(0); return; }
    const start = Date.now();
    const t = setInterval(() => {
      const elapsed = Date.now() - start;
      const ratio = Math.min(0.95, elapsed / Math.max(timeLimit, 1000));
      setPct(ratio * 100);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [loading, timeLimit]);

  if (!loading) return null;

  return (
    <div className="panel-card">
      <div className="panel-card-title">AI 思考</div>
      <div className="ai-progress">
        <div className="ai-progress-meta">
          <span className="ai-progress-engine">
            <span className="dot" />
            {engineKindLabel(engineKind)}
          </span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="ai-progress-bar">
          <div className="ai-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export default AIProgressBar;
