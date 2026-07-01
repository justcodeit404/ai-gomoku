// 仅保留 UI 禁手检测和胜负判定所需的最小逻辑
// 棋盘坐标：i=row, j=col, role: 1=黑, -1=白

export const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function checkFiveAt(board, i, j, role) {
  const size = board.length;
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let k = 1; k < 5; k++) {
        const ni = i + sign * k * dx;
        const nj = j + sign * k * dy;
        if (ni < 0 || ni >= size || nj < 0 || nj >= size) break;
        if (board[ni][nj] !== role) break;
        count++;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

export function getWinningLine(board, i, j, role) {
  const size = board.length;
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    const line = [[i, j]];
    for (const sign of [1, -1]) {
      for (let k = 1; k < 5; k++) {
        const ni = i + sign * k * dx;
        const nj = j + sign * k * dy;
        if (ni < 0 || ni >= size || nj < 0 || nj >= size) break;
        if (board[ni][nj] !== role) break;
        count++;
        if (sign === 1) line.push([ni, nj]);
        else line.unshift([ni, nj]);
      }
    }
    if (count >= 5) return line;
  }
  return null;
}

export const position2Coordinate = (position, size) => [Math.floor(position / size), position % size];
export const coordinate2Position = (row, col, size) => row * size + col;

// 把 (row, col) 转为标准棋谱坐标，例如 (7, 7) -> 'H8'
export function formatCoordinate(i, j) {
  const col = String.fromCharCode(65 + j);
  const row = i + 1;
  return `${col}${row}`;
}

// 把历史记录转成可读文本棋谱
export function formatGameRecord(history) {
  if (!history || history.length === 0) return '';
  return history
    .map((h, idx) => `${idx + 1}. ${formatCoordinate(h.i, h.j)}`)
    .join('  ');
}

// 导出为可保存的 JSON 棋谱对象
export function buildGameRecord({ size, aiFirst, forbiddenEnabled, history, winner, blackTimeMs, whiteTimeMs }) {
  return {
    version: 1,
    format: 'gobang-json',
    savedAt: new Date().toISOString(),
    size,
    aiFirst,
    forbiddenEnabled,
    winner,
    blackTimeMs,
    whiteTimeMs,
    history: (history || []).map((h, idx) => ({
      step: idx + 1,
      role: h.role === 1 ? 'black' : 'white',
      coordinate: formatCoordinate(h.i, h.j),
      i: h.i,
      j: h.j,
      elapsedMs: h.elapsedMs || 0,
    })),
  };
}

// 包裹一层墙，返回 isForbidden 所需的 (size+2)×(size+2) 棋盘
export function buildWalledBoard(rawBoard, size) {
  const bordered = Array.from({ length: size + 2 }, () => Array(size + 2).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      bordered[i + 1][j + 1] = rawBoard[i][j] || 0;
    }
  }
  for (let i = 0; i < size + 2; i++) {
    bordered[0][i] = 2;
    bordered[size + 1][i] = 2;
    bordered[i][0] = 2;
    bordered[i][size + 1] = 2;
  }
  return bordered;
}

function scanOneWay(board, bx, by, dx, dy, role) {
  let count = 0, open = false, hasTwo = false;
  for (let i = 1; ; i++) {
    const nx = bx + i * dx, ny = by + i * dy;
    const v = board[nx][ny];
    if (v === role) { count++; continue; }
    if (v === 0) {
      open = true;
      if (board[nx + dx][ny + dy] === 0) hasTwo = true;
    }
    break;
  }
  return { count, open, hasTwo };
}

function countDirection(board, bx, by, dx, dy) {
  const role = board[bx][by];
  const pos = scanOneWay(board, bx, by, dx, dy, role);
  const neg = scanOneWay(board, bx, by, -dx, -dy, role);
  return {
    count: 1 + pos.count + neg.count,
    leftOpen: neg.open, rightOpen: pos.open,
    leftHasTwo: neg.hasTwo, rightHasTwo: pos.hasTwo,
  };
}

export function isForbidden(board, x, y, size) {
  if (x < 0 || x >= size || y < 0 || y >= size) return false;
  if (board[x + 1][y + 1] !== 0) return false;

  // 复制一份临时棋盘，避免副作用
  const testBoard = board.map((row) => [...row]);
  testBoard[x + 1][y + 1] = 1;
  let fiveCount = 0;
  let overlineCount = 0;
  let fourCount = 0;
  let openThreeCount = 0;

  for (const [dx, dy] of DIRECTIONS) {
    const r = countDirection(testBoard, x + 1, y + 1, dx, dy);
    if (r.count === 5) fiveCount++;
    else if (r.count >= 6) overlineCount++;
    else if (r.count === 4) {
      if (r.leftOpen || r.rightOpen) fourCount++;
    } else if (r.count === 3) {
      if (r.leftOpen && r.rightOpen && (r.leftHasTwo || r.rightHasTwo)) {
        openThreeCount++;
      }
    }
  }

  if (fiveCount === 1 && overlineCount === 0) return false;
  if (overlineCount > 0) return true;
  if (fiveCount >= 2) return true;
  if (fourCount >= 2) return true;
  if (openThreeCount >= 2) return true;
  return false;
}
