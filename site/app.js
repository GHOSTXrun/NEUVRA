/* ALPHAMORPH — living-brain client. No deps, no build. Every number shown comes from the local API,
   except the signal rate and the equity trace, which are counted in this browser and labelled. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const REGION_ORDER = ['awareness', 'timing', 'risk'];
const AMR = window.AMR; // regions.js: data-driven region catalogue (up to 6; 3 core + dormant/active growth regions)
const REGION_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? AMR.label(k) : undefined) });
const MAX_PULSES = 48;

const S = {
  state: null, health: null, gens: [], trades: [], tokens: [],
  nodes: new Map(), comps: new Map(), slotOf: new Map(), slotIdx: new Map(), slotUsed: {}, regSig: '',
  lastEventId: 0, sel: null, es: null, backoff: 1000, sseOk: false,
  sigTimes: [], lastSignal: 0, fire: new Map(), hot: new Map(), born: new Map(), dying: new Map(),
  pulses: [], pool: [], raf: 0, eqTrace: [], seenTrades: new Set(), initEq: 1e9, compLastPulse: new Map(),
};

/* ---------------------------------------------------------------- helpers */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const shortStrat = (id) => String(id || '').replace(/^(aw|ti|ri)-/, '');
const shortComp = (c) => String(c || '').replace(/^C:/, '').split('|').map(shortStrat).join(' · ');
const shortAddr = (a) => a ? String(a).slice(0, 6) + '…' + String(a).slice(-4) : '—';
const hype = (micro, sign = true) => {
  if (micro == null || isNaN(micro)) return '—';
  const v = Number(micro) / 1e6;
  return (sign && v > 0 ? '+' : '') + v.toFixed(4);
};
const pnlCls = (m) => (m > 0 ? 'pos' : m < 0 ? 'neg' : '');
const utc = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(11, 19) : '—');
const sci = (s) => {
  s = String(s ?? ''); if (!/^\d+$/.test(s)) return esc(s);
  if (s.length <= 6) return s;
  return s[0] + '.' + s.slice(1, 3) + 'e' + (s.length - 1);
};
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function provBadges(label, dataLabel, recorded) {
  const out = [];
  if (label === 'PAPER_FILL') out.push('<span class="b b-paper" title="Simulated fill. No real order.">PAPER</span>');
  const src = dataLabel || label;
  if (src === 'SYNTHETIC_TEST') out.push('<span class="b b-synth" title="Generated test data, not market data">SYNTH TEST</span>');
  else if (src === 'NETWORK_OBSERVATION') out.push(recorded
    ? '<span class="b b-rec" title="Genuine network logs, replayed. Not live.">RECORDED</span>'
    : '<span class="b b-live" title="Observed on the network live">LIVE</span>');
  else if (src === 'REPLAY' || src === 'OFFLINE_FIXTURE') out.push('<span class="b b-rec">' + (src === 'REPLAY' ? 'REPLAY' : 'FIXTURE') + '</span>');
  else if (src === 'DETERMINISTIC_POLICY') out.push('<span class="b b-pol">POLICY</span>');
  return out.join(' ');
}
const STATUS = {
  live: ['LIVE', 'pill-live', 'Robinhood Chain (Pons), observed now'],
  recorded: ['RECORDED', 'pill-rec', 'genuine logs replayed · not live'],
  stale: ['STALE', 'pill-stale', 'network data delayed · no new entries'],
  synthetic: ['SYNTHETIC TEST', 'pill-synth', 'generated test feed · not market data'],
};

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.json();
}

/* ---------------------------------------------------------------- geometry: faceted brain */
const OUTLINE = [[170, 330], [178, 282], [198, 236], [232, 190], [276, 152], [330, 122], [390, 102], [455, 90], [520, 86], [590, 94],
  [652, 112], [710, 140], [762, 180], [804, 230], [830, 286], [838, 340], [824, 392], [790, 432], [740, 456], [690, 466], [664, 492],
  [652, 540], [630, 584], [598, 588], [584, 540], [574, 498], [520, 476], [450, 472], [380, 466], [312, 452], [252, 428], [206, 392]];
const ANCHOR = { awareness: [300, 285], timing: [545, 235], risk: [735, 365], provenance: [372, 138], flow: [470, 425], curve: [655, 500] };
const LABELPOS = { // [x, y, anchor, leader-from, leader-to]
  awareness: [70, 110, 'start', [150, 118], [250, 175]], timing: [500, 56, 'start', [520, 64], [545, 92]], risk: [925, 536, 'end', [852, 522], [792, 446]],
  provenance: [480, 40, 'end', [400, 48], [372, 128]], flow: [60, 548, 'start', [150, 540], [440, 432]], curve: [925, 592, 'end', [852, 584], [668, 508]],
};
const SLOTS = {
  awareness: [[262, 262], [340, 196], [318, 334], [412, 268], [236, 362], [414, 384], [362, 140], [210, 300]],
  timing: [[506, 166], [604, 186], [528, 282], [640, 278], [478, 372], [574, 384], [664, 172], [444, 204]],
  risk: [[742, 282], [792, 352], [714, 408], [662, 344], [618, 520], [770, 228], [700, 444], [806, 300]],
};
const INLET = [40, 330];

function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function delaunay(pts) { // Bowyer–Watson, fine for ~120 points
  const big = [[-5000, -5000], [5000, -5000], [0, 8000]];
  const P = pts.concat(big); const n = pts.length;
  let tris = [[n, n + 1, n + 2]];
  const circ = (t) => {
    const [ax, ay] = P[t[0]], [bx, by] = P[t[1]], [cx, cy] = P[t[2]];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
  };
  let cc = tris.map(circ);
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i]; const bad = []; const keep = []; const keepC = [];
    tris.forEach((t, k) => { const c = cc[k]; ((px - c[0]) ** 2 + (py - c[1]) ** 2 < c[2]) ? bad.push(t) : (keep.push(t), keepC.push(c)); });
    const edges = new Map();
    for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      const k = a < b ? a + ',' + b : b + ',' + a; edges.set(k, edges.has(k) ? null : [a, b]);
    }
    for (const e of edges.values()) if (e) { const t = [e[0], e[1], i]; keep.push(t); keepC.push(circ(t)); }
    tris = keep; cc = keepC;
  }
  return tris.filter(t => t[0] < n && t[1] < n && t[2] < n);
}
function nearestRegion(x, y) {
  let best = null, bd = 1e12;
  for (const r of S.regIds || REGION_ORDER) { if (!ANCHOR[r]) continue; const [ax, ay] = ANCHOR[r]; const d = (x - ax) ** 2 + (y - ay) ** 2; if (d < bd) { bd = d; best = r; } }
  return best || 'awareness';
}

function buildBrainShell() {
  const R = rng(0xB12A1);
  const RI = AMR.info(S.state); S.regIds = RI.map(r => r.id).filter(id => ANCHOR[id]); S.regInfo = new Map(RI.map(r => [r.id, r]));
  $('#shell').replaceChildren(); $('#lobelabels').replaceChildren(); $('#field').replaceChildren();
  const pts = OUTLINE.map(p => p.slice());
  for (let i = 0; i < OUTLINE.length; i++) { // edge midpoints, nudged inward
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length];
    pts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  let tries = 0;
  while (pts.length < 125 && tries++ < 4000) {
    const x = 170 + R() * 670, y = 86 + R() * 502;
    if (!inPoly(x, y, OUTLINE)) continue;
    if (pts.some(p => (p[0] - x) ** 2 + (p[1] - y) ** 2 < 34 * 34)) continue;
    pts.push([x, y]);
  }
  const tris = delaunay(pts).filter(t => {
    const cx = (pts[t[0]][0] + pts[t[1]][0] + pts[t[2]][0]) / 3, cy = (pts[t[0]][1] + pts[t[1]][1] + pts[t[2]][1]) / 3;
    return inPoly(cx, cy, OUTLINE);
  });
  const shell = $('#shell'); const tint = Object.fromEntries(Object.keys(AMR.CAT).map(k => [k, AMR.rgb(AMR.CAT[k].tint)]));
  el('polygon', { points: OUTLINE.map(p => p.join(',')).join(' '), class: 'backplate' }, shell);
  const edgeOwner = new Map(); const frag = document.createDocumentFragment();
  for (const t of tris) {
    const [a, b, c] = t.map(i => pts[i]);
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
    const reg = nearestRegion(cx, cy);
    const light = 0.05 + 0.10 * (1 - (cy - 86) / 520) + R() * 0.05; // flat-shaded: lit from above
    const [r, g, bl] = tint[reg]; const ri = S.regInfo.get(reg); const dorm = ri && ri.status === 'dormant';
    const p = el('polygon', { points: `${a} ${b} ${c}`, class: 'facet' + (dorm ? ' dorm' : '') + (ri && ri.born ? ' born' : ''), fill: dorm ? 'rgba(0,0,0,0)' : `rgba(${r},${g},${bl},${light.toFixed(3)})`, ...(dorm ? { stroke: `rgba(${r},${g},${bl},.34)` } : {}) });
    frag.appendChild(p);
    for (const [i, j] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      const k = i < j ? i + ',' + j : j + ',' + i; const o = edgeOwner.get(k);
      if (o && o.reg !== reg) o.fissure = true; else if (!o) edgeOwner.set(k, { reg, i, j });
    }
  }
  shell.appendChild(frag);
  let d = '';
  for (const e of edgeOwner.values()) if (e.fissure) d += `M${pts[e.i]}L${pts[e.j]}`;
  el('path', { d, class: 'fissure' }, shell);
  el('polygon', { points: OUTLINE.map(p => p.join(',')).join(' '), class: 'rim' }, shell);
  // afferent inlet (observations enter here)
  el('path', { d: `M${INLET}L170,330`, class: 'inlet' }, shell);
  const t = el('text', { x: 46, y: 316, class: 'lobelabel' }, shell); t.textContent = 'obs in';

  const field = $('#field');
  [[420, 285], [455, 308], [492, 330]].forEach(([rx, ry]) => el('ellipse', { cx: 505, cy: 335, rx, ry, class: 'fieldring' }, field));
  el('ellipse', { cx: 505, cy: 628, rx: 300, ry: 14, class: 'fieldring', 'stroke-dasharray': '2 6', style: 'animation:none' }, field);

  const L = $('#lobelabels');
  for (const ri of RI) {
    const lp = LABELPOS[ri.id]; if (!lp) continue; const [x, y, anchor, lf, lt] = lp; const [r, g, bl] = tint[ri.id] || [200, 200, 200];
    const col = `rgb(${r},${g},${bl})`; const dorm = ri.status === 'dormant';
    const tx = el('text', { x, y, 'text-anchor': anchor, class: 'lobelabel' + (dorm ? ' dorm' : '') + (ri.born ? ' born' : '') }, L);
    const s1 = el('tspan', { class: 'll-n', fill: col }, tx); s1.textContent = (dorm ? '🔒 ' : '') + ri.n + ' ';
    const s2 = el('tspan', {}, tx); s2.textContent = ri.short + (ri.born ? '  · NEW gen ' + ri.unlocked_gen : '');
    if (dorm) {
      const t2 = el('text', { x, y: y + 14, 'text-anchor': anchor, class: 'lobelabel lock' }, L); t2.textContent = ri.lock;
      const [ax, ay] = ANCHOR[ri.id]; const rad = 26, C = 2 * Math.PI * rad; // thin progress ring on the embryonic region
      el('circle', { cx: ax, cy: ay, r: rad, class: 'ring-bg' }, L);
      const arc = el('circle', { cx: ax, cy: ay, r: rad, class: 'ring-fg', stroke: col, 'stroke-dasharray': `${(C * (ri.pct || 0)).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${ax} ${ay})` }, L);
      const lt2 = el('text', { x: ax, y: ay + 4, 'text-anchor': 'middle', class: 'lobelabel ringtxt' }, L); lt2.textContent = ri.pct == null ? '—' : Math.round(ri.pct * 100) + '%';
      arc.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: ri.lock + (ri.requires ? ' · requires ' + ri.requires : '') }));
    }
    el('path', { d: `M${lf[0]},${lf[1]}L${lt[0]},${lt[1]}`, stroke: dorm ? 'rgba(126,140,153,.3)' : 'rgba(126,140,153,.6)', 'stroke-width': 1, fill: 'none', 'stroke-dasharray': dorm ? '3 3' : '' }, L);
  }
}

/* ---------------------------------------------------------------- city (environment only) */
function buildCity() {
  const svg = $('#city'); const R = rng(0xC17E);
  const defs = el('defs', {}, svg);
  const pat = (id, color, op, w, h) => {
    const p = el('pattern', { id, width: w, height: h, patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { x: 2, y: 3, width: 2, height: 2, fill: color, opacity: op }, p);
  };
  pat('winL', '#B6FF4D', 0.20, 9, 12); pat('winV', '#9B7BFF', 0.22, 11, 13); pat('winG', '#7E8C99', 0.16, 8, 10);
  const layers = [
    { depth: 6, fill: '#18262F', op: 0.45, minH: 150, maxH: 330, minW: 40, maxW: 90, win: 'winG' },
    { depth: 14, fill: '#13202A', op: 0.8, minH: 110, maxH: 290, minW: 50, maxW: 120, win: 'winV' },
    { depth: 26, fill: '#0F1A22', op: 1, minH: 60, maxH: 210, minW: 70, maxW: 150, win: 'winL' },
  ];
  for (const L of layers) {
    const g = el('g', { 'data-depth': L.depth, opacity: L.op }, svg);
    let x = -60;
    while (x < 1500) {
      const w = L.minW + R() * (L.maxW - L.minW), h = L.minH + R() * (L.maxH - L.minH);
      el('rect', { x, y: 600 - h, width: w, height: h + 40, fill: L.fill }, g);
      if (R() > 0.35) el('rect', { x: x + 6, y: 600 - h + 10, width: w - 12, height: h - 10, fill: `url(#${L.win})` }, g);
      if (R() > 0.82) el('line', { x1: x + w - 3, y1: 600 - h - 30 * R(), x2: x + w - 3, y2: 600, stroke: R() > 0.5 ? '#9B7BFF' : '#B6FF4D', 'stroke-opacity': 0.45, 'stroke-width': 1 }, g);
      el('line', { x1: x, y1: 600 - h, x2: x + w, y2: 600 - h, stroke: '#B6FF4D', 'stroke-opacity': 0.06 + L.depth / 400, 'stroke-width': 1 }, g);
      x += w + R() * 18;
    }
  }
  const stage = $('#stage');
  stage.addEventListener('pointermove', (e) => {
    if (REDUCED.matches) return;
    const r = stage.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5;
    svg.querySelectorAll('g[data-depth]').forEach(g => { g.setAttribute('transform', `translate(${(-dx * g.dataset.depth).toFixed(1)},0)`); });
  });
}

/* ---------------------------------------------------------------- brain: nodes + compositions */
function slotFor(s) {
  if (S.slotOf.has(s.id)) return S.slotOf.get(s.id);
  const r = s.region; const used = S.slotUsed[r] instanceof Set ? S.slotUsed[r] : (S.slotUsed[r] = new Set());
  let i = 0; while (used.has(i)) i++;
  used.add(i); S.slotIdx.set(s.id, i);
  let p = (SLOTS[r] || [])[i];
  if (!p) { const R = rng(hash(s.id)); const [ax, ay] = ANCHOR[r] || [500, 300]; p = [ax + (R() - 0.5) * 120, ay + (R() - 0.5) * 120]; }
  S.slotOf.set(s.id, p); return p;
}
function freeSlot(id, region) {
  if (!S.slotIdx.has(id)) return;
  S.slotUsed[region] && S.slotUsed[region].delete(S.slotIdx.get(id)); S.slotIdx.delete(id); S.slotOf.delete(id);
}
// eliminated strategies stay on the brain as ash for one generation, then leave it (still listed + in timeline)
function elimGen() {
  const m = new Map();
  for (const g of S.gens || []) for (const id of g.eliminated || []) m.set(id, g.n);
  return m;
}

function renderBrain() {
  const st = S.state; if (!st) return;
  const rsig = AMR.info(st).map(r => r.id + ':' + r.status + ':' + (r.pct == null ? '' : Math.round(r.pct * 100)) + (r.born ? '!' : '')).join('|');
  if (rsig !== S.regSig) { S.regSig = rsig; buildBrainShell(); }
  const gN = $('#nodes'), gC = $('#comps');
  const eg = elimGen(); const curGen = st.generation || 0;
  const all = [];
  for (const reg of st.regions || []) for (const s of reg.strategies || []) {
    if (s.status === 'eliminated' && !S.dying.has(s.id)) {
      const g = eg.get(s.id);
      if (g == null || curGen - g > 1) continue;
    }
    all.push(s);
  }
  const keep = new Set(all.map(s => s.id));
  for (const [id, n] of S.nodes) if (!keep.has(id)) { n.g.remove(); S.nodes.delete(id); freeSlot(id, n.region); }
  // stable slot order: actives first (gen asc), then id
  all.slice().sort((a, b) => ((a.status === 'eliminated') - (b.status === 'eliminated')) || (a.generation - b.generation) || a.id.localeCompare(b.id)).forEach(slotFor);
  const maxT = Math.max(1, ...all.map(s => s.stats?.trades || 0));
  const now = performance.now();

  for (const s of all) {
    let n = S.nodes.get(s.id);
    const [x, y] = S.slotOf.get(s.id);
    if (!n) {
      const g = el('g', { class: 'node', tabindex: 0, role: 'button', 'data-id': s.id, transform: `translate(${x},${y})` }, gN);
      el('circle', { class: 'halo', r: 14 }, g);
      el('circle', { class: 'core', r: 7 }, g);
      const t1 = el('text', { class: 'nlabel', x: 13, y: -2 }, g);
      const t2 = el('text', { class: 'nsub', x: 13, y: 10 }, g);
      g.addEventListener('click', () => select('s', s.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select('s', s.id); } });
      n = { g, core: g.children[1], halo: g.children[0], t1, t2, x, y, region: s.region };
      S.nodes.set(s.id, n);
      if (S.initDone && s.generation > 0) S.born.set(s.id, now + 5000);
    }
    n.s = s;
    const r = 5 + 6 * Math.sqrt((s.stats?.trades || 0) / maxT);
    n.core.setAttribute('r', r.toFixed(1)); n.halo.setAttribute('r', (r + 6).toFixed(1));
    n.t1.textContent = shortStrat(s.id);
    n.t2.textContent = `v${s.version} · g${s.generation} · ${s.stats?.trades ?? 0}t`;
    const dead = s.status === 'eliminated';
    n.g.classList.toggle('dead', dead && !S.dying.has(s.id));
    n.g.classList.toggle('born', S.born.has(s.id));
    n.g.setAttribute('aria-label', `${REGION_LABEL[s.region]} strategy ${s.id}, version ${s.version}, ${s.status}, ${s.stats?.trades ?? 0} trades, PnL ${hype(s.stats?.pnl_micro)} paper ETH`);
  }

  // compositions = nerves crossing the three lobes
  const comps = st.compositions || [];
  const eqs = comps.map(c => Math.abs((c.equity_micro ?? S.initEq) - S.initEq));
  const maxEq = Math.max(1, ...eqs);
  const live = new Set();
  comps.forEach((c) => {
    const ids = [c.strategies?.awareness, c.strategies?.timing, c.strategies?.risk];
    const ns = ids.map(i => S.nodes.get(i)); if (ns.some(x => !x)) return;
    live.add(c.id);
    const k = ((hash(c.id) % 9) - 4) * 7;
    const [a, b, r] = ns;
    const m1 = [(a.x + b.x) / 2, (a.y + b.y) / 2 + k], m2 = [(b.x + r.x) / 2 + k * 0.6, (b.y + r.y) / 2 - k];
    const d = `M${a.x},${a.y}Q${m1}  ${b.x},${b.y}Q${m2} ${r.x},${r.y}`;
    let o = S.comps.get(c.id);
    if (!o) {
      const hit = el('path', { class: 'comp-hit', tabindex: -1, 'data-id': c.id }, gC);
      const path = el('path', { class: 'comp' }, gC);
      hit.addEventListener('click', () => select('c', c.id));
      o = { path, hit }; S.comps.set(c.id, o);
    }
    if (o.d !== d) { o.path.setAttribute('d', d); o.hit.setAttribute('d', d); o.d = d; o.len = o.path.getTotalLength(); }
    o.c = c;
    const pnl = (c.equity_micro ?? S.initEq) - S.initEq;
    const w = 0.5 + 1.8 * (Math.abs(pnl) / maxEq);           // thickness from real paper PnL magnitude
    o.path.setAttribute('stroke-width', w.toFixed(2));
    o.path.setAttribute('stroke-opacity', (c.open_positions > 0 ? 0.42 : 0.16).toFixed(2)); // glow from open positions
    o.path.classList.toggle('halted', !!c.halted);
    o.path.classList.toggle('sel', !!(S.sel && S.sel.kind === 'c' && S.sel.id === c.id));
    o.path.classList.toggle('rel', !!(S.sel && S.sel.kind === 's' && Object.values(c.strategies || {}).includes(S.sel.id)));
  });
  for (const [id, o] of S.comps) if (!live.has(id)) { o.path.remove(); o.hit.remove(); S.comps.delete(id); }
  for (const [id, n] of S.nodes) n.g.classList.toggle('sel', !!(S.sel && S.sel.kind === 's' && S.sel.id === id));
  $('#stagemsg').hidden = true;
}

/* ---------------------------------------------------------------- pulses (driven only by SSE events) */
function initPool() {
  const g = $('#pulses');
  for (let i = 0; i < MAX_PULSES; i++) { const c = el('circle', { r: 3.2, class: 'pulse', visibility: 'hidden' }, g); S.pool.push(c); }
}
function spawnPulse(spec) {
  if (gl3d()) return false; // 3D view owns the pulses; the hidden 2D fallback stays still
  if (!S.pool.length) return false; // cap reached: drop the visual, the event is still counted
  const c = S.pool.pop(); c.setAttribute('class', 'pulse' + (spec.cls ? ' ' + spec.cls : ''));
  if (spec.fill) c.setAttribute('style', 'fill:' + spec.fill); else c.removeAttribute('style');
  c.setAttribute('visibility', 'visible');
  S.pulses.push({ c, t0: performance.now(), ...spec });
  kick(); return true;
}
function pulseComp(compId) {
  const o = S.comps.get(compId); if (!o) return;
  const now = performance.now();
  S.hot.set(compId, now + 700);
  const c = o.c; if (c) for (const id of Object.values(c.strategies || {})) S.fire.set(id, now + 600);
  if (REDUCED.matches) { kick(); return; }
  if (now - (S.compLastPulse.get(compId) || 0) < 160) { kick(); return; }
  S.compLastPulse.set(compId, now);
  spawnPulse({ comp: o, dur: 1100 });
}
function pulseObs(ev) {
  const p = ev.payload || {};
  const aw = [...S.nodes.values()].filter(n => n.region === 'awareness' && n.s && n.s.status !== 'eliminated');
  if (!aw.length) return;
  const n = aw[hash(String(p.token || ev.id)) % aw.length];
  S.fire.set(n.s.id, performance.now() + 400);
  const synth = ev.label === 'SYNTHETIC_TEST', rec = !!p.recorded;
  if (REDUCED.matches) { kick(); return; }
  spawnPulse({ line: [INLET[0], INLET[1], n.x, n.y], dur: 700, cls: 'obs', fill: synth ? '#8A949E' : rec ? '#D9E6B8' : '#B6FF4D' });
}
function kick() { if (!S.raf) S.raf = requestAnimationFrame(tick); }
function tick(now) {
  S.raf = 0;
  for (let i = S.pulses.length - 1; i >= 0; i--) {
    const p = S.pulses[i]; const t = (now - p.t0) / p.dur;
    if (t >= 1 || (p.comp && !p.comp.path.isConnected)) { p.c.setAttribute('visibility', 'hidden'); S.pool.push(p.c); S.pulses.splice(i, 1); continue; }
    let x, y;
    if (p.comp) { const pt = p.comp.path.getPointAtLength(t * p.comp.len); x = pt.x; y = pt.y; }
    else { const [x0, y0, x1, y1] = p.line; x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t; }
    p.c.setAttribute('cx', x.toFixed(1)); p.c.setAttribute('cy', y.toFixed(1));
  }
  const timers = [[S.fire, (id, on) => S.nodes.get(id)?.g.classList.toggle('fire', on)],
    [S.hot, (id, on) => S.comps.get(id)?.path.classList.toggle('hot', on)],
    [S.born, (id, on) => S.nodes.get(id)?.g.classList.toggle('born', on)],
    [S.dying, (id, on) => { const n = S.nodes.get(id); if (!n) return; n.g.classList.toggle('dying', on); if (!on) n.g.classList.add('dead'); }]];
  let pending = S.pulses.length > 0;
  for (const [map, fn] of timers) for (const [id, until] of map) {
    if (now >= until) { fn(id, false); map.delete(id); } else { fn(id, true); pending = true; }
  }
  if (pending) S.raf = requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------- SSE with backoff */
function connect() {
  if (S.es) { S.es.close(); S.es = null; }
  setStream('connecting');
  const es = new EventSource('/api/stream?since=' + S.lastEventId);
  S.es = es;
  es.onopen = () => { S.backoff = 1000; S.sseOk = true; setStream('open'); };
  for (const t of ['circuit_message', 'circuit_veto', 'circuit_memory', 'circuit_learning', 'circuit_decision', 'circuit_evolution']) { // own id space: never touches S.lastEventId
    es.addEventListener(t, (m) => { try { if (window.CIRC) window.CIRC.sse(JSON.parse(m.data), t); } catch (e) { console.warn('bad circuit event', e); } });
  }
  for (const t of ['observation', 'decision', 'fill', 'generation', 'elimination', 'birth', 'halt', 'data_status', 'heartbeat', 'live_intent', 'live_tx', 'live_fill', 'live_halt']) {
    es.addEventListener(t, (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.warn('bad event', e); } });
  }
  es.onerror = () => {
    es.close(); if (S.es === es) S.es = null; S.sseOk = false;
    const wait = S.backoff; S.backoff = Math.min(30000, S.backoff * 2);
    setStream('retry', wait);
    setTimeout(connect, wait);
  };
}
function setStream(st, wait) {
  const e = $('#stream');
  e.textContent = st === 'open' ? 'stream · open' : st === 'retry' ? `stream · lost · retry in ${Math.round(wait / 1000)}s` : 'stream · connecting';
  e.style.color = st === 'open' ? '' : 'var(--coral)';
}

let refreshT = {};
function later(key, fn, ms) { if (refreshT[key]) return; refreshT[key] = setTimeout(() => { refreshT[key] = 0; fn(); }, ms); }

function onEvent(ev) {
  if (ev.id && ev.id <= S.lastEventId) return;
  if (ev.id) S.lastEventId = ev.id;
  const typ = ev.type; markReady();
  if (window.DBLOG) { try { window.DBLOG.event(ev); } catch (e) { console.warn(e); } }
  if (typ.startsWith('live_')) return;
  const g3 = gl3d(); if (g3) { try { g3.event(ev); } catch (e) { console.warn(e); } }
  if (typ === 'observation' || typ === 'decision' || typ === 'fill') {
    const now = Date.now(); S.sigTimes.push(now); S.lastSignal = now;
    if (S.sigTimes.length > 4000) S.sigTimes.splice(0, S.sigTimes.length - 4000);
    logSig(ev);
  }
  switch (typ) {
    case 'observation': pulseObs(ev); later('tokens', loadTokens, 2500);
      if (ev.payload && ev.payload.block) $('#block').textContent = ev.payload.block; break;
    case 'decision': if (ev.composition) pulseComp(ev.composition);
      if (ev.payload && ev.payload.control) later('state', loadState, 200);
      break;
    case 'fill': if (ev.composition) pulseComp(ev.composition); later('trades', loadTrades, 1500); later('state', loadState, 2500); break;
    case 'birth': if (ev.strategy) S.born.set(ev.strategy, performance.now() + 5000); logSig(ev, 'sig'); later('state', loadState, 150); kick(); break;
    case 'elimination': if (ev.strategy) S.dying.set(ev.strategy, performance.now() + 1700); logSig(ev, 'sig'); later('state', loadState, 150); kick(); break;
    case 'generation': logSig(ev, 'sig'); later('gens', loadGens, 300); later('state', loadState, 300); break;
    case 'halt': logSig(ev, 'sig'); if (ev.payload && 'killed' in ev.payload) setKill(ev.payload.killed);
      if (ev.composition) { S.hot.set(ev.composition, performance.now() + 2500); kick(); }
      later('state', loadState, 200); break;
    case 'data_status': setStatus(ev.payload && ev.payload.data_status, ev.payload && ev.payload.why); break;
    case 'heartbeat': if (ev.payload && ev.payload.data_status) setStatus(ev.payload.data_status); break;
  }
}

function logSig(ev, cls) {
  const ol = $('#siglog'); const li = document.createElement('li');
  const p = ev.payload || {};
  let txt = ev.type;
  if (ev.type === 'fill') { txt = `fill · ${p.side} ${p.symbol || shortAddr(p.token)} · ${shortComp(ev.composition)}`; cls = cls || 'fill'; }
  else if (ev.type === 'decision') { txt = `decide · ${p.action || p.control} · ${shortComp(ev.composition)}`; cls = cls || 'dec'; }
  else if (ev.type === 'observation') { txt = `obs · ${p.kind} ${p.symbol || shortAddr(p.token)} · blk ${p.block ?? '—'}`; cls = cls || 'obs'; }
  else if (ev.type === 'birth') txt = `birth · ${ev.strategy} (from ${p.parent_id})`;
  else if (ev.type === 'elimination') txt = `eliminated · ${ev.strategy}`;
  else if (ev.type === 'generation') txt = `generation ${p.n} · ${p.verdict}`;
  else if (ev.type === 'halt') txt = `halt · ${p.control || p.reason || ev.composition || ''}`;
  li.className = 't-' + (cls || 'dec');
  li.textContent = txt + (ev.label === 'SYNTHETIC_TEST' ? ' · synth' : '');
  ol.prepend(li);
  while (ol.children.length > 5) ol.lastElementChild.remove();
}

/* ---------------------------------------------------------------- status + clock */
let dataReady = false, lastStatus = null;
function markReady() { if (dataReady) return; dataReady = true; if (lastStatus) setStatus(lastStatus[0], lastStatus[1]); }
function setStatus(st, why) {
  if (!st) return;
  lastStatus = [st, why];
  // never claim LIVE (or any data status) before the first state / SSE event has actually arrived
  const [txt, cls, desc] = dataReady ? (STATUS[st] || [st.toUpperCase(), 'pill-wait', '']) : ['CONNECTING', 'pill-wait', 'waiting for the first state from the API'];
  const g = $('#gstatus'); g.textContent = txt; g.className = 'pill ' + cls;
  g.title = 'Global data status: ' + (why ? `${desc} · ${why}` : desc);
  g.setAttribute('aria-label', `Data status ${txt}. ${desc}${why ? '. ' + why : ''}`);
}
function setKill(killed) {
  const k = $('#killstate');
  k.textContent = killed ? 'KILLED · NO ENTRIES' : 'KILL · OFF';
  k.className = 'pill ' + (killed ? 'pill-killed' : 'pill-armed');
  $('#killframe').hidden = !killed;
}
function secTick() {
  const d = new Date(); $('#clock').textContent = d.toISOString().slice(11, 19) + ' UTC';
  const cut = Date.now() - 60000; while (S.sigTimes.length && S.sigTimes[0] < cut) S.sigTimes.shift();
  $('#h-rate').textContent = S.sigTimes.length;
  const firing = Date.now() - S.lastSignal < 4000;
  const synth = S.health && S.health.data_status === 'synthetic';
  $('#firing').textContent = firing ? 'FIRING' : 'IDLE';
  $('#firing').parentElement.title = firing ? (synth ? 'Signals arriving now (synthetic test events)' : 'Network events arriving now') : 'No events in the last 4 s · the brain only breathes';
  $('#livedot').classList.toggle('on', firing);
  $('#brain').classList.toggle('breathing', !firing && !REDUCED.matches);
}

/* ---------------------------------------------------------------- loaders */
async function loadHealth() {
  try {
    const h = await getJSON('/healthz'); S.health = h;
    setStatus(h.data_status, h.last_error ? 'error: ' + h.last_error.slice(0, 60) : (h.source ? 'source ' + h.source : ''));
    setKill(!!h.killed);
    if (h.last_block) $('#block').textContent = h.last_block;
    return h;
  } catch (e) { setStatus('stale', 'API unreachable'); throw e; }
}
async function loadState() {
  try {
    const st = await getJSON('/api/state'); S.state = st;
    S.initEq = st.risk?.limits?.initial_equity_micro || 1e9;
    $('#chain').textContent = st.chain?.id ?? '—';
    $('#block').textContent = st.chain?.last_block ?? '—';
    setKill(!!st.killed);
    let act = 0, dead = 0;
    for (const r of st.regions || []) for (const s of r.strategies || []) s.status === 'eliminated' ? dead++ : act++;
    $('#h-gen').textContent = st.generation ?? '—';
    $('#h-pop').textContent = `${act} active · ${dead} eliminated · ${(st.compositions || []).length} compositions`;
    const t = st.totals || {};
    $('#statusline').textContent = `${t.observations ?? 0} observations · ${t.tokens ?? 0} tokens · ${t.paper_fills ?? 0} paper fills · ${t.closed_trades ?? 0} closed · source ${st.chain?.source ?? '—'}`;
    renderBrain(); renderStrategies(); renderEquity();
    if (gl3d()) gl3d().state(st);
    $('#stagemsg').hidden = true; markReady();
    if (S.sel && S.sel.kind === 'c' && !(gl3d() && gl3d().hist)) renderInspectorComp(S.sel.id);
  } catch (e) {
    console.warn(e);
    if (!S.state) { $('#stagemsg').hidden = false; $('#stagemsg').textContent = 'Could not load brain state. Retrying.'; }
  }
}
async function loadTrades() {
  const body = $('#tape-body');
  try {
    const rows = await getJSON('/api/trades?limit=60'); S.trades = rows;
    if (!rows.length) { body.innerHTML = '<p class="empty">No paper fills yet. The strategies are waiting for a signal.</p>'; return; }
    const first = S.seenTrades.size === 0;
    body.innerHTML = '<table><caption class="skip">Recent paper fills</caption><thead><tr><th>time</th><th>side</th><th>token</th><th class="col-hide">composition</th><th class="r">qty</th><th class="r">fee</th><th class="r">pnl</th><th>source</th></tr></thead><tbody>' +
      rows.map(r => {
        const isNew = !first && !S.seenTrades.has(r.id);
        return `<tr class="${isNew ? 'new' : ''}"><td>${utc(r.ts)}</td><td class="side-${esc(r.side)}">${esc(r.side)}</td><td title="${esc(r.token)}">${esc(r.symbol || shortAddr(r.token))}</td>` +
          `<td class="col-hide"><button class="linkbtn" data-comp="${esc(r.composition)}">${esc(shortComp(r.composition))}</button></td>` +
          `<td class="r">${sci(r.qty)}</td><td class="r">${hype(r.fee, false)}</td><td class="r ${pnlCls(r.pnl_micro)}">${r.side === 'sell' ? hype(r.pnl_micro) : '·'}</td>` +
          `<td>${provBadges(r.label, r.data_label, r.recorded)}</td></tr>`;
      }).join('') + '</tbody></table><p class="empty" style="font-size:11px">fee and pnl in paper ETH · qty in raw token units · quote source: ' + esc(rows[0].quote_source || '—') + '</p>';
    rows.forEach(r => S.seenTrades.add(r.id));
    if (S.seenTrades.size > 2000) S.seenTrades = new Set(rows.map(r => r.id));
  } catch (e) { body.innerHTML = '<p class="err">Trades unavailable: ' + esc(e.message) + '</p>'; }
}
async function loadTokens() {
  const body = $('#tokens-body');
  try {
    const rows = await getJSON('/api/tokens?limit=40'); S.tokens = rows;
    if (!rows.length) { body.innerHTML = '<p class="empty">No tokens observed yet. The launchpad is quiet.</p>'; return; }
    body.innerHTML = '<table><caption class="skip">Observed launchpad tokens</caption><thead><tr><th>token</th><th class="col-hide">address</th><th class="r">block</th><th class="r">trades</th><th>state</th></tr></thead><tbody>' +
      rows.map(t => `<tr><td title="${esc(t.name)}">${esc(t.symbol || '(no symbol)')}</td><td class="col-hide">${esc(shortAddr(t.token))}</td><td class="r">${esc(t.created_block ?? '—')}</td><td class="r">${esc(t.trades)}</td>` +
        `<td>${t.graduated ? '<span class="b b-off" title="graduated: not eligible for entry">GRAD</span> ' : ''}${provBadges(t.label, null, t.recorded)}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { body.innerHTML = '<p class="err">Token feed unavailable: ' + esc(e.message) + '</p>'; }
}
async function loadGens() {
  const body = $('#gens-body');
  try {
    const gens = await getJSON('/api/generations'); S.gens = gens;
    if (gl3d()) gl3d().gens(gens);
    if (!gens.length) { body.innerHTML = '<p class="empty">No generation boundary yet. Gen 0 is still collecting evidence.</p>'; return; }
    const link = (id) => `<button class="linkbtn" data-sid="${esc(id)}">${esc(id)}</button>`;
    body.innerHTML = gens.slice().reverse().map(g => {
      const vb = g.verdict === 'eliminated' ? 'b-dead' : g.verdict === 'insufficient_evidence' ? 'b-ins' : 'b-ok';
      const det = Object.entries(g.details || {}).map(([reg, d]) => `${esc(reg)}: weakest ${esc(d.weakest)} · t=${esc(d.t)} vs ${esc(d.t_crit)} · n=${esc(d.n)}`).join('<br>');
      const surv = (g.survivors || []).filter(s => !(g.born || []).includes(s));
      return `<div class="gen v-${esc(g.verdict)}"><div class="gh"><span class="gn">GEN ${esc(g.n)}</span><span class="b ${vb}">${esc(String(g.verdict).replace(/_/g, ' '))}</span>${provBadges(g.label)}</div>` +
        `<div class="gline">eliminated: ${(g.eliminated || []).length ? g.eliminated.map(link).join(', ') : 'none'}</div>` +
        `<div class="gline">born: ${(g.born || []).length ? g.born.map(link).join(', ') : 'none'} · survivors ${(g.survivors || []).length}</div>` +
        (det ? `<div class="gline">${det}</div>` : '') +
        `<div class="gdots" aria-hidden="true">${surv.map(() => '<i></i>').join('')}${(g.born || []).map(() => '<i class="n"></i>').join('')}${(g.eliminated || []).map(() => '<i class="x"></i>').join('')}</div>` +
        `<div class="hash" title="tournament hash">${esc(String(g.tournament_hash || '').slice(0, 24))}…</div></div>`;
    }).join('');
  } catch (e) { body.innerHTML = '<p class="err">Generations unavailable: ' + esc(e.message) + '</p>'; }
}

/* ---------------------------------------------------------------- panels */
function renderStrategies() {
  const st = S.state; const body = $('#strat-body');
  body.innerHTML = AMR.info(st).map(ri => { const r = { id: ri.id, name: ri.name, strategies: ri.strategies };
    if (ri.status === 'dormant') return `<div class="region"><h3><span>🔒 ${esc(ri.name)}</span><span>dormant</span></h3><p class="empty" style="font-size:11px">${esc(ri.lock)}. Embryonic: no strategies compete here yet.</p></div>`;
    const act = r.strategies.filter(s => s.status !== 'eliminated').length;
    return `<div class="region"><h3><span>${esc(REGION_LABEL[r.id] || r.name)}</span><span>${act} alive / ${r.strategies.length}</span></h3><ul class="slist">` +
      r.strategies.map(s => `<li><button class="${s.status === 'eliminated' ? 'dead' : ''}" data-sid="${esc(s.id)}" aria-current="${S.sel && S.sel.id === s.id}">` +
        `<span>${esc(s.id)} <span class="mut">v${esc(s.version)}·g${esc(s.generation)}</span></span><span class="mut">${esc(s.status)} · ${esc(s.stats?.trades ?? 0)}t</span>` +
        `<span class="${pnlCls(s.stats?.pnl_micro)}">${hype(s.stats?.pnl_micro)}</span></button></li>`).join('') + '</ul></div>';
  }).join('') + '<p class="empty" style="font-size:11px">PnL in paper ETH, after fees.</p>';
}
function renderEquity() {
  const st = S.state; const comps = st.compositions || []; const body = $('#equity-body');
  if (!comps.length) { body.innerHTML = '<p class="empty">No compositions yet.</p>'; return; }
  const tot = comps.reduce((a, c) => a + (c.equity_micro || 0), 0); const base = S.initEq * comps.length;
  S.eqTrace.push(tot); if (S.eqTrace.length > 240) S.eqTrace.shift();
  const halted = comps.filter(c => c.halted).length, open = comps.reduce((a, c) => a + (c.open_positions || 0), 0);
  const tr = S.eqTrace; const lo = Math.min(base, ...tr), hi = Math.max(base, ...tr), span = Math.max(1, hi - lo);
  const W = 400, H = 120, yy = (v) => (H - 8 - (v - lo) / span * (H - 16)).toFixed(1);
  const pts = tr.map((v, i) => `${(tr.length === 1 ? W : i / (tr.length - 1) * W).toFixed(1)},${yy(v)}`).join(' ');
  const pnls = comps.map(c => (c.equity_micro || 0) - S.initEq); const mx = Math.max(1, ...pnls.map(Math.abs));
  body.innerHTML = `<div class="big"><div><span>total paper equity</span><b>${(tot / 1e6).toFixed(2)}</b></div>` +
    `<div><span>vs start</span><b class="${pnlCls(tot - base)}">${hype(tot - base)}</b></div><div><span>open</span><b>${open}</b></div><div><span>halted</span><b class="${halted ? 'neg' : ''}">${halted}</b></div></div>` +
    (tr.length < 3 ? `<p class="empty">Collecting equity samples in this browser (${tr.length} so far).</p>` :
    `<svg class="eq-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Total paper equity sampled since page load"><line class="eq-base" x1="0" x2="${W}" y1="${yy(base)}" y2="${yy(base)}"/><polyline class="eq-line" points="${pts}"/></svg>` +
    `<div class="h-meta">trace: sampled in this browser since page load (${tr.length} samples) · dashed line = starting equity</div>`) +
    `<div class="bars" role="img" aria-label="Paper PnL per composition">${comps.map((c, i) => `<i class="${pnls[i] < 0 ? 'n' : ''} ${c.halted ? 'h' : ''}" style="height:${Math.max(2, Math.abs(pnls[i]) / mx * 100).toFixed(0)}%" title="${esc(shortComp(c.id))}: ${hype(pnls[i])}"></i>`).join('')}</div>` +
    `<div class="h-meta">PnL per composition (${comps.length}) · coral = loss · outlined = halted</div>`;
}

/* ---------------------------------------------------------------- inspector */
const gl3d = () => document.body.classList.contains('gl-on') && window.DB3D;
function openInspector(kind) {
  const p = $('#inspect'); p.hidden = false; if (kind) $('#insp-kind').textContent = kind;
  document.body.classList.add('insp-open');
}
function closeInspector() {
  $('#inspect').hidden = true; document.body.classList.remove('insp-open');
  if (S.sel) { S.sel = null; for (const [, n] of S.nodes) n.g.classList.remove('sel'); for (const [, o] of S.comps) o.path.classList.remove('sel', 'rel'); $('#comps').classList.remove('focus'); }
}
function announce(t) { const e = $('#sr-live'); if (e) e.textContent = t; }
function select(kind, id) {
  const g = gl3d();
  if (g && g.hist && g.inspectHistorical(kind, id)) { S.sel = { kind, id }; return; }
  S.sel = { kind, id };
  for (const [nid, n] of S.nodes) n.g.classList.toggle('sel', kind === 's' && nid === id);
  for (const [cid, o] of S.comps) {
    o.path.classList.toggle('sel', kind === 'c' && cid === id);
    o.path.classList.toggle('rel', kind === 's' && !!o.c && Object.values(o.c.strategies || {}).includes(id));
  }
  $('#comps').classList.toggle('focus', kind === 's');
  document.querySelectorAll('#strat-body button[data-sid]').forEach(b => b.setAttribute('aria-current', String(b.dataset.sid === id)));
  openInspector();
  if (g) g.selected(kind, id);
  if (kind === 's') renderInspectorStrategy(id); else renderInspectorComp(id);
  announce(kind === 's' ? `Inspecting strategy ${id}.` : `Inspecting composition ${shortComp(id)}.`);
  if (!g) $('#inspect').focus({ preventScroll: true });
}
async function renderInspectorStrategy(id) {
  const body = $('#insp-body'); $('#insp-kind').textContent = 'strategy';
  body.innerHTML = '<p class="empty">Loading ' + esc(id) + '.</p>';
  try {
    const s = await getJSON('/api/strategy/' + encodeURIComponent(id));
    if (!S.sel || S.sel.id !== id) return;
    const st = s.stats || {}; const dead = s.status === 'eliminated';
    const link = (x) => `<button class="linkbtn" data-sid="${esc(x)}">${esc(x)}</button>`;
    const params = Object.entries(s.params || {}).map(([k, v]) => {
      const ch = s.changes && s.changes[k];
      return `<span class="pchip ${ch ? 'chg' : ''}"><i>${esc(k)}</i> ${ch ? esc(ch[0]) + '→' : ''}${esc(v)}</span>`;
    }).join('');
    const dec = (s.recent_decisions || []).slice(-10).reverse();
    body.innerHTML = `<div class="big"><div><span>${esc(REGION_LABEL[s.region] || s.region)}</span><b>${esc(s.id)}</b></div>` +
      `<div><span>status</span><b class="${dead ? 'neg' : 'pos'}">${esc(s.status)}</b></div></div>` +
      `<div class="big"><div><span>trades</span><b>${esc(st.trades ?? 0)}</b></div><div><span>pnl · paper</span><b class="${pnlCls(st.pnl_micro)}">${hype(st.pnl_micro)}</b></div>` +
      `<div><span>score</span><b>${esc(st.score ?? '—')}</b></div><div><span>win rate</span><b>${pct(st.win_rate)}</b></div></div>` +
      `<dl class="kv"><dt>version</dt><dd>v${esc(s.version)}</dd><dt>generation</dt><dd>g${esc(s.generation)}</dd>` +
      `<dt>parent</dt><dd>${s.parent_id ? link(s.parent_id) : 'seed strategy'}</dd>` +
      `<dt>ancestors</dt><dd>${(s.lineage?.ancestors || []).map(link).join(' ← ') || '—'}</dd>` +
      `<dt>children</dt><dd>${(s.lineage?.children || []).map(link).join(', ') || '—'}</dd>` +
      `<dt>mutation seed</dt><dd>${esc(s.seed || '—')}</dd><dt>config hash</dt><dd>${esc(s.config_hash)}</dd></dl>` +
      `<div class="sub">params ${s.changes && Object.keys(s.changes).length ? '· outlined = mutated from parent' : ''}</div><div>${params || '—'}</div>` +
      `<div class="sub">recent decisions <span class="b b-pol">POLICY</span></div>` +
      (dec.length ? '<table><thead><tr><th>time</th><th>action</th><th>reason</th><th>token</th><th class="col-hide">composition</th></tr></thead><tbody>' +
        dec.map(d => `<tr><td>${utc(d.ts)}</td><td class="${d.action === 'enter' ? 'side-buy' : 'side-sell'}">${esc(d.action)}</td><td>${esc(d.reason)}</td><td>${esc(shortAddr(d.token))}</td>` +
          `<td class="col-hide"><button class="linkbtn" data-comp="${esc(d.composition)}">${esc(shortComp(d.composition))}</button></td></tr>`).join('') + '</tbody></table>'
        : '<p class="empty">No decisions yet.</p>');
  } catch (e) { body.innerHTML = '<p class="err">Could not load strategy: ' + esc(e.message) + '</p>'; }
}
async function renderInspectorComp(id) {
  const body = $('#insp-body'); $('#insp-kind').textContent = 'composition · nerve tract';
  const c = (S.state?.compositions || []).find(x => x.id === id);
  if (!c) { body.innerHTML = '<p class="empty">This composition is no longer active. One of its strategies was eliminated.</p>'; return; }
  const pnl = (c.equity_micro || 0) - S.initEq;
  const link = (x) => `<button class="linkbtn" data-sid="${esc(x)}">${esc(x)}</button>`;
  let fills = [], views = [];
  try {
    [fills, ...views] = await Promise.all([getJSON('/api/trades?limit=300'),
      ...REGION_ORDER.map(r => getJSON('/api/strategy/' + encodeURIComponent(c.strategies[r])).catch(() => null))]);
    fills = fills.filter(f => f.composition === id).slice(0, 8);
  } catch (e) { /* shown as empty below */ }
  if (!S.sel || S.sel.id !== id) return;
  const decs = [];
  const seen = new Set();
  for (const v of views) for (const d of (v?.recent_decisions || [])) if (d.composition === id) {
    const k = d.ts + d.action + d.token; if (!seen.has(k)) { seen.add(k); decs.push(d); }
  }
  decs.sort((a, b) => b.ts - a.ts);
  const member = (v, r) => {
    if (!v) return `<div class="member"><div class="m-h">${esc(REGION_LABEL[r])}: ${link(c.strategies[r])}</div><p class="err">strategy unavailable</p></div>`;
    const st = v.stats || {};
    return `<div class="member"><div class="m-h"><span class="mut">${esc(REGION_LABEL[r])}</span> ${link(v.id)} <span class="b ${v.status === 'eliminated' ? 'b-dead' : v.status === 'challenger' ? 'b-paper' : 'b-ok'}">${esc(v.status)}</span></div>` +
      `<div class="m-l">v${esc(v.version)} · born gen ${esc(v.generation)} · ${v.parent_id ? 'parent ' + link(v.parent_id) : 'seed strategy'} · ${esc((v.lineage?.ancestors || []).length)} ancestors · seed ${esc(v.seed || '—')}</div>` +
      `<div>${Object.entries(v.params || {}).map(([k, x]) => `<span class="pchip ${v.changes?.[k] ? 'chg' : ''}"><i>${esc(k)}</i> ${v.changes?.[k] ? esc(v.changes[k][0]) + '→' : ''}${esc(x)}</span>`).join('')}</div>` +
      `<div class="m-l">strategy totals across all its compositions: ${esc(st.trades ?? 0)} trades · <span class="${pnlCls(st.pnl_micro)}">${hype(st.pnl_micro)}</span> paper · score ${esc(st.score ?? '—')}</div></div>`;
  };
  body.innerHTML = `<p class="histnote">A composition is not a strategy. It wires one strategy from each region into its own isolated paper book. Book figures below belong to this composition only.</p>` +
    `<div class="big"><div><span>composition id</span><b style="font-size:12px;word-break:break-all">${esc(id)}</b></div></div>` +
    `<div class="big"><div><span>paper equity</span><b>${((c.equity_micro || 0) / 1e6).toFixed(4)}</b></div><div><span>book pnl</span><b class="${pnlCls(pnl)}">${hype(pnl)}</b></div>` +
    `<div><span>open</span><b>${esc(c.open_positions)}</b></div><div><span>state</span><b class="${c.halted ? 'neg' : 'pos'}">${c.halted ? 'halted' : 'trading'}</b></div></div>` +
    `<div class="sub">mapped strategies</div>` + REGION_ORDER.map((r, i) => member(views[i], r)).join('') +
    `<div class="sub">decisions on this book <span class="b b-pol">POLICY</span></div>` +
    (decs.length ? '<table><thead><tr><th>time</th><th>action</th><th>reason</th><th>token</th></tr></thead><tbody>' +
      decs.slice(0, 10).map(d => `<tr><td>${utc(d.ts)}</td><td class="${d.action === 'enter' ? 'side-buy' : 'side-sell'}">${esc(d.action)}</td><td>${esc(d.reason)}</td><td>${esc(shortAddr(d.token))}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="empty">No decisions for this book in the strategies\' recent windows.</p>') +
    `<div class="sub">recent paper fills</div>` +
    (fills.length ? '<table><thead><tr><th>time</th><th>side</th><th>token</th><th class="r">pnl</th></tr></thead><tbody>' +
      fills.map(f => `<tr><td>${utc(f.ts)}</td><td class="side-${esc(f.side)}">${esc(f.side)}</td><td>${esc(f.symbol || shortAddr(f.token))}</td><td class="r ${pnlCls(f.pnl_micro)}">${f.side === 'sell' ? hype(f.pnl_micro) : '·'}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="empty">No fills in the recent tape for this composition.</p>') +
    '<p class="empty" style="font-size:11px">Tract thickness = size of this book\'s paper PnL. Brightness = open positions. Grey = halted. No model is invoked anywhere in this chain.</p>';
}

/* ---------------------------------------------------------------- tabs (mobile) + delegation */
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel[data-tab]').forEach(p => p.classList.toggle('is-active', p.dataset.tab === name));
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#insp-close')) { const g = gl3d(); if (g) g.back(); else closeInspector(); return; }
  const t = e.target.closest('[data-tab]'); if (t && t.tagName === 'BUTTON') { showTab(t.dataset.tab); return; }
  const s = e.target.closest('[data-sid]'); if (s) { select('s', s.dataset.sid); return; }
  const c = e.target.closest('[data-comp]'); if (c) { select('c', c.dataset.comp); }
});

/* ---------------------------------------------------------------- boot */
async function boot(attempt = 0) {
  try {
    const h = await loadHealth();
    S.lastEventId = h.last_event_id || 0; // start the stream at the head: no replayed animations
    await loadGens();
    await Promise.all([loadState(), loadTrades(), loadTokens()]);
    S.initDone = true;
    connect();
    setInterval(() => { loadHealth().catch(() => {}); if (!S.sseOk) { loadState(); loadTrades(); } }, 8000);
    setInterval(() => { loadGens(); loadTokens(); }, 20000);
  } catch (e) {
    const wait = Math.min(30000, 1000 * 2 ** attempt);
    const m = $('#stagemsg'); m.hidden = false; m.textContent = `Can't reach the brain's API. Retrying in ${Math.round(wait / 1000)}s.`;
    $('#statusline').textContent = 'API unreachable.';
    setTimeout(() => boot(attempt + 1), wait);
  }
}
buildCity(); buildBrainShell(); initPool();
setInterval(secTick, 1000); secTick();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !gl3d() && S.sel) closeInspector(); });
window.DBAPP = { S, select, openInspector, closeInspector, announce, esc, shortComp, shortStrat, hype, pnlCls, pct };
/* ---------------------------------------------------------------- site config: X link + contract address slot */
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
async function loadSiteConfig() {
  let cfg = {};
  try { const r = await fetch('/site-config.json', { cache: 'no-store' }); if (r.ok) cfg = await r.json(); } catch (e) { /* no config: preserve the reviewed static token identity */ }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
  const x = $('#xlink'); let xu = '';
  try { const u = new URL(String(cfg.x_url || '')); if (u.protocol === 'https:') xu = u.href; } catch (e) { /* ignore invalid */ }
  if (xu) { x.href = xu; x.target = '_blank'; x.rel = 'noopener noreferrer'; x.removeAttribute('aria-disabled'); x.removeAttribute('tabindex'); x.title = 'ALPHAMORPH on X'; x.classList.remove('off'); }
  else { x.removeAttribute('href'); x.removeAttribute('target'); x.setAttribute('aria-disabled', 'true'); x.tabIndex = -1; x.title = 'X link coming soon'; x.classList.add('off'); }
  const v = $('#ca-v'), b = $('#ca-copy'), pill = $('#capill');
  const configuredCA = typeof cfg.ca === 'string' ? cfg.ca.trim() : '';
  const ca = ADDR_RE.test(configuredCA) ? configuredCA : pill.dataset.ca;
  if (ADDR_RE.test(ca)) {
    const chain = typeof cfg.ca_chain === 'string' && /^[\w .-]{1,24}$/.test(cfg.ca_chain) ? cfg.ca_chain : pill.dataset.chain;
    v.textContent = ca.slice(0, 6) + '…' + ca.slice(-4); v.title = ca; pill.title = (chain ? chain + ' · ' : '') + ca;
    b.hidden = false; pill.classList.add('has');
    b.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(ca); ok = true; } catch (e) {
        try { const t = document.createElement('textarea'); t.value = ca; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e2) { ok = false; }
      }
      const fb = $('#ca-fb'); fb.textContent = ok ? 'copied' : 'copy failed'; b.classList.add('done');
      clearTimeout(b._t); b._t = setTimeout(() => { fb.textContent = ''; b.classList.remove('done'); }, 1600);
    };
  } else {
    // Both sources invalid: keep the static text, but do not offer a misleading copy action.
    b.hidden = true; b.onclick = null; pill.classList.remove('has');
  }
}
loadSiteConfig();
boot();
})();
