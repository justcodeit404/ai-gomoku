const { _electron: electron } = require('playwright');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

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

  console.log('窗口标题:', await page.title());
  await page.screenshot({ path: 'test-undo-00-start.png' });

  // 点击"开始对局"
  const startBtn = await page.locator('button', { hasText: /开.*始.*对.*局/ }).first();
  await startBtn.click({ force: true });
  await delay(3000);
  await page.screenshot({ path: 'test-undo-01-game-started.png' });

  // 获取棋盘单元格尺寸
  const cell = await page.locator('[data-i][data-j]').first();
  const box = await cell.boundingBox();
  const cellSize = box.width;
  console.log('单元格尺寸:', cellSize);

  const clickCell = async (i, j) => {
    const el = page.locator(`[data-i="${i}"][data-j="${j}"]`).first();
    await el.click({ force: true });
    await delay(3500);
  };

  // 走几步棋（人执白后手）
  // 假设 AI 第一手落在中心附近，人下在 (7,6)
  await clickCell(7, 6);
  await page.screenshot({ path: 'test-undo-02-move1.png' });

  await clickCell(8, 7);
  await page.screenshot({ path: 'test-undo-03-move2.png' });

  await clickCell(9, 8);
  await page.screenshot({ path: 'test-undo-04-move3.png' });

  // 记录悔棋前的局面
  const movesBefore = await page.locator('[data-i][data-j]').evaluateAll(els =>
    els.filter(e => e.querySelector('.piece')).map(e => ({
      i: e.getAttribute('data-i'),
      j: e.getAttribute('data-j'),
      color: e.querySelector('.black') ? 'black' : 'white',
    }))
  );
  console.log('悔棋前棋子数量:', movesBefore.length, movesBefore);

  // 悔棋
  const undoBtn = await page.locator('button', { hasText: /悔.*棋/ }).first();
  await undoBtn.click({ force: true });
  await delay(500);
  const confirmUndo = await page.locator('.ant-modal-wrap .ant-btn-primary', { hasText: /悔.*棋/ }).first();
  if (await confirmUndo.isVisible().catch(() => false)) {
    await confirmUndo.click({ force: true });
  }
  await delay(3000);
  await page.screenshot({ path: 'test-undo-05-after-undo.png' });

  const movesAfterUndo = await page.locator('[data-i][data-j]').evaluateAll(els =>
    els.filter(e => e.querySelector('.piece')).map(e => ({
      i: e.getAttribute('data-i'),
      j: e.getAttribute('data-j'),
      color: e.querySelector('.black') ? 'black' : 'white',
    }))
  );
  console.log('悔棋后棋子数量:', movesAfterUndo.length, movesAfterUndo);

  // 重新走棋
  await clickCell(9, 8);
  await page.screenshot({ path: 'test-undo-06-replay.png' });
  await clickCell(10, 9);
  await page.screenshot({ path: 'test-undo-07-replay2.png' });
  await clickCell(11, 10);
  await page.screenshot({ path: 'test-undo-08-replay3.png' });

  // 检查 AI 是否还能正常回应
  const movesFinal = await page.locator('[data-i][data-j]').evaluateAll(els =>
    els.filter(e => e.querySelector('.piece')).map(e => ({
      i: e.getAttribute('data-i'),
      j: e.getAttribute('data-j'),
      color: e.querySelector('.black') ? 'black' : 'white',
    }))
  );
  console.log('重走后棋子数量:', movesFinal.length, movesFinal);

  await app.close();
  console.log('\n--- 引擎日志 ---');
  logs.forEach(l => console.log(l));
  console.log('运行完成。截图已保存到当前目录。');
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
