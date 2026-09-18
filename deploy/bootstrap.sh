#!/bin/bash
# ==============================================================
# 三大赛事选手数据查询站 —— 服务器一键部署（在 199.180.116.188 上执行一次）
#
# 用法（服务器上，root）：
#   bash deploy/bootstrap.sh
#   DEPLOY_TOKEN=xxxxxxxx bash deploy/bootstrap.sh   # 指定部署令牌
#
# 作用：
#   1. 检查/安装 Node.js 16（服务器为 Ubuntu 18.04，glibc 2.27，跑不了 Node 18+）
#   2. 把代码放到 /opt/scplayer-events-stats
#   3. 用 PM2 常驻一个静态服务，监听 0.0.0.0:5001
#   4. 生成部署令牌，之后本地电脑用 HTTP 增量推送，无需再走 SSH
#
# 幂等：可重复执行，会保留 site/ 目录里已推送的线上文件。
# ==============================================================
set -e

APP_PORT="${APP_PORT:-5001}"
APP_DIR="${APP_DIR:-/opt/scplayer-events-stats}"
PM2_NAME="${PM2_NAME:-scplayer-events-stats}"
REPO_HTTPS="https://github.com/yanwx54/scplayer-events-stats.git"

echo "=========================================="
echo "  三大赛事选手数据查询站 · 服务器部署"
echo "=========================================="

if [ "$EUID" -ne 0 ]; then
  echo "✗ 请用 root 执行：sudo bash deploy/bootstrap.sh"
  exit 1
fi

# ---- 1. Node.js ----
echo ""
echo "[1/6] 检查 Node.js ..."
need_node=0
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$major" -ge 16 ] 2>/dev/null; then
    echo "  ✓ 已安装 Node.js $(node -v)"
  else
    need_node=1
  fi
else
  need_node=1
fi
if [ "$need_node" = "1" ]; then
  echo "  安装 Node.js 16.20.2（官方二进制，兼容 Ubuntu 18.04）..."
  cd /tmp
  [ -f node-v16.20.2-linux-x64.tar.xz ] || curl -fsSL -O https://nodejs.org/dist/v16.20.2/node-v16.20.2-linux-x64.tar.xz
  tar -xf node-v16.20.2-linux-x64.tar.xz -C /usr/local --strip-components=1
  rm -f node-v16.20.2-linux-x64.tar.xz
  echo "  ✓ Node.js $(node -v) 安装完成"
fi

# ---- 2. Git / PM2 ----
echo ""
echo "[2/6] 检查 Git 与 PM2 ..."
if ! command -v git >/dev/null 2>&1; then
  echo "  安装 Git ..."
  apt-get update -qq && apt-get install -y -qq git
fi
echo "  ✓ Git $(git --version | cut -d' ' -f3)"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "  安装 PM2 ..."
  npm install -g pm2 --silent
fi
echo "  ✓ PM2 $(pm2 -v)"

# ---- 3. 放置代码 ----
echo ""
echo "[3/6] 准备代码目录 $APP_DIR ..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$APP_DIR"
if [ -d "$SRC_DIR/.git" ] && [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "  从当前克隆复制代码 ..."
  cp -a "$SRC_DIR/." "$APP_DIR/"
elif [ -d "$APP_DIR/.git" ]; then
  echo "  目录已是 git 仓库，拉取最新 ..."
  cd "$APP_DIR" && git fetch --all -q && git reset --hard origin/main -q
else
  echo "  从 GitHub 克隆 ..."
  git clone -q "$REPO_HTTPS" "$APP_DIR"
fi
echo "  ✓ 代码就绪：$APP_DIR"

# ---- 4. 站点目录（首次用仓库里的 public/ 填充）----
echo ""
echo "[4/6] 准备站点目录 $APP_DIR/site ..."
mkdir -p "$APP_DIR/site"
if [ ! -f "$APP_DIR/site/index.html" ]; then
  cp -a "$APP_DIR/public/." "$APP_DIR/site/"
  echo "  ✓ 已用仓库 public/ 初始化站点（$(find "$APP_DIR/site" -type f | wc -l) 个文件）"
else
  echo "  ✓ 站点已存在，保留现有文件（共 $(find "$APP_DIR/site" -type f | wc -l) 个）"
fi

# ---- 5. 部署令牌 ----
echo ""
echo "[5/6] 配置部署令牌 ..."
TOKEN_FILE="$APP_DIR/deploy/deploy-token.txt"
if [ -n "$DEPLOY_TOKEN" ]; then
  printf '%s' "$DEPLOY_TOKEN" > "$TOKEN_FILE"
  echo "  ✓ 已写入指定令牌"
elif [ -s "$TOKEN_FILE" ]; then
  echo "  ✓ 沿用已有令牌"
else
  DEPLOY_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf '%s' "$DEPLOY_TOKEN" > "$TOKEN_FILE"
  echo "  ✓ 已生成新令牌"
fi
chmod 600 "$TOKEN_FILE"

# ---- 6. PM2 启动 ----
echo ""
echo "[6/6] 启动服务 ..."
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
cd "$APP_DIR"
PORT="$APP_PORT" HOST=0.0.0.0 SITE_ROOT="$APP_DIR/site" TOKEN_FILE="$TOKEN_FILE" \
  pm2 start "$APP_DIR/deploy/server.mjs" --name "$PM2_NAME" --cwd "$APP_DIR" >/dev/null
pm2 save >/dev/null 2>&1 || true
if command -v systemctl >/dev/null 2>&1; then
  pm2 startup 2>/dev/null | grep "sudo" | bash 2>/dev/null || true
fi

# ---- 防火墙 ----
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${APP_PORT}/tcp" >/dev/null 2>&1 || true
  echo "  ✓ ufw 已放行 ${APP_PORT}/tcp"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${APP_PORT}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "  ✓ firewalld 已放行 ${APP_PORT}/tcp"
else
  echo "  ! 未检测到防火墙工具，请确认服务商安全组已放行 ${APP_PORT}"
fi

sleep 2
echo ""
echo "  自检："
if command -v curl >/dev/null 2>&1; then
  health="$(curl -s --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || true)"
  if [ -n "$health" ]; then
    echo "    ✓ 服务已响应：$health"
  else
    echo "    ✗ 服务无响应，请查看日志：pm2 logs $PM2_NAME --lines 50"
  fi
else
  echo "    (服务器无 curl，跳过自检) 可用 pm2 logs $PM2_NAME 查看日志"
fi
echo ""
echo "=========================================="
echo "  ✓ 部署完成"
echo "=========================================="
echo ""
echo "  访问地址： http://199.180.116.188:${APP_PORT}/"
echo "  站点目录： $APP_DIR/site"
echo "  部署令牌： $(cat "$TOKEN_FILE")"
echo ""
echo "  本地电脑把上面的令牌写入 local.config.json 的 token 字段后，"
echo "  即可用  node scripts/push-server.mjs  增量推送，无需再走 SSH。"
echo ""
echo "  常用命令："
echo "    pm2 status                        # 服务状态"
echo "    pm2 logs $PM2_NAME                # 查看日志"
echo "    pm2 restart $PM2_NAME             # 重启"
echo "    curl -s localhost:${APP_PORT}/api/health   # 健康检查"
echo ""
