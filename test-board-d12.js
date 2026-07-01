const { RapfiBridge } = require('./electron-main/rapfi-bridge');
const path = require('path');

function fmt(line) { return line ? line.trim() : 'null'; }

async function main() {
  const bin = path.join(__dirname, 'release', 'win-unpacked', 'resources', 'rapfi', 'Rapfi.exe');
  const bridge = new RapfiBridge({ binaryPath: bin });
  bridge.binaryPath = bin;
  await bridge.start({ size: 15, rule: 1, forbidden: false, timeoutTurnMs: 5000, timeoutMatchMs: 10 * 60 * 1000, timeLeftMs: 10 * 60 * 1000, maxDepth: 16, history: [] });

  // 用标准 BOARD 命令让白棋思考（yxboard 不会触发思考）
  // 历史：黑 C12 -> 白 H12 -> 黑 E12 -> 黑 F12 -> 黑 G12，轮到白棋
  bridge._sendLine('BOARD');
  bridge._sendLine('2,11,1'); // C12 黑
  bridge._sendLine('7,11,2'); // H12 白
  bridge._sendLine('4,11,1'); // E12 黑
  bridge._sendLine('5,11,1'); // F12 黑
  bridge._sendLine('6,11,1'); // G12 黑

  const reply = await bridge._sendAndExpect('DONE', /^\d+,\d+$/, { timeoutMs: 10000 });
  console.log('白棋应手:', fmt(reply));
  await bridge.end();
}

main().catch(e => { console.error(e); process.exit(1); });
