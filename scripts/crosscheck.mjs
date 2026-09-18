import { readFile } from 'node:fs/promises';
let n = 0, a = 0, b = 0;
for (const e of [43, 33, 64]) {
  const arr = JSON.parse(await readFile(`data/raw/event-${e}.json`, 'utf8'));
  for (const m of arr) {
    const ps = m.participants.map((p) => p.player_id);
    if (ps.includes(34) && ps.includes(12)) {
      n++;
      const me = m.participants.find((p) => p.player_id === 34);
      if (me.result === 'win') a++; else b++;
    }
  }
}
console.log(`独立计算(原始数据): 总 ${n} 场, 변현제 ${a} : ${b} 유영진`);
const p = JSON.parse(await readFile('public/data/players/34.json', 'utf8'));
const g = p.matches.filter((m) => m.o === 12);
const aw = g.filter((m) => m.w).length;
console.log(`站点数据(34.json):   总 ${g.length} 场, 변현제 ${aw} : ${g.length - aw} 유영진`);
console.log('一致:', n === g.length && a === aw);
