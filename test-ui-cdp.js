const { chromium } = require('playwright');
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
  await page.locator(`[data-i="${i}"][data-j="${j}"]`).first().click({ force: true });
  await delay(3500);
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  await page.waitForLoadState('networkidle');
  await delay(2000);

  await page.locator('button', { hasText: /开.*始.*对.*局/ }).first().click({ force: true });
  await delay(3500);
  console.log('开始后:', await getPieces(page));

  await clickCell(page, 7, 6);
  await clickCell(page, 8, 7);
  await clickCell(page, 9, 8);
  console.log('悔棋前:', await getPieces(page));

  await page.locator('button', { hasText: /悔.*棋/ }).first().click({ force: true });
  await delay(500);
  await page.locator('.ant-modal-wrap .ant-btn-primary').first().click({ force: true });
  await delay(3500);
  console.log('悔棋后:', await getPieces(page));

  await clickCell(page, 9, 8);
  console.log('重走后:', await getPieces(page));

  await page.screenshot({ path: 'test-ui-cdp.png', fullPage: true });
  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
