const { _electron: electron } = require('playwright');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function getPieces(page) {
  return page.locator('[data-i][data-j]').evaluateAll(els =>
    els.filter(e => e.querySelector('.piece')).map(e => ({
      i: e.getAttribute('data-i'),
      j: e.getAttribute('data-j'),
      color: e.querySelector('.black') ? 'black' : 'white',
    }))
  );
}

async function clickCell(page, i, j) {
  await page.locator(`[data-i="${i}"][data-j="${j}"]`).first().click({ force: true });
  await delay(3500);
}

async function main() {
  const app = await electron.launch({
    args: [path.join(__dirname, 'electron-main.js')],
    executablePath: path.join(__dirname, 'release', 'win-unpacked', 'AI五子棋.exe'),
    timeout: 30000,
  });

  const logs = [];
  app.process().stdout?.on('data', d => logs.push('[stdout] ' + d.toString().trim()));
  app.process().stderr?.on('data', d => logs.push('[stderr] ' + d.toString().trim()));

  const page = await app.firstWindow();
  await page.waitForLoadState('networkidle');
  await delay(2000);

  await page.locator('button', { hasText: /开.*始.*对.*局/ }).first().click({ force: true });
  await delay(3000);

  // 固定走法
  await clickCell(page, 7, 6);
  await clickCell(page, 8, 7);
  await clickCell(page, 9, 8);

  const beforeUndo = await getPieces(page);
  console.log('悔棋前:', beforeUndo.length, '子');
  console.log(beforeUndo);

  // 记录 AI 对 (9,8) 的回应
  const aiResponseBefore = beforeUndo.find(p => p.i === '6' && p.j === '6');
  console.log('AI 对 (9,8) 的回应:', aiResponseBefore);

  // 悔棋
  await page.locator('button', { hasText: /悔.*棋/ }).first().click({ force: true });
  await delay(500);
  await page.locator('.ant-modal-wrap .ant-btn-primary', { hasText: /悔.*棋/ }).first().click({ force: true });
  await delay(3000);

  const afterUndo = await getPieces(page);
  console.log('悔棋后:', afterUndo.length, '子');
  console.log(afterUndo);

  // 重新走同样的 (9,8)，看 AI 是否给出相同回应
  await clickCell(page, 9, 8);

  const afterReplay = await getPieces(page);
  console.log('重走 (9,8) 后:', afterReplay.length, '子');
  console.log(afterReplay);

  const aiResponseAfter = afterReplay.find(p => p.i === '6' && p.j === '6');
  console.log('悔棋后 AI 对 (9,8) 的回应:', aiResponseAfter);

  const same = aiResponseBefore && aiResponseAfter &&
    aiResponseBefore.i === aiResponseAfter.i &&
    aiResponseBefore.j === aiResponseAfter.j &&
    aiResponseBefore.color === aiResponseAfter.color;
  console.log('AI 回应是否一致:', same ? '是' : '否');

  await page.screenshot({ path: 'test-undo-same-move.png' });

  await app.close();
  console.log('\n--- 引擎日志 ---');
  logs.forEach(l => console.log(l));
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
