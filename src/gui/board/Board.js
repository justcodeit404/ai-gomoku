import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Button, Radio, Space } from 'antd';
import { EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  movePiece, tempMove, applyBoardEdit, fetchHint, clearHint,
  setEditing, syncEditBoard, commitBoardEdit, endGame,
} from '../../store/gameSlice';
import { isForbidden, buildWalledBoard, coordinate2Position, checkFiveAt } from '../../game';
import { playMoveSound, playWinSound, setSoundEnabled } from '../audio/sounds';
import './board.css';
import { STATUS } from '../../status';

const STAR_POINTS_15 = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
const PADDING_PX = 44;

function usePointStyles(size) {
  return useMemo(() => {
    const styles = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        styles.push({
          left: `calc(${PADDING_PX}px + ${j} * (100% - ${PADDING_PX * 2}px) / ${size - 1})`,
          top: `calc(${PADDING_PX}px + ${i} * (100% - ${PADDING_PX * 2}px) / ${size - 1})`,
        });
      }
    }
    return styles;
  }, [size]);
}

const Intersection = React.memo(function Intersection({ i, j, cell, style, isLast, number }) {
  return (
    <div className="intersection" data-i={i} data-j={j} style={style}>
      {cell !== 0 && (
        <div className={cell === 1 ? 'piece black' : 'piece white'}>
          {number === 0 ? '' : number}
        </div>
      )}
      {isLast && <div className="last-move" />}
    </div>
  );
});

// 把 history 翻回 board 矩阵
function boardFromHistory(history, size) {
  const b = Array.from({ length: size }, () => Array(size).fill(0));
  for (const h of history) b[h.i][h.j] = h.role;
  return b;
}

const Board = () => {
  const dispatch = useDispatch();
  const sel = useSelector((s) => ({
    board: s.game.board,
    currentPlayer: s.game.currentPlayer,
    history: s.game.history,
    winner: s.game.winner,
    aiFirst: s.game.aiFirst,
    status: s.game.status,
    loading: s.game.loading,
    forbiddenEnabled: s.game.forbiddenEnabled,
    showMoveNumbers: s.game.showMoveNumbers,
    soundEnabled: s.game.soundEnabled,
    showHint: s.game.showHint,
    hintMove: s.game.hintMove,
    size: s.game.size,
    winningLine: s.game.winningLine,
    editing: s.game.editing,
  }), shallowEqual);

  const { board, currentPlayer, history, winner, aiFirst, status, loading, forbiddenEnabled, showMoveNumbers, soundEnabled, showHint, hintMove, size, winningLine, editing } = sel;

  const [hover, setHover] = useState(null);
  const [forbiddenMsg, setForbiddenMsg] = useState(null);
  const forbiddenMsgTimerRef = useRef(null);

  // 摆棋模式状态（从 store 读 editing；editBoard/editColor 仍为本地临时态）
  const [editBoard, setEditBoard] = useState(null);
  const [editColor, setEditColor] = useState(1);

  // 同步音效开关
  useEffect(() => {
    setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  // 落子音效：history 增加时播放
  const prevHistoryLenRef = useRef(history.length);
  useEffect(() => {
    if (history.length > prevHistoryLenRef.current) {
      playMoveSound();
    }
    prevHistoryLenRef.current = history.length;
  }, [history.length]);

  // 胜利音效
  const prevWinnerRef = useRef(null);
  useEffect(() => {
    if (winner !== null && prevWinnerRef.current === null) {
      playWinSound();
    }
    prevWinnerRef.current = winner;
  }, [winner]);

  // AI 提示：开启且轮到人类时请求
  const humanRole = aiFirst ? -1 : 1;
  const hintMoveRef = useRef(hintMove);
  hintMoveRef.current = hintMove;
  useEffect(() => {
    if (!showHint || status !== STATUS.GAMING || loading || currentPlayer !== humanRole || winner !== null) {
      if (hintMoveRef.current) dispatch(clearHint());
      return;
    }
    const id = window.setTimeout(() => {
      dispatch(fetchHint());
    }, 400);
    return () => window.clearTimeout(id);
  }, [showHint, status, loading, currentPlayer, humanRole, winner, history.length, dispatch]);

  useEffect(() => () => {
    if (forbiddenMsgTimerRef.current) window.clearTimeout(forbiddenMsgTimerRef.current);
  }, []);

  const lastMove = useMemo(() => history[history.length - 1], [history]);
  const stars = useMemo(() => (size === 15 ? STAR_POINTS_15 : []), [size]);
  const pointStyles = usePointStyles(size);
  const isGaming = status === STATUS.GAMING;

  // 编辑模式开关：进入时把当前局面拷到本地；退出/完成时清空
  const enterEdit = useCallback(() => {
    // 阻断:GAMING 进行中 + loading 都不允许进入(已通过 entry 按钮条件拦住,这里再保险)
    if (status === STATUS.GAMING && loading) return;
    // 阻断:GAMING 中允许进入但需先结束当前对局引擎会话,避免 UI/引擎分叉
    if (status === STATUS.GAMING) {
      dispatch(endGame());
    }
    const copy = boardFromHistory(history, size);
    setEditBoard(copy);
    setEditColor(1);
    dispatch(setEditing(true));
    // 同步初始 editBoard 到 store,让 HeaderBar 立即反映
    dispatch(syncEditBoard({ board: copy }));
  }, [status, loading, history, size, dispatch]);

  const cancelEdit = useCallback(() => {
    dispatch(setEditing(false));
    setEditBoard(null);
    // 恢复 store.board 为最近一次 commit 或空棋盘
    dispatch(syncEditBoard({ board: Array.from({ length: size }, () => Array(size).fill(0)) }));
  }, [dispatch, size]);

  // 摆棋完成：按 editColor 起步、黑/白交替构造 history(非按 (i,j) 扫描),
  // 这样 engine 端 _replayHistory 的"两步一组"TURN 重放能稳定工作。
  const commitEdit = useCallback(() => {
    if (!editBoard) {
      dispatch(setEditing(false));
      return;
    }
    const hist = [];
    // editColor=1 表示"接下来要摆的是黑" → history 末位是白(-1) → currentPlayer=1
    // 收集所有黑子和白子,按时间序交替,起始角色由 editColor 决定
    const blacks = [];
    const whites = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (editBoard[i][j] === 1) blacks.push({ i, j });
        else if (editBoard[i][j] === -1) whites.push({ i, j });
      }
    }
    // 按 i+j 自然序构造模拟时序(无真实时间,引擎只关心位置 + 角色)
    blacks.sort((a, b) => a.i !== b.i ? a.i - b.i : a.j - b.j);
    whites.sort((a, b) => a.i !== b.i ? a.i - b.i : a.j - b.j);
    // editColor=1: 黑先 → 先放黑子再放白子,交替直到一边用完
    // editColor=-1: 白先 → 先放白子再放黑子
    let bIdx = 0, wIdx = 0;
    let turnRole = editColor;        // 下一手该摆什么色(随循环交替反转)
    while (bIdx < blacks.length || wIdx < whites.length) {
      if (turnRole === 1 && bIdx < blacks.length) {
        hist.push({ ...blacks[bIdx++], role: 1, elapsedMs: 0 });
      } else if (turnRole === -1 && wIdx < whites.length) {
        hist.push({ ...whites[wIdx++], role: -1, elapsedMs: 0 });
      } else if (turnRole === 1 && wIdx < whites.length) {
        hist.push({ ...whites[wIdx++], role: -1, elapsedMs: 0 });
      } else if (turnRole === -1 && bIdx < blacks.length) {
        hist.push({ ...blacks[bIdx++], role: 1, elapsedMs: 0 });
      } else {
        break;
      }
      turnRole = -turnRole;
    }
    // currentPlayer: hist 末位是 -role 的相反,即下一步该走谁
    const last = hist[hist.length - 1];
    const nextPlayer = last ? -last.role : (editColor === 1 ? -1 : 1);
    // 先把本地 editBoard 提交到 store(用于重置用时/退出编辑态),
    // 再由 commitBoardEdit thunk 调 engine restore() 完成引擎接管
    dispatch(applyBoardEdit({
      board: editBoard,
      history: hist,
      currentPlayer: nextPlayer,
    }));
    dispatch(commitBoardEdit({
      board: editBoard,
      history: hist,
      currentPlayer: nextPlayer,
    }));
    setEditBoard(null);
  }, [dispatch, editBoard, size, editColor]);

  // 编辑模式下：点击格子切换颜色
  const onEditCellClick = useCallback((i, j) => {
    setEditBoard((prev) => {
      if (!prev) return prev;
      const next = prev.map((row) => row.slice());
      if (next[i][j] === editColor) {
        next[i][j] = 0;
      } else {
        next[i][j] = editColor;
      }
      // 同步到 store.board 让 HeaderBar 等组件即时反映
      dispatch(syncEditBoard({ board: next }));
      return next;
    });
  }, [editColor, dispatch]);

  const onIntersectionClick = useCallback((i, j) => {
    if (editing) {
      onEditCellClick(i, j);
      return;
    }
    if (loading || !isGaming) return;
    if (board[i][j] !== 0) return;
    if (forbiddenEnabled && currentPlayer === 1) {
      const evalBoard = buildWalledBoard(board, size);
      if (isForbidden(evalBoard, i, j, size)) {
        setForbiddenMsg({ i, j });
        window.clearTimeout(forbiddenMsgTimerRef.current);
        forbiddenMsgTimerRef.current = window.setTimeout(() => setForbiddenMsg(null), 1500);
        return;
      }
    }
    dispatch(tempMove([i, j]));
    const nextBoard = board.map((row) => row.slice());
    nextBoard[i][j] = currentPlayer;
    if (checkFiveAt(nextBoard, i, j, currentPlayer)) {
      return;
    }
    dispatch(movePiece({ position: [i, j] }));
  }, [editing, onEditCellClick, loading, isGaming, board, forbiddenEnabled, currentPlayer, size, dispatch]);

  const boardRef = useRef(null);
  const rectRef = useRef(null);

  const findNearest = useCallback((clientX, clientY) => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = rectRef.current || el.getBoundingClientRect();
    const stepX = (rect.width - 2 * PADDING_PX) / (size - 1);
    const stepY = (rect.height - 2 * PADDING_PX) / (size - 1);
    const lx = clientX - rect.left - PADDING_PX;
    const ly = clientY - rect.top - PADDING_PX;
    if (lx < -stepX / 2 || lx > (size - 1) * stepX + stepX / 2) return null;
    if (ly < -stepY / 2 || ly > (size - 1) * stepY + stepY / 2) return null;
    const j = Math.round(lx / stepX);
    const i = Math.round(ly / stepY);
    if (i < 0 || i >= size || j < 0 || j >= size) return null;
    return [i, j];
  }, [size]);

  const onBoardClick = useCallback((e) => {
    const pt = findNearest(e.clientX, e.clientY);
    if (!pt) return;
    onIntersectionClick(pt[0], pt[1]);
  }, [onIntersectionClick, findNearest]);

  useEffect(() => {
    if (!boardRef.current) return;
    const update = () => {
      rectRef.current = boardRef.current.getBoundingClientRect();
    };
    update();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(boardRef.current);
    }
    window.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const onBoardMouseMove = useCallback((e) => {
    const pt = findNearest(e.clientX, e.clientY);
    if (!pt || loading || (!editing && !isGaming) || (!editing && board[pt[0]][pt[1]] !== 0)) {
      if (hover !== null) setHover(null);
      return;
    }
    if (hover && hover[0] === pt[0] && hover[1] === pt[1]) return;
    setHover(pt);
  }, [findNearest, board, isGaming, loading, hover, editing]);

  const onBoardMouseLeave = useCallback(() => setHover(null), []);

  const positionIndexMap = useMemo(() => {
    if (!showMoveNumbers) return null;
    const map = {};
    const srcHist = editing && editBoard ? editBoard : history;
    const indexFromBoard = (m) => {
      // 摆棋模式下没有"步数序号"，按自然排序给个编号
      const flat = [];
      for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++) if (srcHist[i] && srcHist[i][j] !== 0) flat.push([i, j]);
      flat.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
      return flat.findIndex((x) => x[0] === m[0] && x[1] === m[1]) + 1;
    };
    if (editing && editBoard) {
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          if (editBoard[i][j] !== 0) {
            map[coordinate2Position(i, j, size)] = indexFromBoard([i, j]);
          }
        }
      }
    } else {
      for (let x = 0; x < history.length; x++) {
        map[coordinate2Position(history[x].i, history[x].j, size)] = x + 1;
      }
    }
    return map;
  }, [showMoveNumbers, history, size, editing, editBoard]);

  const coordLabels = useMemo(() => {
    const cols = [];
    const rows = [];
    for (let j = 0; j < size; j++) {
      cols.push({ j, left: pointStyles[j].left, char: String.fromCharCode(65 + j) });
    }
    for (let i = 0; i < size; i++) {
      rows.push({ i, top: pointStyles[i * size].top, num: i + 1 });
    }
    return { cols, rows };
  }, [size, pointStyles]);

  const forbiddenOverlay = useMemo(() => {
    if (!forbiddenMsg) return null;
    return (
      <div key="forbidden" className="forbidden-mark" style={pointStyles[forbiddenMsg.i * size + forbiddenMsg.j]}>
        禁
      </div>
    );
  }, [forbiddenMsg, size, pointStyles]);

  // 当前显示的棋盘与 history
  const displayBoard = editing && editBoard ? editBoard : board;
  const displayLastMove = editing ? null : lastMove;

  return (
    <div
      ref={boardRef}
      className={`board ${editing ? 'editing' : ''}`}
      style={{ '--size': size }}
      onClick={onBoardClick}
      onMouseMove={onBoardMouseMove}
      onMouseLeave={onBoardMouseLeave}
    >
      <div className="board-grid" />

      {winningLine && !editing && (
        <svg className="winning-line-svg" viewBox={`0 0 ${size - 1} ${size - 1}`} preserveAspectRatio="none">
          <line
            x1={winningLine[0][1]}
            y1={winningLine[0][0]}
            x2={winningLine[winningLine.length - 1][1]}
            y2={winningLine[winningLine.length - 1][0]}
            stroke="var(--cinnabar)"
            strokeWidth="0.18"
            strokeLinecap="round"
          />
        </svg>
      )}

      {coordLabels.cols.map(({ j, left, char }) => (
        <React.Fragment key={`coord-col-${j}`}>
          <div className="coord-label coord-top" style={{ left }}>{char}</div>
          <div className="coord-label coord-bottom" style={{ left }}>{char}</div>
        </React.Fragment>
      ))}
      {coordLabels.rows.map(({ i, top, num }) => (
        <React.Fragment key={`coord-row-${i}`}>
          <div className="coord-label coord-left" style={{ top }}>{num}</div>
          <div className="coord-label coord-right" style={{ top }}>{num}</div>
        </React.Fragment>
      ))}

      {stars.map(([i, j]) => (
        <div key={`star-${i}-${j}`} className="star-point" style={pointStyles[i * size + j]} />
      ))}

      {forbiddenOverlay}

      {displayBoard.map((row, i) =>
        row.map((cell, j) => {
          const isLast = displayLastMove && displayLastMove.i === i && displayLastMove.j === j;
          const number = positionIndexMap ? (positionIndexMap[coordinate2Position(i, j, size)] || 0) : 0;
          return (
            <Intersection
              key={`${i}-${j}`}
              i={i}
              j={j}
              cell={cell}
              style={pointStyles[i * size + j]}
              isLast={isLast}
              number={number}
            />
          );
        })
      )}

      {/* 摆棋模式：上方工具栏 */}
      {editing && (
        <div className="edit-toolbar">
          <Space>
            <span style={{ color: '#fff' }}>摆棋中：</span>
            <Radio.Group value={editColor} onChange={(e) => setEditColor(e.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value={1}>黑</Radio.Button>
              <Radio.Button value={-1}>白</Radio.Button>
            </Radio.Group>
            <Button size="small" icon={<DeleteOutlined />} onClick={() => setEditBoard(Array.from({ length: size }, () => Array(size).fill(0)))}>
              清空
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={commitEdit}>
              完成
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
              取消
            </Button>
          </Space>
          <div className="edit-hint">点击空格放置当前色，点击同色删除</div>
        </div>
      )}

      {/* 摆棋模式下没有 hover preview，因为不需要 */}
      {!editing && hover && isGaming && !loading && board[hover[0]][hover[1]] === 0 && (
        <div
          className={currentPlayer === 1 ? 'piece black preview' : 'piece white preview'}
          style={pointStyles[hover[0] * size + hover[1]]}
        />
      )}

      {!editing && showHint && hintMove && isGaming && !loading && board[hintMove.i][hintMove.j] === 0 && (
        <div
          className={`piece ${humanRole === 1 ? 'black' : 'white'} hint`}
          style={pointStyles[hintMove.i * size + hintMove.j]}
          title="AI 提示"
        />
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">AI 思考中…</div>
        </div>
      )}

      {/* 摆棋模式：不阻塞正常对弈，提示一个入口按钮 */}
      {!editing && !loading && (
        <Button
          className="edit-entry-btn"
          icon={<EditOutlined />}
          onClick={enterEdit}
          size="small"
        >
          摆棋
        </Button>
      )}
    </div>
  );
};

export default Board;