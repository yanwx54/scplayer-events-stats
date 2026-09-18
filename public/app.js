/* ============================================================
   SC 赛事选手数据查询
   数据口径：仅 eloboard 三大赛事
     43 메이저 프로리그 / 33 K리그 / 64 준메이저 프로리그
   ============================================================ */

const EVENTS = {
  43: { id: 43, name: '메이저 프로리그', zh: '职业联赛', cn: 'Major Pro League', short: 'Major', color: '#3d5afe' },
  33: { id: 33, name: 'K리그', zh: 'K联赛', cn: 'K League', short: 'K League', color: '#12a150' },
  64: { id: 64, name: '준메이저 프로리그', zh: '半职业联赛', cn: 'Semi-Major Pro League', short: 'Semi-Major', color: '#d99a00' },
};
/** 赛事中文名（韩文原名作为小号灰字并列） */
function evHTML(id) {
  const e = EVENTS[id];
  if (!e) return '';
  return `<b>${esc(e.zh)}</b><span class="kr-name">${esc(e.name)}</span>`;
}
const evZh = (id) => EVENTS[id]?.zh || '';
const RACE_CN = { T: '人族', Z: '虫族', P: '神族' };
const RACE_EN = { T: 'Terran', Z: 'Zerg', P: 'Protoss' };

const state = {
  index: null,
  maps: null,
  daily: null,
  playerCache: new Map(),
  playerSort: { key: 'games', dir: -1 },
  playerFilter: { event: 0, race: '', q: '', min: 0, from: null, to: null },
  detailTab: 'overview',
  detailPage: 0,
  h2h: { a: null, b: null, from: null, to: null },
};

let P_BY_ID = new Map();      // id → 选手索引项（含 cn / idEn）
let SEASON_MAPS = new Set();  // 本赛季地图的全部韩文别名（地图板块只展示这些）

/* ---------- 工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const pct = (n) => (n == null ? '—' : n.toFixed(1) + '%');

function racePill(r, small) {
  if (!r) return '<span class="pill gray">未知</span>';
  return `<span class="pill ${r.toLowerCase()}">${RACE_CN[r]} ${r}</span>`;
}
function avatar(p, cls = 'av') {
  return p.avatar
    ? `<img class="${cls}" src="${p.avatar}" alt="" loading="lazy">`
    : `<span class="${cls}" style="display:grid;place-items:center;color:#8b95a7;font-size:11px;font-weight:700">${esc((p.name || '?').slice(0, 1))}</span>`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 1800);
}
function fmtDate(d) { return d || '—'; }

/* ---------- 选手名：文档内用中文名，其余保留韩文原名 ---------- */
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
/** 展示名：有中文名用中文名，否则用韩文原名 */
const dispName = (p) => (p ? (p.cn || p.name || '') : '');
/** 中文名 + 小号韩文原名（无中文名时只显示韩文）；悬停可见 韩文名 / 英文 ID */
function nameHTML(p) {
  if (!p) return '';
  const cn = p.cn, kr = p.name || '';
  const tip = esc([kr, p.idEn].filter(Boolean).join(' / '));
  if (!cn || cn === kr) return `<b title="${tip}">${esc(kr)}</b>`;
  return `<b title="${tip}">${esc(cn)}</b><span class="kr-name" title="${tip}">${esc(kr)}</span>`;
}
/** 选手搜索：支持 韩文名 / 中文名 / 英文 ID / 数字 ID */
function matchPlayer(p, q) {
  if (!p) return false;
  const s = String(q ?? '').trim();
  if (!s) return true;
  if (String(p.id) === s) return true;
  const n = norm(s);
  return norm(p.name).includes(n)
    || (!!p.cn && norm(p.cn).includes(n))
    || (!!p.idEn && norm(p.idEn).includes(n));
}
/** 地图名：中文名 + 小号韩文（未收录译名时只显示韩文） */
function mapHTML(cn, kr) {
  const c = cn || kr || '未知地图', k = kr || '';
  return k && c !== k
    ? `<b>${esc(c)}</b><span class="kr-name">${esc(k)}</span>`
    : `<b>${esc(c)}</b>`;
}
const mapCn = (kr) => state.index?.mapCn?.[kr] || kr || '未知地图';

/** 对局记录中的地图标签：中文名 + 小号韩文；非本赛季地图额外标注 */
function mapTag(kr) {
  const c = mapCn(kr), k = kr || '';
  const season = !k || SEASON_MAPS.has(k);
  const krPart = k && c !== k ? `<span class="kr-name">${esc(k)}</span>` : '';
  return `<span class="mapname"${season ? '' : ' title="非本赛季地图，不计入地图统计"'}>· ${esc(c)}${krPart}${season ? '' : ' <span class="muted">·非本赛季</span>'}</span>`;
}
/** 地图搜索文本（韩文 + 中文） */
const mapSearchText = (kr) => norm(`${kr || ''} ${mapCn(kr)}`);

/* ---------- 数据加载 ---------- */
async function loadIndex() {
  if (state.index) return state.index;
  const [idx, maps] = await Promise.all([
    fetch('data/index.json').then((r) => r.json()),
    fetch('data/maps.json').then((r) => r.json()),
  ]);
  state.index = idx;
  state.maps = maps;
  P_BY_ID = new Map(idx.players.map((p) => [p.id, p]));
  SEASON_MAPS = new Set(idx.meta.season?.aliases || []);
  return idx;
}
async function loadPlayer(id) {
  id = Number(id);
  if (state.playerCache.has(id)) return state.playerCache.get(id);
  const d = await fetch(`data/players/${id}.json`).then((r) => r.json());
  state.playerCache.set(id, d);
  return d;
}
async function loadDaily() {
  if (state.daily) return state.daily;
  state.daily = await fetch('data/daily.json').then((r) => r.json());
  return state.daily;
}

/* ============================================================
   日期时间段
   ============================================================ */
const RANGE_PRESETS = [
  ['all', '全部'],
  ['30', '近 30 天'],
  ['90', '近 90 天'],
  ['180', '近半年'],
  ['365', '近 1 年'],
];

/** days 中第一个 >= date 的下标 */
function lowerBound(days, date) {
  let lo = 0, hi = days.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] < date) lo = m + 1; else hi = m; }
  return lo;
}
/** days 中最后一个 <= date 的下标 */
function upperBound(days, date) {
  let lo = 0, hi = days.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] <= date) lo = m + 1; else hi = m; }
  return lo - 1;
}

/**
 * 在某个选手的分日桶上求和。
 * buckets 形如 [[赛事id, 日期下标, 场次, 胜场, ELO净变], …] 按日期下标升序。
 * eventId 为 0/null 表示不限赛事。
 */
function sumBuckets(buckets, lo, hi, eventId) {
  let g = 0, w = 0, elo = 0;
  if (buckets) {
    for (const [e, d, gg, ww, ee] of buckets) {
      if (eventId && e !== eventId) continue;
      if (d < lo || d > hi) continue;
      g += gg; w += ww; elo += ee;
    }
  }
  return {
    games: g, wins: w, losses: g - w,
    wr: g ? Math.round((w / g) * 1000) / 10 : 0,
    eloNet: Math.round(elo * 10) / 10,
  };
}

function rangeBarHTML(id, from, to, first, last) {
  return `
    <div class="filters range-bar" id="${id}">
      <div class="seg" data-role="presets">
        ${RANGE_PRESETS.map(([k, t]) => `<button data-range="${k}">${t}</button>`).join('')}
      </div>
      <div class="range-inputs">
        <input type="date" data-role="from" min="${first}" max="${last}" value="${from}">
        <span class="range-sep">~</span>
        <input type="date" data-role="to" min="${first}" max="${last}" value="${to}">
      </div>
      <span class="count" data-role="info"></span>
    </div>`;
}

/**
 * 绑定日期区间控件。
 * onApply(from, to) 在区间变化时被调用（from/to 为 YYYY-MM-DD）。
 */
function bindRangeBar(rootId, first, last, getRange, onApply) {
  const root = $('#' + rootId);
  if (!root) return;
  const fromEl = root.querySelector('[data-role="from"]');
  const toEl = root.querySelector('[data-role="to"]');
  const infoEl = root.querySelector('[data-role="info"]');
  const presetsEl = root.querySelector('[data-role="presets"]');

  const shiftDays = (n) => {
    const d = new Date(last + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    const s = d.toISOString().slice(0, 10);
    return s < first ? first : s;
  };

  const sync = () => {
    const { from, to } = getRange();
    fromEl.value = from; toEl.value = to;
    const isAll = from <= first && to >= last;
    $$('button', presetsEl).forEach((b) => {
      const k = b.dataset.range;
      const on = k === 'all'
        ? isAll
        : !isAll && from === shiftDays(Number(k)) && to >= last;
      b.classList.toggle('on', on);
    });
    if (infoEl) {
      infoEl.textContent = isAll
        ? `全部 ${first} ~ ${last}`
        : `${from} ~ ${to}`;
    }
  };

  presetsEl.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.range;
    const from = k === 'all' ? first : shiftDays(Number(k));
    onApply(from, last);
    sync();
  };
  const commit = () => {
    let from = fromEl.value || first;
    let to = toEl.value || last;
    if (from > to) { [from, to] = [to, from]; }
    onApply(from, to);
    sync();
  };
  fromEl.onchange = commit;
  toEl.onchange = commit;
  sync();
}

/** 判断区间是否覆盖全部数据 */
function isFullRange(from, to, first, last) {
  return from <= first && to >= last;
}

/* ============================================================
   路由
   ============================================================ */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { parts, params };
}

async function route() {
  const { parts, params } = parseHash();
  const page = parts[0] || 'home';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
  const app = $('#app');
  try {
    if (page === 'home') await viewHome(app);
    else if (page === 'players') await viewPlayers(app, params);
    else if (page === 'player') await viewPlayer(app, parts[1], params);
    else if (page === 'h2h') await viewH2H(app, params);
    else if (page === 'maps') await viewMaps(app);
    else { location.hash = '#/'; return; }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ============================================================
   总览
   ============================================================ */
async function viewHome(app) {
  const idx = await loadIndex();
  const m = idx.meta;
  const top = [...idx.players].sort((a, b) => b.games - a.games).slice(0, 12);
  const best = [...idx.players].filter((p) => p.games >= 300).sort((a, b) => b.wr - a.wr).slice(0, 8);
  const eloTop = [...idx.players].filter((p) => p.elo && p.games >= 100).sort((a, b) => b.elo - a.elo).slice(0, 8);

  app.innerHTML = `
  <section class="hero">
    <h1>韩国星际职业选手数据查询</h1>
    <p>数据口径严格限定在 eloboard 三大赛事：<b>职业联赛</b>（메이저 프로리그 / Major Pro League）、
       <b>K联赛</b>（K리그 / K League）、<b>半职业联赛</b>（준메이저 프로리그 / Semi-Major Pro League），
       且<b>仅统计 ${esc(m.cutoff || '')} 之后</b>的比赛。
       全部战绩、地图与对抗统计均基于这三个赛事的 ${nf(m.totalMatches)} 场对局重新计算；
       地图板块仅展示<b>本赛季（${esc(m.season?.label || '')}）</b>地图。</p>
    <div class="hero-stats">
      <div class="hero-stat"><b>${nf(m.totalMatches)}</b><span>对局总数</span></div>
      <div class="hero-stat"><b>${nf(m.totalPlayers)}</b><span>参赛选手</span></div>
      <div class="hero-stat"><b>${nf(m.totalMaps)}</b><span>本赛季地图</span></div>
      <div class="hero-stat"><b>${esc(m.first)}<br>${esc(m.last)}</b><span>数据跨度</span></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>赛事分布</h2><span class="sub">点击进入该赛事排行</span></div>
    <div class="grid c3">
      ${idx.events.map((e) => `
        <a class="card event-card" href="#/players?event=${e.id}">
          <div class="eid">EVENT ${e.id}</div>
          <h3>${esc(e.nameZh || e.name)}</h3>
          <div class="en">${esc(e.name)} · ${esc(e.cn)}</div>
          <div class="erow">
            <div><b>${nf(e.matches)}</b><span>对局</span></div>
            <div><b>${nf(e.players)}</b><span>选手</span></div>
            <div><b style="font-size:12px">${esc(e.first)}<br>${esc(e.last)}</b><span>时间跨度</span></div>
          </div>
        </a>`).join('')}
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>出场次数 TOP 12</h2><a class="sub" href="#/players">查看完整排行 →</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>选手</th><th>种族</th><th class="num">出场</th><th class="num">胜</th><th class="num">负</th><th class="num">胜率</th><th class="num">官方 ELO</th></tr></thead>
      <tbody>${top.map((p, i) => `
        <tr class="clickable" onclick="location.hash='#/player/${p.id}'">
          <td><span class="rank">${i + 1}</span></td>
          <td><div class="pname">${avatar(p)}${nameHTML(p)}</div></td>
          <td>${racePill(p.race)}</td>
          <td class="num">${nf(p.games)}</td>
          <td class="num" style="color:var(--win)">${nf(p.wins)}</td>
          <td class="num" style="color:var(--loss)">${nf(p.losses)}</td>
          <td class="num">${wrCell(p.wr)}</td>
          <td class="num">${p.elo ? p.elo.toFixed(1) : '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </section>

  <section class="section">
    <div class="grid c3">
      <div>
        <div class="section-head"><h2>胜率榜</h2><span class="sub">≥300 场</span></div>
        <div class="card">${miniList(best, (p) => pct(p.wr))}</div>
      </div>
      <div>
        <div class="section-head"><h2>官方 ELO 榜</h2><span class="sub">≥100 场 · 站点当前值</span></div>
        <div class="card">${miniList(eloTop, (p) => p.elo.toFixed(1))}</div>
      </div>
      <div>
        <div class="section-head"><h2>热门地图</h2><a class="sub" href="#/maps">全部 →</a></div>
        <div class="card">${miniList(
          state.maps.slice(0, 8).map((mp) => ({ id: mp.kr, name: `${mp.cn}`, race: null, _v: nf(mp.games), _sub: mp.kr })),
          (x) => x._v
        )}</div>
      </div>
    </div>
  </section>`;

  $('#builtAt').textContent = `数据构建于 ${new Date(m.builtAt).toLocaleString('zh-CN')}`;
}

function miniList(list, valFn) {
  return `<div class="mlist">${list.map((p, i) => `
    <div class="mrow" style="grid-template-columns:26px 1fr auto" ${p.avatar !== undefined ? `onclick="location.hash='#/player/${p.id}'" style="cursor:pointer"` : ''}>
      <span class="rank">${i + 1}</span>
      <div>${p.avatar !== undefined
        ? `<div class="who">${nameHTML(p)}${p.race ? racePill(p.race) : ''}</div>`
        : `<div class="who"><b>${esc(p.name)}</b><span class="muted" style="font-size:11.5px">${esc(p._sub || '')}</span></div>`}</div>
      <span class="num" style="font-weight:600">${valFn(p)}</span>
    </div>`).join('')}</div>`;
}

function wrCell(wr) {
  const cls = wr >= 55 ? 'hi' : wr < 45 ? 'lo' : '';
  return `<span class="wrbar"><span class="bar"><i class="${cls}" style="width:${Math.min(100, wr)}%"></i></span>${wr.toFixed(1)}%</span>`;
}

/* ============================================================
   选手排行
   ============================================================ */
async function viewPlayers(app, params) {
  const idx = await loadIndex();
  const daily = await loadDaily();
  // URL 为唯一事实来源：带 ?event= 则采用，否则一律回到「全部赛事」
  // （否则从首页事件卡片 #/players?event=43 进入后，再点导航「选手排行」会残留筛选）
  const evParam = Number(params.get('event'));
  state.playerFilter.event = Number.isInteger(evParam) && evParam > 0 ? evParam : 0;
  const f = state.playerFilter;
  const FIRST = idx.meta.first, LAST = idx.meta.last;
  if (!f.from) f.from = FIRST;
  if (!f.to) f.to = LAST;

  app.innerHTML = `
    <div class="section-head"><h2>选手排行</h2><span class="sub">共 ${nf(idx.players.length)} 名选手 · 点击表头排序</span></div>
    <div class="filters">
      <div class="seg" id="segEvent">
        <button data-ev="0" class="${f.event === 0 ? 'on' : ''}">全部赛事</button>
        ${idx.events.map((e) => `<button data-ev="${e.id}" title="${esc(e.name)}" class="${f.event === e.id ? 'on' : ''}">${esc(e.nameZh || e.name)}</button>`).join('')}
      </div>
      <div class="seg race" id="segRace">
        <button data-race="" class="${f.race === '' ? 'on' : ''}">全部种族</button>
        <button data-race="T" class="${f.race === 'T' ? 'on' : ''}">人族 T</button>
        <button data-race="Z" class="${f.race === 'Z' ? 'on' : ''}">虫族 Z</button>
        <button data-race="P" class="${f.race === 'P' ? 'on' : ''}">神族 P</button>
      </div>
      <input type="search" id="q" placeholder="搜索选手（中文 / 韩文 / 英文 ID）…" value="${esc(f.q)}" style="min-width:230px">
      <div class="seg" id="segMin">
        ${[[0, '全部'], [100, '≥100场'], [500, '≥500场'], [1000, '≥1000场']].map(([v, t]) =>
    `<button data-min="${v}" class="${f.min === v ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <span class="count" id="count"></span>
    </div>
    ${rangeBarHTML('segRange', f.from, f.to, FIRST, LAST)}
    <div id="plist"></div>`;

  $('#segEvent').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    f.event = Number(b.dataset.ev);
    // 同步地址栏（replaceState 不触发 hashchange，不会引起整页重渲染）
    history.replaceState(null, '', `#/players${f.event ? `?event=${f.event}` : ''}`);
    renderPlayerTable();
  };
  $('#segRace').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; f.race = b.dataset.race; renderPlayerTable(); };
  $('#segMin').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; f.min = Number(b.dataset.min); renderPlayerTable(); };
  $('#q').oninput = (e) => { f.q = e.target.value; renderPlayerTable(); };

  // 当前日期区间 → 日期下标区间
  const dayRange = () => {
    const lo = Math.max(0, lowerBound(daily.days, f.from));
    const hi = upperBound(daily.days, f.to);
    return { lo, hi };
  };

  // 依据「赛事 + 日期区间」投影出用于展示/排序的数值
  function view(p) {
    const { lo, hi } = dayRange();
    if (isFullRange(f.from, f.to, FIRST, LAST) && !f.event) {
      return { games: p.games, wins: p.wins, losses: p.losses, wr: p.wr, eloNet: p.eloNet };
    }
    return sumBuckets(daily.p[p.id], lo, hi, f.event || 0);
  }

  function renderPlayerTable() {
    $$('#segEvent button').forEach((b) => b.classList.toggle('on', Number(b.dataset.ev) === f.event));
    $$('#segRace button').forEach((b) => b.classList.toggle('on', b.dataset.race === f.race));
    $$('#segMin button').forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === f.min));
    const rangeActive = !isFullRange(f.from, f.to, FIRST, LAST);
    const { lo, hi } = dayRange();

    const rows = idx.players
      .filter((p) => (!f.race || p.race === f.race))
      .map((p) => ({ p, v: view(p) }))
      .filter((x) => x.v.games > 0)   // 当前「赛事 + 时间段」下没有出场的选手不进入排行
      .filter((x) => x.v.games >= f.min)
      .filter((x) => matchPlayer(x.p, f.q))
      .sort((A, B) => {
        const k = state.playerSort.key, d = state.playerSort.dir;
        let va, vb;
        if (k === 'games' || k === 'wr' || k === 'wins' || k === 'eloNet') { va = A.v[k] ?? -1; vb = B.v[k] ?? -1; }
        else { va = A.p[k] ?? -1; vb = B.p[k] ?? -1; }
        if (typeof va === 'string') return va.localeCompare(vb) * d;
        return (va - vb) * d;
      });
    $('#count').textContent = `${rows.length} 名选手`;

    const cols = [
      ['name', '选手', 0], ['race', '种族', 0],
      ['games', f.event ? evZh(f.event) + ' 场次' : '出场', 1],
      ['wins', '胜 / 负', 1],
      ['wr', '胜率', 1], ['eloNet', 'ELO 净变', 1], ['elo', '官方 ELO', 1],
    ];
    $('#plist').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th>${cols.map(([k, t, num]) =>
      `<th class="sortable ${state.playerSort.key === k ? 'sorted' : ''} ${num ? 'num' : ''}" data-k="${k}">${t} <span class="arrow">${state.playerSort.key === k ? (state.playerSort.dir === 1 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
        <th class="num" title="基于全部数据统计，不受上方时间段与赛事筛选影响">近 10 场</th></tr></thead>
        <tbody>${rows.slice(0, 400).map((x, i) => { const { p, v } = x; return `
          <tr class="clickable" onclick="location.hash='#/player/${p.id}'">
            <td><span class="rank">${i + 1}</span></td>
            <td><div class="pname">${avatar(p)}${nameHTML(p)}</div></td>
            <td>${racePill(p.race)}</td>
            <td class="num">${nf(v.games)}</td>
            <td class="num"><span style="color:var(--win)">${nf(v.wins)}</span> / <span style="color:var(--loss)">${nf(v.losses)}</span></td>
            <td class="num">${v.games ? wrCell(v.wr) : '<span class="muted">—</span>'}</td>
            <td class="num" style="color:${(v.eloNet ?? 0) >= 0 ? 'var(--win)' : 'var(--loss)'}">${v.eloNet == null ? '—' : (v.eloNet > 0 ? '+' : '') + v.eloNet.toFixed(1)}</td>
            <td class="num">${p.elo ? p.elo.toFixed(1) : '—'}</td>
            <td class="num">${p.recentGames ? `${p.recentWins} / ${p.recentGames}` : '—'}</td>
          </tr>`; }).join('')
          || `<tr><td colspan="${cols.length + 2}" class="empty">当前「赛事 + 时间段」下没有比赛记录</td></tr>`}</tbody>
      </table></div>
      ${rows.length > 400 ? `<div class="hint" style="padding:10px">仅显示前 400 名，请使用筛选缩小范围。</div>` : ''}
      ${rangeActive ? `<div class="hint" style="padding:0 10px 10px">已按时间段 ${esc(f.from)} ~ ${esc(f.to)} 统计（覆盖 ${hi - lo + 1} 个比赛日）</div>` : ''}`;

    $$('#plist th.sortable').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        if (state.playerSort.key === k) state.playerSort.dir *= -1;
        else state.playerSort = { key: k, dir: k === 'name' || k === 'race' ? 1 : -1 };
        renderPlayerTable();
      };
    });
  }

  bindRangeBar('segRange', FIRST, LAST, () => ({ from: f.from, to: f.to }), (from, to) => {
    f.from = from; f.to = to;
    renderPlayerTable();
  });
  renderPlayerTable();
}

/* ============================================================
   选手详情
   ============================================================ */
async function viewPlayer(app, id, params) {
  if (!id) { location.hash = '#/players'; return; }
  const p = await loadPlayer(id);
  if (params.get('tab')) state.detailTab = params.get('tab');

  app.innerHTML = `
    <div class="card profile">
      ${avatar(p, 'big-av')}
      <div class="pinfo">
        <h1>${esc(dispName(p))}${p.cn && p.cn !== p.name ? ` <span class="kr-name" style="font-size:15px">${esc(p.name)}</span>` : ''} ${racePill(p.race)}</h1>
        <div class="pmeta">
          ${p.idEn ? `<span>ID <b style="font-family:var(--mono)">${esc(p.idEn)}</b></span>` : ''}
          <span>#${p.id}</span>
          ${p.college ? `<span>· ${esc(p.college)}</span>` : ''}
          ${p.elo ? `<span>· 官方 ELO <b style="font-family:var(--mono)">${p.elo.toFixed(1)}</b></span>` : ''}
          ${p.lastPlayed ? `<span>· 最近出场 ${esc(p.lastPlayed)}</span>` : ''}
          ${p.soop ? `<span>· SOOP ${esc(p.soop)}</span>` : ''}
        </div>
      </div>
      <div class="pstats">
        <div class="card stat"><b>${nf(p.games)}</b><span>三赛事出场</span></div>
        <div class="card stat"><b>${p.wr.toFixed(1)}%</b><span>胜率 (${nf(p.wins)} 胜 ${nf(p.losses)} 负)</span></div>
      </div>
    </div>

    <div class="tabs" id="tabs">
      ${[['overview', '总览'], ['maps', '地图'], ['matchup', '对抗'], ['opponents', '对手'], ['matches', '对局记录']]
      .map(([k, t]) => `<button data-tab="${k}" class="${state.detailTab === k ? 'on' : ''}">${t}</button>`).join('')}
    </div>
    <div id="tabbody"></div>`;

  $('#tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.detailTab = b.dataset.tab; state.detailPage = 0;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderTab(p);
  };
  renderTab(p);
}

function renderTab(p) {
  const body = $('#tabbody');
  if (state.detailTab === 'overview') { body.innerHTML = tabOverview(p); drawTrend(p); }
  else if (state.detailTab === 'maps') body.innerHTML = tabMaps(p);
  else if (state.detailTab === 'matchup') body.innerHTML = tabMatchup(p);
  else if (state.detailTab === 'opponents') { body.innerHTML = tabOpponents(p); initOpponents(p); }
  else if (state.detailTab === 'matches') { body.innerHTML = tabMatches(p); initMatches(p); }
}

function tabOverview(p) {
  const recent = p.matches.slice(0, 10);
  const eTotal = p.events.reduce((a, e) => a + e.games, 0);
  return `
    <div class="grid c4">
      <div class="card stat"><b>${nf(p.games)}</b><span>三赛事总出场</span></div>
      <div class="card stat"><b style="color:var(--win)">${nf(p.wins)}</b><span>胜场</span></div>
      <div class="card stat"><b style="color:var(--loss)">${nf(p.losses)}</b><span>负场</span></div>
      <div class="card stat"><b>${p.eloNet == null ? '—' : (p.eloNet > 0 ? '+' : '') + p.eloNet.toFixed(1)}</b><span>赛事内 ELO 净变</span></div>
    </div>

    <div class="grid c2" style="margin-top:14px">
      <div class="card" style="padding:17px">
        <div class="section-head" style="margin-bottom:10px"><h2 style="font-size:14.5px">分赛事战绩</h2></div>
        <div class="bars" style="padding:0">
          ${p.events.map((e) => `
            <div class="bar-row">
              <span class="lbl">${evHTML(e.id)}</span>
              <span class="track"><i style="width:${(e.games / eTotal) * 100}%;background:${EVENTS[e.id].color}"></i></span>
              <span class="val">${nf(e.games)} 场 · ${e.wr.toFixed(1)}%</span>
            </div>`).join('')}
        </div>
        <table style="margin-top:14px">
          <thead><tr><th>赛事</th><th class="num">场次</th><th class="num">胜</th><th class="num">负</th><th class="num">胜率</th></tr></thead>
          <tbody>${p.events.map((e) => `
            <tr><td>${evHTML(e.id)}</td><td class="num">${nf(e.games)}</td>
            <td class="num" style="color:var(--win)">${nf(e.wins)}</td>
            <td class="num" style="color:var(--loss)">${nf(e.losses)}</td>
            <td class="num">${e.wr.toFixed(1)}%</td></tr>`).join('')}
          <tr style="font-weight:700;background:var(--panel-2)">
            <td>合计</td><td class="num">${nf(p.games)}</td>
            <td class="num" style="color:var(--win)">${nf(p.wins)}</td>
            <td class="num" style="color:var(--loss)">${nf(p.losses)}</td>
            <td class="num">${p.wr.toFixed(1)}%</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="padding:17px">
        <div class="section-head" style="margin-bottom:10px"><h2 style="font-size:14.5px">种族对抗</h2>
          <span class="sub">对手种族</span></div>
        <div class="bars" style="padding:0">
          ${p.vsRace.map((r) => `
            <div class="bar-row">
              <span class="lbl">${racePill(r.race)}</span>
              <span class="track"><i style="width:${r.wr}%"></i></span>
              <span class="val">${nf(r.games)} 场 · ${r.wr.toFixed(1)}%</span>
            </div>`).join('')}
        </div>
        <div class="section-head" style="margin:18px 0 10px"><h2 style="font-size:14.5px">近期状态</h2>
          <span class="sub">最近 ${p.recentGames} 场</span></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${recent.map((m) => `<span class="pill ${m.w ? 'win' : 'loss'}" title="${esc(m.d)} vs ${esc(oppName(m.o))}">${m.w ? '胜' : '负'}</span>`).join('')}
        </div>
        <div class="hint" style="margin-top:12px">
          首场 ${esc(fmtDate(p.firstDate))} · 最近 ${esc(fmtDate(p.lastDate))}
          ${p.careerWins != null ? `<br>官方生涯（含全部赛事）：${nf(p.careerWins)} 胜 ${nf(p.careerLosses)} 负` : ''}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>月度走势</h2><span class="sub">柱=出场数　线=当月胜率</span></div>
      <div class="card chart" id="trend"></div>
    </div>`;
}

function oppPlayer(id) { return P_BY_ID.get(Number(id)) || null; }
function oppName(id) {
  const p = oppPlayer(id);
  return p ? (p.cn || p.name) : '#' + id;
}

function drawTrend(p) {
  const host = $('#trend'); if (!host) return;
  const first = p.firstDate ? p.firstDate.slice(0, 7) : null;
  const last = p.lastDate ? p.lastDate.slice(0, 7) : null;
  if (!first) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const months = [];
  let [y, mo] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && mo <= lm)) {
    months.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  const map = Object.fromEntries(p.monthly.map((x) => [x.m, x]));
  const W = 900, H = 190, PL = 34, PR = 34, PT = 14, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxG = Math.max(...months.map((m) => map[m]?.games || 0), 1);
  const bw = Math.max(1.5, iw / months.length - 1.5);
  const x = (i) => PL + (iw / months.length) * (i + 0.5);
  const yWr = (v) => PT + ih - (v / 100) * ih;

  let bars = '', dots = '', line = '', area = '';
  const pts = [];
  months.forEach((m, i) => {
    const d = map[m];
    const g = d?.games || 0;
    const h = (g / maxG) * ih * 0.82;
    bars += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(PT + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#e9edf8"></rect>`;
    if (d) {
      const cx = x(i), cy = yWr(d.wr);
      pts.push([cx, cy, d, m]);
      dots += `<circle class="dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.6"></circle>`;
    } else pts.push(null);
  });
  const segs = [];
  let cur = [];
  pts.forEach((pt) => { if (pt) cur.push(pt); else { if (cur.length) segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  line = segs.map((s) => `<path class="line" d="${s.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}"></path>`).join('');
  if (segs.length) {
    const s = segs[0];
    if (s.length > 1) area = `<path class="area" d="M${s[0][0].toFixed(1)} ${(PT + ih).toFixed(1)} ${s.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')} L${s.at(-1)[0].toFixed(1)} ${(PT + ih).toFixed(1)} Z"></path>`;
  }
  const grid = [0, 25, 50, 75, 100].map((v) =>
    `<line class="axis" x1="${PL}" x2="${W - PR}" y1="${yWr(v).toFixed(1)}" y2="${yWr(v).toFixed(1)}"></line>
     <text class="lbl" x="${PL - 6}" y="${(yWr(v) + 3).toFixed(1)}" text-anchor="end">${v}%</text>`).join('');
  const step = Math.max(1, Math.round(months.length / 10));
  const xl = months.map((m, i) => i % step === 0 || i === months.length - 1
    ? `<text class="lbl" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${m}</text>` : '').join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3d5afe" stop-opacity=".22"/><stop offset="100%" stop-color="#3d5afe" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${bars}${area}${line}${dots}${xl}
  </svg>`;
  host.querySelectorAll('.dot').forEach((c, i) => {
    const pt = pts.filter(Boolean)[i]; if (!pt) return;
    c.innerHTML = `<title>${pt[3]}：${pt[2].games} 场，胜率 ${pt[2].wr.toFixed(1)}%（${pt[2].wins} 胜 ${pt[2].losses} 负）</title>`;
  });
}

function tabMaps(p) {
  const label = state.index?.meta?.season?.label || '';
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>地图</th><th class="num">场次</th><th class="num">胜</th><th class="num">负</th><th class="num">胜率</th></tr></thead>
    <tbody>${p.maps.map((m, i) => `
      <tr><td><span class="rank">${i + 1}</span></td>
      <td>${mapHTML(m.cn, m.kr)}</td>
      <td class="num">${nf(m.games)}</td>
      <td class="num" style="color:var(--win)">${nf(m.wins)}</td>
      <td class="num" style="color:var(--loss)">${nf(m.losses)}</td>
      <td class="num">${wrCell(m.wr)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">该选手在本赛季地图上暂无记录</td></tr>'}
    </tbody></table></div>
    <div class="hint" style="padding:10px">共 ${p.maps.length} 张地图 · 仅展示本赛季（${esc(label)}）地图</div>`;
}

function tabMatchup(p) {
  return `
    <div class="grid c2">
      <div class="card" style="padding:17px">
        <div class="section-head"><h2 style="font-size:14.5px">对手种族对抗</h2></div>
        <table><thead><tr><th>对手种族</th><th class="num">场次</th><th class="num">胜</th><th class="num">负</th><th class="num">胜率</th></tr></thead>
        <tbody>${p.vsRace.map((r) => `
          <tr><td>${racePill(r.race)} <span class="muted" style="font-size:11.5px">${RACE_EN[r.race]}</span></td>
          <td class="num">${nf(r.games)}</td><td class="num" style="color:var(--win)">${nf(r.wins)}</td>
          <td class="num" style="color:var(--loss)">${nf(r.losses)}</td><td class="num">${wrCell(r.wr)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card" style="padding:17px">
        <div class="section-head"><h2 style="font-size:14.5px">地图胜率分布</h2>
          <span class="sub">≥10 场 · 仅本赛季地图</span></div>
        <div class="bars" style="padding:0;max-height:420px;overflow-y:auto">
          ${p.maps.filter((m) => m.games >= 10).map((m) => `
            <div class="bar-row" style="grid-template-columns:120px 1fr 88px">
              <span class="lbl" title="${esc(m.kr)}">${esc(m.cn)}</span>
              <span class="track"><i style="width:${m.wr}%"></i></span>
              <span class="val">${m.wr.toFixed(1)}% <span class="muted">(${m.games})</span></span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function tabOpponents(p) {
  return `
    <div class="filters">
      <input type="search" id="oppQ" placeholder="筛选对手（中文 / 韩文 / 英文 ID）…" style="min-width:240px">
      <span class="count">共 ${p.opponents.length} 位交手过的对手</span>
    </div>
    <div class="table-wrap"><table id="oppTable">
      <thead><tr><th>#</th><th>对手</th><th>种族</th><th class="num">交手</th><th class="num">胜</th><th class="num">负</th><th class="num">胜率</th><th class="num">最近交手</th></tr></thead>
      <tbody></tbody></table></div>`;
}

function initOpponents(p) {
  const draw = (q) => {
    const list = p.opponents.filter((o) => matchPlayer(o, q));
    $('#oppTable tbody').innerHTML = list.map((o, i) => `
      <tr class="clickable" onclick="location.hash='#/h2h?a=${p.id}&b=${o.id}'" title="点击查看双方对战">
        <td><span class="rank">${i + 1}</span></td>
        <td><div class="pname">${avatar(o)}${nameHTML(o)}</div></td>
        <td>${racePill(o.race)}</td>
        <td class="num">${nf(o.games)}</td>
        <td class="num" style="color:var(--win)">${nf(o.wins)}</td>
        <td class="num" style="color:var(--loss)">${nf(o.losses)}</td>
        <td class="num">${wrCell(o.wr)}</td>
        <td class="num muted">${esc(lastVs(p, o.id))}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">没有匹配的对手</td></tr>';
  };
  draw('');
  $('#oppQ').oninput = (e) => draw(e.target.value);
}

function lastVs(p, oid) {
  const m = p.matches.find((x) => x.o === oid);
  return m?.d || '—';
}

const PAGE_SIZE = 40;
function tabMatches(p) {
  const total = p.matches.length;
  return `
    <div class="filters">
      <div class="seg" id="mFilter">
        <button data-ev="0" class="on">全部</button>
        ${p.events.map((e) => `<button data-ev="${e.id}" title="${esc(e.name)}">${esc(e.nameZh || e.short)}</button>`).join('')}
      </div>
      <input type="search" id="mQ" placeholder="按地图 / 对手筛选（支持中文 / 韩文 / 英文 ID）…" style="min-width:280px">
      <span class="count" id="mCount">共 ${nf(total)} 场</span>
    </div>
    <div class="table-wrap"><div class="mlist" id="mList"></div></div>
    <div class="pager" id="mPager"></div>`;
}

function initMatches(p) {
  let filt = { ev: 0, q: '' };
  const draw = () => {
    const q = norm(filt.q);
    const list = p.matches.filter((m) => (!filt.ev || m.e === filt.ev)
      && (!q || mapSearchText(m.map).includes(q) || matchPlayer(oppPlayer(m.o), filt.q)));
    const pg = Math.ceil(list.length / PAGE_SIZE) || 1;
    const c = Math.min(state.detailPage, pg - 1);
    const sl = list.slice(c * PAGE_SIZE, c * PAGE_SIZE + PAGE_SIZE);
    $('#mCount').textContent = `共 ${nf(list.length)} 场`;
    $('#mList').innerHTML = sl.map((m) => `
      <div class="mrow">
        <span class="res ${m.w ? 'w' : 'l'}">${m.w ? '胜' : '负'}</span>
        <div>
          <div class="who">
            <span class="muted" style="font-size:12px">vs</span>
            <span style="cursor:pointer" onclick="location.hash='#/player/${m.o}'">${oppPlayer(m.o) ? nameHTML(oppPlayer(m.o)) : `<b>#${m.o}</b>`}</span>
            ${m.or ? racePill(m.or) : ''}
            ${mapTag(m.map)}
          </div>
          <div class="meta">
            <span>${esc(fmtDate(m.d))}</span>
            <span>${esc(evZh(m.e))}</span>
            ${m.team ? `<span>${esc(m.team)} vs ${esc(m.oteam || '')}</span>` : ''}
          </div>
        </div>
        <span class="elo ${m.elo == null ? 'na' : m.elo > 0 ? 'up' : 'dn'}">${m.elo == null ? '—' : (m.elo > 0 ? '+' : '') + m.elo.toFixed(1)}</span>
      </div>`).join('') || '<div class="empty">没有匹配的对局</div>';
    $('#mPager').innerHTML = pg > 1 ? `
      <button ${c === 0 ? 'disabled' : ''} data-p="0">首页</button>
      <button ${c === 0 ? 'disabled' : ''} data-p="${c - 1}">上一页</button>
      <span>${c + 1} / ${pg}</span>
      <button ${c >= pg - 1 ? 'disabled' : ''} data-p="${c + 1}">下一页</button>
      <button ${c >= pg - 1 ? 'disabled' : ''} data-p="${pg - 1}">末页</button>` : '';
    $$('#mPager button').forEach((b) => b.onclick = () => { state.detailPage = Number(b.dataset.p); draw(); });
  };
  draw();
  $('#mFilter').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filt.ev = Number(b.dataset.ev); state.detailPage = 0;
    $$('#mFilter button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
  $('#mQ').oninput = (e) => { filt.q = e.target.value; state.detailPage = 0; draw(); };
}

/* ============================================================
   双方对战
   ============================================================ */
async function viewH2H(app, params) {
  const idx = await loadIndex();
  const a = params.get('a'), b = params.get('b');

  app.innerHTML = `
    <div class="section-head"><h2>双方对战</h2><span class="sub">选择两名选手，查看他们在三大赛事中的全部交手记录</span></div>
    <div class="card" style="padding:22px">
      <div class="h2h-pick">
        <div class="picker">
          <input type="search" id="pickA" placeholder="搜索选手 A（中文 / 韩文 / 英文 ID）…" autocomplete="off" value="${esc(dispName(idx.players.find((p) => p.id === Number(a))))}">
          <div class="dropdown" id="ddA" style="display:none"></div>
        </div>
        <div class="vs">VS</div>
        <div class="picker">
          <input type="search" id="pickB" placeholder="搜索选手 B（中文 / 韩文 / 英文 ID）…" autocomplete="off" value="${esc(dispName(idx.players.find((p) => p.id === Number(b))))}">
          <div class="dropdown" id="ddB" style="display:none"></div>
        </div>
      </div>
      <div class="hint" style="margin-top:16px">提示：支持中文名、韩文名、英文 ID 或数字 ID 搜索；在选手详情页的「对手」标签中点击任意对手，也可直接跳转到双方对战。</div>
    </div>
    <div id="h2hResult" style="margin-top:20px"></div>`;

  const bind = (inputSel, ddSel, onPick) => {
    const input = $(inputSel), dd = $(ddSel);
    const show = () => {
      const q = input.value.trim();
      const list = idx.players
        .filter((p) => matchPlayer(p, q))
        .sort((x, y) => y.games - x.games).slice(0, 40);
      dd.innerHTML = list.map((p) => `<div data-id="${p.id}">${avatar(p)}${nameHTML(p)}${racePill(p.race)}<span class="rr">${nf(p.games)} 场</span></div>`).join('')
        || '<div class="muted" style="padding:10px">无匹配</div>';
      dd.style.display = 'block';
      $$('div[data-id]', dd).forEach((el) => el.onclick = () => {
        dd.style.display = 'none';
        input.value = dispName(idx.players.find((p) => p.id === Number(el.dataset.id)));
        onPick(Number(el.dataset.id));
      });
    };
    input.onfocus = show;
    input.oninput = show;
    input.onblur = () => setTimeout(() => dd.style.display = 'none', 180);
  };

  const sel = { a: Number(a) || null, b: Number(b) || null };
  const go = () => { if (sel.a && sel.b && sel.a !== sel.b) location.hash = `#/h2h?a=${sel.a}&b=${sel.b}`; };
  bind('#pickA', '#ddA', (id) => { sel.a = id; go(); });
  bind('#pickB', '#ddB', (id) => { sel.b = id; go(); });

  if (sel.a && sel.b && sel.a !== sel.b) await renderH2H(sel.a, sel.b);
  else $('#h2hResult').innerHTML = '<div class="empty">请选择两名选手开始对比</div>';
}

async function renderH2H(aId, bId) {
  const H2H_MAX = 200;
  const host = $('#h2hResult');
  host.innerHTML = '<div class="loading">加载中…</div>';
  const [A, B] = await Promise.all([loadPlayer(aId), loadPlayer(bId)]);
  const allGames = A.matches.filter((m) => m.o === bId).slice().sort((x, y) => (y.d || '').localeCompare(x.d || ''));
  const FIRST = state.index.meta.first, LAST = state.index.meta.last;
  // 换了一对选手就把时间段重置为全部，避免沿用上一对的窄区间造成"无记录"的困惑
  const pairKey = `${aId}|${bId}`;
  if (state.h2h.pair !== pairKey) {
    state.h2h.pair = pairKey;
    state.h2h.from = null;
    state.h2h.to = null;
  }
  if (!state.h2h.from) state.h2h.from = FIRST;
  if (!state.h2h.to) state.h2h.to = LAST;

  host.innerHTML = rangeBarHTML('h2hRange', state.h2h.from, state.h2h.to, FIRST, LAST)
    + '<div id="h2hBody"></div>';

  const draw = () => {
    const { from, to } = state.h2h;
    const games = allGames.filter((m) => m.d && m.d >= from && m.d <= to);
    const aw = games.filter((g) => g.w).length, bw = games.length - aw;
    const tot = games.length || 1;

    const byMap = {}, byEvent = {};
    for (const g of games) {
      const mk = g.map || '?';
      (byMap[mk] || (byMap[mk] = { games: 0, a: 0, b: 0 })).games++;
      byMap[mk][g.w ? 'a' : 'b']++;
      const ek = g.e;
      (byEvent[ek] || (byEvent[ek] = { games: 0, a: 0, b: 0 })).games++;
      byEvent[ek][g.w ? 'a' : 'b']++;
    }
    // 分地图交手只统计本赛季地图
    const mapRows = Object.entries(byMap)
      .filter(([k]) => SEASON_MAPS.has(k))
      .map(([k, v]) => ({ kr: k, cn: mapCn(k), ...v }))
      .sort((x, y) => y.games - x.games);
    const offSeason = Object.keys(byMap).length - mapRows.length;

    $('#h2hBody').innerHTML = `
      <div class="card h2h-head">
        <div class="h2h-side">
          ${avatar(A, 'big-av')}
          ${nameHTML(A)}${racePill(A.race)}
          <span class="muted" style="font-size:12px">三赛事 ${nf(A.games)} 场 · ${A.wr.toFixed(1)}%</span>
        </div>
        <div>
          <div class="h2h-score">${aw} : ${bw}<small>交手 ${games.length} 场</small></div>
          <div class="h2h-bar"><i class="a" style="width:${(aw / tot) * 100}%"></i><i class="b" style="width:${(bw / tot) * 100}%"></i></div>
        </div>
        <div class="h2h-side">
          ${avatar(B, 'big-av')}
          ${nameHTML(B)}${racePill(B.race)}
          <span class="muted" style="font-size:12px">三赛事 ${nf(B.games)} 场 · ${B.wr.toFixed(1)}%</span>
        </div>
      </div>

      ${games.length === 0 ? `<div class="empty">该时间段内没有交手记录${allGames.length ? `（全部时间共 ${allGames.length} 场）` : ''}</div>` : `
      <div class="grid c2" style="margin-top:16px">
        <div class="card" style="padding:17px">
          <div class="section-head"><h2 style="font-size:14.5px">分地图交手</h2>
            <span class="sub">${mapRows.length} 张本赛季地图${offSeason ? ` · 另有 ${offSeason} 张非本赛季地图未计入` : ''}</span></div>
          <table id="h2hMapTable"><thead><tr><th>地图</th><th class="num">场次</th><th class="num">${esc(dispName(A))}</th><th class="num">${esc(dispName(B))}</th></tr></thead>
          <tbody>${mapRows.map((m) => `
            <tr><td>${mapHTML(m.cn, m.kr)}</td>
            <td class="num">${m.games}</td>
            <td class="num" style="color:var(--win);font-weight:600">${m.a}</td>
            <td class="num" style="color:var(--loss);font-weight:600">${m.b}</td></tr>`).join('')
          || '<tr><td colspan="4" class="empty">本赛季地图上无交手记录</td></tr>'}
          </tbody></table>
        </div>
        <div class="card" style="padding:17px">
          <div class="section-head"><h2 style="font-size:14.5px">分赛事交手</h2></div>
          <table><thead><tr><th>赛事</th><th class="num">场次</th><th class="num">${esc(dispName(A))}</th><th class="num">${esc(dispName(B))}</th></tr></thead>
          <tbody>${Object.entries(byEvent).map(([k, v]) => `
            <tr><td>${evHTML(k)}</td><td class="num">${v.games}</td>
            <td class="num" style="color:var(--win);font-weight:600">${v.a}</td>
            <td class="num" style="color:var(--loss);font-weight:600">${v.b}</td></tr>`).join('')}
          </tbody></table>
          <div class="section-head" style="margin:20px 0 10px"><h2 style="font-size:14.5px">最近 20 次交手</h2></div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${games.slice(0, 20).map((g) => `<span class="pill ${g.w ? 'win' : 'loss'}" title="${esc(g.d)} · ${esc(mapCn(g.map))} · ${esc(dispName(g.w ? A : B))} 胜">${g.w ? 'A' : 'B'}</span>`).join('')}
          </div>
          <div class="hint" style="margin-top:10px">A = ${esc(dispName(A))}　B = ${esc(dispName(B))}（左起为最近）</div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>交手记录</h2><span class="sub">${games.length} 场${games.length > H2H_MAX ? ` · 仅显示最近 ${H2H_MAX} 场` : ''}</span></div>
        <div class="table-wrap"><table id="h2hList">
          <thead><tr><th></th><th>对阵</th><th>地图</th><th>日期</th><th>赛事</th></tr></thead>
          <tbody>${games.slice(0, H2H_MAX).map((m) => {
        const win = m.w ? A : B, lose = m.w ? B : A;
        const season = !m.map || SEASON_MAPS.has(m.map);
        return `<tr>
              <td><span class="res ${m.w ? 'w' : 'l'}">${m.w ? '胜' : '负'}</span></td>
              <td>${nameHTML(win)}<span class="muted" style="margin:0 6px">vs</span><span class="muted">${nameHTML(lose)}</span></td>
              <td>${mapHTML(mapCn(m.map), m.map)}${season ? '' : '<span class="muted" style="font-size:11px"> 非本赛季</span>'}</td>
              <td class="muted">${esc(fmtDate(m.d))}</td>
              <td>${EVENTS[m.e] ? evHTML(m.e) : '<span class="muted">—</span>'}</td>
            </tr>`;
      }).join('')}</tbody>
        </table></div>
      </div>`}`;
  };

  bindRangeBar('h2hRange', FIRST, LAST, () => ({ from: state.h2h.from, to: state.h2h.to }), (from, to) => {
    state.h2h.from = from; state.h2h.to = to;
    draw();
  });
  draw();
}

/* ============================================================
   地图情报
   ============================================================ */
async function viewMaps(app) {
  const idx = await loadIndex();
  const maps = state.maps;
  const MU = idx.meta.matchups || ['ZvP', 'ZvT', 'PvZ', 'PvT', 'TvZ', 'TvP'];
  const RACE_CN = { Z: '虫族', P: '神族', T: '人族' };
  // 按第一个种族把对抗分成 Z / P / T 三组，表头两行（组名 + 具体方向）
  const groups = [];
  for (const k of MU) {
    const race = k[0], last = groups[groups.length - 1];
    if (last && last.race === race) last.cols.push(k);
    else groups.push({ race, cols: [k] });
  }
  app.innerHTML = `
    <div class="section-head"><h2>地图情报</h2>
      <span class="sub">仅本赛季（${esc(idx.meta.season?.label || '')}）地图 · 共 ${maps.length} 张</span></div>
    <div class="filters">
      <input type="search" id="mapQ" placeholder="搜索地图（中文 / 韩文）…" style="min-width:200px">
      <span class="count" id="mapCount"></span>
    </div>
    <div class="table-wrap"><table id="mapTable">
      <thead>
        <tr>
          <th rowspan="2">#</th><th rowspan="2">地图</th><th rowspan="2" class="num">总场次</th>
          ${groups.map((g) => `<th colspan="${g.cols.length}" class="mu-group">${esc(RACE_CN[g.race] || g.race)} ${esc(g.race)}</th>`).join('')}
          <th rowspan="2" class="num">同族</th>
        </tr>
        <tr>${groups.flatMap((g) => g.cols.map((k) => `<th class="num">${esc(k)}</th>`)).join('')}</tr>
      </thead>
      <tbody></tbody></table></div>
    <div class="hint" style="margin-top:10px">
      每列只统计该方向中<b>前者</b>的胜率：ZvP = 虫族对神族的胜率，PvZ = 神族对虫族的胜率，依此类推。
      互为反向的两列（如 ZvP / PvZ）场次相同、胜率互补合计 100%；同族对抗（ZvZ / PvP / TvT）不计胜率。
    </div>`;

  const muCell = (k, mm) => {
    if (!mm || !mm.g) return '<span class="mu-na">—</span>';
    const v = mm.wr;
    const cls = v >= 55 ? 'up' : v <= 45 ? 'dn' : 'mid';
    const [a, b] = k.split('v');
    return `<span class="mu ${cls}" title="${esc(k)} 共 ${mm.g} 场：${esc(a)} ${mm.w} 胜 / ${esc(b)} ${mm.g - mm.w} 胜">${v.toFixed(1)}%
        <span class="mu-cnt">${mm.g} 场</span>
        <span class="mu-bar"><i style="width:${v}%"></i></span></span>`;
  };

  const draw = (q) => {
    const list = maps.filter((m) => !q || m.cn.includes(q) || m.kr.includes(q));
    $('#mapCount').textContent = `${list.length} 张地图`;
    $('#mapTable tbody').innerHTML = list.map((m, i) => `
      <tr>
        <td><span class="rank">${i + 1}</span></td>
        <td>${mapHTML(m.cn, m.kr)}</td>
        <td class="num">${nf(m.games)}</td>
        ${MU.map((k) => `<td class="num">${muCell(k, m.matchups?.[k])}</td>`).join('')}
        <td class="num">${m.mirror ? `<span class="muted">${m.mirror}</span>` : '<span class="mu-na">—</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="${4 + MU.length}" class="empty">无匹配地图</td></tr>`;
  };
  draw('');
  $('#mapQ').oninput = (e) => draw(e.target.value);
}

/* ---------- 启动 ---------- */
route();
