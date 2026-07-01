const { RapfiBridge } = require('./electron-main/rapfi-bridge');
const path = require('path');

const RAPFI_EXE = path.join(__dirname, 'release', 'win-unpacked', 'resources', 'rapfi', 'Rapfi.exe');

function fmt(m) { return m ? `${m.x},${m.y}` : 'null'; }

async function main() {
  const bridge = new RapfiBridge({ binaryPath: RAPFI_EXE });
  await bridge.start({ size: 15, rule: 1, forbidden: false, timeoutTurnMs: 5000, timeoutMatchMs: 10 * 60 * 1000, timeLeftMs: 10 * 60 * 1000, maxDepth: 16, history: [] });

  // AI 先手
  const aiFirst = await bridge.begin();
  console.log('AI 第一手:', fmt(aiFirst));

  // 人走 H9（避开 AI 已占的中心）
  const user1 = { i: 8, j: 7, role: -1 };
  const reply1 = await bridge.move(7, 8, [{ i: aiFirst.y, j: aiFirst.x, role: 1 }, user1]);
  console.log('人 H8 后 AI:', fmt(reply1));

  // 悔棋（撤销人 + AI）
  const popped = await bridge.undo(2);
  console.log('撤销步数:', popped.length, '剩余引擎历史长度:', bridge.history.length);

  // 人重走 H9
  const reply2 = await bridge.move(7, 8, [{ i: aiFirst.y, j: aiFirst.x, role: 1 }, user1]);
  console.log('悔棋重走 H8 后 AI:', fmt(reply2));

  await bridge.end();
}

main().catch(e => { console.error(e); process.exit(1); });
