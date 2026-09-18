/**
 * 用 Playwright 对本地站点截图 + 交互自检（复用参考项目的 playwright 安装）。
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

  let failed = 0;
  const check = (name, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
  };

  /* ---------- 各页面可加载 ---------- */
  console.log('=== 页面加载 ===');
  for (const [name, url, full] of pages) {
    if (name.startsWith('mobile')) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
    const h = await page.evaluate(() => (document.querySelector('main h1, main h2') || {}).textContent || '');
    console.log(`  ${name.padEnd(16)} ${h.trim().slice(0, 34)}`);
    if (name.startsWith('mobile')) await page.setViewportSize({ width: 1440, height: 1000 });
  }

  const rowVals = async () =>
    page.$$eval('#plist tbody tr', (trs) => trs.slice(0, 5).map((tr) => {
      const td = tr.querySelectorAll('td');
      return { name: td[1].innerText.trim(), games: td[3].innerText.trim(), wr: td[5].innerText.trim(), eloNet: td[6].innerText.trim() };
    }));

  /* ---------- 选手排行：基础筛选 ---------- */
  console.log('\n=== 选手排行 ===');
  // 回归：从首页事件卡片 (#/players?event=43) 进入后，再点导航回 #/players 必须复位为「全部赛事」
  await page.goto(BASE + '/#/players?event=43', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.goto(BASE + '/#/players', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('离开 ?event=43 后复位为「全部赛事」',
    await page.locator('#segEvent button[data-ev="0"]').evaluate((b) => b.classList.contains('on')));
  check('默认 238 行', (await page.locator('#plist tbody tr').count()) === 238);
  const full5 = await rowVals();
  const n0 = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  // 期望基线直接从 index.json 推导，避免数据每日同步后断言写死失效
  const idxJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'index.json'), 'utf8'));
  const topP = [...idxJson.players].sort((a, b) => b.games - a.games)[0];
  check('初始基线为全量（与 index.json 榜首一致）',
    full5[0].name === topP.name && n0(full5[0].games) === topP.games,
    `页面 [${full5[0].name} ${full5[0].games}] vs 数据 [${topP.name} ${topP.games}]`);

  await page.locator('#q').fill('변');
  await page.waitForTimeout(300);
  check('搜索「변」得 2 行', (await page.locator('#plist tbody tr').count()) === 2);
  await page.locator('#q').fill('');
  await page.waitForTimeout(300);

  /* ---------- 选手排行：日期时间段 ---------- */
  console.log('\n=== 选手排行 · 日期时间段 ===');
  check('区间条已渲染', await page.locator('#segRange').isVisible());
  check('默认选中「全部」', await page.locator('#segRange button[data-range="all"]').evaluate((b) => b.classList.contains('on')));

  await page.locator('#segRange button[data-range="90"]').click();
  await page.waitForTimeout(400);
  const r90 = await rowVals();
  const info90 = await page.locator('#segRange [data-role="info"]').innerText();
  console.log(`    近90天区间: ${info90}`);
  console.log(`    榜首: ${r90[0].name} ${r90[0].games} 场 ${r90[0].wr}`);
  const n = (s) => Number(s.replace(/[^0-9]/g, '')) || 0;
  check('近 90 天场次 < 全部场次', n(r90[0].games) < n(full5[0].games), `${n(r90[0].games)} < ${n(full5[0].games)}`);
  check('「近 90 天」按钮高亮', await page.locator('#segRange button[data-range="90"]').evaluate((b) => b.classList.contains('on')));
  check('区间条数字非空', n(r90[0].games) > 0);
  await page.screenshot({ path: path.join(OUT, 'players-range90.png'), fullPage: false });

  // 自定义区间
  await page.locator('#segRange [data-role="from"]').fill('2025-01-01');
  await page.locator('#segRange [data-role="to"]').fill('2025-12-31');
  await page.locator('#segRange [data-role="to"]').dispatchEvent('change');
  await page.waitForTimeout(400);
  const r2025 = await rowVals();
  console.log(`    2025 全年: 榜首 ${r2025[0].name} ${r2025[0].games} 场 ${r2025[0].wr}`);
  check('自定义区间生效', n(r2025[0].games) > 0 && n(r2025[0].games) !== n(r90[0].games));

  // 赛事 + 时间段 组合
  await page.locator('#segEvent button[data-ev="43"]').click();
  await page.waitForTimeout(400);
  const ev43 = await rowVals();
  console.log(`    2025 全年 + 메프로: 榜首 ${ev43[0].name} ${ev43[0].games} 场`);
  check('赛事+时间段可叠加', n(ev43[0].games) > 0 && n(ev43[0].games) <= n(r2025[0].games));

  // 恢复全部
  await page.locator('#segEvent button[data-ev="0"]').click();
  await page.locator('#segRange button[data-range="all"]').click();
  await page.waitForTimeout(400);
  const back = await rowVals();
  check('恢复「全部」后与初始一致',
    back[0].name === full5[0].name && back[0].games === full5[0].games,
    `初始 [${full5[0].name} ${full5[0].games}] → 恢复后 [${back[0].name} ${back[0].games}]`);

  /* ---------- 双方对战：日期时间段 ---------- */
  console.log('\n=== 双方对战 · 日期时间段 ===');
  await page.goto(BASE + '/#/h2h?a=34&b=12', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check('区间条已渲染', await page.locator('#h2hRange').isVisible());
  const score0 = await page.locator('.h2h-score').innerText();
  console.log(`    全部区间比分: ${score0.replace(/\n/g, ' ')}`);
  check('全部区间为 139 : 107', score0.includes('139') && score0.includes('107'));

  await page.locator('#h2hRange button[data-range="90"]').click();
  await page.waitForTimeout(500);
  const score90 = await page.locator('.h2h-score').innerText();
  console.log(`    近 90 天比分: ${score90.replace(/\n/g, ' ')}`);
  check('近 90 天比分与全部不同', score90 !== score0);
  check('近 90 天场次变少', n(score90.split(':')[0]) + n(score90.split(':')[1]) < n(score0.split(':')[0]) + n(score0.split(':')[1]));
  await page.screenshot({ path: path.join(OUT, 'h2h-range90.png'), fullPage: false });

  // 极窄区间 → 无记录
  await page.locator('#h2hRange [data-role="from"]').fill('2021-04-08');
  await page.locator('#h2hRange [data-role="to"]').fill('2021-04-09');
  await page.locator('#h2hRange [data-role="to"]').dispatchEvent('change');
  await page.waitForTimeout(500);
  const emptyShown = await page.locator('#h2hBody .empty').count();
  check('无记录时给出空状态提示', emptyShown > 0);

  await page.locator('#h2hRange button[data-range="all"]').click();
  await page.waitForTimeout(500);
  const scoreBack = await page.locator('.h2h-score').innerText();
  check('恢复「全部」后比分还原', scoreBack === score0);

  /* ---------- 选手详情 tabs ---------- */
  console.log('\n=== 选手详情 tabs ===');
  await page.goto(BASE + '/#/player/12', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  for (const t of ['maps', 'matchup', 'opponents', 'matches']) {
    await page.locator(`#tabs button[data-tab="${t}"]`).click();
    await page.waitForTimeout(350);
    const txt = await page.locator('#tabbody').innerText();
    check(`tab ${t} 有内容`, txt.length > 200, `${txt.length} 字符`);
  }

  console.log('\n--- 控制台错误 ---');
  console.log(errors.length ? errors.slice(0, 10).join('\n') : '(无)');
  console.log(`\n${failed === 0 && errors.length === 0 ? 'SHOOT_OK' : 'SHOOT_FAILED'}  失败断言 ${failed} 项，控制台错误 ${errors.length} 条`);
  await browser.close();
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
