// GitHub REST API (Git Data) 推送兜底脚本
//
// 背景：本机到 github.com 的 SSH（ssh.github.com:443 / 22）与 HTTPS 会被网络重置/超时，
// 但 api.github.com 仍可访问。此时 `git push` 会连续失败，可用本脚本把**已存在的本地提交**
// 通过 Git Data API 原样搬上远端（blob → tree → commit → 更新 ref）。
//
// 特点：逐字复现本地提交（tree/author/committer/时间/信息），因此远端提交号与本地完全一致，
// 不会产生分叉；若 GitHub 归一化了时间导致哈希不同，脚本会用 API 返回的元数据在本地重建同一
// 提交对象并把本地分支对齐过去。
//
// 用法（项目根目录）：
//   node scripts/git-push-api.mjs [分支名，默认 main]
//
// 前提：远端该分支当前指向本地 HEAD 的父提交（即只领先 1 个提交），否则脚本拒绝执行。
// 令牌来源：`git credential fill`（host=github.com），不落盘、不入库。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'yanwx54';
const REPO = 'scplayer-events-stats';
const BRANCH = process.argv[2] || 'main';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28 }).toString();

const tokOut = execFileSync('git', ['credential', 'fill'], {
  cwd: ROOT,
  input: 'protocol=https\nhost=github.com\n\n',
}).toString();
const TOKEN = /password=(.*)/.exec(tokOut)[1].trim();
const H = {
  Authorization: 'token ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'scplayer-events-stats',
  'Content-Type': 'application/json',
};

async function api(method, p, body) {
  const res = await fetch('https://api.github.com' + p, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const HEAD = git('rev-parse', 'HEAD').trim();
const PARENT = git('rev-parse', 'HEAD^').trim();
const raw = git('cat-file', 'commit', HEAD);
const treeSha = /^tree (\w+)/m.exec(raw)[1];
const parentTree = /^tree (\w+)/m.exec(git('cat-file', 'commit', PARENT))[1];
const authorLine = /^author (.*) (\d+) ([+-]\d{4})$/m.exec(raw);
const committerLine = /^committer (.*) (\d+) ([+-]\d{4})$/m.exec(raw);
const message = raw.slice(raw.indexOf('\n\n') + 2);

const toIso = (ts, off) => {
  const sign = off[0] === '-' ? -1 : 1;
  const mins = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
  const d = new Date((Number(ts) + mins * 60) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${off.slice(0, 3)}:${off.slice(3, 5)}`
  );
};
const parseId = (line) => {
  const m = /^(.*) <(.*)>$/.exec(line[1]);
  return { name: m[1], email: m[2], date: toIso(line[2], line[3]) };
};
const author = parseId(authorLine);
const committer = parseId(committerLine);

const remoteRef = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const remoteSha = remoteRef.object.sha;
console.log('远端', BRANCH, '=', remoteSha, '| 本地 HEAD =', HEAD, '| 父 =', PARENT);
if (remoteSha !== PARENT) {
  console.error('远端不是本地 HEAD 的父提交，放弃（需人工处理）');
  process.exit(2);
}

const status = git('diff', '--name-status', PARENT, HEAD).trim();
const changed = git('diff', '--name-only', PARENT, HEAD).split('\n').filter(Boolean);
const deleted = status
  .split('\n')
  .filter((l) => l.startsWith('D\t'))
  .map((l) => l.slice(2));
console.log('待上传文件数 =', changed.length, '| 删除 =', deleted.length);

const tree = [];
let done = 0;
async function upload(p) {
  // 必须用 git 里的规范化内容（不是工作区文件）：autocrlf 会把磁盘上的 CRLF 转成 LF 入库，
  // 直接读工作区会导致 blob/tree 哈希与本地提交不一致。
  const buf = execFileSync('git', ['cat-file', 'blob', `${HEAD}:${p}`], {
    cwd: ROOT,
    maxBuffer: 1 << 28,
  });
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
  done += 1;
  if (done % 10 === 0) console.log('  blobs', done, '/', changed.length);
}
for (let i = 0; i < changed.length; i += 5) {
  await Promise.all(changed.slice(i, i + 5).map(upload));
}
for (const p of deleted) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });

const newTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: parentTree,
  tree,
});
console.log(
  '远端新 tree =',
  newTree.sha,
  '| 本地 HEAD tree =',
  treeSha,
  newTree.sha === treeSha ? '(一致)' : '(不一致!)'
);
if (newTree.sha !== treeSha) {
  console.error('tree 不一致，放弃推送');
  process.exit(3);
}

const newCommit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message,
  tree: newTree.sha,
  parents: [PARENT],
  author,
  committer,
});
console.log(
  '远端新 commit =',
  newCommit.sha,
  '| 本地 HEAD =',
  HEAD,
  newCommit.sha === HEAD ? '(一致)' : '(不一致)'
);

if (newCommit.sha !== HEAD) {
  const isoToGit = (s) => {
    const m = /^(.*T.*?)([+-])(\d{2}):(\d{2})$/.exec(s) || /^(.*T.*Z)$/.exec(s);
    if (!m) return s;
    const ts = Math.floor(new Date(s).getTime() / 1000);
    const off = m[2] ? m[2] + m[3] + m[4] : '+0000';
    return `${ts} ${off}`;
  };
  const text =
    `tree ${newTree.sha}\nparent ${PARENT}\n` +
    `author ${newCommit.author.name} <${newCommit.author.email}> ${isoToGit(newCommit.author.date)}\n` +
    `committer ${newCommit.committer.name} <${newCommit.committer.email}> ${isoToGit(newCommit.committer.date)}\n\n` +
    message;
  const rebuilt = execFileSync('git', ['hash-object', '-w', '-t', 'commit', '--stdin'], {
    cwd: ROOT,
    input: text,
  })
    .toString()
    .trim();
  console.log('本地重建 commit =', rebuilt);
  if (rebuilt !== newCommit.sha) {
    console.error('重建后仍不一致，需人工处理；远端 commit 已创建但引用未更新');
    process.exit(4);
  }
  git('update-ref', `refs/heads/${BRANCH}`, newCommit.sha, HEAD);
  console.log('本地分支已对齐远端提交');
}

await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  sha: newCommit.sha,
  force: false,
});
const after = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
console.log('API_PUSH_OK 远端', BRANCH, '=', after.object.sha);
