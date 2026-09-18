/**
 * 数据一致性校验。
 * 用法：node scripts/verify.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';

const idx = JSON.parse(await readFile('public/data/index.json', 'utf8'));
const files = await readdir('public/data/players');
const sum = (k) => idx.players.reduce((a, p) => a + p[k], 0);

console.log('=== 索引 ===');
console.log('选手数', idx.players.length, '| 选手明细文件', files.length, idx.players.length === files.length ? '✓' : '✗ 不一致');
console.log('对局数', idx.meta.totalMatches, '| 地图数', idx.meta.totalMaps, '| 跨度', idx.meta.first, '~', idx.meta.last);

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

console.log('\n=== 抽样复核（변현제 #34）===');
const p = JSON.parse(await readFile('public/data/players/34.json', 'utf8'));
console.log(`${p.name} ${p.race} · ${p.games} 场 ${p.wins}胜 ${p.losses}负 · 胜率 ${p.wr}%`);
console.log('  分赛事', p.events.map((e) => `${e.short}:${e.games}/${e.wr}%`).join(' '));
console.log('  月度记录', p.monthly.length, '个月 | 地图', p.maps.length, '张 | 对手', p.opponents.length, '人 | 对局明细', p.matches.length);
console.log('  明细自洽', p.matches.length === p.games ? '✓' : '✗');
console.log('  胜场自洽', p.matches.filter((m) => m.w).length === p.wins ? '✓' : '✗');

let g = 0, w = 0;
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) {
    const me = m.participants.find((x) => x.player_id === 34);
    if (me) { g++; if (me.result === 'win') w++; }
  }
}
console.log(`  原始数据独立复算 ${g} 场 ${w} 胜 →`, g === p.games && w === p.wins ? '✓ 一致' : '✗ 不一致');

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
