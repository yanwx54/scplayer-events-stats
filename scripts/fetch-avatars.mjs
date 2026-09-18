/**
 * 下载选手头像到 public/avatars/{id}.jpg
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://eloboard.co.kr/static/';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'avatars');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const players = JSON.parse(await readFile(path.join(ROOT, 'data', 'raw', 'players.json'), 'utf8'));
await mkdir(OUT, { recursive: true });

let ok = 0, skip = 0, fail = 0;
for (const p of Object.values(players)) {
  if (!p.thumb_url) { skip++; continue; }
  const dest = path.join(OUT, `${p.id}.jpg`);
  try {
    const r = await fetch(BASE + p.thumb_url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await writeFile(dest, Buffer.from(await r.arrayBuffer()));
    ok++;
  } catch (e) {
    fail++;
    console.log('  FAIL', p.id, e.message);
  }
  await sleep(60);
}
console.log(`avatars: ok=${ok} skip=${skip} fail=${fail} -> public/avatars/`);
