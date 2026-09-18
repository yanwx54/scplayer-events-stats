/**
 * 数据溯源核对 —— 现场对比「官方 API」与「本地/线上数据」，确认每日同步抓的是对的。
 *
 * 用法：
 *   node scripts/check-source.mjs          # 默认核对赛事 43（메이저 프로리그）
 *   node scripts/check-source.mjs 33       # 核对指定赛事
 *   node scripts/check-source.mjs 43 --live # 额外抓取线上站点做三方比对
 *
 * 输出三段：
 *   ① 官方 API 的权威数字（总数 + 最新一条原始记录）
 *   ② 本地 raw 缓存与聚合产物的数字
 *   ③ 线上站点正在展示的数字
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://eloboard.com';
const LIVE = 'http://199.180.116.188:5001';

const EVENTS = {
  43: { name: '메이저 프로리그', nameZh: '职业联赛', url: 'https://eloboard.com/events/43' },
  33: { name: 'K리그', nameZh: 'K联赛', url: 'https://eloboard.com/events/33' },
  64: { name: '준메이저 프로리그', nameZh: '半职业联赛', url: 'https://eloboard.com/events/64' },
};

const argv = process.argv.slice(2);
const EVENT_ID = Number(argv.find((a) => /^\d+$/.test(a)) || 43);
const WITH_LIVE = argv.includes('--live');
const CUTOFF = '2026-01-01';

const ev = EVENTS[EVENT_ID];
if (!ev) {
  console.error('未知赛事 id，只支持 43 / 33 / 64');
  process.exit(1);
}

const readJson = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const apiUrl = (offset = 0) => `${BASE}/api/matches?event_id=${EVENT_ID}&limit=200&offset=${offset}`;

console.log('═'.repeat(74));
console.log(`数据溯源核对 · 赛事 ${EVENT_ID} ${ev.name}（${ev.nameZh}）`);
console.log('═'.repeat(74));

/* ---------- ① 官方 API ---------- */
console.log('\n① 官方数据源（eloboard 公开 JSON API）');
console.log('   赛事页 : ' + ev.url);
console.log('   接口   : ' + apiUrl(0));
console.log('   说明   : 官方总数在响应头 x-total-count，数据按时间倒序（最新在前）');

const r1 = await fetch(apiUrl(0), { headers: { accept: 'application/json' } });
const page1 = await r1.json();
const officialTotal = Number(r1.headers.get('x-total-count') || 0);
console.log(`\n   HTTP ${r1.status} · x-total-count = ${officialTotal}（该赛事历史全部对局）`);
console.log(`   本页返回 ${page1.length} 条，最新一条：`);
const newest = page1[0];
console.log('   ' + JSON.stringify(newest, null, 2).split('\n').join('\n   '));

/* ---------- ② 本地 ---------- */
console.log('\n② 本地数据');
const raw = await readJson(path.join(ROOT, 'data', 'raw', `event-${EVENT_ID}.json`), []);
const afterCutoff = raw.filter((m) => (m.played_on || '') >= CUTOFF);
const idx = await readJson(path.join(ROOT, 'public', 'data', 'index.json'), {});
const evMeta = (idx.events || []).find((e) => e.id === EVENT_ID) || {};
const dailies = await readJson(path.join(ROOT, 'public', 'data', 'daily.json'), null);

console.log(`   data/raw/event-${EVENT_ID}.json    : ${raw.length} 条（全量缓存，含 ${CUTOFF} 之前）`);
console.log(`   其中 ${CUTOFF} 之后               : ${afterCutoff.length} 条 ← 网站实际统计范围`);
console.log(`   public/data/index.json events[${EVENT_ID}] : matches=${evMeta.matches} · players=${evMeta.players} · ${evMeta.first} ~ ${evMeta.last}`);
if (dailies) {
  const buckets = (dailies.days || dailies.d || []).length;
  console.log(`   public/data/daily.json            : ${buckets} 个日期桶（用于日期段筛选）`);
}
console.log(`   构建时间 meta.builtAt              : ${idx.meta?.builtAt}`);
console.log(`   全站口径 meta.scope                : ${idx.meta?.scope}`);

/* ---------- ③ 线上 ---------- */
if (WITH_LIVE) {
  console.log('\n③ 线上站点');
  try {
    const hr = await fetch(`${LIVE}/api/health`);
    const h = await hr.json();
    console.log(`   ${LIVE}/api/health → 站点 ${h.files} 个文件, ${(h.bytes / 1048576).toFixed(1)} MB, 更新于 ${h.updatedAt}`);
    const lr = await fetch(`${LIVE}/data/index.json`);
    const lidx = await lr.json();
    const lev = (lidx.events || []).find((e) => e.id === EVENT_ID) || {};
    console.log(`   线上 events[${EVENT_ID}] : matches=${lev.matches} · players=${lev.players} · ${lev.first} ~ ${lev.last}`);
    console.log(`   线上 builtAt           : ${lidx.meta?.builtAt}`);
    const same = lidx.meta?.builtAt === idx.meta?.builtAt;
    console.log(`   → 线上与本地构建时间${same ? '一致 ✓（已同步）' : '不一致 ✗（需 npm run deploy）'}`);
  } catch (e) {
    console.log(`   线上不可达：${e.message}`);
  }
}

/* ---------- 结论 ---------- */
console.log('\n' + '─'.repeat(74));
console.log('核对结论');
console.log('─'.repeat(74));
const diff = officialTotal - raw.length;
console.log(`  官方总数 ${officialTotal} vs 本地全量缓存 ${raw.length} → 差 ${diff}`);
if (diff === 0) {
  console.log('  ✓ 本地缓存与官方总数完全一致，没有漏抓');
} else if (diff > 0) {
  console.log(`  ⚠ 本地比官方少 ${diff} 条（可能官方刚追加了新对局，跑一次 sync 即可补齐）`);
} else {
  console.log(`  ⚠ 本地比官方多 ${-diff} 条（官方删过记录，属于只增不减策略的正常现象）`);
}
console.log(`  网站展示口径 = 该赛事 ${CUTOFF} 之后的 ${afterCutoff.length} 条 → index.json 记为 ${evMeta.matches}`);
console.log(`  ${afterCutoff.length === evMeta.matches ? '✓ 聚合产物与明细一致' : '✗ 聚合产物与明细不一致，请重跑 build-db.mjs'}`);
console.log('');
