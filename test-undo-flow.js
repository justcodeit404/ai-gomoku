// 完整模拟 UI 的 undo 流程，验证 engine.history 与 UI history 一致性
const { RapfiBridge } = require('./electron-main/rapfi-bridge');
const path = require('path');

const RAPFI_EXE = path.join(__dirname, 'release', 'win-unpacked', 'resources', 'rapfi', 'Rapfi.exe');

function arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].role !== b[i].role) return false;
  }
  return true;
}

function dump(label, h) {
  console.log(label, h.map(m => `(${m.x},${m.y})${m.role===1?'B':'W'}`).join(' '));
}

function uiToEngine(h) {
  return { x: h.j, y: h.i, role: h.role === 1 ? 1 : 2 };
}

async function main() {
  const bridge = new RapfiBridge({ binaryPath: RAPFI_EXE });

  // 模拟 UI 端 start：AI 先手
  const uiHistory = [];
  await bridge.start({
    size: 15, rule: 1, forbidden: false, aiFirst: true,
    timeoutTurnMs: 5000, timeoutMatchMs: 10*60*1000,
    timeLeftMs: 10*60*1000, maxDepth: 16, history: [],
  });
  const aiFirstMove = bridge.history[0];
  console.log('AI 先手:', aiFirstMove);
  uiHistory.push({ i: aiFirstMove.y, j: aiFirstMove.x, role: 1 });

  // 人走 H9
  console.log('\n-- 人走 H9 --');
  const r1 = await bridge.move(7, 8, [
    ...uiHistory,
    { i: 8, j: 7, role: -1 }, // 人 H9
  ]);
  uiHistory.push({ i: 8, j: 7, role: -1 });  // 人 H9
  uiHistory.push({ i: r1.y, j: r1.x, role: r1.role });  // AI 回复
  console.log('AI 回复 1:', r1);
  dump('engine history:', bridge.history);
  dump('UI history   :', uiHistory.map(uiToEngine));

  const expectedAfterR1 = uiHistory.map(uiToEngine);
  console.log('engine === UI:', arrEq(bridge.history, expectedAfterR1));

  // 人走 G7
  console.log('\n-- 人走 G7 --');
  const r2 = await bridge.move(6, 6, [
    ...uiHistory,
    { i: 6, j: 6, role: -1 },
  ]);
  uiHistory.push({ i: 6, j: 6, role: -1 });
  uiHistory.push({ i: r2.y, j: r2.x, role: r2.role });
  console.log('AI 回复 2:', r2);

  // 悔棋（撤销 2 步：人+AI）
  console.log('\n-- 悔棋（撤销 2 步：人+AI）--');
  console.log('  悔棋前 UI length:', uiHistory.length, 'engine length:', bridge.history.length);
  await bridge.undo(2);
  uiHistory.splice(-2);
  console.log('  悔棋后 UI length:', uiHistory.length, 'engine length:', bridge.history.length);
  dump('  engine history:', bridge.history);
  dump('  UI history   :', uiHistory.map(uiToEngine));

  const expectedAfterUndo = uiHistory.map(uiToEngine);
  console.log('  engine === UI:', arrEq(bridge.history, expectedAfterUndo));

  // 关键测试：悔棋后再走一步同样的位置，AI 回应是否和第一次相同
  console.log('\n-- 悔棋后重新走 G7 --');
  const r2b = await bridge.move(6, 6, [
    ...uiHistory,
    { i: 6, j: 6, role: -1 },
  ]);
  console.log('悔棋前 AI 回复 2:', r2);
  console.log('悔棋后 AI 回复 2:', r2b);
  console.log('一致?', r2.x === r2b.x && r2.y === r2b.y);

  await bridge.end();
}

main().catch(e => { console.error(e); process.exit(1); });
