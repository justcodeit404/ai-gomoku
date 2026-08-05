import React, { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Button, message } from 'antd';
import { startGame, closeResultModal } from '../../store/gameSlice';
import { DEFAULT_DEPTH } from '../../config';
import { formatMs } from '../indicators/TimeClock';
import { formatGameRecord, buildGameRecord } from '../../game';
import { saveGameRecord } from '../../persistence/recordStorage';

function GameResultModal() {
  const dispatch = useDispatch();
  const visible = useSelector(s => s.game.showResultModal);
  const savedRef = useRef(false);
  const lastSignatureRef = useRef('');
  const data = useSelector(s => {
    if (!visible) return null;
    const { winner, aiFirst, timeLimit, forbiddenEnabled, size, history, blackTimeMs, whiteTimeMs } = s.game;
    return {
      winner,
      aiFirst,
      timeLimit,
      forbiddenEnabled,
      size,
      history,
      historyLen: history.length,
      blackTimeMs,
      whiteTimeMs,
    };
  }, shallowEqual);

  const onCopyRecord = useCallback(() => {
    if (!data?.history) return;
    const text = formatGameRecord(data.history);
    navigator.clipboard.writeText(text).then(() => {
      message.success('棋谱已复制到剪贴板', 2);
    }).catch(() => {
      message.error('复制失败', 2);
    });
  }, [data]);

  const onSaveRecord = useCallback(() => {
    if (!data?.history) return;
    saveGameRecord({
      size: data.size,
      aiFirst: data.aiFirst,
      forbiddenEnabled: data.forbiddenEnabled,
      history: data.history,
      winner: data.winner,
      blackTimeMs: data.blackTimeMs,
      whiteTimeMs: data.whiteTimeMs,
    });
  }, [data]);

  useEffect(() => {
    if (!visible || !data?.history?.length) return;
    const signature = `${data.history.length}-${data.winner}`;
    if (signature !== lastSignatureRef.current) {
      savedRef.current = false;
      lastSignatureRef.current = signature;
    }
    if (savedRef.current) return;
    const appAPI = (typeof window !== 'undefined' && window.appAPI) || null;
    if (appAPI) {
      const record = buildGameRecord({
        size: data.size,
        aiFirst: data.aiFirst,
        forbiddenEnabled: data.forbiddenEnabled,
        history: data.history,
        winner: data.winner,
        blackTimeMs: data.blackTimeMs,
        whiteTimeMs: data.whiteTimeMs,
      });
      record.id = `${Date.now()}-${data.history.length}`;
      appAPI.historyAdd(record).catch(() => {});
      savedRef.current = true;
    }
  }, [visible, data]);

  if (!visible || !data) return null;

  const playerRole = data.aiFirst ? -1 : 1;
  const playerWon = data.winner === playerRole;

  const onStart = () => dispatch(startGame({
    board_size: data.size, aiFirst: data.aiFirst, depth: DEFAULT_DEPTH,
    timeLimit: data.timeLimit, forbiddenEnabled: data.forbiddenEnabled,
  }));

  return (
    <div className="result-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="result-card">
        <div className={`result-mark ${playerWon ? 'win' : 'lose'}`}>
          <span className="result-mark-text">{playerWon ? '胜' : '负'}</span>
        </div>
        <div className="result-title">
          {playerWon ? '你赢了' : (data.winner === 1 ? '黑方胜' : '白方胜')}
        </div>
        <div className="result-subtitle">
          {playerWon ? '漂亮的棋局，再来一局？' : '胜败常事，再来一局？'}
        </div>

        <div className="result-stats">
          <div>
            <div className="result-stat-label">总步数</div>
            <div className="result-stat-value">{data.historyLen}</div>
          </div>
          <div>
            <div className="result-stat-label">黑方剩余</div>
            <div className="result-stat-value">{formatMs(data.blackTimeMs)}</div>
          </div>
          <div>
            <div className="result-stat-label">白方剩余</div>
            <div className="result-stat-value">{formatMs(data.whiteTimeMs)}</div>
          </div>
        </div>

        <div className="result-actions">
          <Button size="large" onClick={() => dispatch(closeResultModal())}>关闭</Button>
          <Button size="large" onClick={onCopyRecord}>复制棋谱</Button>
          <Button size="large" onClick={onSaveRecord}>保存棋谱</Button>
          <Button size="large" type="primary" onClick={onStart}>再来一局</Button>
        </div>
      </div>
    </div>
  );
}

export default GameResultModal;
