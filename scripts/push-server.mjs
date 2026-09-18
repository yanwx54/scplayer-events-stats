/**
 * 把本地 public/ 增量推送到线上服务器（默认 http://199.180.116.188:5001）
 *
 * 用法：
 *   node scripts/push-server.mjs            # 增量：只推改动过的文件
 *   node scripts/push-server.mjs --full     # 全量：重推所有文件
 *   node scripts/push-server.mjs --check    # 只比对不推送
 *
 * 配置来源（按优先级）：
 *   1) 环境变量 DEPLOY_SERVER / DEPLOY_TOKEN
 *   2) 项目根目录 local.config.json → { "server": "...", "token": "..." }
 *
 * 退出码：0 成功；1 失败（供自动化任务判断）
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const CHECK = argv.includes('--check');

function loadConfig() {
  let cfg = {};
  const cfgFile = path.join(ROOT, 'local.config.json');
  try {
    cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (e) {
    /* 无配置文件时走环境变量 */
  }
  const server = (process.env.DEPLOY_SERVER || cfg.server || '').replace(/\/+$/, '');
  const token = process.env.DEPLOY_TOKEN || cfg.token || '';
  if (!server) {
    console.error('✗ 未配置服务器地址。请在 local.config.json 写入 {"server":"http://199.180.116.188:5001","token":"..."}');
    process.exit(1);
  }
  if (!token) {
    console.error('✗ 未配置部署 token。请在 local.config.json 写入 token 字段。');
    process.exit(1);
  }
  return { server, token };
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function walk(dir, base, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(abs, rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** 本地站点快照：rel → { sha1, size, abs } */
async function localManifest() {
  const list = await walk(PUBLIC_DIR, '', []);
  const map = {};
  let bytes = 0;
  for (const rel of list) {
    const abs = path.join(PUBLIC_DIR, rel);
    const buf = await fsp.readFile(abs);
    map[rel] = { sha1: sha1(buf), size: buf.length, abs };
    bytes += buf.length;
  }
  return { map, bytes, count: list.length };
}

async function fetchJSON(url, opts = {}, ms = 60000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

const { server, token } = loadConfig();
console.log('→ 目标服务器: ' + server);

// ---- 1. 健康检查 ----
const health = await fetchJSON(server + '/api/health', {}, 15000).catch((e) => ({ ok: false, status: 0, body: { error: e.message } }));
if (!health.ok) {
  console.error('✗ 服务器不可达: HTTP ' + health.status + ' ' + JSON.stringify(health.body));
  process.exit(1);
}
console.log('✓ 服务器在线（当前 ' + health.body.files + ' 个文件, ' + (health.body.bytes / 1048576).toFixed(1) + ' MB, Node ' + health.body.node + '）');
if (!health.body.deployEnabled) {
  console.error('✗ 服务器未启用部署接口（缺少 deploy-token.txt）');
  process.exit(1);
}

// ---- 2. 取线上清单 ----
const remote = await fetchJSON(server + '/api/manifest', { headers: { Authorization: 'Bearer ' + token } }, 60000);
if (!remote.ok) {
  console.error('✗ 读取线上清单失败: HTTP ' + remote.status + ' ' + JSON.stringify(remote.body));
  process.exit(1);
}
const remoteFiles = remote.body.files || {};

// ---- 3. 本地清单 & 差异 ----
const local = await localManifest();
console.log('✓ 本地站点 ' + local.count + ' 个文件, ' + (local.bytes / 1048576).toFixed(1) + ' MB');

const changed = [];
for (const rel of Object.keys(local.map)) {
  const r = remoteFiles[rel];
  if (FULL || !r || r.sha1 !== local.map[rel].sha1) changed.push(rel);
}
const toDelete = Object.keys(remoteFiles).filter((rel) => !local.map[rel]);

console.log('  新增/变更: ' + changed.length + ' 个 | 待删除: ' + toDelete.length + ' 个');
if (changed.length) {
  const preview = changed.slice(0, 8).join(', ');
  console.log('  ' + preview + (changed.length > 8 ? ' …' : ''));
}

if (CHECK) {
  console.log('\n(--check 模式，未推送)');
  process.exit(0);
}

if (!changed.length && !toDelete.length) {
  console.log('\n✓ 线上已是最新，无需推送');
  process.exit(0);
}

// ---- 4. 组装并推送 ----
const files = {};
let payloadBytes = 0;
for (const rel of changed) {
  const buf = await fsp.readFile(local.map[rel].abs);
  files[rel] = buf.toString('base64');
  payloadBytes += buf.length;
}

const t0 = Date.now();
const res = await fetchJSON(server + '/api/deploy', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ files, delete: toDelete }),
}, 300000).catch((e) => ({ ok: false, status: 0, body: { error: e.message } }));

if (!res.ok) {
  console.error('✗ 推送失败: HTTP ' + res.status + ' ' + JSON.stringify(res.body));
  process.exit(1);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n✓ 推送完成：写入 ' + res.body.written + ' 个，删除 ' + res.body.removed + ' 个，耗时 ' + secs + 's');
console.log('  线上共 ' + res.body.total + ' 个文件, ' + (res.body.bytes / 1048576).toFixed(1) + ' MB');
if (res.body.skipped && res.body.skipped.length) console.warn('  ⚠ 跳过非法路径 ' + res.body.skipped.length + ' 个');
console.log('  访问地址: ' + server + '/');
