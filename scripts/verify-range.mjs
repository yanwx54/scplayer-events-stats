/**
 * 校验 daily.json 分日桶与原始数据在任意「日期区间 × 赛事」下的求和一致性。
 * 用法：node scripts/verify-range.mjs
 */
import { readFile } from 'node:fs/promises';

const daily = JSON.parse(await readFile('public/data/daily.json', 'utf8'));
const days = daily.days;

const lowerBound = (d) => { let lo = 0, hi = days.length; while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] < d) lo = m + 1; else hi = m; } return lo; };
const upperBound = (d) => { let lo = 0, hi = days.length; while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] <= d) lo = m + 1; else hi = m; } return lo - 1; };

function sumBuckets(buckets, lo, hi, ev) {
  let g = 0, w = 0, e = 0;
  for (const [be, bd, bg, bw, be2] of buckets || []) {
    if (ev && be !== ev) continue;
    if (bd < lo || bd > hi) continue;
    g += bg; w += bw; e += be2;
  }
  return { g, w, elo: Math.round(e * 10) / 10 };
}

const raw = [];
for (const ev of [43, 33, 64]) raw.push(...JSON.parse(await readFile(`data/raw/event-${ev}.json`, 'utf8')));

function brute(pid, from, to, ev) {
  let g = 0, w = 0, e = 0;
  for (const m of raw) {
    if (ev && m.event_id !== ev) continue;
    if (!m.played_on || m.played_on < from || m.played_on > to) continue;
    const me = m.participants.find((p) => p.player_id === pid);
    if (!me) continue;
    g++;
    const win = me.result === 'win';
    if (win) w++;
    if (typeof m.elo_delta === 'number') e += win ? m.elo_delta : -m.elo_delta;
  }
  return { g, w, elo: Math.round(e * 10) / 10 };
}

const cases = [
  ['2021-04-08', '2026-09-17', 0],
  ['2026-01-01', '2026-09-17', 0],
  ['2025-01-01', '2025-12-31', 0],
  ['2026-01-01', '2026-09-17', 43],
  ['2025-06-01', '2025-12-31', 33],
  ['2024-01-01', '2026-09-17', 64],
  ['2026-08-01', '2026-09-17', 0],
];

let pass = 0, fail = 0;
const label = (ev) => (ev ? `赛事${ev}` : '全部赛事');

for (const pid of [34, 12, 3, 9, 39, 22, 151, 108]) {
  for (const [from, to, ev] of cases) {
    const lo = Math.max(0, lowerBound(from)), hi = upperBound(to);
    const a = sumBuckets(daily.p[pid], lo, hi, ev);
    const b = brute(pid, from, to, ev);
    if (a.g === b.g && a.w === b.w && a.elo === b.elo) pass++;
    else {
      fail++;
      console.log(`✗ 选手${pid} ${from}~${to} ${label(ev)}: 桶 ${a.g}/${a.w}/${a.elo} vs 复算 ${b.g}/${b.w}/${b.elo}`);
    }
  }
}

console.log(`区间求和校验：通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RANGE_OK' : 'RANGE_FAILED');
