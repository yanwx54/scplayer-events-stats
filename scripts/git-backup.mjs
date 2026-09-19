/**
 * 把本地数据变更提交并推送到 GitHub（供每日自动化调用）。
 *
 * 用法：
 *   node scripts/git-backup.mjs            # 有变更才提交推送
 *   node scripts/git-backup.mjs --force    # 无变更也推一次（同步追踪引用）
 *   node scripts/git-backup.mjs --msg "feat: xxx"   # 指定提交信息（手工提交时用）
 *
 * 处理了几个坑：
 *   - 无变更时直接跳过，不产生空提交
 *   - push 失败自动重试（SSH 到 github.com 会间歇性 Connection reset）
 *   - 推送后校准本地 origin/main 追踪引用（本环境 .git/refs/remotes/ 写不进去，
 *     改用 .git/packed-refs，详见 README）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const FORCE = process.argv.includes('--force');
/** 手工提交时可用 --msg 覆盖默认的「同步 YYYY-MM-DD」信息 */
const CUSTOM_MSG = (() => {
  const i = process.argv.indexOf('--msg');
  return i >= 0 ? (process.argv[i + 1] || '').trim() : '';
})();
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();

const tryGit = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const log = (...a) => console.log('  [git]', ...a);

/**
 * 按改动内容生成提交类型前缀：只有数据/头像变化才算 chore(data)，
 * 涉及脚本、样式、文档等则用 chore，避免历史里出现「改了脚本却写每日同步」的误导信息。
 */
const commitType = (files) => {
  const dataOnly = files.every(
    (f) => f.startsWith('public/data/') || f.startsWith('public/avatars/') || f.startsWith('data/'),
  );
  return dataOnly ? 'chore(data)' : 'chore';
};

/* ---------- 0. 前置检查 ---------- */
const branch = git(['branch', '--show-current']);
if (!branch) { console.error('GIT_BACKUP_FAILED: 当前不在任何分支上'); process.exit(1); }
const remotes = git(['remote']).split('\n').filter(Boolean);
if (!remotes.includes('origin')) { console.error('GIT_BACKUP_FAILED: 未配置 origin 远程'); process.exit(1); }

/* ---------- 1. 暂存 ---------- */
git(['add', '-A']);
const staged = tryGit(['diff', '--cached', '--quiet']);
const hasChanges = !staged.ok;   // --quiet 有差异时返回非 0

if (!hasChanges && !FORCE) {
  log('无变更，跳过提交');
  console.log('GIT_BACKUP_SKIP');
  process.exit(0);
}

/* ---------- 2. 提交 ---------- */
if (hasChanges) {
  const files = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const stat = tryGit(['diff', '--cached', '--shortstat']).out;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const msg = CUSTOM_MSG || [
    `${commitType(files)}: 同步 ${stamp}`,
    '',
    stat || `${files.length} 个文件变更`,
    '',
    '由每日 10:00 自动化任务生成',
  ].join('\n');
  git(['commit', '-q', '-m', msg]);
  log(`已提交 ${files.length} 个文件（${stat || '无统计'}）`);
} else {
  log('无变更，仅推送（--force）');
}

/* ---------- 3. 推送（带重试） ---------- */
const sshCmd = 'ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new';
let pushed = false;
for (let i = 1; i <= 4 && !pushed; i++) {
  const r = spawnSync('git', ['push', 'origin', branch], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, GIT_SSH_COMMAND: sshCmd },
  });
  if (r.status === 0) {
    pushed = true;
    const line = (r.stderr || '').split('\n').find((l) => l.includes('->')) || '';
    log('推送成功', line.trim());
  } else {
    const err = (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-2).join(' ');
    log(`推送失败（第 ${i}/4 次）：${err}`);
    if (i < 4) {
      const wait = 5000 * i;
      log(`等待 ${wait / 1000}s 后重试…`);
      sleepSync(wait);
    }
  }
}
if (!pushed) { console.error('GIT_BACKUP_FAILED: 推送连续 4 次失败'); process.exit(1); }

/* ---------- 4. 校准本地追踪引用 ---------- */
try {
  const remoteSha = git(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0];
  const localSha = git(['rev-parse', 'HEAD']);
  if (remoteSha && remoteSha === localSha) {
    writeFileSync(
      path.join(ROOT, '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted \n${remoteSha} refs/remotes/origin/${branch}\n`
    );
    log('追踪引用已校准 →', remoteSha.slice(0, 7));
  } else if (remoteSha) {
    log(`⚠ 远程 ${remoteSha.slice(0, 7)} 与本地 ${localSha.slice(0, 7)} 不一致`);
  }
} catch (e) {
  log('追踪引用校准跳过：' + e.message);
}

/* ---------- 5. 轻度整理 ---------- */
tryGit(['gc', '--auto', '--quiet']);

log('完成');
console.log('GIT_BACKUP_OK');
