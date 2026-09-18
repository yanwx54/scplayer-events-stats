# SC 赛事选手数据查询

韩国星际争霸职业选手数据查询网站。**全部数据严格限定在 eloboard 三大赛事**：

| 赛事 ID | 韩文名 | 中文/英文 | 对局数 | 选手数 | 时间跨度 |
|---|---|---|---|---|---|
| [43](https://eloboard.com/events/43) | 메이저 프로리그 | Major Pro League | 13,888 | 174 | 2021-06-01 ~ 2026-09-17 |
| [33](https://eloboard.com/events/33) | K리그 | K League | 12,925 | 148 | 2021-04-08 ~ 2026-09-15 |
| [64](https://eloboard.com/events/64) | 준메이저 프로리그 | Semi-Major Pro League | 1,348 | 50 | 2023-11-30 ~ 2026-08-30 |

合计 **28,161 场对局 / 238 名选手 / 84 张地图**。

## 功能

- **总览** — 赛事分布、出场 TOP12、胜率榜、ELO 榜、热门地图
- **选手排行** — 238 名选手可按赛事 / 种族 / 场次门槛筛选，按场次、胜负、胜率、ELO、ELO 净变排序，支持姓名搜索
- **选手详情** — 五项标签页
  - 总览：分赛事战绩、种族对抗、近期状态、**月度走势图**（柱=出场数，线=当月胜率）
  - 地图：该选手在每张地图的场次与胜率
  - 对抗：对手种族对抗表 + 地图胜率分布
  - 对手：全部交手过的对手及其 H2H 战绩（点击进入双方对战）
  - 对局记录：全部比赛，可按赛事筛选、按地图/对手搜索、分页浏览
- **双方对战** — 任选两名选手，查看总比分、分地图/分赛事交手、最近 20 次结果与全部交手记录
- **地图情报** — 84 张地图的总场次、使用人数、出场最多选手

## 数据口径说明

- **所有统计均从这三个赛事的比赛记录重新计算**，不含其他赛事。
- **官方 ELO**（选手页与排行中标注为「官方 ELO」）是 eloboard 站点当前的全局 ELO 值，仅作参考，**不是**这三个赛事内的计算值。
- **ELO 净变** 才是本口径内的指标：把该选手在这三个赛事中每局的 `elo_delta` 按胜负取符号后累加。
- 赛制绝大多数为单局（`단판`），一场比赛 = 一条记录 = 双方各计一场。
- 数据自检：所有选手胜场总和 = 负场总和 = 28,161。

## 目录结构

```
Project07_scplayer-stats/
├── server.mjs                   # 零依赖静态服务器（默认 5178）
├── package.json
├── public/                      # 网站（纯静态，可直接托管）
│   ├── index.html
│   ├── app.js                   # 前端逻辑（无框架）
│   ├── style.css
│   ├── avatars/                 # 234 张选手头像（已本地化）
│   └── data/
│       ├── index.json           # 选手索引 + 赛事/地图/月度元信息
│       ├── maps.json            # 地图榜
│       └── players/{id}.json    # 每名选手的完整明细（238 个）
├── scripts/
│   ├── sync.mjs                 # 每日增量同步（抓新对局 + 补选手/头像 + 重建）
│   ├── fetch-matches.mjs        # 抓取三大赛事全量比赛
│   ├── fetch-players.mjs        # 抓取选手元数据
│   ├── fetch-avatars.mjs        # 下载头像
│   ├── build-db.mjs             # 构建聚合数据库
│   ├── verify.mjs               # 数据一致性校验
│   ├── crosscheck.mjs           # H2H 交叉复核
│   └── shoot.cjs                # Playwright 截图自检
└── data/raw/                    # 原始 API 响应（抓取产物，不入库）
```

## 使用

```bash
# 预览（零依赖）
node server.mjs            # → http://127.0.0.1:5178

# 每日增量同步（推荐）
npm run sync               # 增量抓取新对局 + 补选手/头像 + 重建数据库
npm run sync:full          # 全量重抓（数据异常时使用）
npm run verify             # 数据一致性校验
npm run backup             # 提交并推送到 GitHub

# 全量重建（需要能访问 eloboard.com）
npm run fetch              # 抓比赛 + 选手 + 头像
npm run build              # 生成 public/data/
```

`public/` 是纯静态目录，可直接部署到任意静态托管。

## 每日自动同步 + 备份

已配置每日 **10:00** 自动运行（WorkBuddy 自动化「SC三大赛事数据每日同步」）：

```
scripts/sync.mjs  →  scripts/verify.mjs  →  scripts/git-backup.mjs  →  中文简报
```

### 增量同步策略（`scripts/sync.mjs`）

1. 从 `offset=0` 开始分页拉取（官方按最新在前排序），每页与本地已知 `match id` 比对。
2. **最近 400 条始终重新抓取**（纠错窗口，覆盖官方对近期记录的修正）。
3. 越过窗口后，遇到「整页都已存在」即判定到达增量边界并停止。
4. 合并规则：**同 id 以新抓到的为准**，本地多出的旧记录保留 —— 只增不减 + 近期窗口纠错。
5. 自动补抓新出现的选手元数据、下载缺失头像，最后重建 `public/data/`。
6. 结束时输出 `SYNC_OK`；若某赛事本地条数少于官方 `x-total-count`，会提示改用 `--full`。

实测：无新数据时约 2.5~5 秒完成（每赛事仅 2 页）。

### GitHub 备份（`scripts/git-backup.mjs`）

- 无变更时跳过（输出 `GIT_BACKUP_SKIP`），不产生空提交
- 推送失败自动退避重试 4 次（SSH 到 github.com 会间歇性 Connection reset）
- 推送后校准本地追踪引用；末尾输出 `GIT_BACKUP_OK`

仓库：<https://github.com/yanwx54/scplayer-events-stats>

### 版本控制约定

`.gitignore` 排除了 `data/raw/`（21MB 抓取缓存，每日整体重写，入库会让仓库快速膨胀；
缺失时 `sync.mjs` 会自动全量重抓）、`shots/`（自检截图）与 `node_modules/`。
`public/data/` 与 `public/avatars/` **入库**，克隆后即可直接运行站点。

## 数据来源

[eloboard.com](https://eloboard.com) 公开 JSON API：
`/api/matches?event_id={43|33|64}&limit=200&offset=n`、`/api/players/{id}`。
头像来自 `https://eloboard.co.kr/static/`。

## License

MIT
