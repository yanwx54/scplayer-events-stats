/**
 * 网页抓取兜底源。
 *
 * eloboard.com 的 `/api/*` 在 2026-11-05 之后开始返回 403（nginx），
 * 但服务端渲染的网页仍然完整可读，且携带与 API 等价的数据：
 *   - `/events/{id}?tab=results&rk=team`      团队赛日列表（日期 / 标题 / 队伍 / 场次数）
 *   - `/events/{id}?tab=results&rk=team&day=N` 单日详情（阵容、每盘地图 / 选手 / 胜负、match id）
 *   - `/events/{id}?tab=results`               个人赛最近 30 场（duels，含每盘 match id）
 *
 * 这里只做解析，不落盘；合并/重建仍由 sync.mjs 负责。
 */

export const EVENT_NAMES = {
  43: '메이저 프로리그',
  33: 'K리그',
  64: '준메이저 프로리그',
};

const BASE = 'https://eloboard.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带重试的网页抓取（403 会直接抛错，由调用方决定是否降级） */
export async function fetchText(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(700 * i);
    }
  }
}

/** 把 Next.js 的 `self.__next_f.push([1,"..."])` 片段拼回 RSC 文本 */
function rscText(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* 个别片段不是合法 JSON 字符串，跳过 */
    }
  }
  return out.join('');
}

/** 从文本里截取某个 key 对应的 JSON 数组（按括号配对，忽略字符串内的括号） */
function extractArray(text, key) {
  const marker = `"${key}":[`;
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  return null;
}

const decode = (s) =>
  String(s || '')
    .replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------- 团队赛日列表 ---------- */

export function parseBoardRows(html) {
  const rows = [];
  const re =
    /<a class="events-module__dIbM2a__brow" href="\/events\/(\d+)\?tab=results&amp;day=(\d+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[3];
    const dateText = decode((inner.match(/__bdate">([^<]*)</) || [])[1] || '');
    const date = dateText.slice(0, 10).replace(/\./g, '-');
    const title = decode((inner.match(/__btitle">([^<]*)</) || [])[1] || '');
    const teams = [...inner.matchAll(/title="([^"]*)"/g)].map((x) => decode(x[1]));
    const games = Number((inner.match(/__bnum">(\d+)</) || [])[1] || 0);
    rows.push({ day: Number(m[2]), date, title, teams, games });
  }
  return rows;
}

/* ---------- 单日详情 ---------- */

function parseRosters(html) {
  const map = new Map();
  const teams = [];
  const re = /<div class="events-module__dIbM2a__roster"><b>\[<!-- -->(.*?)<!-- -->\]<\/b>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const team = decode(m[1]);
    const players = [...m[2].matchAll(/href="\/players\/(\d+)">([^<]*)<\/a>/g)].map((x) => ({
      id: Number(x[1]),
      name: decode(x[2]),
    }));
    teams.push(team);
    for (const p of players) if (!map.has(p.id)) map.set(p.id, team);
  }
  return { map, teams };
}

function parseSections(html) {
  const sections = [];
  const re =
    /<section class="events-module__dIbM2a__set"><h4 class="events-module__dIbM2a__setHd">([\s\S]*?)<\/h4><ol class="events-module__dIbM2a__games">([\s\S]*?)<\/ol><\/section>/g;
  const gameRe =
    /<span class="events-module__dIbM2a__gname events-module__dIbM2a__(gleft|gright) events-module__dIbM2a__(gwin|glose)"><a class="events-module__dIbM2a__who" href="\/players\/(\d+)"><i class="race ([ZPT])">[ZPT]<\/i><span class="events-module__dIbM2a__nm">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const head = decode(m[1].replace(/<\/?span[^>]*>/g, ' '));
    const lis = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
    const games = lis.map((li) => {
      const gno = Number((li.match(/__gno">(\d+)</) || [])[1] || 0);
      const mapName = decode((li.match(/__gmapName">([^<]*)</) || [])[1] || '');
      const mapImage = (li.match(/__gmapImg" src="https:\/\/eloboard.com\/static\/([^"]+)"/) || [])[1] || null;
      const names = [...li.matchAll(gameRe)].map((x) => ({
        side: x[1],
        result: x[2],
        id: Number(x[3]),
        race: x[4],
        name: decode(x[5]),
      }));
      const left = names.find((x) => x.side === 'gleft') || null;
      const right = names.find((x) => x.side === 'gright') || null;
      return { gno, mapName, mapImage, left, right };
    });
    sections.push({ label: head, games });
  }
  return sections;
}

/** RSC 里每个「N경기 추가 정보」组件都以 match id 为 key，顺带把该盘地图/选手解析出来 */
function parseGameIds(rsc) {
  const re = /"\$[A-Za-z0-9]+","(\d{6,})",\{"panelClass":"[^"]*","label":"(\d+)경기 추가 정보"/g;
  const hits = [];
  let m;
  while ((m = re.exec(rsc))) hits.push({ at: m.index, id: Number(m[1]), label: Number(m[2]) });

  return hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : Math.min(rsc.length, h.at + 2500);
    const seg = rsc.slice(h.at, end);
    const map = (seg.match(/__gmapName","children":"([^"]+)"/) || [])[1] || null;
    const pids = [...seg.matchAll(/"href":"\/players\/(\d+)"/g)].map((x) => Number(x[1]));
    const wl = [...seg.matchAll(/__gname events-module__dIbM2a__g(left|right) events-module__dIbM2a__g(win|lose)/g)]
      .map((x) => x[1] + ':' + x[2]);
    return { id: h.id, label: h.label, map, p1: pids[0], p2: pids[1], wl };
  });
}

const setKindOf = (label, idx) => {
  if (/슈퍼|에이스/.test(label)) return 'super_ace';
  if (/위너/.test(label)) return 'winners';
  if (idx === 1) return 'solo';
  return idx === 3 ? 'super_ace' : 'winners';
};

function buildDayRecords(html, ctx) {
  const rsc = rscText(html);
  const rosters = parseRosters(html);
  const ids = parseGameIds(rsc);
  const sections = parseSections(html);
  const out = [];
  const usedIds = new Set();

  sections.forEach((sec, si) => {
    const setNo = si + 1;
    const kind = setKindOf(sec.label, setNo);
    sec.games.forEach((g) => {
      const pair = [g.left && g.left.id, g.right && g.right.id];
      const keyOf = (x) => `${x.label}|${x.map}|${x.p1}|${x.p2}`;
      const want = [`${g.gno}|${g.mapName}|${pair[0]}|${pair[1]}`, `${g.gno}|${g.mapName}|${pair[1]}|${pair[0]}`];
      let hit = ids.find((x) => want.includes(keyOf(x)));
      if (!hit) {
        hit = ids.find(
          (x) =>
            x.map === g.mapName &&
            ((x.p1 === pair[0] && x.p2 === pair[1]) || (x.p1 === pair[1] && x.p2 === pair[0]))
        );
      }
      if (!hit || !g.left || !g.right) {
        console.warn(
          `    ⚠ 跳过无法识别的一盘：第${setNo}세트 ${g.gno}경기 ${g.mapName || '?'} ${pair.join(' vs ')}`
        );
        return;
      }
      usedIds.add(hit.id);

      const leftWin = g.left.result === 'gwin';
      const rightWin = g.right.result === 'gwin';
      if (!leftWin && !rightWin) {
        console.warn(`    ⚠ 第${setNo}세트 ${g.gno}경기 没有胜方标记，跳过`);
        return;
      }
      const winner = leftWin ? g.left : g.right;
      const loser = leftWin ? g.right : g.left;
      const mapImage = g.mapImage || null;
      const mapId = Number((mapImage || '').match(/maps\/(\d+)/)?.[1] || 0);
      const [teamA, teamB] = [ctx.teams[0], ctx.teams[1]];

      out.push({
        id: hit.id,
        division: 'men',
        played_on: ctx.date,
        map_id: mapId,
        map_name: g.mapName,
        map_raw: null,
        map_image: mapImage,
        event_id: ctx.eventId,
        event_name: ctx.eventName,
        category: 'pro_league',
        round_label: null,
        series: null,
        set_no: null,
        format_raw: '단판',
        elo_delta: null, // 网页不提供 ELO 变动；build-db 会按「未结算」处理
        team_set_no: setNo,
        team_set_kind: kind,
        team_game_no: g.gno,
        memo:
          `${ctx.eventName} ${ctx.title} ${teamA}vs${teamB}` +
          (setNo === 2 ? ' (2)' : setNo === 3 ? ' 에이스 결정전' : ''),
        created_by_nickname: null,
        details: null,
        participants: [
          {
            player_id: winner.id,
            name: winner.name,
            race: winner.race,
            result: 'win',
            team_name: rosters.map.get(winner.id) || null,
            team_college_id: null,
          },
          {
            player_id: loser.id,
            name: loser.name,
            race: loser.race,
            result: 'loss',
            team_name: rosters.map.get(loser.id) || null,
            team_college_id: null,
          },
        ],
      });
    });
  });

  const unused = ids.filter((x) => !usedIds.has(x.id));
  if (unused.length) {
    console.warn(`    ⚠ ${unused.length} 盘未匹配到 match id（可能页面结构有变）：${unused.map((x) => x.id).join(',')}`);
  }
  return out;
}

/* ---------- 个人赛（duels） ---------- */

function soloRecords(html, ctx, raceById) {
  const duels = JSON.parse((extractArray(rscText(html), 'duels') || '[]').replace(/"\$undefined"/g, 'null'));
  const out = [];
  for (const d of duels) {
    if (!d.day || d.day <= ctx.lastDate) continue;
    for (const s of d.sets || []) {
      if (!s.match_id) continue;
      out.push({
        id: s.match_id,
        division: 'men',
        played_on: d.day,
        map_id: s.map_id,
        map_name: s.map_name,
        map_raw: null,
        map_image: s.map_image,
        event_id: ctx.eventId,
        event_name: ctx.eventName,
        category: 'pro_league',
        round_label: null,
        series: null,
        set_no: null,
        format_raw: (d.context || '').split(' · ')[0] || '단판',
        elo_delta: null,
        team_set_no: null,
        team_set_kind: null,
        team_game_no: null,
        memo: `${ctx.eventName} ${d.a}vs${d.b}`,
        created_by_nickname: null,
        details: null,
        participants: [
          {
            player_id: s.winner_id,
            name: s.winner,
            race: raceById?.get(s.winner_id) || null,
            result: 'win',
            team_name: null,
            team_college_id: null,
          },
          {
            player_id: s.loser_id,
            name: s.loser,
            race: raceById?.get(s.loser_id) || null,
            result: 'loss',
            team_name: null,
            team_college_id: null,
          },
        ],
      });
    }
  }
  return out;
}

/* ---------- 对外入口 ---------- */

/**
 * 从网页抓取某赛事的最新对局。
 * @param {number} eventId 43 / 33 / 64
 * @param {{ lastDate?: string, raceById?: Map<number,string> }} opts
 *        lastDate：本地已有的最新日期（只抓它之后的比赛）
 * @returns {Promise<{matches: object[], fetched: number}>}
 */
export async function fetchEventViaHtml(eventId, opts = {}) {
  const lastDate = opts.lastDate || '';
  const eventName = EVENT_NAMES[eventId] || `event-${eventId}`;
  const matches = new Map();
  let fetched = 0;

  // 1) 团队赛：按「日」拉取详情
  const boardHtml = await fetchText(`${BASE}/events/${eventId}?tab=results&rk=team`);
  const rows = parseBoardRows(boardHtml).filter((r) => r.date && r.date > lastDate);
  for (const row of rows) {
    const dayHtml = await fetchText(`${BASE}/events/${eventId}?tab=results&rk=team&day=${row.day}`);
    const recs = buildDayRecords(dayHtml, {
      eventId,
      eventName,
      date: row.date,
      title: row.title,
      teams: row.teams,
    });
    fetched++;
    for (const m of recs) matches.set(m.id, m);
    await sleep(200);
  }

  // 2) 个人赛：赛事页默认 tab 里的最近 duels
  try {
    const soloHtml = await fetchText(`${BASE}/events/${eventId}?tab=results`);
    for (const m of soloRecords(soloHtml, { eventId, eventName, lastDate }, opts.raceById)) {
      if (!matches.has(m.id)) matches.set(m.id, m);
    }
  } catch (e) {
    console.warn(`    ⚠ 个人赛页面解析失败（${e.message}）`);
  }

  return { matches: [...matches.values()], fetched: rows.length };
}
