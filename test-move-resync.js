const { RapfiBridge } = require('./electron-main/rapfi-bridge');
const path = require('path');

function fmt(m) { return m ? `${m.x},${m.y}` : 'null'; }

async function main() {
  const bridge = new RapfiBridge({ binaryPath: path.join(__dirname, 'release', 'win-unpacked', 'resources', 'rapfi', 'Rapfi.exe') });
  await bridge.start({ size: 15, rule: 1, forbidden: false, timeoutTurnMs: 5000, timeoutMatchMs: 10 * 60 * 1000, timeLeftMs: 10 * 60 * 1000, maxDepth: 16, history: [] });

  // 人类先手，黑下 H8
  const uiHistory1 = [{ i: 7, j: 7, role: 1 }];
  const reply1 = await bridge.move(7, 7, uiHistory1);
  console.log('白棋应手:', fmt(reply1));

  // 模拟引擎 history 漂移（比如漏掉一步），传入正确 UI history 时应自动重同步
  const uiHistory2 = [
    { i: 7, j: 7, role: 1 },
    { i: reply1.y, j: reply1.x, role: reply1.role }, // AI 白
    { i: 8, j: 7, role: 1 }, // 黑下 I8
  ];
  bridge.history.pop(); // 故意让引擎历史少一步
  const reply2 = await bridge.move(7, 8, uiHistory2);
  console.log('漂移后白棋应手:', fmt(reply2));

  await bridge.end();
}

main().catch(e => { console.error(e); process.exit(1); });
