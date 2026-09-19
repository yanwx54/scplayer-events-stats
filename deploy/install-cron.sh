#!/bin/bash
# ==============================================================
# 安装/更新「服务器自助同步」的 cron 任务（幂等，可重复执行）
#
# 用法（服务器上，root）：
#   bash deploy/install-cron.sh            # 安装（默认每天 10:20 与 20:20）
#   bash deploy/install-cron.sh --remove   # 卸载
#   SYNC_TIMES="10:20" bash deploy/install-cron.sh   # 自定义时间（逗号分隔）
#
# 会先备份当前 crontab 到 /root/crontab.backup.<时间戳>。
# ==============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/scplayer-events-stats}"
SCRIPT="$APP_DIR/deploy/self-sync.sh"
LOG_FILE="${LOG_FILE:-/var/log/scplayer-events-sync.log}"
SYNC_TIMES="${SYNC_TIMES:-10:20,20:20}"
MATCH_KEY="deploy/self-sync.sh"

if [ "$EUID" -ne 0 ]; then
  echo "✗ 请用 root 执行：sudo bash deploy/install-cron.sh"
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "✗ 找不到 $SCRIPT"
  exit 1
fi
chmod +x "$SCRIPT"

# ---- 备份 ----
BACKUP="/root/crontab.backup.$(date +%Y%m%d%H%M%S)"
crontab -l > "$BACKUP" 2>/dev/null || true
echo "✓ 已备份当前 crontab → $BACKUP"

# ---- 去掉旧的同类条目（按 MATCH_KEY 匹配，保证幂等）----
CURRENT="$(crontab -l 2>/dev/null | grep -v "$MATCH_KEY" || true)"

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$CURRENT" | crontab -
  echo "✓ 已卸载自助同步 cron 任务"
  exit 0
fi

# ---- 生成新条目 ----
NEW_BLOCK="# scplayer-events-stats 自助同步（由 deploy/install-cron.sh 管理，勿手改）"
IFS=',' read -ra TIMES <<< "$SYNC_TIMES"
for t in "${TIMES[@]}"; do
  hh="${t%%:*}"; mm="${t##*:}"
  hh=$((10#$hh)); mm=$((10#$mm))
  NEW_BLOCK="$NEW_BLOCK
$mm $hh * * * /bin/bash $SCRIPT >> $LOG_FILE 2>&1"
done

printf '%s\n%s\n' "$CURRENT" "$NEW_BLOCK" | sed '/^$/d' | crontab -

echo "✓ 已安装 cron 任务："
crontab -l | grep -A10 "$MATCH_KEY" | sed 's/^/    /'
echo ""
echo "  日志： tail -f $LOG_FILE"
echo "  立即试跑： bash $SCRIPT"
