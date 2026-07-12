import React, { useMemo } from 'react';
import { useSelector, shallowEqual } from 'react-redux';

function HeaderBar() {
  // 一次 useSelector 拿到三个数据源，editing 切换时才会计 board，否则走 history。
  const { history, editing, board } = useSelector(s => ({
    history: s.game.history,
    editing: s.game.editing,
    board: s.game.board,
  }), shallowEqual);

  const [blackCount, whiteCount] = useMemo(() => {
    if (editing) {
      let b = 0, w = 0;
      for (const row of board) for (const c of row) {
        if (c === 1) b++; else if (c === -1) w++;
      }
      return [b, w];
    }
    let b = 0;
    for (const h of history) if (h.role === 1) b++;
    return [b, history.length - b];
  }, [history, editing, board]);

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">五</div>
        <div className="app-title">
          弈心五子棋
          <span className="app-title-sub">{editing ? '摆棋中' : 'Gomoku'}</span>
        </div>
      </div>

      <div className="app-header-right">
        {editing && <span className="score-pill" style={{ background: 'var(--cinnabar)', color: 'var(--paper-50)' }}>编辑模式</span>}
        <span className="score-pill black">
          <span className="score-pill-dot" />
          黑 {blackCount}
        </span>
        <span style={{ color: 'var(--ink-300)' }}>·</span>
        <span className="score-pill white">
          <span className="score-pill-dot" />
          白 {whiteCount}
        </span>
      </div>
    </header>
  );
}

export default HeaderBar;
