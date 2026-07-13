import React, { useState } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Button, Modal } from 'antd';
import {
  startGame, undoMove, resign, restartGame, triggerAiAfterSetup,
} from '../../store/gameSlice';
import { STATUS } from '../../status';
import { DEFAULT_DEPTH } from '../../config';
import { saveGameRecord } from '../../persistence/recordStorage';

function ActionBar() {
  const dispatch = useDispatch();
  const {
    status, loading, aiFirst, timeLimit, forbiddenEnabled, size, history, winner,
    blackTimeMs, whiteTimeMs, editing, aiTakeOverReady,
  } = useSelector(s => ({
    status: s.game.status,
    loading: s.game.loading,
    aiFirst: s.game.aiFirst,
    timeLimit: s.game.timeLimit,
    forbiddenEnabled: s.game.forbiddenEnabled,
    size: s.game.size,
    history: s.game.history,
    winner: s.game.winner,
    blackTimeMs: s.game.blackTimeMs,
    whiteTimeMs: s.game.whiteTimeMs,
    editing: s.game.editing,
    aiTakeOverReady: s.game.aiTakeOverReady,
  }), shallowEqual);
  const historyLen = history.length;

  const [confirmUndo, setConfirmUndo] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  const isGaming = status === STATUS.GAMING;
  const canUndo = isGaming && historyLen >= 2 && !loading && !editing;
  const canResign = isGaming && !loading && !editing;
  const canStart = status === STATUS.IDLE && !loading && !editing;
  const canTriggerAi = isGaming && aiTakeOverReady && !loading && !editing;

  const onStart = () => dispatch(startGame({
    board_size: size, aiFirst, depth: DEFAULT_DEPTH, timeLimit, forbiddenEnabled,
  }));

  const onSaveRecord = () => saveGameRecord({
    size, aiFirst, forbiddenEnabled, history, winner, blackTimeMs, whiteTimeMs,
  });

  return (
    <div className="toolbar-actions">
      {canTriggerAi && (
        <Button type="primary" className="btn-cta" loading={loading} onClick={() => dispatch(triggerAiAfterSetup())}>
          AI 接手
        </Button>
      )}
      {canStart ? (
        <Button type="primary" className="btn-cta" onClick={onStart}>开始</Button>
      ) : (
        <>
          <Button disabled={!canUndo} onClick={() => setConfirmUndo(true)}>悔棋</Button>
          <Button danger disabled={!canResign} onClick={() => setConfirmResign(true)}>认输</Button>
        </>
      )}
      {status !== STATUS.IDLE && (
        <Button disabled={editing} onClick={() => dispatch(restartGame())}>重新开始</Button>
      )}
      {historyLen > 0 && (
        <Button type="text" disabled={editing} onClick={onSaveRecord}>保存棋谱</Button>
      )}

      <Modal
        title="确认悔棋"
        open={confirmUndo}
        onOk={() => { setConfirmUndo(false); dispatch(undoMove()); }}
        onCancel={() => setConfirmUndo(false)}
        okText="悔棋"
        cancelText="取消"
        centered
      >
        撤销最近两步（你和 AI 各一步），是否继续？
      </Modal>

      <Modal
        title="确认认输"
        open={confirmResign}
        onOk={() => { setConfirmResign(false); dispatch(resign()); }}
        onCancel={() => setConfirmResign(false)}
        okText="认输"
        okType="danger"
        cancelText="再想想"
        centered
      >
        认输后本局将结束，对方获胜。确定吗？
      </Modal>
    </div>
  );
}

export default ActionBar;
