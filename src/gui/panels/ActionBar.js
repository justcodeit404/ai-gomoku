import React, { useState } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Button, Modal, message } from 'antd';
import {
  startGame, undoMove, resign, restartGame, triggerAiAfterSetup,
} from '../../store/gameSlice';
import { STATUS } from '../../status';
import { DEFAULT_DEPTH } from '../../config';
import { buildGameRecord } from '../../game';

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
  // "AI 接手"按钮:摆棋完成且当前该白走(引擎执白),等用户点一下触发引擎应手。
  // 用高亮 primary 提示用户操作,而不是默认按钮组的一部分。
  const canTriggerAi = isGaming && aiTakeOverReady && !loading && !editing;

  const onStart = () => dispatch(startGame({
    board_size: size, aiFirst, depth: DEFAULT_DEPTH, timeLimit, forbiddenEnabled,
  }));

  const onSaveRecord = async () => {
    const appAPI = (typeof window !== 'undefined' && window.appAPI) || null;
    if (!appAPI) {
      message.error('保存接口不可用', 2);
      return;
    }
    const record = buildGameRecord({
      size, aiFirst, forbiddenEnabled, history, winner, blackTimeMs, whiteTimeMs,
    });
    const defaultName = `棋谱-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    try {
      const result = await appAPI.saveRecord(JSON.stringify(record, null, 2), defaultName);
      if (result?.canceled) return;
      message.success('棋谱已保存', 2);
    } catch (e) {
      message.error(`保存失败：${e.message}`, 2);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-card-title">操作</div>
      <div className="action-stack">
        {canTriggerAi && (
          <Button
            type="primary"
            size="large"
            loading={loading}
            onClick={() => dispatch(triggerAiAfterSetup())}
          >
            AI 接手
          </Button>
        )}
        {canStart ? (
          <Button type="primary" size="large" onClick={onStart}>开始对局</Button>
        ) : (
          <div className="action-row">
            <Button size="large" disabled={!canUndo} onClick={() => setConfirmUndo(true)}>悔棋</Button>
            <Button size="large" danger disabled={!canResign} onClick={() => setConfirmResign(true)}>认输</Button>
          </div>
        )}
        {status !== STATUS.IDLE && (
          <Button size="large" disabled={editing} onClick={() => dispatch(restartGame())}>重新开始</Button>
        )}
        {historyLen > 0 && (
          <Button size="large" disabled={editing} onClick={onSaveRecord}>保存棋谱</Button>
        )}
      </div>

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
