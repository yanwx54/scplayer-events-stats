# 项目长期约定（Project07_scplayer-stats）

## 项目定位
eloboard 三大赛事（43 메이저 프로리그 / 33 K리그 / 64 준메이저 프로리그）选手数据查询网站。
纯静态站点（`public/`）+ 零依赖 Node 脚本（`scripts/`）。仓库：`yanwx54/scplayer-events-stats`（公开）。

## 硬约束（用户明确要求）
- **数据来源只能是这三个赛事**，不得引入其他赛事
- **不要改动 `D:\WorkSpace` 下的其他项目**（尤其是参考项目 `D:\WorkSpace\scplayer-stats`，只读）
- 数据只保留 **2026-01-01 之后**（`build-db.mjs` 的 `CUTOFF` 常量）
- 选手/地图译名以 `docs/` 下两份文档为准；文档未涉及的保留原韩文
- 所有地图板块**只展示本赛季地图**（`SEASON_ROW_IDX` 指定的 7 张）

## 改译名的流程
1. 改 `docs/韩国选手名字.md` 或 `docs/地图翻译规则.md`
2. 同步到 `scripts/build-db.mjs` 顶部的 `PLAYER_ROWS` / `MAP_ROWS` 常量（脚本不解析 Markdown）
3. `npm run build && npm run verify`

## 数据口径
- 单局粒度：一条 match = 双方各计一场，所以「选手场次总和 = 对局数 × 2」
- `elo_delta` 恒为胜方正增益；`ELO 净变` 是本口径内的指标，`官方 ELO` 只是站点全局值
- 日期筛选走 `daily.json` 的「日期 × 赛事」稀疏桶，前端二分后线性求和

## 环境坑（会反复踩，务必记住）
- **沙箱内 `curl` 走系统代理会卡在 TLS 重协商（HTTP 000）**；抓取一律用 Node 原生 `fetch`
- 访问本机服务要加 `--noproxy '*'`
- **沙箱写不进 `.git/refs/remotes/origin/`**，`git-backup.mjs` 改用 `.git/packed-refs` 校准追踪引用
- `ssh -T git@github.com` 会间歇性 Connection reset，推送需重试；`~/.ssh/config` 已映射到 `ssh.github.com:443`
- Playwright 复用 `D:\WorkSpace\scplayer-stats\node_modules`，须指定 `executablePath` 指向 `chromium-1200`
- 写脚本文件用 Write 工具，不要用 Bash heredoc（`${...}` 会被 shell 展开报 Bad substitution）

## 测试约定
- `shoot.cjs` 的期望值必须**从构建产物（index.json 等）推导**，不要写死数字 —— 数据每天都在涨
- Playwright 点下拉框附近的元素前记得 `blur()`，否则展开的下拉会拦截点击导致超时
- 断言失败时先怀疑产品、再怀疑测试（曾在这一点上误判过一次）

## 每日自动化
id `6d509d81-1957-43f4-be6a-80da6aa7fa96`，每天 10:00：
`sync.mjs` → `verify.mjs` → `verify-range.mjs` → `git-backup.mjs` → 中文简报

## 线上发布
- 发布对象是 **`public/` 目录**（纯静态），不是项目根
- 分享链接：`https://93a5c2c68d004874bfff959e25daade5.sg.agentos-app.run`
- 每日同步后线上**不会自动更新**，需重新发布该目录（链接不变，内容被覆盖）
- 重新发布属于对外发布动作，**必须先问过用户**再执行
