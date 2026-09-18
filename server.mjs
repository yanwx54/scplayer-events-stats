/**
 * 零依赖静态服务器（本地预览 / 部署均可用）。
 * 用法：node server.mjs [port]   默认 5178
 *
 * 监听地址：本地默认 127.0.0.1；当通过环境变量 PORT 传入端口时（部署沙箱的做法）
 * 自动改为 0.0.0.0，否则外部反向代理无法访问。也可用 HOST 显式指定。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, 'public');
const PORT = Number(process.argv[2] || process.env.PORT || 5178);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': s.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SC 选手数据查询 → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
