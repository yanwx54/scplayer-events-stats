/**
 * 构建聚合数据库。
 * 输入：data/raw/event-{43,33,64}.json、data/raw/players.json
 * 输出：public/data/index.json、public/data/players/{id}.json、public/data/maps.json
 *
 * 所有统计口径严格限定在三个赛事（43 / 33 / 64）的比赛数据内。
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');

const EVENTS = [
  { id: 43, name: '메이저 프로리그', nameCn: 'Major Pro League', short: '메프로', shortCn: 'Major' },
  { id: 33, name: 'K리그', nameCn: 'K League', short: 'K리그', shortCn: 'K League' },
  { id: 64, name: '준메이저 프로리그', nameCn: 'Semi-Major Pro League', short: '준메프로', shortCn: 'Semi-Major' },
];
const EVENT_IDS = EVENTS.map((e) => e.id);

/* ---------- 韩文地图名 → 中文名 ---------- */
const MAP_CN = {
  '옥타곤': '八角笼', '아이올로스': '艾洛斯', '오디세이': '奥德赛', '컬러리스 페이트': '无色命运',
  '녹아웃': '击倒', '백룸': '后室', '애티튜드': '态度', '폴리포이드': '波利波伊德', '폴스타': '极星',
  '네오 실피드': '新希尔菲德', '제인 도': '简·多', '매치포인트': '赛点', '라데온': '镭射',
  '메트로폴리스': '大都会', '투혼': '斗魂', '이클립스': '日蚀', '헬바운드': '地狱边界',
  '도미네이터': '支配者', '리트머스': '石蕊', '울돌목': '鸣梁', '데자 뷰': '似曾相识',
  '데스밸리': '死亡谷', '킥 백': '回踢', '판테온': '万神殿', '민스트렐': '吟游诗人',
  '버미어': '朱红', '몬티홀': '蒙提霍尔', '아포칼립스': '天启', '레트로': '复古',
  '블리츠Y': '闪电Y', '시타델': '堡垒', '네오 다크 오리진': '新黑暗起源', '트로이': '特洛伊',
  '라 캄파넬라': '钟声', '인베이더': '入侵者', '템페스트': '暴风雨', '다크 오리진': '黑暗起源',
  '챔피언': '冠军', '슈팅브레이크': '射击突破', '네메시스': '复仇女神', '단장의능선': '断肠岭',
  '버터': '黄油', '76': '76', '오버워치': '守望先锋', '써킷': '电路', '리볼버': '左轮',
  '더 블레싱': '祝福', '뉴런': '神经元', '레드 이글': '红鹰', '알레그로': '快板',
  '네오 알카노이드': '新打砖块', '메타버스': '元宇宙', '프로스트': '霜冻', '폴아웃': '辐射',
  '굿나잇': '晚安', '라르고': '广板', '어센션': '升天', '모노폴리': '垄断',
  '제이드': '翡翠', '실피드': '希尔菲德', '화이트아웃': '白茫茫', '아웃사이더': '局外人',
  '일렉트릭서킷': '电子电路', '레몬': '柠檬', '아즈텍': '阿兹特克', '라만차': '拉曼查',
  '저격능선': '狙击岭', '파이썬': '蟒蛇', '링잉블룸': '响铃花', '얼티메이트스트림': '终极流',
  '히든트랙': '隐秘赛道', '폴라리스랩소디': '北极星狂想曲', '에스컬레이드': '升级',
  '중원': '中原', '네오 홀 오브 발할라': '新英灵殿', '머큐리': '水星', '데스페라도': '亡命徒',
  '네오 정글 스토리': '新丛林故事', '네오아즈텍': '新阿兹特克', '안드로메다': '仙女座',
  '타우크로스': '十字星', '서킷브레이커': '断路器', '벤젠': '苯', '트라이애슬론': '铁人三项',
};

const RACE_CN = { T: '人族', Z: '虫族', P: '神族' };

/* ---------- 载入 ---------- */
const players = JSON.parse(await readFile(path.join(RAW, 'players.json'), 'utf8'));
const matches = [];
for (const e of EVENT_IDS) {
  const arr = JSON.parse(await readFile(path.join(RAW, `event-${e}.json`), 'utf8'));
  for (const m of arr) matches.push(m);
}
console.log('loaded matches:', matches.length);

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
    byEvent: {}, byMap: {}, vsRace: {}, vsOpp: {},
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
      id: p.player_id, name: p.name, race: p.race, elo: null, avatar: null, college: null, soop: null,
      careerWins: null, careerLosses: null, lastPlayed: null,
      games: 0, wins: 0, losses: 0, byEvent: {}, byMap: {}, vsRace: {}, vsOpp: {},
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
for (const m of matches) {
  const [a, b] = m.participants;
  const date = m.played_on || null;
  const month = date ? date.slice(0, 7) : null;
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
const globalMap = {};
const globalMonth = {};

for (const pl of P.values()) {
  if (pl.games === 0) continue;
  pl.matches.sort((x, y) => (y.d || '').localeCompare(x.d || '') || y.id - x.id);

  const mapList = Object.entries(pl.byMap).map(([kr, v]) => ({
    kr, cn: MAP_CN[kr] || kr, ...v, wr: wr(v.wins, v.games),
  })).sort((a, b) => b.games - a.games);

  const raceList = Object.entries(pl.vsRace).map(([r, v]) => ({
    race: r, ...v, wr: wr(v.wins, v.games),
  })).sort((a, b) => b.games - a.games);

  const oppList = Object.entries(pl.vsOpp).map(([oid, v]) => {
    const o = P.get(Number(oid));
    return {
      id: Number(oid), name: o?.name || `#${oid}`, race: o?.race || null,
      avatar: o?.avatar || null, ...v, wr: wr(v.wins, v.games),
    };
  }).sort((a, b) => b.games - a.games);

  const recent = pl.matches.slice(0, 10);
  const recentWins = recent.filter((m) => m.w).length;

  const eventList = EVENTS.map((e) => {
    const v = pl.byEvent[e.id];
    return {
      id: e.id, name: e.name, nameCn: e.nameCn, short: e.short,
      games: v?.games || 0, wins: v?.wins || 0, losses: v?.losses || 0,
      wr: v ? wr(v.wins, v.games) : 0,
    };
  }).filter((e) => e.games > 0);

  const monthly = Object.entries(pl.monthly).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mo, v]) => ({ m: mo, ...v, wr: wr(v.wins, v.games) }));

  // 长期趋势：按月聚合，用于折线图
  const detail = {
    id: pl.id, name: pl.name, race: pl.race, elo: pl.elo, avatar: pl.avatar,
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

  for (const m of pl.matches) {
    if (!m.map) continue;
    const g = globalMap[m.map] || (globalMap[m.map] = { kr: m.map, cn: MAP_CN[m.map] || m.map, games: 0, players: {} });
    g.games++;
    g.players[pl.id] = (g.players[pl.id] || 0) + 1;
  }
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
    id: pl.id, name: pl.name, race: pl.race, elo: pl.elo, avatar: pl.avatar,
    college: pl.college,
    games: pl.games, wins: pl.wins, losses: pl.losses, wr: wr(pl.wins, pl.games),
    ev,
    firstDate: pl.firstDate, lastDate: pl.lastDate,
    recentWins, recentGames: recent.length,
    eloNet: pl.eloGames ? Math.round(pl.eloNet * 10) / 10 : null,
  });
}

index.sort((a, b) => b.games - a.games);

/* ---------- 地图榜 ---------- */
const maps = Object.values(globalMap).map((g) => {
  const top = Object.entries(g.players)
    .map(([id, games]) => ({ id: Number(id), games }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5)
    .map((x) => ({ ...x, name: P.get(x.id)?.name, race: P.get(x.id)?.race }));
  return { kr: g.kr, cn: g.cn, games: g.games, players: Object.keys(g.players).length, top };
}).sort((a, b) => b.games - a.games);

/* ---------- 月度活动 ---------- */
const months = Object.values(globalMonth).map((g) => ({ m: g.m, games: g.games, players: g.players.size }))
  .sort((a, b) => a.m.localeCompare(b.m));

/* ---------- 赛事元信息 ---------- */
const eventMeta = EVENTS.map((e) => {
  const ms = matches.filter((m) => m.event_id === e.id);
  const dates = ms.map((m) => m.played_on).filter(Boolean).sort();
  const ps = new Set(ms.flatMap((m) => m.participants.map((p) => p.player_id)));
  return {
    id: e.id, name: e.name, nameCn: e.nameCn, short: e.short, shortCn: e.shortCn,
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
    source: 'https://eloboard.com',
    scope: '仅统计 메이저 프로리그(43) / K리그(33) / 준메이저 프로리그(64) 三个赛事的比赛',
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
console.log('players written:', index.length);
console.log('meta:', JSON.stringify(index_out.meta));
console.log('events:', JSON.stringify(eventMeta));
console.log('top10:', index.slice(0, 10).map((p) => `${p.name}(${p.race}) ${p.games}场 ${p.wr}%`).join(' | '));
console.log('top maps:', maps.slice(0, 5).map((m) => `${m.cn} ${m.games}`).join(' | '));
console.log('months:', months.length, months[0]?.m, '~', months.at(-1)?.m);
