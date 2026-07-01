import React, { useMemo } from 'react';
import { useSelector, shallowEqual } from 'react-redux';

function HeaderBar() {
  const history = useSelector(s => s.game.history, shallowEqual);

  const { blackCount, whiteCount } = useMemo(() => {
    const black = history.reduce((n, h) => h.role === 1 ? n + 1 : n, 0);
    return { blackCount: black, whiteCount: history.length - black };
  }, [history]);

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">五</div>
        <div className="app-title">
          AI 五子棋
          <span className="app-title-sub">Gomoku</span>
        </div>
      </div>

      <div className="app-header-right">
        <span className="score-pill black">
          <span className="score-pill-dot" />
          黑 {blackCount}
        </span>
        <span style={{ color: '#bbb' }}>·</span>
        <span className="score-pill white">
          <span className="score-pill-dot" />
          白 {whiteCount}
        </span>
      </div>
    </header>
  );
}

export default HeaderBar;
