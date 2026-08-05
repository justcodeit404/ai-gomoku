import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { message, Drawer, ConfigProvider, theme as antTheme, Button } from 'antd';
import Board from './gui/board/Board';
import HeaderBar from './gui/indicators/HeaderBar';
import SettingsPanel from './gui/panels/SettingsPanel';
import GameResultModal from './gui/modals/GameResultModal';
import ActionBar from './gui/panels/ActionBar';
import DebugPanel from './gui/panels/DebugPanel';
import HistoryPanel from './gui/panels/HistoryPanel';
import { probeEngine, startGame, undoMove, restartGame, setAiEval } from './store/gameSlice';
import { STATUS } from './status';
import { DEFAULT_DEPTH } from './config';
import './App.css';
import './gui/theme/ui.css';

function EngineEvalListener() {
  const dispatch = useDispatch();
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.engineAPI : null;
    if (!api?.onEval) return undefined;
    return api.onEval((payload) => {
      if (payload && (payload.winRate != null || payload.eval != null)) {
        dispatch(setAiEval(payload));
      }
    });
  }, [dispatch]);
  return null;
}

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
  const stateRef = useRef({});
  stateRef.current = useSelector((s) => ({
    status: s.game.status,
    loading: s.game.loading,
    aiFirst: s.game.aiFirst,
    timeLimit: s.game.timeLimit,
    forbiddenEnabled: s.game.forbiddenEnabled,
    size: s.game.size,
    historyLen: s.game.history.length,
    editing: s.game.editing,
  }), shallowEqual);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const { status, loading, aiFirst, timeLimit, forbiddenEnabled, size, historyLen, editing } = stateRef.current;
      if (editing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (status === STATUS.GAMING && !loading && historyLen >= 2) dispatch(undoMove());
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (status === STATUS.IDLE && !loading) {
          if (historyLen > 0) dispatch(restartGame());
          else {
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
  }, [dispatch]);
  return null;
}

function IdleBanner() {
  const dispatch = useDispatch();
  const { status, loading, editing, size, aiFirst, timeLimit, forbiddenEnabled, historyLen } = useSelector(s => ({
    status: s.game.status,
    loading: s.game.loading,
    editing: s.game.editing,
    size: s.game.size,
    aiFirst: s.game.aiFirst,
    timeLimit: s.game.timeLimit,
    forbiddenEnabled: s.game.forbiddenEnabled,
    historyLen: s.game.history.length,
  }), shallowEqual);

  if (status !== STATUS.IDLE || loading || editing) return null;

  const onStart = () => {
    if (historyLen > 0) dispatch(restartGame());
    dispatch(startGame({
      board_size: size, aiFirst, depth: DEFAULT_DEPTH, timeLimit, forbiddenEnabled,
    }));
  };

  return (
    <div className="idle-banner">
      <div className="idle-title">五子棋</div>
      <div className="idle-sub">点击开始，或按空格键</div>
      <Button type="primary" size="large" className="idle-cta" onClick={onStart}>
        开始
      </Button>
    </div>
  );
}

function App() {
  const dispatch = useDispatch();
  const theme = useSelector(s => s.game.theme);
  const debug = useSelector(s => s.game.debug);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    dispatch(probeEngine());
  }, [dispatch]);

  const isDark = theme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#60a5fa' : '#2563eb',
          borderRadius: 8,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <div className={`App theme-${theme} minimal`}>
        <HeaderBar onOpenHistory={() => setHistoryOpen(true)} />
        <div className="app-body">
          <div className="main-column">
            <main className="board-area">
              <div className="board-stage">
                <Board />
                <IdleBanner />
              </div>
              <GameResultModal />
            </main>
            <footer className="toolbar">
              <ActionBar />
            </footer>
          </div>
          <aside className="settings-rail" aria-label="设置">
            <div className="settings-rail-title">设置</div>
            <div className="settings-rail-body">
              <SettingsPanel embedded />
              {debug && <DebugPanel />}
            </div>
          </aside>
        </div>

        <Drawer
          title="对局历史"
          placement="right"
          width={360}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          className="arena-drawer"
        >
          <div className="drawer-body history-host">
            <HistoryPanel embedded />
          </div>
        </Drawer>

        <EngineEvalListener />
        <EngineErrorToast />
        <KeyboardShortcuts />
      </div>
    </ConfigProvider>
  );
}

export default App;
