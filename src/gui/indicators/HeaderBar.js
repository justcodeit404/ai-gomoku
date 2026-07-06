import React, { useMemo } from 'react';
import { useSelector, shallowEqual } from 'react-redux';

function HeaderBar() {
  // 摆棋模式下显示 editBoard 的实时统计,而不是 store.history
  const { history, editing } = useSelector(s => ({
    history: s.game.history,
    editing: s.game.editing,
  }), shallowEqual);

  const { blackCount, whiteCount } = useMemo(() => {
    if (editing) {
      // editing 时读 board,Board 组件会注入;这里从 store.board 计算
      return { blackCount: 0, whiteCount: 0 };
    }
    const black = history.reduce((n, h) => h.role === 1 ? n + 1 : n, 0);
    return { blackCount: black, whiteCount: history.length - black };
  }, [history, editing]);

  // 在 editing 时,从 store.board 统计(因为 applyBoardEdit 还没把 editBoard 写进 store 前,
  // 统计会滞后,但 applyBoardEdit 提交后即同步;若需更即时,可在 store.editing 时另读 board)
  const liveBoard = useSelector(s => s.game.board, shallowEqual);
  const live = useMemo(() => {
    if (!editing) return null;
    let b = 0, w = 0;
    for (const row of liveBoard) for (const c of row) {
      if (c === 1) b++; else if (c === -1) w++;
    }
    return { b, w };
  }, [editing, liveBoard]);

  const displayBlack = editing && live ? live.b : blackCount;
  const displayWhite = editing && live ? live.w : whiteCount;

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
          黑 {displayBlack}
        </span>
        <span style={{ color: 'var(--ink-300)' }}>·</span>
        <span className="score-pill white">
          <span className="score-pill-dot" />
          白 {displayWhite}
        </span>
      </div>
    </header>
  );
}

export default HeaderBar;
