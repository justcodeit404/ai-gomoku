const fs = require('fs');
const PNG = require('pngjs').PNG;

const PATH = 'C:/Users/16416/Desktop/QQ20260630-161008.png';
const { data, width, height } = PNG.sync.read(fs.readFileSync(PATH));

function bright(x, y) {
  const i = (y * width + x) << 2;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
}

const DARK = 110;
const colDark = new Array(width).fill(0);
const rowDark = new Array(height).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (bright(x, y) < DARK) {
      colDark[x]++;
      rowDark[y]++;
    }
  }
}

function range(arr, thr) {
  let s = -1, e = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > thr) { if (s < 0) s = i; e = i; }
  }
  return { s, e, len: e - s + 1 };
}

const xr = range(colDark, height * 0.25);
const yr = range(rowDark, width * 0.25);
console.log('dark ranges x', xr, 'y', yr);

function peaks(arr, lo, hi, count, minGap) {
  // find local maxima
  const pts = [];
  for (let i = lo + 2; i <= hi - 2; i++) {
    if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1] && arr[i] > 0) {
      pts.push({ idx: i, val: arr[i] });
    }
  }
  pts.sort((a, b) => b.val - a.val);
  const chosen = [];
  for (const p of pts) {
    if (!chosen.some(q => Math.abs(q - p.idx) < minGap)) chosen.push(p.idx);
    if (chosen.length >= count) break;
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

const vLines = peaks(colDark, xr.s, xr.e, 15, 20);
const hLines = peaks(rowDark, yr.s, yr.e, 15, 20);
console.log('vLines', vLines.length, vLines.join(','));
console.log('hLines', hLines.length, hLines.join(','));

if (vLines.length !== 15 || hLines.length !== 15) { console.log('fail'); process.exit(0); }

function avgColor(x, y, r) {
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const i = (py * width + px) << 2;
      rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++;
    }
  }
  return { r: rs / n, g: gs / n, b: bs / n };
}

const board = [];
let lastMove = null;
for (let i = 0; i < 15; i++) {
  const row = [];
  for (let j = 0; j < 15; j++) {
    const c = avgColor(vLines[j], hLines[i], 6);
    const b = (c.r + c.g + c.b) / 3;
    let cell = '.';
    if (b < 80) cell = 'X';
    else if (b > 200 && c.b > 180) cell = 'O';
    row.push(cell);
    if (c.r > c.g + 30 && c.r > c.b + 30 && c.r > 170) lastMove = { i, j, c };
  }
  board.push(row);
}
console.log('\n   A B C D E F G H I J K L M N O');
for (let i = 0; i < 15; i++) console.log(String(i + 1).padStart(2) + ' ' + board[i].join(' '));
if (lastMove) console.log('last', String.fromCharCode(65 + lastMove.j), lastMove.i + 1);
