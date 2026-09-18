/**
 * 构建聚合数据库。
 * 输入：data/raw/event-{43,33,64}.json、data/raw/players.json
 * 输出：public/data/index.json、public/data/players/{id}.json、public/data/maps.json、public/data/daily.json
 *
 * 统计口径：
 *   1) 仅三个赛事（43 / 33 / 64）
 *   2) 仅 CUTOFF（默认 2026-01-01）之后的比赛
 *   3) 地图板块仅展示「本赛季地图」（见 SEASON_MAP_ROWS）
 *
 * 选手中文名 / 英文 ID 依据 docs/韩国选手名字.md，
 * 地图中文名依据 docs/地图翻译规则.md；文档未涉及的一律保留原韩文。
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');

/** 只保留该日期（含）之后的比赛。改这里即可调整数据范围。 */
const CUTOFF = process.env.CUTOFF || '2026-01-01';

const EVENTS = [
  { id: 43, name: '메이저 프로리그', nameZh: '职业联赛', nameCn: 'Major Pro League', short: '메프로', shortCn: 'Major' },
  { id: 33, name: 'K리그', nameZh: 'K联赛', nameCn: 'K League', short: 'K리그', shortCn: 'K League' },
  { id: 64, name: '준메이저 프로리그', nameZh: '半职业联赛', nameCn: 'Semi-Major Pro League', short: '준메프로', shortCn: 'Semi-Major' },
];
const EVENT_IDS = EVENTS.map((e) => e.id);

/** 种族对抗的规范顺序：Z < P < T，两两组合得到 ZvP / ZvT / PvT */
const RACE_ORDER = { Z: 0, P: 1, T: 2 };
const MATCHUPS = ['ZvP', 'ZvT', 'PvT'];
const matchupOf = (r1, r2) => {
  if (!r1 || !r2 || !(r1 in RACE_ORDER) || !(r2 in RACE_ORDER)) return null;
  const a = RACE_ORDER[r1] <= RACE_ORDER[r2] ? r1 : r2;
  const b = a === r1 ? r2 : r1;
  return `${a}v${b}`;
};

/* ============================================================
   地图译名（依据 docs/地图翻译规则.md）
   每行列出该地图在数据中出现过的所有韩文写法；只有本表覆盖到的地图才显示中文，
   其余一律保留原韩文（符合「没有涉及到的先用原有的韩文」）。
   ============================================================ */
const MAP_ROWS = [
  { kr: ['제인 도', '제인'], cn: '无名氏', en: 'Jane Doe' },
  { kr: ['애티튜드', '애티', '에티'], cn: '态度', en: 'Attitude' },
  { kr: ['옥타곤', '옥타'], cn: '八角笼', en: 'Octagon' },
  { kr: ['매치포인트', '매치'], cn: '赛点', en: 'MatchPoint' },
  { kr: ['네오실피드', '네오 실피드', '실피드', '실피'], cn: '小仙女', en: 'Neo Sylphid' },
  { kr: ['녹아웃', '녹아'], cn: '击倒', en: 'KnockOut' },
  { kr: ['폴스타', '폴스'], cn: '北极星', en: 'Pole Star' },
  { kr: ['오디세이', '오디'], cn: '奥德赛', en: 'Odyssey' },
  { kr: ['컬러리스 페이트', '컬러'], cn: '无色命运', en: 'Colorless Fate' },
  { kr: ['아이올로스', '아이'], cn: '艾洛斯', en: 'Aiolos' },
  { kr: ['백 룸', '백룸'], cn: '后室', en: 'Backrooms' },
];

/** 本赛季地图（docs/地图翻译规则.md「本赛季地图 · 2026年下半年」）。
 *  所有地图板块只展示这些地图。 */
const SEASON_LABEL = '2026 下半年';
const SEASON_ROW_IDX = [1, 2, 5, 7, 8, 9, 10];   // 指向 MAP_ROWS 下标
const SEASON_MAP_ROWS = SEASON_ROW_IDX.map((i) => MAP_ROWS[i]);

/** 韩文（含别名） → 中文 */
const MAP_CN = {};
for (const r of MAP_ROWS) for (const k of r.kr) MAP_CN[k] = r.cn;

/** 数据中实际出现的写法 → 该地图的规范中文名；未覆盖则为 undefined（前端回落韩文） */
const mapCnOf = (kr) => (kr ? MAP_CN[kr] : undefined);

/** 本赛季地图的全部韩文别名（用于过滤） */
const SEASON_MAP_ALIASES = new Set(SEASON_MAP_ROWS.flatMap((r) => r.kr));
const isSeasonMap = (kr) => !!kr && SEASON_MAP_ALIASES.has(kr);

/* ============================================================
   选手中文名 / 英文 ID（依据 docs/韩国选手名字.md）
   ============================================================ */
const PLAYER_ROWS = [
  ['이영호', '教主', 'Flash'], ['이재호', '光哥', 'Light'], ['유영진', '永镇', 'Rush'],
  ['조기석', '夏普', 'Sharp'], ['김지성', '抱歉', 'Royal'], ['정영재', '橘右京', 'JYJ'],
  ['황병영', '兵营', 'Barracks'], ['이영웅', '教练', 'Speed'], ['최호선', '侠义', 'Ssak'],
  ['박성균', '神麦', 'Mind'], ['윤찬희', '猪头', 'Mong'], ['김태영', '苹果', 'Ample'],
  ['신상문', '如花', 'Leta'], ['김재현', '刷分', 'Shine'], ['임진묵', '钢琴', 'Piano'],
  ['지동원', 'KOP', 'Kop'], ['전태양', '太阳', 'Sun'], ['유승곤', '扫描', 'Scan'],
  ['정민기', 'Bishop', 'Bishop'], ['김택용', '老毕', 'Bisu'], ['송병구', '石头', 'Stork'],
  ['정윤종', '雨神', 'Rain'], ['장윤철', '小雪', 'Snow'], ['도재욱', '禽兽', 'Best'],
  ['변현제', '迷你', 'Mini'], ['김윤중', '宝儿', 'JUM'], ['윤용태', '灯哥', 'Free'],
  ['원선재', '木头', 'Motive'], ['윤수철', '胡子', 'Tulbo'], ['박수범', '泰森', 'Tyson'],
  ['진영화', '老师', 'Movie'], ['홍덕', '如影', 'Ruin'], ['배병우', '815', '815'],
  ['이경민', '虎狼', 'Horang'], ['김범수', 'nOOB', 'nOOB'], ['정경두', '爆炸头', 'Paralyze'],
  ['장민철', 'MC', 'MC'], ['손찬웅', '白虎', 'BackHo'], ['이광용', 'Mighty', 'Mighty'],
  ['이제동', '解冻', 'Jaedong'], ['김민철', '永康', 'Soulkey'], ['조일장', '小胖', 'Hero'],
  ['김명운', '小零', 'Queen'], ['김성대', '瞬本', 'Action'], ['박상현', '索玛', 'Soma'],
  ['김정우', '火星', 'Effort'], ['이영한', '假卡', 'Shine Kal'], ['이예훈', '小头', 'Sacsri'],
  ['박준오', '杀本', 'Killer'], ['임홍규', '屌丝', 'Larva'], ['김경모', '寂寞', 'Gaemo'],
  ['김윤환', '脑虫', 'Clam'], ['방태수', 'BTS', 'BTS'], ['박재혁', '胡克', 'Hyuk'],
  ['어윤수', '搜本', 'Soo'], ['이창우', 'Saber', 'Saber'], ['배성흠', 'HM', 'HM'],
  ['고석현', '小玄', 'Hyun'], ['서문지훈', '拼命', 'Zelot'], ['윤진규', 'Yoon', 'Yoon'],
];

/** 归一化选手名：去空白 + 小写，用于容错匹配（数据里偶有多余空格） */
const normName = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const CN_BY_KEY = new Map();   // 韩文名/英文ID → 中文名
const EN_BY_KEY = new Map();   // 韩文名/英文ID → 英文 ID
for (const [kr, cn, en] of PLAYER_ROWS) {
  for (const k of [normName(kr), normName(en)]) {
    if (!CN_BY_KEY.has(k)) { CN_BY_KEY.set(k, cn); EN_BY_KEY.set(k, en); }
  }
}
/** 选手名 → { cn, idEn }；不在文档内则为 null */
const nameOf = (name) => {
  const k = normName(name);
  return CN_BY_KEY.has(k) ? { cn: CN_BY_KEY.get(k), idEn: EN_BY_KEY.get(k) } : { cn: null, idEn: null };
};

const RACE_CN = { T: '人族', Z: '虫族', P: '神族' };

/* ---------- 载入 ---------- */
const players = JSON.parse(await readFile(path.join(RAW, 'players.json'), 'utf8'));
const matches = [];
let droppedBeforeCutoff = 0;
for (const e of EVENT_IDS) {
  const arr = JSON.parse(await readFile(path.join(RAW, `event-${e}.json`), 'utf8'));
  for (const m of arr) {
    if ((m.played_on || '') < CUTOFF) { droppedBeforeCutoff++; continue; }
    matches.push(m);
  }
}
console.log('loaded matches:', matches.length, `| 因早于 ${CUTOFF} 被剔除:`, droppedBeforeCutoff);

/* ---------- 校验 ---------- */
const seen = new Set();
let dup = 0, badParts = 0;
for (const m of matches) {
  if (seen.has(m.id)) dup++;
  seen.add(m.id);
  if (!Array.isArray(m.participants) || m.participants.length !== 2) badParts++;
}
console.log('duplicate match ids:', dup, '| non-2-participant matches:', badParts);

/* ---------- 选手索引 ---------- */
const P = new Map();
for (const [id, raw] of Object.entries(players)) {
  const pid = Number(id);
  P.set(pid, {
    id: pid,
    name: raw.name,
    ...nameOf(raw.name),
    race: raw.main_race || null,
    elo: raw.elo_raw ? Number(raw.elo_raw) : null,
    avatar: raw.thumb_url ? `avatars/${pid}.jpg` : null,
    college: raw.college_name || null,
    soop: raw.soop_id || null,
    // 以下为该选手在「全部赛事」的官方生涯数据（仅作参考展示，非本统计口径）
    careerWins: raw.wins ?? null,
    careerLosses: raw.losses ?? null,
    lastPlayed: raw.last_played_on || null,
    // 本统计口径（三赛事）
    games: 0, wins: 0, losses: 0,
    byEvent: {}, byMap: {}, vsRace: {}, vsOpp: {}, byDay: {},
    firstDate: null, lastDate: null,
    eloNet: 0, eloGames: 0,
    monthly: {},
    matches: [],
  });
}
// 补上比赛里出现但 players.json 未覆盖的选手
for (const m of matches) for (const p of m.participants) {
  if (!P.has(p.player_id)) {
    P.set(p.player_id, {
      id: p.player_id, name: p.name, ...nameOf(p.name), race: p.race, elo: null, avatar: null, college: null, soop: null,
      careerWins: null, careerLosses: null, lastPlayed: null,
      games: 0, wins: 0, losses: 0, byEvent: {}, byMap: {}, vsRace: {}, vsOpp: {}, byDay: {},
      firstDate: null, lastDate: null, eloNet: 0, eloGames: 0, monthly: {}, matches: [],
    });
  }
}

const bump = (obj, key, isWin) => {
  const o = obj[key] || (obj[key] = { games: 0, wins: 0, losses: 0 });
  o.games++; isWin ? o.wins++ : o.losses++;
  return o;
};

/* ---------- 逐场累计 ---------- */
/** 地图维度（只统计本赛季地图）：总场次 + 分种族对抗胜负 */
const mapAgg = {};
for (const m of matches) {
  const [a, b] = m.participants;
  const date = m.played_on || null;
  const month = date ? date.slice(0, 7) : null;

  if (isSeasonMap(m.map_name)) {
    const g = mapAgg[m.map_name] || (mapAgg[m.map_name] = {
      kr: m.map_name, cn: mapCnOf(m.map_name) || m.map_name,
      games: 0, mirror: 0, unknownRace: 0, m2: {},
    });
    g.games++;
    const label = matchupOf(a.race, b.race);
    if (!label) {
      g.unknownRace++;
    } else if (a.race === b.race) {
      g.mirror++;                       // 同族对抗（ZvZ / PvP / TvT）：胜负各半，不统计胜率
    } else {
      // 规范顺序下先出现的一方为 w1
      const first = RACE_ORDER[a.race] <= RACE_ORDER[b.race] ? a : b;
      const mm = g.m2[label] || (g.m2[label] = { g: 0, w1: 0, w2: 0 });
      mm.g++;
      if (first.result === 'win') mm.w1++; else mm.w2++;
    }
  }

  for (const [me, opp] of [[a, b], [b, a]]) {
    const pl = P.get(me.player_id);
    if (!pl) continue;
    const isWin = me.result === 'win';
    pl.games++; isWin ? pl.wins++ : pl.losses++;
    bump(pl.byEvent, m.event_id, isWin);
    if (m.map_name) bump(pl.byMap, m.map_name, isWin);
    if (opp.race) bump(pl.vsRace, opp.race, isWin);
    bump(pl.vsOpp, opp.player_id, isWin);
    if (date) {
      if (!pl.firstDate || date < pl.firstDate) pl.firstDate = date;
      if (!pl.lastDate || date > pl.lastDate) pl.lastDate = date;
      const mo = pl.monthly[month] || (pl.monthly[month] = { games: 0, wins: 0, losses: 0 });
      mo.games++; isWin ? mo.wins++ : mo.losses++;
      // 按「日期 × 赛事」分桶：供「赛事 + 日期时间段」组合筛选的排行使用
      const key = date + '|' + m.event_id;
      const dy = pl.byDay[key] || (pl.byDay[key] = { date, event: m.event_id, games: 0, wins: 0, elo: 0 });
      dy.games++; if (isWin) dy.wins++;
      if (typeof m.elo_delta === 'number') dy.elo += isWin ? m.elo_delta : -m.elo_delta;
    }
    if (typeof m.elo_delta === 'number') {
      pl.eloNet += isWin ? m.elo_delta : -m.elo_delta;
      pl.eloGames++;
    }
    pl.matches.push({
      id: m.id, d: date, e: m.event_id, map: m.map_name,
      o: opp.player_id, or: opp.race, w: isWin ? 1 : 0,
      elo: typeof m.elo_delta === 'number' ? (isWin ? m.elo_delta : -m.elo_delta) : null,
      memo: m.memo || null,
      team: me.team_name || null, oteam: opp.team_name || null,
    });
  }
}

const wr = (w, g) => (g ? Math.round((w / g) * 1000) / 10 : 0);

/* ---------- 输出选手明细 ---------- */
await rm(path.join(OUT, 'players'), { recursive: true, force: true });
await mkdir(path.join(OUT, 'players'), { recursive: true });

const index = [];
const globalMonth = {};

for (const pl of P.values()) {
  if (pl.games === 0) continue;
  pl.matches.sort((x, y) => (y.d || '').localeCompare(x.d || '') || y.id - x.id);

  // 地图板块只保留本赛季地图（非本赛季地图不进 mapList，故前端所有地图区块自动收敛）
  const mapList = Object.entries(pl.byMap)
    .filter(([kr]) => isSeasonMap(kr))
    .map(([kr, v]) => ({
      kr, cn: mapCnOf(kr) || kr, ...v, wr: wr(v.wins, v.games),
    })).sort((a, b) => b.games - a.games);

  const raceList = Object.entries(pl.vsRace).map(([r, v]) => ({
    race: r, ...v, wr: wr(v.wins, v.games),
  })).sort((a, b) => b.games - a.games);

  const oppList = Object.entries(pl.vsOpp).map(([oid, v]) => {
    const o = P.get(Number(oid));
    return {
      id: Number(oid), name: o?.name || `#${oid}`, cn: o?.cn || null, idEn: o?.idEn || null,
      race: o?.race || null, avatar: o?.avatar || null, ...v, wr: wr(v.wins, v.games),
    };
  }).sort((a, b) => b.games - a.games);

  const recent = pl.matches.slice(0, 10);
  const recentWins = recent.filter((m) => m.w).length;

  const eventList = EVENTS.map((e) => {
    const v = pl.byEvent[e.id];
    return {
      id: e.id, name: e.name, nameZh: e.nameZh, nameCn: e.nameCn, short: e.short,
      games: v?.games || 0, wins: v?.wins || 0, losses: v?.losses || 0,
      wr: v ? wr(v.wins, v.games) : 0,
    };
  }).filter((e) => e.games > 0);

  const monthly = Object.entries(pl.monthly).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mo, v]) => ({ m: mo, ...v, wr: wr(v.wins, v.games) }));

  // 长期趋势：按月聚合，用于折线图
  const detail = {
    id: pl.id, name: pl.name, cn: pl.cn, idEn: pl.idEn, race: pl.race, elo: pl.elo, avatar: pl.avatar,
    college: pl.college, soop: pl.soop,
    careerWins: pl.careerWins, careerLosses: pl.careerLosses, lastPlayed: pl.lastPlayed,
    games: pl.games, wins: pl.wins, losses: pl.losses, wr: wr(pl.wins, pl.games),
    firstDate: pl.firstDate, lastDate: pl.lastDate,
    eloNet: pl.eloGames ? Math.round(pl.eloNet * 10) / 10 : null,
    events: eventList, maps: mapList, vsRace: raceList,
    opponents: oppList,
    recentWins, recentGames: recent.length,
    monthly,
    matches: pl.matches,
  };
  await writeFile(path.join(OUT, 'players', `${pl.id}.json`), JSON.stringify(detail));

  for (const mo of monthly) {
    const g = globalMonth[mo.m] || (globalMonth[mo.m] = { m: mo.m, games: 0, players: new Set() });
    g.games += mo.games;
    g.players.add(pl.id);
  }

  const ev = {};
  for (const e of EVENT_IDS) {
    const v = pl.byEvent[e];
    if (v) ev[e] = { g: v.games, w: v.wins, l: v.losses };
  }

  index.push({
    id: pl.id, name: pl.name, cn: pl.cn, idEn: pl.idEn, race: pl.race, elo: pl.elo, avatar: pl.avatar,
    college: pl.college,
    games: pl.games, wins: pl.wins, losses: pl.losses, wr: wr(pl.wins, pl.games),
    ev,
    firstDate: pl.firstDate, lastDate: pl.lastDate,
    recentWins, recentGames: recent.length,
    eloNet: pl.eloGames ? Math.round(pl.eloNet * 10) / 10 : null,
  });
}

index.sort((a, b) => b.games - a.games);

/* ---------- 地图榜：总场次 + 分种族对抗胜率（不展示选手出场数据） ---------- */
const maps = Object.values(mapAgg).map((g) => {
  const matchups = {};
  for (const label of MATCHUPS) {
    const mm = g.m2[label];
    matchups[label] = mm
      ? { g: mm.g, w1: mm.w1, w2: mm.w2, wr1: wr(mm.w1, mm.g) }
      : { g: 0, w1: 0, w2: 0, wr1: null };
  }
  return { kr: g.kr, cn: g.cn, games: g.games, mirror: g.mirror, unknownRace: g.unknownRace, matchups };
}).sort((a, b) => b.games - a.games);

// 自检：每张地图「三项异族对抗 + 同族 + 未标注种族」应等于总场次
for (const mp of maps) {
  const sum = MATCHUPS.reduce((a, k) => a + mp.matchups[k].g, 0) + mp.mirror + mp.unknownRace;
  if (sum !== mp.games) console.error(`✗ 地图 ${mp.kr} 对抗场次合计 ${sum} ≠ 总场次 ${mp.games}`);
}
const mapGamesTotal = maps.reduce((a, m) => a + m.games, 0);

/* ---------- 月度活动 ---------- */
const months = Object.values(globalMonth).map((g) => ({ m: g.m, games: g.games, players: g.players.size }))
  .sort((a, b) => a.m.localeCompare(b.m));

/* ---------- 赛事元信息 ---------- */
const eventMeta = EVENTS.map((e) => {
  const ms = matches.filter((m) => m.event_id === e.id);
  const dates = ms.map((m) => m.played_on).filter(Boolean).sort();
  const ps = new Set(ms.flatMap((m) => m.participants.map((p) => p.player_id)));
  return {
    id: e.id, name: e.name, nameZh: e.nameZh, nameCn: e.nameCn, short: e.short, shortCn: e.shortCn,
    matches: ms.length, players: ps.size, first: dates[0] || null, last: dates.at(-1) || null,
    url: `https://eloboard.com/events/${e.id}`,
  };
});

const allDates = matches.map((m) => m.played_on).filter(Boolean).sort();
const index_out = {
  meta: {
    builtAt: new Date().toISOString(),
    totalMatches: matches.length,
    totalPlayers: index.length,
    totalMaps: maps.length,
    first: allDates[0], last: allDates.at(-1),
    cutoff: CUTOFF,
    source: 'https://eloboard.com',
    scope: `仅统计 메이저 프로리그(43) / K리그(33) / 준메이저 프로리그(64) 三个赛事、且不早于 ${CUTOFF} 的比赛`,
    // 地图板块的展示范围（本赛季地图）
    season: {
      label: SEASON_LABEL,
      aliases: [...SEASON_MAP_ALIASES],
      maps: SEASON_MAP_ROWS.map((r) => ({ kr: r.kr[0], cn: r.cn, en: r.en })),
    },
    // 地图情报的种族对抗列（前者视角胜率）
    matchups: MATCHUPS,
  },
  events: eventMeta,
  mapCn: MAP_CN,
  raceCn: RACE_CN,
  months,
  players: index,
};

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index_out));
await writeFile(path.join(OUT, 'maps.json'), JSON.stringify(maps));

/* ---------- 按「日期 × 赛事」分桶（供时间段筛选，单独按需加载） ---------- */
const allDays = new Set();
for (const pl of P.values()) for (const b of Object.values(pl.byDay)) allDays.add(b.date);
const dayList = [...allDays].sort();
const dayIdx = new Map(dayList.map((d, i) => [d, i]));

const dailyP = {};
let bucketCount = 0;
for (const pl of P.values()) {
  if (pl.games === 0) continue;
  // [赛事id, 日期下标, 场次, 胜场, ELO净变]
  const buckets = Object.values(pl.byDay)
    .map((v) => [v.event, dayIdx.get(v.date), v.games, v.wins, Math.round(v.elo * 10) / 10])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  dailyP[pl.id] = buckets;
  bucketCount += buckets.length;
}
await writeFile(path.join(OUT, 'daily.json'), JSON.stringify({
  meta: { first: dayList[0], last: dayList.at(-1), days: dayList.length, buckets: bucketCount },
  days: dayList,
  p: dailyP,
}));
console.log('daily.json:', dayList.length, '天 /', bucketCount, '个日-赛事桶 /', Object.keys(dailyP).length, '名选手');
console.log('players written:', index.length);
console.log('meta:', JSON.stringify(index_out.meta));
console.log('events:', JSON.stringify(eventMeta));
console.log('top10:', index.slice(0, 10).map((p) => `${p.name}(${p.race}) ${p.games}场 ${p.wr}%`).join(' | '));
console.log('top maps:', maps.slice(0, 5).map((m) =>
  `${m.cn} ${m.games}场 [${MATCHUPS.map((k) => `${k} ${m.matchups[k].wr1 ?? '—'}%`).join(' ')} 同族${m.mirror}]`).join(' | '));
console.log('地图总场次:', mapGamesTotal, '| 同族合计:', maps.reduce((a, m) => a + m.mirror, 0));
console.log('months:', months.length, months[0]?.m, '~', months.at(-1)?.m);
