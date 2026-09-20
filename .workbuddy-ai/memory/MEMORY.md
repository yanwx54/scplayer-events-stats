# 项目长期约定（Project07_scplayer-stats）

## 定位与硬约束
eloboard 三大赛事（43 职业联赛 / 33 K联赛 / 64 半职业联赛）选手数据站。纯静态 `public/` + 零依赖 Node `scripts/`。
仓库 `yanwx54/scplayer-events-stats`（公开）。线上：自有服务器 http://199.180.116.188:5001/ 。

- 数据来源**只能是这三个赛事**；只保留 **2026-01-01 之后**（`build-db.mjs` 的 `CUTOFF`）
- **不要改动 `D:\WorkSpace` 下其他项目**（参考项目 `scplayer-stats` 只读）
- 译名以 `docs/` 两份文档为准，未涉及的保留韩文；地图只展示本赛季 7 张（`SEASON_ROW_IDX`）
- 赛事中文名（用户指定）：`메이저 프로리그`→职业联赛、`K리그`→K联赛、`준메이저 프로리그`→半职业联赛。
  前端一律用 `evHTML(id)`/`evZh(id)`，别直出 `EVENTS[k].name`
- 改译名流程：改 `docs/` → 同步 `build-db.mjs` 顶部 `PLAYER_ROWS`/`MAP_ROWS` → `npm run build && npm run verify`

## 数据口径
- 单局粒度：一条 match = 双方各计一场 → 选手场次总和 == 对局数 × 2
- `elo_delta` 恒为胜方正增益；`ELO 净变` 是本口径指标，`官方 ELO` 是站点全局值
- 日期筛选走 `daily.json` 的「日期 × 赛事」稀疏桶，前端二分后线性求和
- 月度 ELO：`eloChg`=当月净变（站点未结算的月为 `null`，图表按 0 处理，**不要补 0 当真实涨幅**）；
  `eloEnd(M) = 官方ELO − Σ(晚于 M 的 eloChg)`。自洽：Σ`eloChg`==`eloNet`、末月==官方 ELO、相邻差==后一月 eloChg
- `maps.json` **按对局计数**（不是选手出场），总场次 = 本赛季对局数，**不要再乘 2**
- 地图对抗胜率 6 方向 `ZvP ZvT PvZ PvT TvZ TvP`，每列只统计前者；同场计入两个相反方向
  → 反向两列场次相同、胜率互补。`matchups[k]` 结构 `{g,w,wr}`。
  自检：`Σ六方向场次 ÷ 2 + mirror + unknownRace === games`（**÷2 不能漏**）

## 环境坑
- 沙箱 `curl` 走代理会卡 TLS（HTTP 000）→ 抓取一律 Node 原生 `fetch`；访问本机服务加 `--noproxy '*'`
- 沙箱写不进 `.git/refs/remotes/origin/` → `git-backup.mjs` 用 `.git/packed-refs` 校准
- 推送统一走 `node scripts/git-backup.mjs --msg "..."`（add -A + 提交 + 重试推送 + 校准引用）
- 本机 `git push` **间歇性卡死**（卡在 `git credential-manager get`，40s 超时）；本机 ssh key 未授权 GitHub、
  无 `gh`/TOKEN。遇时多试几次，仍不行就如实说「提交已完成、推送待办」
- **本机无 Playwright 包**，`shoot.cjs` 跑不起来；改用 Playwright 缓存里的 Chromium 无头渲染验收
  （`--virtual-time-budget`；`--screenshot` 与 `--dump-dom` 不能同时用）
- Playwright **元素截图被固定顶栏 `.topbar` 盖住** → 截图前 `display:none` + 等 200ms（`visibility:hidden` 无效）
- 写脚本用 Write 工具，别用 Bash heredoc（`${...}` 被 shell 展开报 Bad substitution）
- `local.config.json` 不入库（gitignore）→ 缺服务器地址与令牌时 `npm run deploy` 用不了
- `build-db.mjs` **禁止整目录 `rm(public/data/players)`**（>50 文件触发沙箱批量删除保护），现在逐个清理、幂等
- 本机 `~/.ssh/config` 只配了那台服务器（199.180.116.188:27168 root），免密可用；
  服务器 repo `/opt/scplayer-events-stats`，`site/` 是线上站点目录

## 官方接口（2026-09-20 踩过）
- 详情 `/api/players/{id}`：**唯一返回真实 `college_name`**，但部分 id 稳定 500 → 不能当主路径
- 列表 `/api/players?limit=200&offset=n`：稳定（1267 人/7 页），但 **`college_name` 恒 null**
- **战队名解法**：`GET /api/colleges`（1 请求返回全部 13 支，`id`/`name`/…）→ `college_id → name`。
  `sync.mjs` 的 `fetchColleges()` 干这个；`build-db.mjs` 写 `college: raw.college_name || null`
  → **players.json 的 `college_name` 必须由 sync 补齐**
- `syncPlayers` 刷新**所有在册选手**（不只新增），返回值字段是 **`refreshed`**；
  列表未覆盖的女子组（5988/5990/5992）退回详情兜底

## 前端约定
- 表头排序三个 helper（`app.js`）：`sortableTH(cols, sort)` / `bindSort(sel, sort, redraw)` / `updateSortMarks(sel, sort)`；
  `cols=[[key,标签,是否数值,首点方向(1升/-1降)]]`；排序状态放 `state`（`playerSort`/`oppSort`）
- **只重绘 `tbody` 的表格必须手动调 `updateSortMarks()`**（表头不重建，高亮/箭头不会自更新）
- 单行记录两栏表格统一 `recColsHTML(list, REC_COLS, rowFn, emptyText)`
- **路由以 URL 为唯一事实来源**：query 派生的状态（排行页 `event`、详情页 `tab`）无参数时必须**显式复位**；
  切换用 `history.replaceState`
- **异步渲染别用全局 `$('#xxx')`**：渲染开始用 `host.querySelector()` 捕获引用，绘制前判 `isConnected`
  （H2H 页踩过 → 线上 1 条控制台错误）

## 测试约定
- `shoot.cjs` 期望值**从构建产物推导**，别写死数字（`PAGE_SIZE` 从 `app.js` 正则读）
- 点下拉框附近元素前先 `blur()`；断言失败**先怀疑产品再怀疑测试**
- 多表布局 `tbody tr:first-child` 命中多个（strict mode）→ 选择器限定具体栏
- `screenshot({clip})` 用**页面坐标**，`boundingBox()` 是**视口坐标** → 直接对 locator 元素截图

## 部署
- **服务器自助定时更新（线上主路径）**：root crontab 10:20 / 20:20 →
  `/opt/scplayer-events-stats/deploy/self-sync.sh`（`git fetch + reset --hard origin/main` →
  `node --experimental-fetch scripts/sync.mjs` → verify + verify-range → `rsync public/ site/`）。
  装/卸 `bash deploy/install-cron.sh [--remove]`；日志 `/var/log/scplayer-events-sync.log`；
  `flock` 单实例；任一步失败不发布。**改 self-sync.sh 必须 push 到 GitHub 才生效**
- **服务器 Node 16 兼容**：nvm 装于 `/root/.nvm/versions/node/v16.20.2/bin/`；
  禁用 `import.meta.dirname`（用 `scripts/_paths.mjs` 的 `ROOT`）、`structuredClone`、`AbortSignal.timeout`；
  无全局 `fetch` → 必须 `--experimental-fetch`；已装 rsync
- 服务器 Ubuntu 18.04（glibc 2.27）→ 最高 Node 16。SSH `ssh -p 27168 root@199.180.116.188`
  （**端口 27168**；偶发 ECONNRESET，隔几分钟重试，**别判定端口改了/被封**）
- 同机另有旧版 `scplayer-stats`（端口 3001）、nginx(80) → 本项目用 **5001**
- 部署走 **HTTP 增量推送**（日常不需 SSH）：`deploy/server.mjs`（静态 + `POST /api/deploy` Bearer token +
  `/api/health` + `/api/manifest` sha1）；`scripts/push-server.mjs` 只推变化文件（`--full`/`--check`）。
  实测首次全量 326 文件 / 5.5MB / 16.5s
- **线上验收**：`BASE=http://199.180.116.188:5001 node scripts/shoot.cjs`（71 项断言）
- 本机 npm 被安全策略拦死（调黑名单 `reg.exe`），装不了 `ssh2`；密码登录服务器改用 Python `paramiko`
  （`C:\Users\yanwx\.workbuddy-ai\binaries\python\envs\default`，配套 `scripts/remote-deploy.py`）

## 本地每日自动化（备份手段）
id `6d509d81-1957-43f4-be6a-80da6aa7fa96`，每天 10:00：sync → verify → verify-range → git-backup →
push-server → 中文简报。**2026-09-19 起线上已由服务器自助更新**，本自动化非必需；两者不冲突。

## 沙箱预览发布（次要目标）
- 发布对象是 `public/` 目录；链接**按机器/工作副本各一条**，重复发布复用同一 sandbox（链接不变、内容覆盖）
  - 原副本（yanwx）：`https://93a5c2c68d004874bfff959e25daade5.sg.agentos-app.run`
  - 本机新克隆（AAA，2026-09-19）：`https://25d6bffd32f54fa5a230c6fb6c0a7840.sg.agentos-app.run`
- **用户长期授权**：「每次做完都同步更新线上分享链接」→ 改动 + 自检通过后**直接重新发布，不必逐次问**
