#!/usr/bin/env python
"""
通过 SSH（密码认证）在服务器上执行一次引导部署 —— 仅用于「本机没有服务器私钥」的情况。

用法：
    set DEPLOY_SSH_PASSWORD=你的root密码
    <venv>/Scripts/python.exe scripts/remote-deploy.py            # 执行引导
    <venv>/Scripts/python.exe scripts/remote-deploy.py --check    # 只连上去看一眼现状

也可用环境变量覆盖：DEPLOY_HOST / DEPLOY_SSH_PORT / DEPLOY_USER / DEPLOY_TOKEN。
密码只从环境变量读取，不会写进任何文件。
"""
import json
import os
import pathlib
import sys

import paramiko

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

REPO = "https://github.com/yanwx54/scplayer-events-stats.git"
APP_DIR = "/opt/scplayer-events-stats"
APP_PORT = "5001"


def load_cfg():
    cfg = {}
    f = ROOT / "local.config.json"
    if f.exists():
        try:
            cfg = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    host = os.environ.get("DEPLOY_HOST") or "199.180.116.188"
    port = int(os.environ.get("DEPLOY_SSH_PORT") or 27168)
    user = os.environ.get("DEPLOY_USER") or "root"
    token = os.environ.get("DEPLOY_TOKEN") or cfg.get("token") or ""
    return host, port, user, token


def run(client, cmd, title):
    print("\n$ " + title, flush=True)
    chan = client.get_transport().open_session()
    chan.get_pty()
    chan.exec_command(cmd)
    for line in iter(lambda: chan.recv(4096), b""):
        sys.stdout.write(line.decode("utf-8", "replace"))
        sys.stdout.flush()
    code = chan.recv_exit_status()
    print("  [exit %d]" % code, flush=True)
    return code


def main():
    check_only = "--check" in sys.argv
    host, port, user, token = load_cfg()
    password = os.environ.get("DEPLOY_SSH_PASSWORD")

    if not password:
        print("✗ 未提供密码。请先设置环境变量 DEPLOY_SSH_PASSWORD")
        return 2
    if not token:
        print("✗ 未找到部署令牌（local.config.json 的 token 字段或 DEPLOY_TOKEN）")
        return 2

    print("连接 %s@%s:%d ..." % (user, host, port), flush=True)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host, port=port, username=user, password=password,
            timeout=20, banner_timeout=30, auth_timeout=30, allow_agent=False, look_for_keys=False,
        )
    except Exception as e:
        print("✗ 连接或认证失败: %s: %s" % (type(e).__name__, e))
        return 1
    print("✓ 登录成功", flush=True)

    try:
        if check_only:
            run(client, "hostname; uname -m; node -v 2>/dev/null || echo 'no node'; "
                        "pm2 -v 2>/dev/null || echo 'no pm2'; "
                        "ls -d %s 2>/dev/null || echo 'no app dir'; "
                        "ss -lntp 2>/dev/null | grep -E ':(5001|3001|80)\\b' || netstat -lntp 2>/dev/null | grep -E ':(5001|3001|80)\\b'"
                        % APP_DIR, "现状检查")
            return 0

        cmd = (
            "set -e; "
            "cd /tmp && rm -rf se-deploy && git clone -q --depth 1 %s se-deploy && "
            "sed -i 's/\\r$//' se-deploy/deploy/bootstrap.sh && "
            "DEPLOY_TOKEN=%s bash se-deploy/deploy/bootstrap.sh" % (REPO, token)
        )
        code = run(client, cmd, "执行引导部署")
        if code != 0:
            print("\n✗ 引导脚本返回非 0，请把上面的输出发我排查")
            return code

        run(client, "sleep 1; curl -s --max-time 8 http://127.0.0.1:%s/api/health" % APP_PORT, "服务器本地自检")
        print("\n✓ 完成。接下来我会从本机验证 http://%s:%s/ 并做首次全量推送。" % (host, APP_PORT))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
