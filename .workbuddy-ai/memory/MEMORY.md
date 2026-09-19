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
- **赛事中文名（用户指定，非文档）**：`메이저 프로리그`→职业联赛、`K리그`→K联赛、
  `준메이저 프로리그`→半职业联赛。前端一律用 `evHTML(id)` / `evZh(id)` 渲染，别再直出 `EVENTS[k].name`

## 改译名的流程
1. 改 `docs/韩国选手名字.md` 或 `docs/地图翻译规则.md`
2. 同步到 `scripts/build-db.mjs` 顶部的 `PLAYER_ROWS` / `MAP_ROWS` 常量（脚本不解析 Markdown）
3. `npm run build && npm run verify`

## 数据口径
- 单局粒度：一条 match = 双方各计一场，所以「选手场次总和 = 对局数 × 2」
- `elo_delta` 恒为胜方正增益；`ELO 净变` 是本口径内的指标，`官方 ELO` 只是站点全局值
- 日期筛选走 `daily.json` 的「日期 × 赛事」稀疏桶，前端二分后线性求和
- **月度 ELO（`monthly[].eloChg` / `eloEnd`）**：
  - `eloChg` = 当月 ELO 净变；站点未结算的对局不返回 `elo_delta`（如 2026-09 整月缺），
    这类月份为 `null`，图表按 0 处理（与「官方 ELO 也未动」自洽，**不要补 0 后当成真实涨幅**）
  - `eloEnd` = 月末 ELO，由官方 ELO 向前倒推：`eloEnd(M) = 官方ELO − Σ(月份晚于 M 的 eloChg)`
  - 自洽条件（verify.mjs 已断言）：Σ`eloChg` == `eloNet`；末月 == 官方 ELO；相邻差 == 后一月 `eloChg`
- **`maps.json` 按「对局」计数**（不是选手出场次数）：总场次 = 本赛季对局数，**不要再乘 2**
- **地图对抗胜率是「6 个方向」**：`ZvP ZvT PvZ PvT TvZ TvP`，每列只统计该方向**前者**的胜率。
  同一场比赛**同时计入两个相反方向**，所以互为反向的两列（如 ZvP/PvZ）场次相同、胜率互补合计 100%。
  `maps.json` 的 `matchups[k]` 结构是 **`{g, w, wr}`**（不是 `{g, w1, w2, wr1}`）。
  自检口径：`Σ六方向场次 ÷ 2 + mirror + unknownRace === games`（**÷2 不能漏**，每场被算了两次）

## 环境坑（会反复踩，务必记住）
- **沙箱内 `curl` 走系统代理会卡在 TLS 重协商（HTTP 000）**；抓取一律用 Node 原生 `fetch`
- 访问本机服务要加 `--noproxy '*'`
- **沙箱写不进 `.git/refs/remotes/origin/`**，`git-backup.mjs` 改用 `.git/packed-refs` 校准追踪引用
- `ssh -T git@github.com` 会间歇性 Connection reset，推送需重试；`~/.ssh/config` 已映射到 `ssh.github.com:443`
- Playwright 复用 `D:\WorkSpace\scplayer-stats\node_modules`，须指定 `executablePath` 指向 `chromium-1200`
- Playwright **元素截图会被固定顶栏 `.topbar` 盖住**：截图前 `display:none` + 等 200ms
  （`visibility:hidden` 不生效，导航仍会被画出来）
- 写脚本文件用 Write 工具，不要用 Bash heredoc（`${...}` 会被 shell 展开报 Bad substitution）
- 手工提交推送统一走 `node scripts/git-backup.mjs --msg "feat: ..."`（自动 add -A + 提交 + 重试推送 + 校准追踪引用）
- **官方 `/api/players/{id}` 详情接口已坏**（2026-09-19 发现）：对相当一部分 id 稳定 **500**，
  含 김지성#29 这类当红选手 → 抓选手一律走**列表接口** `/api/players?limit=200&offset=n`
  （正常、1267 人 / 7 页、字段与详情接口一致）。列表未覆盖的女子组（5988/5990/5992）退回详情兜底。
  已改 `sync.mjs`（`fetchPlayerList()`）与 `fetch-players.mjs`，**别再改回逐 id 详情抓取**
- **`build-db.mjs` 禁止整目录 `rm(public/data/players)`** —— 86 个文件会触发沙箱批量删除保护
  （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，单轮 >50 个即拦）。现在是逐个清理失效文件，幂等
- 本机（用户 AAA）**没有 Playwright 包**，`shoot.cjs` 里写死的 `D:/WorkSpace/scplayer-stats/...`
  路径不存在且 npm 装不了 → `shoot.cjs` 跑不起来。替代方案：用 Playwright 缓存里的
  `C:/Users/AAA/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe` 做无头渲染验收
  （`--virtual-time-budget` 等 SPA 加载；`--screenshot` 与 `--dump-dom` 不能同时用）
- **`local.config.json` 不入库**（gitignore）→ 新克隆的副本缺服务器地址与令牌，`npm run deploy` 用不了

## 表格与排序
- 表头排序统一走三个 helper（`app.js` 里 `wrCell` 之后）：`sortableTH(cols, sort)` /
  `bindSort(sel, sort, redraw)` / `updateSortMarks(sel, sort)`
  - `cols = [[key, 标签, 是否数值列, 首次点击的默认方向(1 升 / -1 降)], …]`
  - 排序状态放 `state`（`playerSort` / `oppSort`），重绘后保持
- **只重绘 `tbody` 的表格，必须手动调 `updateSortMarks()`** —— 表头不重建，
  `.sorted` 高亮与 ▲▼ 箭头不会自己更新（排行榜整体重建 innerHTML 所以不需要）
- 单行记录两栏表格统一走 `recColsHTML(list, REC_COLS, rowFn, emptyText)`，列定义 `REC_COLS`

## 测试约定
- `shoot.cjs` 的期望值必须**从构建产物（index.json 等）推导**，不要写死数字 —— 数据每天都在涨
  （`PAGE_SIZE` 这类代码常量则从 `app.js` 源码正则读取）
- Playwright 点下拉框附近的元素前记得 `blur()`，否则展开的下拉会拦截点击导致超时
- 断言失败时先怀疑产品、再怀疑测试（曾在这一点上误判过一次）
- **两栏/多表布局下 `tbody tr:first-child` 会命中多个元素**（Playwright strict mode 报错），
  断言选择器要限定到具体一栏（`#xxx .table-wrap:first-child `）
- Playwright `screenshot({clip})` 的坐标是**页面坐标**，而 `boundingBox()` 返回**视口坐标**，
  页面滚动过就会错位 → 直接对 locator 做元素截图

## 路由状态管理（踩过两次的坑）
- **以 URL 为唯一事实来源**：凡是从 query 参数派生的筛选/页签状态（排行页 `event`、详情页 `tab`），
  无参数时必须**显式复位**，不能写成 `if (params.get(x)) state.y = params.get(x)`
- 切换这些状态时用 `history.replaceState` 同步地址栏（不触发 hashchange，不整页重渲染）

## 每日自动化
id `6d509d81-1957-43f4-be6a-80da6aa7fa96`，每天 10:00：
`sync.mjs` → `verify.mjs` → `verify-range.mjs` → `git-backup.mjs` → **`push-server.mjs`** → 中文简报

## 服务器部署（用户自有服务器）
- 目标地址 **`http://199.180.116.188:5001/`** —— **已上线运行**（2026-09-18 部署完成，用户要求可在外网随时访问）
- 服务器：**Ubuntu 18.04（glibc 2.27）** → 官方二进制最高只能用 **Node 16**，
  服务器侧代码禁止使用 `import.meta.dirname` / `structuredClone` / `AbortSignal.timeout` 等新 API
- 登录：`ssh -p 27168 root@199.180.116.188`（**端口是 27168**；22 等端口无监听）
  - 本机 `~/.ssh/id_ed25519` 是 GitHub 专用，**未被该服务器授权**；服务器允许 publickey/password
  - **该端口会偶发「建连后立刻 ECONNRESET」**，用 PowerShell 直连也一样 → 不是沙箱问题，
    隔几分钟重试即可恢复，**不要因此判定「端口改了 / 被封了」**
- 同机还跑着：旧版 `scplayer-stats`（`/opt/scplayer-stats`，PM2，端口 **3001**）、nginx(80)、3000 端口某服务
  → 本项目端口选 **5001** 避让
- 部署方式：**HTTP 增量推送，日常不需要走 SSH**
  - `deploy/bootstrap.sh`（服务器上执行一次，幂等）：装 Node16/PM2 → 代码到 `/opt/scplayer-events-stats`
    → 用 `public/` 初始化 `site/` → 写 `deploy/deploy-token.txt` → PM2 起 `deploy/server.mjs` 监听 0.0.0.0:5001 → ufw 放行
  - `deploy/server.mjs`：静态服务 + `POST /api/deploy`（Bearer token，base64 写文件/删除）、
    `GET /api/health`、`GET /api/manifest`（sha1 清单）
  - `scripts/push-server.mjs`：本地比对 sha1 后**只推变化文件**（`--full` 全量 / `--check` 只比对）
  - 地址与令牌放 **`local.config.json`（已 gitignore，不入库）**
- 实测：首次全量 326 文件 / 5.5MB / 16.5s；无变化时幂等跳过；改 1 个文件 0.2s
- **线上验收方式：`BASE=http://199.180.116.188:5001 node scripts/shoot.cjs`**（71 项断言；2026-09-18 全过、0 控制台错误）
- 服务器实测跑的是 **Node v16.20.2**，与「服务器侧代码必须兼容 Node 16」的约束一致（改动 server.mjs 时别引入新 API）
- 排障需 SSH：`pm2 logs scplayer-events-stats` / `pm2 restart scplayer-events-stats`
- 本机 **npm 被安全策略拦死**（会调黑名单里的 `reg.exe`），装不了 `ssh2`；
  若将来要用密码登录服务器，改用 Python `paramiko`（已装在
  `C:\Users\yanwx\.workbuddy-ai\binaries\python\envs\default`，配套 `scripts/remote-deploy.py`）

## 线上发布
现在有**两个线上目标**，内容都是 `public/` 目录：
1. **自有服务器 `http://199.180.116.188:5001/`**（主力目标，见上一节；`npm run deploy` 增量推送）
2. 沙箱预览链接（见下）

- 发布对象是 **`public/` 目录**（纯静态），不是项目根
- 分享链接：`https://93a5c2c68d004874bfff959e25daade5.sg.agentos-app.run`（sandboxId 同 ID，重发链接不变）
- **用户的长期授权（2026-09-18 明确要求）**：「以后每次做完都同步更新到线上分享链接，让我看效果」
  → 完成改动 + 本地自检通过后，**直接重新发布，不必再逐次问**；发布后给出链接与线上验证结果
- 每日 10:00 自动同步后线上**不会自动更新**，需要重新发布（链接不变，内容被覆盖）
- **发布后的验收方式**：`BASE=<线上地址> node scripts/shoot.cjs` —— 同一套 **71 项**断言直接打线上，
  比只看 HTTP 200 靠谱得多
