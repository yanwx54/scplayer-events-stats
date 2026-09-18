/**
 * 用 Playwright 对本地站点截图自检（复用参考项目的 playwright 安装）。
 * 用法：node scripts/shoot.cjs
 */
const PW = 'D:/WorkSpace/scplayer-stats/node_modules/playwright';
const { chromium } = require(PW);
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.BASE || 'http://127.0.0.1:5178';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const pages = [
  ['home', '/#/', true],
  ['players', '/#/players', true],
  ['player-34', '/#/player/34', true],
  ['player-34-maps', '/#/player/34?tab=maps', true],
  ['player-34-opp', '/#/player/34?tab=opponents', true],
  ['h2h', '/#/h2h?a=34&b=12', false],
  ['maps', '/#/maps', true],
  ['players-event43', '/#/players?event=43', true],
  ['mobile-home', '/#/', false],
];

(async () => {
  const EXE = process.env.CHROME_EXE || 'C:/Users/yanwx/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe';
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  for (const [name, url, full] of pages) {
    if (name.startsWith('mobile')) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
    const h1 = await page.evaluate(() => (document.querySelector('main h1, main h2') || {}).textContent || '');
    console.log(`${name.padEnd(18)} ok  h1/h2="${h1.trim().slice(0, 40)}"`);
    if (name.startsWith('mobile')) await page.setViewportSize({ width: 1440, height: 1000 });
  }

  // 交互自检
  await page.goto(BASE + '/#/players', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const rows = await page.locator('#plist tbody tr').count();
  console.log('leaderboard rows:', rows);
  await page.locator('#q').fill('변');
  await page.waitForTimeout(300);
  console.log('after search "변":', await page.locator('#plist tbody tr').count());
  await page.locator('#segRace button[data-race="P"]').click();
  await page.waitForTimeout(300);
  console.log('after race=P:', await page.locator('#plist tbody tr').count());

  // 选手详情 tab 切换
  await page.goto(BASE + '/#/player/12', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  for (const t of ['maps', 'matchup', 'opponents', 'matches']) {
    await page.locator(`#tabs button[data-tab="${t}"]`).click();
    await page.waitForTimeout(350);
    const txt = await page.locator('#tabbody').innerText();
    console.log(`tab ${t}: ${txt.length} chars`);
  }
  await page.screenshot({ path: path.join(OUT, 'player-12-matches.png'), fullPage: true });

  console.log('\n--- errors ---');
  console.log(errors.length ? errors.slice(0, 20).join('\n') : '(none)');
  await browser.close();
})();
