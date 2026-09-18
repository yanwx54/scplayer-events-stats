/**
 * 数据一致性校验。
 * 用法：node scripts/verify.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';

const idx = JSON.parse(await readFile('public/data/index.json', 'utf8'));
const files = await readdir('public/data/players');
const sum = (k) => idx.players.reduce((a, p) => a + p[k], 0);
/** 与 build-db.mjs 保持一致的数据起点 */
const CUTOFF = idx.meta.cutoff || '2026-01-01';
const inScope = (m) => (m.played_on || '') >= CUTOFF;

console.log('=== 索引 ===');
console.log('选手数', idx.players.length, '| 选手明细文件', files.length, idx.players.length === files.length ? '✓' : '✗ 不一致');
console.log('对局数', idx.meta.totalMatches, '| 本赛季地图数', idx.meta.totalMaps, '| 跨度', idx.meta.first, '~', idx.meta.last);
console.log('数据起点（cutoff）', CUTOFF, '| 本赛季', idx.meta.season?.label);

const cnCnt = idx.players.filter((p) => p.cn).length;
console.log('有中文名的选手', cnCnt, '/', idx.players.length, cnCnt > 0 ? '✓' : '✗');

console.log('\n=== 平衡校验 ===');
console.log('选手-场次总和', sum('games'), '（应为对局数 ×2 =', idx.meta.totalMatches * 2, '）', sum('games') === idx.meta.totalMatches * 2 ? '✓' : '✗');
console.log('胜场总和', sum('wins'), '| 负场总和', sum('losses'), sum('wins') === sum('losses') ? '✓ 相等' : '✗ 不等');

console.log('\n=== 分赛事场次 ===');
let evTotal = 0;
for (const e of idx.events) {
  const g = idx.players.reduce((a, p) => a + (p.ev?.[e.id]?.g || 0), 0);
  evTotal += g;
  console.log(`  ${e.name} (${e.id}): 选手累计 ${g} = 对局数 ×2 ${e.matches * 2}`, g === e.matches * 2 ? '✓' : '✗');
}
console.log('  合计', evTotal, evTotal === idx.meta.totalMatches * 2 ? '✓' : '✗');

console.log('\n=== 抽样复核（出场最多的选手）===');
const topP = idx.players[0];   // index 按场次降序
const p = JSON.parse(await readFile(`public/data/players/${topP.id}.json`, 'utf8'));
console.log(`${p.name}${p.cn ? ` (${p.cn}${p.idEn ? ' / ' + p.idEn : ''})` : ''} ${p.race} · ${p.games} 场 ${p.wins}胜 ${p.losses}负 · 胜率 ${p.wr}%`);
console.log('  分赛事', p.events.map((e) => `${e.short}:${e.games}/${e.wr}%`).join(' '));
console.log('  月度记录', p.monthly.length, '个月 | 本赛季地图', p.maps.length, '张 | 对手', p.opponents.length, '人 | 对局明细', p.matches.length);
console.log('  明细自洽', p.matches.length === p.games ? '✓' : '✗');
console.log('  胜场自洽', p.matches.filter((m) => m.w).length === p.wins ? '✓' : '✗');
console.log('  对手带中文名', p.opponents.filter((o) => o.cn).length, '/', p.opponents.length);

let g = 0, w = 0;
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) {
    if (!inScope(m)) continue;
    const me = m.participants.find((x) => x.player_id === topP.id);
    if (me) { g++; if (me.result === 'win') w++; }
  }
}
console.log(`  原始数据独立复算 ${g} 场 ${w} 胜 →`, g === p.games && w === p.wins ? '✓ 一致' : '✗ 不一致');

console.log('\n=== 地图口径 ===');
const seasonAliases = new Set(idx.meta.season?.aliases || []);
let offSeason = 0, onSeason = 0;
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) {
    if (!inScope(m) || !m.map_name) continue;
    if (seasonAliases.has(m.map_name)) onSeason++; else offSeason++;
  }
}
console.log(`  本赛季地图对局 ${onSeason} 场 | 非本赛季地图对局 ${offSeason} 场（按需求不计入地图板块）`);
const maps = JSON.parse(await readFile('public/data/maps.json', 'utf8'));
console.log('  maps.json 条数', maps.length, maps.length === idx.meta.season?.maps?.length ? '✓ 仅本赛季' : '✗');
const mapGames = maps.reduce((a, m) => a + m.games, 0);
console.log('  maps.json 总场次', mapGames, '= 本赛季对局', onSeason, mapGames === onSeason ? '✓' : '✗');

console.log('\n=== 地图对抗胜率（分种族，从原始数据独立复算）===');
const MU = idx.meta.matchups || ['ZvP', 'ZvT', 'PvT'];
const ORD = { Z: 0, P: 1, T: 2 };
const rc = {};
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) {
    if (!inScope(m) || !m.map_name || !seasonAliases.has(m.map_name)) continue;
    const [a, b] = m.participants || [];
    if (!a || !b) continue;
    const g = rc[m.map_name] || (rc[m.map_name] = { games: 0, mirror: 0, m2: {} });
    g.games++;
    if (a.race === b.race) { g.mirror++; continue; }
    if (!(a.race in ORD) || !(b.race in ORD)) continue;
    const label = ORD[a.race] <= ORD[b.race] ? `${a.race}v${b.race}` : `${b.race}v${a.race}`;
    const first = ORD[a.race] <= ORD[b.race] ? a : b;
    const mm = g.m2[label] || (g.m2[label] = { g: 0, w1: 0 });
    mm.g++;
    if (first.result === 'win') mm.w1++;
  }
}
let muBad = 0, muMirror = 0;
for (const mp of maps) {
  const r = rc[mp.kr];
  const sumG = MU.reduce((a, k) => a + (mp.matchups[k]?.g || 0), 0);
  const okStruct = sumG + mp.mirror + mp.unknownRace === mp.games;
  const okMirror = !!r && r.mirror === mp.mirror;
  let okMU = true;
  for (const k of MU) {
    const want = r?.m2[k] || { g: 0, w1: 0 };
    const got = mp.matchups[k] || { g: 0, w1: 0 };
    if (want.g !== got.g || want.w1 !== got.w1 || got.w2 !== got.g - got.w1) okMU = false;
  }
  if (!okStruct || !okMirror || !okMU) muBad++;
  muMirror += mp.mirror;
  console.log(`  ${mp.cn}(${mp.kr}) ${mp.games} 场 同族${mp.mirror} | `
    + MU.map((k) => `${k} ${mp.matchups[k].g}场 ${mp.matchups[k].wr1 == null ? '—' : mp.matchups[k].wr1 + '%'}`).join(' · ')
    + (okStruct && okMirror && okMU ? ' ✓' : ' ✗'));
}
console.log(`  合计 异族 ${mapGames - muMirror} 场 + 同族 ${muMirror} 场 = ${mapGames} 场`,
  muBad === 0 ? '✓ 全部一致' : `✗ ${muBad} 张地图不一致`);

console.log('\n=== 重复检查 ===');
const seen = new Set();
let dup = 0;
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) { if (seen.has(m.id)) dup++; seen.add(m.id); }
}
console.log('原始数据 match id 重复数', dup, dup === 0 ? '✓' : '✗');

console.log('\n=== 体积 ===');
let tot = 0;
for (const f of files) tot += (await stat('public/data/players/' + f)).size;
console.log('players/', (tot / 1048576).toFixed(2), 'MB | index.json', ((await stat('public/data/index.json')).size / 1024).toFixed(1), 'KB');
console.log('\nVERIFY_DONE');
