import React, { useMemo } from 'react';
import { useSelector, shallowEqual } from 'react-redux';

function DebugPanel() {
  const visible = useSelector(s => s.game.debug);
  const data = useSelector(s => {
    if (!s.game.debug) return null;
    return { history: s.game.history, engine: s.game.engine };
  }, shallowEqual);

  const historyShort = useMemo(
    () => visible && data?.history?.length ? JSON.stringify(data.history.map(h => [h.i, h.j])) : '',
    [visible, data],
  );

  if (!visible || !data) return null;

  const { engine } = data;
  const engineError = engine?.lastError;

  return (
    <div className="panel-card">
      <div className="panel-card-title">调试</div>
      <div className="debug-panel">
        <div className="debug-panel-row"><span className="debug-panel-key">历史</span><span className="debug-panel-value">{historyShort}</span></div>
        <div className="debug-panel-row"><span className="debug-panel-key">引擎</span><span className="debug-panel-value">{engine?.kind} / bundled={String(!!engine?.bundled)}</span></div>
        {engineError && <div className="debug-panel-row"><span className="debug-panel-key">错误</span><span className="debug-panel-value" style={{ color: '#ff4d4f' }}>{engineError}</span></div>}
      </div>
    </div>
  );
}

export default DebugPanel;
