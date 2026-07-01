import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { message } from 'antd';
import Board from './gui/board/Board';
import HeaderBar from './gui/indicators/HeaderBar';
import TurnIndicator from './gui/indicators/TurnIndicator';
import AIProgressBar from './gui/indicators/AIProgressBar';
import SettingsPanel from './gui/panels/SettingsPanel';
import GameResultModal from './gui/modals/GameResultModal';
import ActionBar from './gui/panels/ActionBar';
import DebugPanel from './gui/panels/DebugPanel';
import HistoryPanel from './gui/panels/HistoryPanel';
import { probeEngine, startGame, undoMove, restartGame } from './store/gameSlice';
import { STATUS } from './status';
import { DEFAULT_DEPTH } from './config';
import './App.css';
import './gui/theme/ui.css';

function EngineErrorToast() {
  const error = useSelector(s => s.game.engine.lastError);
  const shownRef = useRef(null);
  useEffect(() => {
    if (!error) {
      shownRef.current = null;
      return;
    }
    if (shownRef.current !== error) {
      shownRef.current = error;
      message.error(`引擎错误：${error}`, 5);
    }
  }, [error]);
  return null;
}

function KeyboardShortcuts() {
  const dispatch = useDispatch();
  const { status, loading, aiFirst, timeLimit, forbiddenEnabled, size, history } = useSelector(s => ({
    status: s.game.status,
    loading: s.game.loading,
    aiFirst: s.game.aiFirst,
    timeLimit: s.game.timeLimit,
    forbiddenEnabled: s.game.forbiddenEnabled,
    size: s.game.size,
    history: s.game.history,
  }));

  useEffect(() => {
    const onKeyDown = (e) => {
      // 忽略输入框内的快捷键
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      // Ctrl/Cmd + Z：悔棋
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (status === STATUS.GAMING && !loading && history.length >= 2) {
          dispatch(undoMove());
        }
        return;
      }

      // Space / Enter：未开始时开局，结束后再来一局
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (status === STATUS.IDLE && !loading) {
          if (history.length > 0) {
            dispatch(restartGame());
          } else {
            dispatch(startGame({
              board_size: size, aiFirst, depth: DEFAULT_DEPTH,
              timeLimit, forbiddenEnabled,
            }));
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, status, loading, aiFirst, timeLimit, forbiddenEnabled, size, history]);

  return null;
}

function App() {
  const dispatch = useDispatch();
  const theme = useSelector(s => s.game.theme);

  useEffect(() => {
    dispatch(probeEngine());
  }, [dispatch]);

  return (
    <div className={`App theme-${theme}`}>
      <HeaderBar />
      <div className="app-body">
        <main className="board-area">
          <Board />
          <GameResultModal />
        </main>
        <aside className="side-panel">
          <TurnIndicator />
          <AIProgressBar />
          <ActionBar />
          <SettingsPanel />
          <HistoryPanel />
          <DebugPanel />
        </aside>
      </div>
      <EngineErrorToast />
      <KeyboardShortcuts />
    </div>
  );
}

export default App;