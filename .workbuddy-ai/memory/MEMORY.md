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

## 测试约定
- `shoot.cjs` 的期望值必须**从构建产物（index.json 等）推导**，不要写死数字 —— 数据每天都在涨
- Playwright 点下拉框附近的元素前记得 `blur()`，否则展开的下拉会拦截点击导致超时
- 断言失败时先怀疑产品、再怀疑测试（曾在这一点上误判过一次）

## 每日自动化
id `6d509d81-1957-43f4-be6a-80da6aa7fa96`，每天 10:00：
`sync.mjs` → `verify.mjs` → `verify-range.mjs` → `git-backup.mjs` → 中文简报

## 线上发布
- 发布对象是 **`public/` 目录**（纯静态），不是项目根
- 分享链接：`https://93a5c2c68d004874bfff959e25daade5.sg.agentos-app.run`（sandboxId 同 ID，重发链接不变）
- **用户的长期授权（2026-09-18 明确要求）**：「以后每次做完都同步更新到线上分享链接，让我看效果」
  → 完成改动 + 本地自检通过后，**直接重新发布，不必再逐次问**；发布后给出链接与线上验证结果
- 每日 10:00 自动同步后线上**不会自动更新**，需要重新发布（链接不变，内容被覆盖）
- **发布后的验收方式**：`BASE=<线上地址> node scripts/shoot.cjs` —— 同一套 47 项断言直接打线上，
  比只看 HTTP 200 靠谱得多
