/**
 * 下载 eloboard 三大赛事（43 메이저 프로리그 / 33 K리그 / 64 준메이저 프로리그）全量比赛。
 * 输出：data/raw/event-{id}.json  —— 原样保存 API 返回的 match 数组。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://eloboard.com';
const EVENTS = [43, 33, 64];
const PAGE = 200;
const ROOT = path.resolve(import.meta.dirname, '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(eventId, offset) {
  const url = `${BASE}/api/matches?event_id=${eventId}&limit=${PAGE}&offset=${offset}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('x-total-count') || 0);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('not an array');
      return { data, total };
    } catch (e) {
      if (attempt === 4) throw e;
      console.warn(`   重试 ${attempt}/4 (${e.message})`);
      await sleep(800 * attempt);
    }
  }
}

async function main() {
  await mkdir(path.join(ROOT, 'data', 'raw'), { recursive: true });
  for (const eventId of EVENTS) {
    console.log(`\n=== event ${eventId}`);
    const all = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += PAGE) {
      const { data, total: t } = await fetchPage(eventId, offset);
      if (t) total = t;
      all.push(...data);
      process.stdout.write(`   ${all.length}/${total}\r`);
      if (data.length === 0) break;
      await sleep(120);
    }
    console.log(`   ${all.length}/${total} 完成`);
    const file = path.join(ROOT, 'data', 'raw', `event-${eventId}.json`);
    await writeFile(file, JSON.stringify(all));
    console.log(`   -> ${file}`);
  }
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
