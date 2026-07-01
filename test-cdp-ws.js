const { chromium } = require('playwright');
async function main() {
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:9223/devtools/browser/1cd72564-fe34-432d-85b5-616ec99a98a6');
  console.log('contexts', browser.contexts().length);
  const page = browser.contexts()[0]?.pages()[0];
  console.log('page url', page?.url());
  await page?.screenshot({ path: 'cdp-shot.png' });
  await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
