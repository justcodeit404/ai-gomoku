const fs = require('fs');
const PNG = require('pngjs').PNG;

const PATH = 'C:/Users/16416/Desktop/QQ20260630-161008.png';
const { data, width, height } = PNG.sync.read(fs.readFileSync(PATH));

function col(x, y) {
  const i = (y * width + x) << 2;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}
function bright(c) { return (c.r + c.g + c.b) / 3; }

// Estimate board y range by rows with many tan-ish pixels (low saturation, warm)
function isTan(c) {
  return c.r > 170 && c.g > 140 && c.b > 70 && c.b < 200 && c.r - c.b > 25;
}
const rowTan = new Array(height).fill(0);
const colTan = new Array(width).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (isTan(col(x, y))) { rowTan[y]++; colTan[x]++; }
  }
}
function findRange(arr) {
  let s = -1, e = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > Math.max(...arr) * 0.3) { if (s < 0) s = i; e = i; }
  }
  return { s, e };
}
const yr = findRange(rowTan);
const xr = findRange(colTan);
console.log('ranges', xr, yr);

// Average brightness per column within board rows
const colAvg = new Array(width).fill(0);
for (let x = 0; x < width; x++) {
  let sum = 0, n = 0;
  for (let y = yr.s; y <= yr.e; y++) {
    sum += bright(col(x, y)); n++;
  }
  colAvg[x] = sum / n;
}
const rowAvg = new Array(height).fill(0);
for (let y = 0; y < height; y++) {
  let sum = 0, n = 0;
  for (let x = xr.s; x <= xr.e; x++) {
    sum += bright(col(x, y)); n++;
  }
  rowAvg[y] = sum / n;
}

function findMinima(arr, lo, hi, count, minGap) {
  const pts = [];
  for (let i = lo + 3; i <= hi - 3; i++) {
    if (arr[i] < arr[i - 1] && arr[i] <= arr[i + 1]) pts.push({ idx: i, val: arr[i] });
  }
  pts.sort((a, b) => a.val - b.val);
  const chosen = [];
  for (const p of pts) {
    if (!chosen.some(q => Math.abs(q - p.idx) < minGap)) chosen.push(p.idx);
    if (chosen.length >= count) break;
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

const vLines = findMinima(colAvg, xr.s, xr.e, 15, 20);
const hLines = findMinima(rowAvg, yr.s, yr.e, 15, 20);
console.log('vLines', vLines.length, vLines.join(','));
console.log('hLines', hLines.length, hLines.join(','));

if (vLines.length !== 15 || hLines.length !== 15) { console.log('fail'); process.exit(0); }

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
    const c = avgColorAt(vLines[j], hLines[i], 7);
    const b = (c.r + c.g + c.b) / 3;
    let cell = '.';
    if (b < 90) cell = 'X';
    else if (b > 205 && c.b > 185) cell = 'O';
    row.push(cell);
    if (c.r > c.g + 25 && c.r > c.b + 25 && c.r > 180) lastMove = { i, j };
  }
  board.push(row);
}

console.log('\n   A B C D E F G H I J K L M N O');
for (let i = 0; i < 15; i++) console.log(String(i + 1).padStart(2) + ' ' + board[i].join(' '));
if (lastMove) console.log('last move:', String.fromCharCode(65 + lastMove.j), lastMove.i + 1);
