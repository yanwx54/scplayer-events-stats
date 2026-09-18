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

/* 期望值统一从构建产物推导，避免写死数字在数据每日同步后失效 */
const DATA = path.join(__dirname, '..', 'public', 'data');
const idxJson = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const dispOf = (p) => p.cn || p.name;              // 展示名（中文优先）
const byId = new Map(idxJson.players.map((p) => [p.id, p]));
const topPlayer = [...idxJson.players].sort((a, b) => b.games - a.games)[0];
const player34 = JSON.parse(fs.readFileSync(path.join(DATA, 'players', '34.json'), 'utf8'));
const h2hGames = player34.matches.filter((m) => m.o === 12);   // 34 vs 12
const h2hAW = h2hGames.filter((m) => m.w).length;
const dayBefore = (d) => new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10);
const dayAfter = (d) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);
const h2hDates = h2hGames.map((m) => m.d).sort();
// 找一段「两人一定没有交手」的区间，用于校验空状态
const emptyWin = h2hDates[0] > idxJson.meta.first
  ? [idxJson.meta.first, dayBefore(h2hDates[0])]
  : [dayAfter(h2hDates.at(-1)), idxJson.meta.last];

const pages = [
  ['home', '/#/', true],
  ['players', '/#/players', true],
  ['player-34', '/#/player/34', true],
  ['player-34-maps', '/#/player/34?tab=maps', true],
  ['player-34-opp', '/#/player/34?tab=opponents', true],
  ['h2h', '/#/h2h?a=34&b=12', true],
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
      const bold = td[1].querySelector('b');
      return {
        name: (bold ? bold.textContent : td[1].innerText).trim(),   // 展示名（中文优先）
        krName: (td[1].querySelector('.kr-name') || {}).textContent || '',
        games: td[3].innerText.trim(), wr: td[5].innerText.trim(), eloNet: td[6].innerText.trim(),
      };
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
  const nPlayers = idxJson.players.length;
  check(`默认 ${nPlayers} 行`, (await page.locator('#plist tbody tr').count()) === nPlayers);
  const full5 = await rowVals();
  const n0 = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  check('初始基线为全量（与 index.json 榜首一致）',
    full5[0].name === dispOf(topPlayer) && n0(full5[0].games) === topPlayer.games,
    `页面 [${full5[0].name} ${full5[0].games}] vs 数据 [${dispOf(topPlayer)} ${topPlayer.games}]`);
  check('榜首显示中文名 + 韩文原名', full5[0].name === topPlayer.cn && full5[0].krName === topPlayer.name,
    `[${full5[0].name} / ${full5[0].krName}]`);

  // 三语搜索：中文名 / 韩文名 / 英文 ID
  await page.locator('#q').fill('迷你');
  await page.waitForTimeout(300);
  check('中文名搜索「迷你」命中 1 行', (await page.locator('#plist tbody tr').count()) === 1);
  await page.locator('#q').fill('변현제');
  await page.waitForTimeout(300);
  check('韩文名搜索「변현제」命中 1 行', (await page.locator('#plist tbody tr').count()) === 1);
  await page.locator('#q').fill('Mini');
  await page.waitForTimeout(300);
  check('英文 ID 搜索「Mini」命中 1 行', (await page.locator('#plist tbody tr').count()) === 1);
  await page.locator('#q').fill('Flash');
  await page.waitForTimeout(300);
  const flashRow = await page.$$eval('#plist tbody tr', (trs) => trs.map((tr) => tr.querySelectorAll('td')[1].innerText.trim()));
  check('英文 ID 搜索「Flash」→ 教主', flashRow.length === 1 && flashRow[0].includes('教主'), flashRow.join('|'));
  await page.locator('#q').fill('');
  await page.waitForTimeout(300);

  /* ---------- 选手排行：日期时间段 ---------- */
  console.log('\n=== 选手排行 · 日期时间段 ===');
  check('区间条已渲染', await page.locator('#segRange').isVisible());
  check('默认选中「全部」', await page.locator('#segRange button[data-range="all"]').evaluate((b) => b.classList.contains('on')));
  const infoAll = await page.locator('#segRange [data-role="info"]').innerText();
  check(`数据起点为 ${idxJson.meta.cutoff}`, infoAll.includes(idxJson.meta.cutoff), infoAll);

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

  // 自定义区间（落在数据范围内）
  await page.locator('#segRange [data-role="from"]').fill('2026-03-01');
  await page.locator('#segRange [data-role="to"]').fill('2026-06-30');
  await page.locator('#segRange [data-role="to"]').dispatchEvent('change');
  await page.waitForTimeout(400);
  const rCustom = await rowVals();
  console.log(`    2026-03-01 ~ 2026-06-30: 榜首 ${rCustom[0]?.name} ${rCustom[0]?.games} 场 ${rCustom[0]?.wr}`);
  check('自定义区间生效', n(rCustom[0]?.games) > 0 && n(rCustom[0]?.games) !== n(r90[0].games));

  // 赛事 + 时间段 组合
  await page.locator('#segEvent button[data-ev="43"]').click();
  await page.waitForTimeout(400);
  const ev43 = await rowVals();
  console.log(`    2026-03-01 ~ 2026-06-30 + 메프로: 榜首 ${ev43[0]?.name} ${ev43[0]?.games} 场`);
  check('赛事+时间段可叠加', n(ev43[0]?.games) > 0 && n(ev43[0]?.games) <= n(rCustom[0]?.games));

  // 早于数据起点的区间应为空（数据只保留 2026-01-01 之后）
  await page.locator('#segEvent button[data-ev="0"]').click();
  await page.locator('#segRange [data-role="from"]').fill('2025-01-01');
  await page.locator('#segRange [data-role="to"]').fill('2025-12-31');
  await page.locator('#segRange [data-role="to"]').dispatchEvent('change');
  await page.waitForTimeout(400);
  const rBefore = await page.locator('#plist tbody tr').count();
  console.log(`    2025 全年（早于数据起点）: ${rBefore} 行`);
  check('早于数据起点的区间无数据', rBefore === 1
    && (await page.locator('#plist tbody .empty').count()) === 1);

  // 恢复全部
  await page.locator('#segEvent button[data-ev="0"]').click();
  await page.locator('#segRange button[data-range="all"]').click();
  await page.waitForTimeout(400);
  const back = await rowVals();
  check('恢复「全部」后与初始一致',
    back[0].name === full5[0].name && back[0].games === full5[0].games,
    `初始 [${full5[0].name} ${full5[0].games}] → 恢复后 [${back[0].name} ${back[0].games}]`);

  /* ---------- 双方对战 ---------- */
  console.log('\n=== 双方对战 ===');
  await page.goto(BASE + '/#/h2h?a=34&b=12', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check('区间条已渲染', await page.locator('#h2hRange').isVisible());
  const score0 = await page.locator('.h2h-score').innerText();
  console.log(`    全部区间比分: ${score0.replace(/\n/g, ' ')}`);
  check(`全部区间为 ${h2hAW} : ${h2hGames.length - h2hAW}（交手 ${h2hGames.length} 场）`,
    score0.includes(String(h2hAW)) && score0.includes(String(h2hGames.length - h2hAW)));

  const h2hNames = await page.$$eval('.h2h-side b', (bs) => bs.map((b) => b.textContent.trim()));
  check('双方显示中文名（迷你 / 永镇）', h2hNames.join(',') === '迷你,永镇', h2hNames.join(','));

  // 交手记录：全部信息压缩成一行（表格），不再用两行 .mrow 布局
  const recRows = await page.locator('#h2hList tbody tr').count();
  check(`交手记录行数 = 交战场次 ${h2hGames.length}`, recRows === Math.min(h2hGames.length, 200), `${recRows} 行`);
  const recCells = await page.$$eval('#h2hList tbody tr:first-child td', (tds) => tds.length);
  check('交手记录每行 7 列（结果/对阵/地图/日期/赛事/队伍/ELO）', recCells === 7, `${recCells} 列`);
  check('交手记录已无两行布局（.mrow）', (await page.locator('#h2hBody .mrow').count()) === 0);
  check('交手记录含结果徽标', (await page.locator('#h2hList tbody tr:first-child td .res').count()) === 1);
  const recTxt = await page.locator('#h2hList tbody tr:first-child').innerText();
  console.log(`    首行: ${recTxt.replace(/\n/g, ' | ')}`);
  check('交手记录赛事显示中文名', /职业联赛|K联赛|半职业联赛/.test(recTxt), recTxt.replace(/\n/g, ' ').slice(0, 70));
  check('交手记录每行只占一行文本高度（无第二行 meta）',
    recTxt.split('\n').length <= 7, `${recTxt.split('\n').length} 行文本`);

  // 分地图交手只应包含本赛季地图
  const seasonAliases = new Set(idxJson.meta.season.aliases);
  const mapRowsKr = await page.$$eval('#h2hMapTable tbody tr', (trs) => trs.map((tr) => {
    const kr = tr.querySelector('.kr-name');
    return kr ? kr.textContent.trim() : tr.querySelectorAll('td')[0].innerText.trim();
  }));
  check('分地图交手仅本赛季地图', mapRowsKr.length > 0 && mapRowsKr.every((k) => seasonAliases.has(k)),
    `${mapRowsKr.length} 张：${mapRowsKr.join(' / ')}`);

  // 三语搜索：用英文 ID 选人
  await page.locator('#pickA').fill('Flash');
  await page.waitForTimeout(300);
  const ddTxt = await page.locator('#ddA').innerText();
  check('H2H 英文 ID 搜索「Flash」→ 教主', ddTxt.includes('教主'), ddTxt.replace(/\n/g, ' ').slice(0, 60));
  await page.locator('#pickA').fill('');
  await page.locator('#pickA').blur();          // 关掉下拉，否则会盖住下方的区间条
  await page.waitForTimeout(400);
  check('H2H 下拉已收起', !(await page.locator('#ddA').isVisible()));

  await page.locator('#h2hRange button[data-range="90"]').click();
  await page.waitForTimeout(500);
  const score90 = await page.locator('.h2h-score').innerText();
  console.log(`    近 90 天比分: ${score90.replace(/\n/g, ' ')}`);
  check('近 90 天比分与全部不同', score90 !== score0);
  check('近 90 天场次变少', n(score90.split(':')[0]) + n(score90.split(':')[1]) < n(score0.split(':')[0]) + n(score0.split(':')[1]));
  await page.screenshot({ path: path.join(OUT, 'h2h-range90.png'), fullPage: false });

  // 一定没有交手的区间 → 无记录
  await page.locator('#h2hRange [data-role="from"]').fill(emptyWin[0]);
  await page.locator('#h2hRange [data-role="to"]').fill(emptyWin[1]);
  await page.locator('#h2hRange [data-role="to"]').dispatchEvent('change');
  await page.waitForTimeout(500);
  const emptyShown = await page.locator('#h2hBody .empty').count();
  check(`无记录时给出空状态提示（${emptyWin[0]} ~ ${emptyWin[1]}）`, emptyShown > 0);

  await page.locator('#h2hRange button[data-range="all"]').click();
  await page.waitForTimeout(500);
  const scoreBack = await page.locator('.h2h-score').innerText();
  check('恢复「全部」后比分还原', scoreBack === score0);

  /* ---------- 地图情报 ---------- */
  console.log('\n=== 地图情报 ===');
  await page.goto(BASE + '/#/maps', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const mapCount = await page.locator('#mapTable tbody tr').count();
  check(`仅本赛季 ${idxJson.meta.season.maps.length} 张地图`, mapCount === idxJson.meta.season.maps.length, `${mapCount} 行`);
  const mapKr = await page.$$eval('#mapTable tbody tr', (trs) => trs.map((tr) => {
    const kr = tr.querySelector('.kr-name');
    return kr ? kr.textContent.trim() : '';
  }));
  check('每行都有中文译名（中文名 + 韩文原名）', mapKr.length === mapCount && mapKr.every((k) => seasonAliases.has(k)),
    mapKr.join(' / '));

  // 地图情报：改为「总场次 + 分种族对抗胜率」，不再显示选手出场次数
  const mapHeads = await page.$$eval('#mapTable thead th', (ths) => ths.map((t) => t.textContent.trim()));
  check('地图情报表头含 ZvP / ZvT / PvT',
    ['ZvP', 'ZvT', 'PvT'].every((k) => mapHeads.includes(k)), mapHeads.join(' / '));
  check('地图情报不再显示「使用选手」「出场最多选手」',
    !mapHeads.some((h) => h.includes('选手')), mapHeads.join(' / '));
  const mapsJson = JSON.parse(fs.readFileSync(path.join(DATA, 'maps.json'), 'utf8'));
  const byKr = new Map(mapsJson.map((m) => [m.kr, m]));
  const mapStats = await page.$$eval('#mapTable tbody tr', (trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    return {
      kr: tr.querySelector('.kr-name')?.textContent.trim() || '',
      games: cells[2].innerText.trim(),
      mu: cells.slice(3, 6).map((td) => td.innerText.trim().split('\n')[0]),
    };
  }));
  const muOk = mapStats.every((s) => {
    const m = byKr.get(s.kr);
    if (!m) return false;
    if (s.games !== String(m.games)) return false;
    return ['ZvP', 'ZvT', 'PvT'].every((k, i) => (m.matchups[k].g === 0
      ? s.mu[i] === '—'
      : s.mu[i] === m.matchups[k].wr1.toFixed(1) + '%'));
  });
  check('地图情报每格胜率/场次与 maps.json 一致', muOk,
    mapStats.map((s) => `${s.kr}:${s.mu.join(' ')}`).join(' | ').slice(0, 120));

  /* ---------- 选手详情 tabs ---------- */
  console.log('\n=== 选手详情 tabs ===');
  await page.goto(BASE + '/#/player/12', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('详情页标题显示中文名（永镇）', (await page.locator('.profile h1').innerText()).includes('永镇'));
  for (const t of ['maps', 'matchup', 'opponents', 'matches']) {
    await page.locator(`#tabs button[data-tab="${t}"]`).click();
    await page.waitForTimeout(350);
    const txt = await page.locator('#tabbody').innerText();
    check(`tab ${t} 有内容`, txt.length > 200, `${txt.length} 字符`);
  }
  await page.locator('#tabs button[data-tab="maps"]').click();
  await page.waitForTimeout(350);
  const pMapRows = await page.locator('#tabbody tbody tr').count();
  check('选手「地图」tab 仅本赛季地图', pMapRows > 0 && pMapRows <= idxJson.meta.season.maps.length, `${pMapRows} 行`);
  const pMapTxt = await page.locator('#tabbody').innerText();
  check('选手「地图」tab 显示中文地图名', pMapTxt.includes('态度') || pMapTxt.includes('八角笼'));

  // 对手 tab 支持三语搜索
  await page.locator('#tabs button[data-tab="opponents"]').click();
  await page.waitForTimeout(350);
  const oppAll = await page.locator('#oppTable tbody tr').count();
  await page.locator('#oppQ').fill('Mini');
  await page.waitForTimeout(300);
  const oppHit = await page.locator('#oppTable tbody tr').count();
  check('对手 tab 英文 ID 搜索生效', oppHit < oppAll && oppHit >= 1, `${oppAll} → ${oppHit}`);
  await page.locator('#oppQ').fill('迷你');
  await page.waitForTimeout(300);
  check('对手 tab 中文名搜索生效', (await page.locator('#oppTable tbody tr').count()) === oppHit);

  console.log('\n--- 控制台错误 ---');
  console.log(errors.length ? errors.slice(0, 10).join('\n') : '(无)');
  console.log(`\n${failed === 0 && errors.length === 0 ? 'SHOOT_OK' : 'SHOOT_FAILED'}  失败断言 ${failed} 项，控制台错误 ${errors.length} 条`);
  await browser.close();
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
