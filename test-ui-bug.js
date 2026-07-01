const { _electron: electron } = require('playwright');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function getPieces(page) {
  return page.locator('[data-i][data-j]').evaluateAll(els =>
    els.filter(e => e.querySelector('.piece')).map(e => ({
      i: Number(e.getAttribute('data-i')),
      j: Number(e.getAttribute('data-j')),
      color: e.querySelector('.black') ? 'black' : 'white',
    }))
  );
}

async function clickCell(page, i, j) {
  const el = page.locator(`[data-i="${i}"][data-j="${j}"]`).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ force: true });
  await delay(2500);
}

async function main() {
  const electronPath = require('electron');
  const app = await electron.launch({
    args: [path.join(__dirname)],
    executablePath: electronPath,
    timeout: 30000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('networkidle');
  await delay(2000);

  // 开始对局（AI 先手默认）
  await page.locator('button', { hasText: /开.*始.*对.*局/ }).first().click({ force: true });
  await delay(3000);
  console.log('开始后:', await getPieces(page));

  await clickCell(page, 7, 6);
  console.log('玩家 (7,6):', await getPieces(page));
  await clickCell(page, 8, 7);
  console.log('玩家 (8,7):', await getPieces(page));
  await clickCell(page, 9, 8);
  const beforeUndo = await getPieces(page);
  console.log('玩家 (9,8) 后:', beforeUndo);

  // 悔棋
  await page.locator('button', { hasText: /悔.*棋/ }).first().click({ force: true });
  await delay(500);
  await page.locator('.ant-modal-wrap .ant-btn-primary').first().click({ force: true });
  await delay(3000);
  console.log('悔棋后:', await getPieces(page));

  // 重走
  await clickCell(page, 9, 8);
  const afterReplay = await getPieces(page);
  console.log('重走 (9,8) 后:', afterReplay);

  await page.screenshot({ path: 'test-ui-bug.png', fullPage: true });
  await app.close();
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
