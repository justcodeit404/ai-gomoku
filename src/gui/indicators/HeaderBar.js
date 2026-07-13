import React, { useMemo } from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { Button } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { STATUS } from '../../status';
import { formatMs, useCountdowns } from './TimeClock';

function HeaderBar({ onOpenHistory }) {
  const { history, editing, board, status, currentPlayer, aiFirst, loading, aiEval } = useSelector(s => ({
    history: s.game.history,
    editing: s.game.editing,
    board: s.game.board,
    status: s.game.status,
    currentPlayer: s.game.currentPlayer,
    aiFirst: s.game.aiFirst,
    loading: s.game.loading,
    aiEval: s.game.aiEval,
  }), shallowEqual);

  const { black, white } = useCountdowns();

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

  const isGaming = status === STATUS.GAMING;
  const blackWho = aiFirst ? 'AI' : '你';
  const whiteWho = aiFirst ? '你' : 'AI';
  const turnLabel = !isGaming
    ? (editing ? '摆棋中' : '准备中')
    : loading
      ? 'AI 思考中'
      : currentPlayer === 1
        ? (aiFirst ? 'AI 行棋' : '你的回合')
        : (aiFirst ? '你的回合' : 'AI 行棋');

  return (
    <header className="app-header hud">
      <div className="app-header-left">
        <div className="app-logo" aria-hidden>五</div>
        <div className="app-title">
          弈心
          <span className="app-title-sub">GOMOKU</span>
        </div>
      </div>

      <div className="hud-center">
        <div className={`hud-clock ${isGaming && currentPlayer === 1 ? 'active' : ''}`}>
          <span className="hud-clock-dot black" />
          <span className="hud-clock-label">黑 · {blackWho}</span>
          <span className="hud-clock-time">{isGaming || history.length ? formatMs(black) : '--:--'}</span>
          <span className="hud-clock-count">{blackCount}</span>
        </div>
        <div className={`hud-turn ${loading ? 'thinking' : ''}`}>
          {turnLabel}
          {loading && <span className="hud-turn-pulse" aria-hidden />}
        </div>
        <div className={`hud-clock ${isGaming && currentPlayer === -1 ? 'active' : ''}`}>
          <span className="hud-clock-dot white" />
          <span className="hud-clock-label">白 · {whiteWho}</span>
          <span className="hud-clock-time">{isGaming || history.length ? formatMs(white) : '--:--'}</span>
          <span className="hud-clock-count">{whiteCount}</span>
        </div>
        {aiEval?.winRate != null && (
          <div
            className={`hud-winrate ${loading ? 'live' : ''}`}
            title={
              aiEval.eval != null
                ? `引擎评估 Eval ${aiEval.eval}${aiEval.depth ? ` · Depth ${aiEval.depth}` : ''}（AI 视角）`
                : 'AI 视角胜率'
            }
          >
            <span className="hud-winrate-label">AI</span>
            <span className="hud-winrate-value">{Number(aiEval.winRate).toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div className="app-header-right">
        {editing && <span className="score-pill edit">编辑</span>}
        <Button
          type="text"
          className="hud-icon-btn"
          icon={<HistoryOutlined />}
          onClick={onOpenHistory}
          title="对局历史"
        />
      </div>
    </header>
  );
}

export default HeaderBar;
