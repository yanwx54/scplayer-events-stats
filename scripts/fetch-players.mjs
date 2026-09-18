/**
 * 抓取三大赛事涉及的全部选手元数据（种族 / 头像 / 官方 ELO / 生涯胜负）。
 * 输出：data/raw/players.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://eloboard.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(600 * i);
    }
  }
}

const raw = path.join(ROOT, 'data', 'raw');
const ids = new Set();
const nullDate = [];
const missingRace = [];
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(path.join(raw, `event-${e}.json`), 'utf8'));
  for (const m of arr) {
    if (!m.played_on) nullDate.push({ event: e, id: m.id });
    for (const p of m.participants) {
      ids.add(p.player_id);
      if (!p.race) missingRace.push({ event: e, match: m.id, player: p.player_id });
    }
  }
}
console.log('players to fetch:', ids.size, '| null played_on:', nullDate.length, '| missing race:', missingRace.length);
if (nullDate.length) console.log('null dates sample', JSON.stringify(nullDate.slice(0, 5)));

const out = {};
const list = [...ids].sort((a, b) => a - b);
let done = 0;
for (const id of list) {
  const p = await getJson(`${BASE}/api/players/${id}`);
  out[id] = p;
  done++;
  process.stdout.write(`   ${done}/${list.length}\r`);
  await sleep(80);
}
console.log(`\n   ${done}/${list.length} 完成`);
await mkdir(raw, { recursive: true });
await writeFile(path.join(raw, 'players.json'), JSON.stringify(out));
console.log('-> data/raw/players.json');

// 汇总
const races = {};
let noThumb = 0;
for (const p of Object.values(out)) {
  races[p.main_race] = (races[p.main_race] || 0) + 1;
  if (!p.thumb_url) noThumb++;
}
console.log('race distribution', JSON.stringify(races), '| no avatar', noThumb);
console.log('sample', JSON.stringify(out[list[0]]).slice(0, 400));
