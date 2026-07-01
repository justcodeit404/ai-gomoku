const fs = require('fs');
const PNG = require('pngjs').PNG;

const PATH = 'C:/Users/16416/Desktop/QQ20260630-161008.png';
const buf = fs.readFileSync(PATH);
const img = PNG.sync.read(buf);
const { width, height, data } = img;

function col(x, y) {
  const i = (y * width + x) << 2;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function isBoardish(c) {
  // tan board: high red/green, lower blue, not too dark, not white
  return c.r > 180 && c.g > 150 && c.b > 80 && c.b < 200 && c.r - c.b > 30;
}

const rowCount = new Array(height).fill(0);
const colCount = new Array(width).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (isBoardish(col(x, y))) {
      rowCount[y]++;
      colCount[x]++;
    }
  }
}

function findRange(arr, threshold) {
  let start = -1, end = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > threshold) {
      if (start < 0) start = i;
      end = i;
    }
  }
  return { start, end, len: end - start + 1 };
}

const rowRange = findRange(rowCount, width * 0.35);
const colRange = findRange(colCount, height * 0.35);
console.log('row range', rowRange);
console.log('col range', colRange);

const y0 = rowRange.start, y1 = rowRange.end;
const x0 = colRange.start, x1 = colRange.end;
console.log('board box', x0, y0, x1, y1, 'size', x1 - x0, y1 - y0);

// Within board box, detect vertical grid lines by dark line score averaged over full height
function vScore(x) {
  let s = 0;
  for (let y = y0; y <= y1; y++) {
    const c = col(x, y);
    s += 255 - (c.r + c.g + c.b) / 3;
  }
  return s / (y1 - y0 + 1);
}
function hScore(y) {
  let s = 0;
  for (let x = x0; x <= x1; x++) {
    const c = col(x, y);
    s += 255 - (c.r + c.g + c.b) / 3;
  }
  return s / (x1 - x0 + 1);
}

const v = [];
for (let x = x0; x <= x1; x++) v.push({ x, s: vScore(x) });
v.sort((a, b) => b.s - a.s);
const vRaw = v.slice(0, 40);
vRaw.sort((a, b) => a.x - b.x);
const vLines = [];
for (const p of vRaw) {
  if (!vLines.some(q => Math.abs(q.x - p.x) < 8)) vLines.push(p);
}

const h = [];
for (let y = y0; y <= y1; y++) h.push({ y, s: hScore(y) });
h.sort((a, b) => b.s - a.s);
const hRaw = h.slice(0, 40);
hRaw.sort((a, b) => a.y - b.y);
const hLines = [];
for (const p of hRaw) {
  if (!hLines.some(q => Math.abs(q.y - p.y) < 8)) hLines.push(p);
}

console.log('vLines', vLines.length, vLines.map(l=>l.x).join(','));
console.log('hLines', hLines.length, hLines.map(l=>l.y).join(','));

if (vLines.length !== 15 || hLines.length !== 15) {
  console.log('Grid detect failed'); process.exit(0);
}

function avgColorAt(x, y, r) {
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const c = col(px, py);
      rs += c.r; gs += c.g; bs += c.b; n++;
    }
  }
  return { r: rs / n, g: gs / n, b: bs / n };
}

const board = [];
let lastMove = null;
for (let i = 0; i < 15; i++) {
  const row = [];
  for (let j = 0; j < 15; j++) {
    const x = vLines[j].x, y = hLines[i].y;
    const c = avgColorAt(x, y, 6);
    const bright = (c.r + c.g + c.b) / 3;
    let cell = '.';
    if (bright < 75) cell = 'X';
    else if (bright > 200 && c.b > 180) cell = 'O';
    row.push(cell);
    // red marker
    if (c.r > c.g + 35 && c.r > c.b + 35 && c.r > 180) {
      lastMove = { i, j, c };
    }
  }
  board.push(row);
}

console.log('\n   A B C D E F G H I J K L M N O');
for (let i = 0; i < 15; i++) {
  console.log(String(i + 1).padStart(2) + ' ' + board[i].join(' '));
}
if (lastMove) {
  console.log('Last move marker at', String.fromCharCode(65 + lastMove.j), lastMove.i + 1, JSON.stringify(lastMove.c));
}
