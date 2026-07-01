const fs = require('fs');
const PNG = require('pngjs').PNG;

const PATH = 'C:/Users/16416/Desktop/QQ20260630-161008.png';
const buf = fs.readFileSync(PATH);
const img = PNG.sync.read(buf);
const { width, height, data } = img;

function lum(x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return 255;
  const i = (y * width + x) << 2;
  // approximate grayscale
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// Determine board region by finding the tan board background; detect large inner square.
// Simpler: scan center vertical line for horizontal grid lines (dark lines), center horizontal for vertical.
const cx = Math.floor(width / 2);
const cy = Math.floor(height / 2);

function lineScoreY(y, x0, x1) {
  let s = 0;
  for (let x = x0; x <= x1; x++) s += 255 - lum(x, y);
  return s / (x1 - x0 + 1);
}
function lineScoreX(x, y0, y1) {
  let s = 0;
  for (let y = y0; y <= y1; y++) s += 255 - lum(x, y);
  return s / (y1 - y0 + 1);
}

// Scan vertical center to find horizontal grid lines
const hScores = [];
for (let y = 20; y < height - 20; y++) {
  hScores.push({ y, s: lineScoreY(y, Math.max(0, cx - 100), Math.min(width - 1, cx + 100)) });
}
// Find 15 strongest horizontal lines (peak detection)
hScores.sort((a, b) => b.s - a.s);
const hLinesRaw = hScores.slice(0, 40);
hLinesRaw.sort((a, b) => a.y - b.y);
// pick groups separated by at least 15px
const hLines = [];
for (const p of hLinesRaw) {
  if (!hLines.some(q => Math.abs(q.y - p.y) < 15)) hLines.push(p);
}

// Scan horizontal center to find vertical grid lines
const vScores = [];
for (let x = 20; x < width - 20; x++) {
  vScores.push({ x, s: lineScoreX(x, Math.max(0, cy - 100), Math.min(height - 1, cy + 100)) });
}
vScores.sort((a, b) => b.s - a.s);
const vLinesRaw = vScores.slice(0, 40);
vLinesRaw.sort((a, b) => a.x - b.x);
const vLines = [];
for (const p of vLinesRaw) {
  if (!vLines.some(q => Math.abs(q.x - p.x) < 15)) vLines.push(p);
}

console.log('hLines count', hLines.length, hLines.map(l => l.y).join(','));
console.log('vLines count', vLines.length, vLines.map(l => l.x).join(','));

if (hLines.length !== 15 || vLines.length !== 15) {
  console.log('Failed to detect grid');
  process.exit(0);
}

// Sample at intersections: radius 6px, average color
function avgColorAt(x, y, r) {
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
for (let i = 0; i < 15; i++) {
  const row = [];
  for (let j = 0; j < 15; j++) {
    const x = vLines[j].x;
    const y = hLines[i].y;
    const c = avgColorAt(x, y, 8);
    // classify based on brightness and color
    const bright = (c.r + c.g + c.b) / 3;
    // board tan ~ (232,200,150). black ~ (20). white ~ (240).
    let cell = '.';
    if (bright < 80) cell = 'X'; // black
    else if (bright > 210 && c.b > 200) cell = 'O'; // white
    row.push(cell);
  }
  board.push(row);
}

console.log('\n   A B C D E F G H I J K L M N O');
for (let i = 0; i < 15; i++) {
  console.log(String(i + 1).padStart(2) + ' ' + board[i].join(' '));
}

// Detect red last move marker: find intersection where red channel significantly higher than green/blue
for (let i = 0; i < 15; i++) {
  for (let j = 0; j < 15; j++) {
    const x = vLines[j].x, y = hLines[i].y;
    const c = avgColorAt(x, y, 4);
    if (c.r > c.g + 40 && c.r > c.b + 40 && c.r > 180) {
      console.log('Last move marker likely at', String.fromCharCode(65 + j), i + 1);
    }
  }
}
