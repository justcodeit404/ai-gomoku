import React, { useEffect, useState } from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { engineKindLabel } from './engine-label';

const TICK_MS = 200;

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
    <div className="ai-strip" role="status" aria-live="polite">
      <span className="ai-strip-label">
        <span className="dot" />
        {engineKindLabel(engineKind)} 思考中
      </span>
      <div className="ai-strip-bar">
        <div className="ai-strip-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ai-strip-pct">{Math.round(pct)}%</span>
    </div>
  );
}

export default AIProgressBar;
