/**
 * 线上静态服务 + 部署接收端（部署在 199.180.116.188:5001）
 *
 * 兼容 Node.js 16 —— 服务器是 Ubuntu 18.04（glibc 2.27），跑不了 Node 18+ 的官方二进制，
 * 因此这里刻意不使用 import.meta.dirname / structuredClone / AbortSignal.timeout 等新 API。
 *
 * 路由：
 *   GET  /api/health    健康检查（含文件数、最近更新时间）
 *   GET  /api/manifest  站点文件清单（相对路径 → { sha1, size }），供本地做增量比对
 *   POST /api/deploy    接收变更文件（需 Bearer token），支持新增/覆盖/删除
 *   其余路径            静态文件（SPA 用 hash 路由，无需 fallback 重写）
 *
 * 启动：PORT=5001 SITE_ROOT=/opt/scplayer-events-stats/site node server.mjs
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(process.env.SITE_ROOT || path.join(HERE, 'site'));
const PORT = Number(process.env.PORT || 5001);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(HERE, 'deploy-token.txt');
const MANIFEST_FILE = path.join(SITE_ROOT, '.manifest.json');
const MAX_BODY = 64 * 1024 * 1024; // 64MB，够整站全量推送

let TOKEN = null;
try {
  TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null;
} catch (e) {
  /* 文件不存在则视为未启用 */
}
if (!TOKEN) console.warn('[warn] 未找到 ' + TOKEN_FILE + '，POST /api/deploy 将返回 503');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- 工具 ----------

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/** 把请求路径解析为站点内的绝对路径；越界返回 null */
function resolveSafe(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch (e) {
    return null;
  }
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const rel = path.normalize(p).replace(/^([/\\])+/, '');
  if (rel.split(/[/\\]/).indexOf('..') >= 0) return null;
  const abs = path.resolve(SITE_ROOT, rel);
  if (abs !== SITE_ROOT && !abs.startsWith(SITE_ROOT + path.sep)) return null;
  return abs;
}

/** 校验客户端传来的相对路径，返回规范化后的相对路径或 null */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const norm = path.normalize(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm || norm === '.' || norm.split('/').indexOf('..') >= 0) return null;
  if (path.isAbsolute(norm)) return null;
  return norm;
}

async function walk(dir, base, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(abs, rel, out);
    else if (e.isFile() && rel !== '.manifest.json') out.push(rel);
  }
  return out;
}

async function buildManifest() {
  const files = {};
  let list = [];
  try {
    list = await walk(SITE_ROOT, '', []);
  } catch (e) {
    return { files: {}, total: 0, bytes: 0, updatedAt: null };
  }
  let bytes = 0;
  for (const rel of list) {
    const abs = path.join(SITE_ROOT, rel);
    const buf = await fsp.readFile(abs);
    files[rel] = { sha1: sha1(buf), size: buf.length };
    bytes += buf.length;
  }
  return { files, total: list.length, bytes, updatedAt: new Date().toISOString() };
}

function atomicWrite(abs, buf) {
  const tmp = abs + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

// ---------- 主服务 ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // --- API ---
  if (pathname === '/api/health') {
    const m = await buildManifest();
    return sendJSON(res, 200, {
      ok: true,
      site: SITE_ROOT,
      files: m.total,
      bytes: m.bytes,
      updatedAt: m.updatedAt,
      deployEnabled: !!TOKEN,
      node: process.version,
      uptime: Math.round(process.uptime()),
    });
  }

  if (pathname === '/api/manifest') {
    if (TOKEN && req.headers.authorization !== 'Bearer ' + TOKEN) {
      return sendJSON(res, 401, { error: 'unauthorized' });
    }
    const m = await buildManifest();
    return sendJSON(res, 200, m);
  }

  if (pathname === '/api/deploy') {
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST required' });
    if (!TOKEN) return sendJSON(res, 503, { error: '部署未启用：服务器缺少 deploy-token.txt' });
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return sendJSON(res, 401, { error: 'unauthorized' });

    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJSON(res, 400, { error: 'bad json: ' + e.message });
    }

    const files = (payload && payload.files) || {};
    const del = (payload && payload.delete) || [];
    const written = [];
    const removed = [];
    const skipped = [];

    try {
      for (const key of Object.keys(files)) {
        const rel = safeRel(key);
        if (!rel) { skipped.push(key); continue; }
        const abs = path.join(SITE_ROOT, rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        const buf = Buffer.from(files[key], 'base64');
        atomicWrite(abs, buf);
        written.push(rel);
      }
      for (const key of del) {
        const rel = safeRel(key);
        if (!rel) { skipped.push(key); continue; }
        try { await fsp.unlink(path.join(SITE_ROOT, rel)); removed.push(rel); } catch (e) { /* 已不存在 */ }
      }
    } catch (e) {
      console.error('[deploy] 写入失败:', e.message);
      return sendJSON(res, 500, { error: e.message, written: written.length });
    }

    const m = await buildManifest();
    await fsp.writeFile(MANIFEST_FILE, JSON.stringify({ ...m, files: Object.keys(m.files).length ? m.files : {} }, null, 0)).catch(() => {});
    console.log('[deploy] 写入 ' + written.length + ' 个文件，删除 ' + removed.length + ' 个，站点共 ' + m.total + ' 个文件');
    return sendJSON(res, 200, { ok: true, written: written.length, removed: removed.length, skipped, total: m.total, bytes: m.bytes });
  }

  // --- 静态文件 ---
  const abs = resolveSafe(pathname);
  if (!abs) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  try {
    const s = await fsp.stat(abs);
    if (s.isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'content-length': s.size,
      'cache-control': 'no-cache',
    });
    createReadStream(abs).pipe(res);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, HOST, async () => {
  const m = await buildManifest();
  console.log('SC 三大赛事选手数据查询 → http://' + HOST + ':' + PORT);
  console.log('站点目录: ' + SITE_ROOT + '（' + m.total + ' 个文件, ' + (m.bytes / 1048576).toFixed(1) + ' MB）');
  console.log('Node: ' + process.version + ' | 部署接口: ' + (TOKEN ? '已启用' : '未启用'));
});
