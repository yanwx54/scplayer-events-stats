#!/bin/bash
# ==============================================================
# 服务器自助同步 —— 让线上站点自己定时更新，不再依赖本地电脑
#
# 由 cron 调用（见 deploy/install-cron.sh 或 README「服务器自助更新」）。
# 也可手动执行：bash deploy/self-sync.sh
#
# 流程：
#   1. git fetch + reset --hard origin/main   取最新代码（服务器从不提交，安全）
#   2. node --experimental-fetch scripts/sync.mjs   增量抓取 + 重建 public/data/
#   3. verify.mjs + verify-range.mjs          校验，不通过就**不动站点**
#   4. rsync public/ → site/                  发布
#
# 服务器环境：Ubuntu 18.04（glibc 2.27）→ Node 16.20.2（nvm 安装）
#   - Node 16 没有全局 fetch，必须加 --experimental-fetch
#   - 站点目录 site/ 不在 git 里，data/ 被 gitignore，所以 reset --hard 不会动它们
# ==============================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/scplayer-events-stats}"
SITE_DIR="${SITE_DIR:-$APP_DIR/site}"
LOCK_FILE="${LOCK_FILE:-/tmp/scplayer-events-selfsync.lock}"

# 找 node：cron 的 PATH 里通常没有 nvm，所以优先用绝对路径兜底
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(ls -1 /root/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "✗ 找不到 node，请设置 NODE_BIN 环境变量"
  exit 1
fi

# 单实例锁：上一轮没跑完就跳过本轮，避免两个 sync 同时写数据
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "已有同步任务在运行，本轮跳过"
  exit 0
fi

cd "$APP_DIR" || { echo "✗ 目录不存在：$APP_DIR"; exit 1; }

echo "=========================================="
echo "  服务器自助同步  $(date '+%F %T %Z')"
echo "  node: $NODE_BIN ($("$NODE_BIN" -v))"
echo "=========================================="

# ---- 1. 代码 ----
echo "[1/4] 同步代码 ..."
if git fetch origin main -q 2>/dev/null; then
  git reset --hard origin/main -q
  echo "  ✓ 已对齐 origin/main → $(git rev-parse --short HEAD)"
else
  echo "  ⚠ git fetch 失败，沿用当前代码继续（数据仍会更新）"
fi

# ---- 2. 抓取 + 重建 ----
echo "[2/4] 抓取并重建数据 ..."
"$NODE_BIN" --experimental-fetch scripts/sync.mjs 2>&1 | sed 's/^/    /'
sync_rc=${PIPESTATUS[0]}
if [ "$sync_rc" -ne 0 ]; then
  echo "✗ 同步失败（退出码 $sync_rc），站点保持原样"
  exit 1
fi

# ---- 3. 校验（不通过就不发布）----
echo "[3/4] 数据校验 ..."
if ! "$NODE_BIN" scripts/verify.mjs 2>&1 | tail -1 | grep -q VERIFY_DONE; then
  echo "✗ verify 未通过，站点保持原样"
  exit 1
fi
if ! "$NODE_BIN" scripts/verify-range.mjs 2>&1 | tail -1 | grep -q RANGE_OK; then
  echo "✗ verify-range 未通过，站点保持原样"
  exit 1
fi
echo "  ✓ VERIFY_DONE + RANGE_OK"

# ---- 4. 发布到站点目录 ----
echo "[4/4] 发布到 $SITE_DIR ..."
if command -v rsync >/dev/null 2>&1; then
  # .manifest.json 是 server.mjs 的缓存，别删
  rsync -a --delete --exclude '.manifest.json' "$APP_DIR/public/" "$SITE_DIR/"
else
  cp -a "$APP_DIR/public/." "$SITE_DIR/"
  echo "  (无 rsync，用 cp 覆盖；残留文件不会被清理)"
fi
echo "  ✓ 站点文件 $(find "$SITE_DIR" -type f | wc -l) 个"

meta="$("$NODE_BIN" -e "
const m=require('$APP_DIR/public/data/index.json').meta;
console.log(m.totalMatches+' 场 / '+m.totalPlayers+' 选手 / 截至 '+m.last);
" 2>/dev/null)"
echo "  当前数据：${meta:-（读取失败）}"
echo "SELF_SYNC_OK"
