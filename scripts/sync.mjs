/**
 * 增量同步三大赛事（43 / 33 / 64）的最新战绩，并重建聚合数据库。
 *
 * 用法：
 *   node scripts/sync.mjs            # 增量（默认）
 *   node scripts/sync.mjs --full     # 全量重抓
 *   node scripts/sync.mjs --no-build # 只抓数据，不重建数据库
 *
 * 策略：
 *   1. 从 offset 0 开始分页拉取（最新在前），每页与本地已知 match id 比对；
 *      前 REFRESH_WINDOW 条始终重新抓取（覆盖官方对近期记录的修正），
 *      越过窗口后遇到「整页都已存在」即停止 —— 这就是增量边界。
 *   2. 合并时以新抓到的为准（同 id 覆盖），旧数据保留（只增不减 + 近期窗口纠错）。
 *   3. 补抓新出现的选手元数据，下载缺失头像。
 *   4. 重建 public/data/。
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const AVATARS = path.join(ROOT, 'public', 'avatars');
const BASE = 'https://eloboard.com';
const AVATAR_BASE = 'https://eloboard.co.kr/static/';

const EVENTS = [43, 33, 64];
const PAGE = 200;
const REFRESH_WINDOW = 400;   // 每次强制重抓的最新条数（纠错窗口）
const MAX_PAGES = 120;        // 安全上限（单赛事最多 24000 条）

const argv = new Set(process.argv.slice(2));
const FULL = argv.has('--full');
const NO_BUILD = argv.has('--no-build');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { data: await r.json(), total: Number(r.headers.get('x-total-count') || 0) };
    } catch (e) {
      if (i === tries) throw e;
      await sleep(700 * i);
    }
  }
}

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

/* ---------- 单赛事增量同步 ---------- */
async function syncEvent(eventId) {
  const file = path.join(RAW, `event-${eventId}.json`);
  let rawText = '';
  try { rawText = await readFile(file, 'utf8'); } catch { /* 首次运行，无本地缓存 */ }
  const existing = FULL ? [] : (() => { try { return JSON.parse(rawText); } catch { return []; } })();
  const known = new Set(existing.map((m) => m.id));

  const fresh = [];
  let total = 0, pages = 0;
  for (let offset = 0; pages < MAX_PAGES; pages++) {
    const { data, total: t } = await getJson(`${BASE}/api/matches?event_id=${eventId}&limit=${PAGE}&offset=${offset}`);
    if (t) total = t;
    if (!Array.isArray(data) || data.length === 0) break;
    fresh.push(...data);
    offset += PAGE;
    // 越过纠错窗口后，整页都是已知数据 → 到达增量边界
    if (!FULL && offset >= REFRESH_WINDOW && data.every((m) => known.has(m.id))) break;
    if (offset >= total) break;
    await sleep(120);
  }

  // 合并：新抓到的覆盖同 id 旧记录
  const map = new Map();
  for (const m of existing) map.set(m.id, m);
  for (const m of fresh) map.set(m.id, m);
  const merged = [...map.values()].sort(
    (a, b) => (b.played_on || '').localeCompare(a.played_on || '') || b.id - a.id
  );

  const added = merged.reduce((n, m) => n + (known.has(m.id) ? 0 : 1), 0);
  const removed = existing.length + added - merged.length;

  // 内容比对：即使条数不变，官方修正某条记录也应算作变更
  const nextText = JSON.stringify(merged);
  const changed = nextText !== rawText;

  if (changed) {
    await mkdir(RAW, { recursive: true });
    await writeFile(file, nextText);
  }
  return { eventId, before: existing.length, after: merged.length, added, removed, changed, officialTotal: total, pages: pages + 1 };
}

/* ---------- 补抓选手元数据 ---------- */
async function syncPlayers(allMatches) {
  const file = path.join(RAW, 'players.json');
  const players = await readJson(file, {});
  const need = new Set();
  for (const m of allMatches) for (const p of m.participants) {
    if (!players[p.player_id]) need.add(p.player_id);
  }
  const added = [];
  for (const id of [...need].sort((a, b) => a - b)) {
    const { data } = await getJson(`${BASE}/api/players/${id}`);
    players[id] = data;
    added.push(`${data.name}(${id})`);
    await sleep(80);
  }
  if (added.length) await writeFile(file, JSON.stringify(players));
  return { total: Object.keys(players).length, added };
}

/* ---------- 补下载头像 ---------- */
async function syncAvatars() {
  const players = await readJson(path.join(RAW, 'players.json'), {});
  await mkdir(AVATARS, { recursive: true });
  const added = [];
  for (const p of Object.values(players)) {
    if (!p.thumb_url) continue;
    const dest = path.join(AVATARS, `${p.id}.jpg`);
    if (await exists(dest)) continue;
    try {
      const r = await fetch(AVATAR_BASE + p.thumb_url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await writeFile(dest, Buffer.from(await r.arrayBuffer()));
      added.push(p.name);
    } catch (e) {
      console.warn(`   头像下载失败 ${p.id}: ${e.message}`);
    }
    await sleep(60);
  }
  return added;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

/* ---------- 主流程 ---------- */
async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] 开始同步（模式：${FULL ? '全量' : '增量'}）`);

  const results = [];
  for (const e of EVENTS) {
    const r = await syncEvent(e);
    results.push(r);
    const tag = r.changed ? (r.added ? `新增 ${r.added}` : '记录有修正') : '无变化';
    console.log(`  赛事 ${e}: ${r.before} → ${r.after}（${tag}，纠正/移除 ${r.removed}）· 官方总数 ${r.officialTotal} · ${r.pages} 页`);
  }

  const allMatches = [];
  for (const e of EVENTS) allMatches.push(...await readJson(path.join(RAW, `event-${e}.json`), []));

  const pl = await syncPlayers(allMatches);
  console.log(`  选手元数据：${pl.total} 人${pl.added.length ? `，新增 ${pl.added.join('、')}` : '，无新增'}`);

  const av = await syncAvatars();
  console.log(`  头像：${av.length ? `新增 ${av.length} 张（${av.join('、')}）` : '无新增'}`);

  // 数据无任何变化时跳过重建 —— 避免 index.json 里的 builtAt 时间戳
  // 每天制造一个无意义的提交（否则每日自动化会天天产生空提交噪声）
  const dataChanged = results.some((r) => r.changed) || pl.added.length > 0 || av.length > 0;
  let rebuilt = false;
  if (NO_BUILD) {
    console.log('  跳过重建（--no-build）');
  } else if (!dataChanged) {
    console.log('  数据无变化，跳过数据库重建');
  } else {
    console.log('  重建数据库…');
    await run(process.execPath, [path.join(ROOT, 'scripts', 'build-db.mjs')]);
    rebuilt = true;
  }

  const totalAdded = results.reduce((n, r) => n + r.added, 0);
  const totalRemoved = results.reduce((n, r) => n + r.removed, 0);
  const totalMatches = allMatches.length;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('─'.repeat(60));
  console.log(`完成：对局 ${totalMatches}（新增 ${totalAdded}，纠正 ${totalRemoved}）· 选手 ${pl.total} · 耗时 ${secs}s · ${today()}`);
  console.log(`数据库：${rebuilt ? '已重建' : '未变更'} · 数据${dataChanged ? '有更新' : '无更新'}`);
  for (const r of results) {
    const diff = r.officialTotal - r.after;
    if (diff > 0) console.log(`  ⚠ 赛事 ${r.eventId}：本地 ${r.after} 少于官方 ${r.officialTotal}（差 ${diff}），可能需要 --full`);
  }
  console.log('SYNC_OK');
}

main().catch((e) => {
  console.error('SYNC_FAILED:', e.message);
  process.exit(1);
});
