/* ALPHAMORPH — neural circuits view (SHADOW MODE). Renders ONLY recorded API state from /api/circuits/*.
   Nothing here is decorative: a pulse is drawn only when a real 'message' event src->dst is delivered after the panel was
   primed; node fill = activation_ppm from /status; unknown values are a dash with a tooltip; disabled/404 => honest notice. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#circuits'), body = $('#circ-body'), live = $('#circ-live');
if (!root || !body) return;

const NODES = ['thalamus', 'prefrontal', 'basal_ganglia', 'dopamine', 'cerebellum', 'hippocampus', 'amygdala', 'acc'];
const LABEL = { thalamus: 'Thalamus', prefrontal: 'Prefrontal', hippocampus: 'Hippocampus', amygdala: 'Amygdala', basal_ganglia: 'Basal ganglia', acc: 'ACC', cerebellum: 'Cerebellum', dopamine: 'Dopamine' };
const POS = { thalamus: [280, 62], prefrontal: [452, 132], basal_ganglia: [498, 262], dopamine: [452, 392], cerebellum: [280, 452], hippocampus: [108, 392], amygdala: [62, 262], acc: [108, 132] };
const R = 27, PULSE_MS = 900, MAX_EV = 600;
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

const C = {
  avail: 'loading', why: '', st: null, ev: [], seen: new Set(), cursor: 0, primed: false,
  bench: null, benchWhy: '', lin: null, linWhy: '', mem: { token: null, data: null, why: '', t: 0 },
  selToken: null, selDecision: null, selCircuit: null, open: false, timers: [], lastMsg: null, pulses: 0, graphSig: '',
};

/* ---------------------------------------------------------------- helpers */
const dash = (why) => `<span class="na" tabindex="0" title="${esc(why || 'unknown: not reported by the API')}">—</span>`;
const isN = (v) => typeof v === 'number' && isFinite(v);
const ppmPct = (v, d = 2) => isN(v) ? (v / 1e4).toFixed(d) + '%' : null;
const ppmFrac = (v) => isN(v) ? (Math.abs(v) > 1 ? v / 1e6 : v) : null;
const microUsd = (v) => isN(v) ? '$' + (v / 1e6).toFixed(Math.abs(v) < 1e4 ? 5 : 2) : null;
const orDash = (s, why) => s == null ? dash(why) : esc(s);
const short = (h) => h ? (String(h).length > 16 ? String(h).slice(0, 8) + '…' + String(h).slice(-6) : String(h)) : '';
const tsec = (t) => isN(t) ? (t > 1e12 ? t / 1000 : t) : null;
const clock = (t) => { const s = tsec(t); return s == null ? '—' : new Date(s * 1000).toISOString().slice(11, 19) + 'Z'; };
const ago = (t) => { const s = tsec(t); if (s == null) return null; const d = Math.max(0, Date.now() / 1000 - s); return d < 90 ? Math.round(d) + ' s ago' : d < 5400 ? Math.round(d / 60) + ' min ago' : d < 172800 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago'; };
const ageS = (s) => isN(s) ? (s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d') : null;
const nm = (c) => LABEL[c] || c || '—';
const sec = (id, title, inner, sub) => `<section class="ec-sec" id="${id}" aria-labelledby="${id}-h"><h3 id="${id}-h">${title}${sub ? ` <span class="muted">· ${sub}</span>` : ''}</h3>${inner}</section>`;
const setHTML = (el, html) => { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };
const announce = (t) => { if (live) live.textContent = t; };

async function get(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) return { ok: false, status: r.status, why: r.status === 404 ? 'endpoint not available yet (HTTP 404)' : 'HTTP ' + r.status };
    return { ok: true, status: r.status, data: await r.json() };
  } catch (e) { return { ok: false, status: 0, why: 'fetch failed: ' + e.message }; }
}

/* ---------------------------------------------------------------- data loading */
function applyStatus(r) {
  if (!r.ok) { C.avail = r.status === 404 ? 'missing' : 'error'; C.why = r.why; C.st = null; }
  else if (!r.data || r.data.enabled === false || r.data.enabled == null) { C.avail = 'disabled'; C.why = (r.data && r.data.reason) || ''; C.st = null; }
  else { C.avail = 'ok'; C.st = r.data; C.why = ''; }
  badge(); window.dispatchEvent(new Event('circ-status'));
}
async function loadStatus() { applyStatus(await get('/api/circuits/status')); return C.avail; }
async function loadSlow() {
  const [b, l] = await Promise.all([get('/api/circuits/benchmark'), get('/api/circuits/lineage')]);
  C.bench = b.ok ? b.data : null; C.benchWhy = b.ok ? '' : b.why;
  C.lin = l.ok ? (Array.isArray(l.data) ? l.data : (l.data && l.data.lineage) || []) : null; C.linWhy = l.ok ? '' : l.why;
}
async function loadMemory(force) {
  const tok = C.selToken; if (!tok) return;
  if (!force && C.mem.token === tok && Date.now() - C.mem.t < 15000) return;
  const r = await get('/api/circuits/memory?token=' + encodeURIComponent(tok));
  C.mem = { token: tok, t: Date.now(), data: r.ok ? r.data : null, why: r.ok ? '' : r.why };
}
function kindOf(ev) { return ev.kind || (ev.type ? String(ev.type).replace(/^circuit_/, '') : ''); }
function ingest(ev, fresh) {
  if (!ev || ev.id == null || C.seen.has(ev.id)) return false;
  C.seen.add(ev.id); ev.kind = kindOf(ev); C.ev.push(ev);
  if (ev.id > C.cursor) C.cursor = ev.id;
  if (fresh && ev.kind === 'message') pulse(ev);
  return true;
}
async function pollEvents() {
  let added = 0, fresh = [];
  for (let page = 0; page < 4; page++) {
    const r = await get('/api/circuits/events?since=' + C.cursor + '&limit=200');
    if (!r.ok) return added;
    const arr = Array.isArray(r.data) ? r.data : (r.data && r.data.events) || [];
    arr.sort((a, b) => a.id - b.id);
    for (const e of arr) if (ingest(e, C.primed)) { added++; fresh.push(e); }
    if (arr.length < 200) break;
  }
  C.ev.sort((a, b) => a.id - b.id);
  if (C.ev.length > MAX_EV) C.ev.splice(0, C.ev.length - MAX_EV);
  if (C.primed) {
    const dv = fresh.filter(e => e.kind === 'decision' || e.kind === 'veto').pop();
    if (dv) announce(decisionText(dv));
  }
  C.primed = true;
  return added;
}

/* ---------------------------------------------------------------- event field readers (tolerant: unknown => null) */
const det = (ev) => (ev && ev.detail && typeof ev.detail === 'object') ? ev.detail : {};
function verdictOf(ev) {
  const d = det(ev), v = String(d.verdict ?? d.action ?? d.decision ?? (d.go === true ? 'go' : d.go === false ? 'no_go' : '')).toLowerCase().replace(/[^a-z]/g, '');
  if (ev.kind === 'veto') return 'veto';
  if (v === 'go' || v === 'buy' || v === 'enter') return 'go';
  if (v === 'nogo' || v === 'skip' || v === 'reject') return 'nogo';
  if (v === 'abstain') return 'abstain';
  return v ? 'other:' + v : null;
}
const vetoer = (ev) => { const d = det(ev); return d.vetoed_by ?? d.veto_circuit ?? d.vetoing_circuit ?? d.veto ?? (ev.kind === 'veto' ? ev.circuit : null) ?? null; };
const sizeOf = (ev) => { const d = det(ev); return d.size_ppm ?? d.size ?? null; };
const reasonOf = (ev) => { const d = det(ev); return d.reason ?? d.note ?? null; };
function msgEdge(ev) {
  const d = det(ev); let src = d.src ?? d.from ?? ev.circuit ?? null, dst = d.dst ?? d.to ?? null;
  if ((!src || !dst) && typeof d.edge === 'string' && /->|→/.test(d.edge)) { const p = d.edge.split(/->|→/).map(s => s.trim()); src = src || p[0]; dst = dst || p[1]; }
  else if ((!src || !dst) && d.edge && typeof d.edge === 'object') { src = src || d.edge.src; dst = dst || d.edge.dst; }
  return src && dst ? { src, dst } : null;
}
const decisionText = (ev) => { const v = verdictOf(ev); return `Shadow ${ev.kind}: ${v === 'go' ? 'go' : v === 'nogo' ? 'no-go' : v === 'veto' ? 'veto' : v === 'abstain' ? 'abstain' : (ev.kind)}${vetoer(ev) ? ' by ' + nm(vetoer(ev)) : ''}${ev.token ? ' on ' + short(ev.token) : ''}. Recommendation only, no trade.`; };

/* ---------------------------------------------------------------- 1. circuit graph */
function edgeGeom(a, b) {
  const [x1, y1] = POS[a], [x2, y2] = POS[b]; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const k = Math.min(46, L * 0.16), nx = -uy, ny = ux; // always bends to the left of travel => a->b and b->a never overlap
  const sx = x1 + ux * (R + 3), sy = y1 + uy * (R + 3), ex = x2 - ux * (R + 8), ey = y2 - uy * (R + 8);
  const cx = (x1 + x2) / 2 + nx * k, cy = (y1 + y2) / 2 + ny * k;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
const edgeKey = (e) => e.src + '>' + e.dst;
function graphSkeleton(st) {
  const edges = (st.edges || []).filter(e => POS[e.src] && POS[e.dst]);
  const circs = {}; (st.circuits || []).forEach(c => { circs[c.id] = c; });
  const maxw = Math.max(1e6, ...edges.map(e => Math.abs(e.weight_ppm || 0)));
  const paths = edges.map(e => {
    const inh = e.sign === 'inhibitory', w = isN(e.weight_ppm) ? 0.8 + 5.2 * Math.min(1, Math.abs(e.weight_ppm) / maxw) : 1.2;
    return `<path class="cx-edge ${inh ? 'inh' : 'exc'}" data-k="${esc(edgeKey(e))}" d="${edgeGeom(e.src, e.dst)}" stroke-width="${w.toFixed(2)}" ${inh ? 'stroke-dasharray="7 5"' : ''} marker-end="url(#cx-${inh ? 'inh' : 'exc'})"><title>${esc(nm(e.src))} → ${esc(nm(e.dst))} · ${esc(e.sign || 'sign unknown')} · weight ${isN(e.weight_ppm) ? (e.weight_ppm / 1e6).toFixed(3) : 'unknown'}</title></path>`;
  }).join('');
  const nodes = NODES.map(id => {
    const [x, y] = POS[id];
    const up = y < 200 || id === 'basal_ganglia', ny = up ? -(R + 22) : R + 17, py = up ? -(R + 8) : R + 32; // labels sit on the outer side of each node, away from the edges
    return `<g class="cx-node" data-id="${id}" tabindex="0" role="button" aria-pressed="false" transform="translate(${x} ${y})"><circle class="cx-halo" r="${R + 6}"/><circle class="cx-disc" r="${R}"/><circle class="cx-fill" r="${R - 2}"/><text class="cx-name" y="${ny}" text-anchor="middle">${esc(LABEL[id])}</text><text class="cx-pct" y="${py}" text-anchor="middle">—</text></g>`;
  }).join('');
  return `<svg id="cx-svg" class="cx-svg" viewBox="0 0 560 520" role="group" aria-labelledby="cx-svg-t"><title id="cx-svg-t">Circuit graph: 8 circuits, directed edges. Excitatory edges solid lime, inhibitory dashed red, thickness is weight magnitude. Same data as the edge table below.</title>
    <defs><marker id="cx-exc" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#B6FF4D"/></marker><marker id="cx-inh" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#FF5A4E"/></marker></defs>
    <g id="cx-edges">${paths}</g><g id="cx-pulses" aria-hidden="true"></g><g id="cx-nodes">${nodes}</g></svg>`;
}
function updateGraph() {
  const st = C.st, svg = $('#cx-svg'); if (!st || !svg) return;
  const circs = {}; (st.circuits || []).forEach(c => { circs[c.id] = c; });
  svg.querySelectorAll('.cx-node').forEach(g => {
    const c = circs[g.dataset.id], a = c && isN(c.activation_ppm) ? Math.max(0, Math.min(1, c.activation_ppm / 1e6)) : null;
    const f = g.querySelector('.cx-fill'); f.style.opacity = a == null ? 0 : (0.26 + 0.74 * a).toFixed(3);
    g.classList.toggle('unk', a == null);
    g.querySelector('.cx-pct').textContent = a == null ? '—' : Math.round(a * 100) + '%';
    const lab = `${LABEL[g.dataset.id]}: activation ${a == null ? 'unknown' : Math.round(a * 100) + ' percent'}${c && c.function ? '. ' + c.function : ''}`;
    g.setAttribute('aria-label', lab); g.setAttribute('aria-pressed', C.selCircuit === g.dataset.id ? 'true' : 'false');
    g.classList.toggle('sel', C.selCircuit === g.dataset.id);
    let t = g.querySelector('title'); if (!t) { t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); g.prepend(t); }
    t.textContent = lab + (c && c.last_t ? ' · last update ' + clock(c.last_t) : '');
  });
}
function pulse(ev) {
  const e = msgEdge(ev), svg = $('#cx-svg');
  C.lastMsg = { ev, e, at: Date.now() };
  const edges = C.st ? (C.st.edges || []) : [];
  const edge = e && edges.find(x => x.src === e.src && x.dst === e.dst);
  const st = $('#cx-last'); 
  if (!edge || !svg || root.hidden) { if (st) setLast(); return; }
  const path = svg.querySelector(`.cx-edge[data-k="${CSS.escape(edgeKey(edge))}"]`); if (!path) return;
  C.pulses++;
  const inh = (edge.sign === 'inhibitory') || det(ev).sign === '-';
  const dstNode = svg.querySelector(`.cx-node[data-id="${edge.dst}"]`), srcNode = svg.querySelector(`.cx-node[data-id="${edge.src}"]`);
  path.classList.add('hit'); [dstNode, srcNode].forEach(n => n && n.classList.add('hit'));
  setTimeout(() => { path.classList.remove('hit'); [dstNode, srcNode].forEach(n => n && n.classList.remove('hit')); }, 3200);
  if (!reduce()) {
    const len = path.getTotalLength(), dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('class', 'cx-pulse ' + (inh ? 'inh' : 'exc')); $('#cx-pulses', svg).appendChild(dot);
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / PULSE_MS), p = path.getPointAtLength(len * k); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); if (k < 1) requestAnimationFrame(step); else dot.remove(); };
    requestAnimationFrame(step);
  }
  setLast();
}
function setLast() {
  const el = $('#cx-last'); if (!el) return; const m = C.lastMsg;
  if (!m) { el.textContent = 'No message has arrived since this panel opened. Edges stay still until the API delivers a real message event.'; return; }
  const e = m.e, edges = C.st ? (C.st.edges || []) : [], known = e && edges.some(x => x.src === e.src && x.dst === e.dst);
  el.textContent = e ? `Last message: ${nm(e.src)} → ${nm(e.dst)} (event #${m.ev.id}, ${clock(m.ev.t)})${known ? '' : ' · edge not in the graph, not drawn'}` : `Last message event #${m.ev.id} has no src/dst in its detail, not drawn.`;
}
function graphSection() {
  const st = C.st, circs = {}; (st.circuits || []).forEach(c => { circs[c.id] = c; });
  const sig = (st.edges || []).map(e => edgeKey(e) + e.sign + e.weight_ppm).join('|');
  const missing = NODES.filter(id => !circs[id]);
  const sel = C.selCircuit && circs[C.selCircuit];
  const tbl = `<details class="ec-raw" id="cx-edge-tbl"><summary>Edge table (${(st.edges || []).length} edges, same data as the graph)</summary><div class="ec-wrap" tabindex="0" role="region" aria-label="edge table, scrolls horizontally if needed"><table class="ec-tbl"><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Sign</th><th scope="col">Weight</th></tr></thead><tbody>${(st.edges || []).map(e => `<tr><td>${esc(nm(e.src))}</td><td>${esc(nm(e.dst))}</td><td class="${e.sign === 'inhibitory' ? 'neg' : 'pos'}">${esc(e.sign || '—')}</td><td>${isN(e.weight_ppm) ? (e.weight_ppm / 1e6).toFixed(3) : dash('weight not reported')}</td></tr>`).join('')}</tbody></table></div></details>`;
  const info = sel ? `<div class="cx-sel"><b>${esc(nm(sel.id))}</b> · activation ${ppmPct(sel.activation_ppm, 1) ?? dash('activation not reported')} · last update ${sel.last_t ? esc(clock(sel.last_t)) : dash('no update recorded')}<br><span class="muted">${sel.function ? esc(sel.function) : 'function not reported by the API'}</span></div>` : `<div class="cx-sel muted">Select a circuit (click or Enter) to read its recorded function and activation.</div>`;
  return { sig, html: `<div class="cx-graphwrap"><div id="cx-graph">${graphSkeleton(st)}</div><div class="cx-side"><div class="cx-leg" aria-label="Graph legend"><span><i class="lg-exc"></i>excitatory</span><span><i class="lg-inh"></i>inhibitory (dashed)</span><span>thickness = |weight|</span><span><i class="lg-act"></i>node fill = activation</span></div>
    <p class="ec-note" id="cx-last" role="status"></p>${info}${missing.length ? `<p class="ec-note">Not reported by the API: ${esc(missing.map(nm).join(', '))}.</p>` : ''}
    <p class="ec-note muted">Pulses travel along an edge only when a real <code>message</code> event with that source and target is delivered. With reduced motion, the edge is highlighted instead.</p></div></div>${tbl}` };
}

/* ---------------------------------------------------------------- 2. decision timeline */
const VB = { go: ['b-ok', 'GO'], nogo: ['b-dead', 'NO-GO'], veto: ['b-dead', 'VETO'], abstain: ['b-off', 'ABSTAIN'] };
function evRefs(ev) {
  const r = Array.isArray(ev.evidence_refs) ? ev.evidence_refs : [];
  if (!r.length) return dash('no evidence references recorded');
  return r.slice(0, 5).map(id => `<button type="button" class="cx-ref" data-obs="${esc(id)}" title="Open live-log observation #${esc(id)}" aria-label="Open live-log observation ${esc(id)}">obs #${esc(id)}</button>`).join(' ') + (r.length > 5 ? ` <span class="muted" title="${esc(r.slice(5).join(', '))}">+${r.length - 5}</span>` : '');
}
function timelineSection() {
  const rows = C.ev.filter(e => e.kind === 'decision' || e.kind === 'veto').slice(-25).reverse();
  if (!rows.length) return sec('circuits-decisions', 'Decision timeline', '<p class="ec-note">No shadow decisions recorded yet. Rows appear only when the circuit engine records a decision or veto.</p>', 'recommendations, never trades');
  const li = rows.map(ev => {
    const v = verdictOf(ev), [cls, lab] = VB[v] || ['b-off', String(v || '?').replace(/^other:/, '').toUpperCase() || '?'], vt = vetoer(ev), sz = sizeOf(ev), sel = C.selDecision === ev.id;
    return `<li class="cx-row${sel ? ' sel' : ''}" data-ev="${ev.id}"><span class="cx-t" title="${esc(ago(ev.t) || '')}">${esc(clock(ev.t))}</span>
      <span class="b ${cls}">${esc(lab)}</span>
      <span class="cx-m">${ev.token ? `<button type="button" class="cx-tok" data-tok="${esc(ev.token)}" data-dec="${ev.id}" title="${esc(ev.token)} · select for the disagreement strip and memory" aria-label="Select token ${esc(short(ev.token))}">${esc(short(ev.token))}</button>` : dash('no token on this event')}
      · veto by ${vt ? `<b>${esc(nm(vt))}</b>` : (v === 'veto' ? dash('vetoing circuit not reported') : '<span class="muted">none</span>')}
      · size ${isN(sz) ? (Math.abs(sz) > 1 ? ppmPct(sz, 1) : sz) : dash('no size recommended')}</span>
      <span class="cx-r">${esc(reasonOf(ev) || '')}</span><span class="cx-e">${evRefs(ev)}</span></li>`;
  }).join('');
  return sec('circuits-decisions', 'Decision timeline', `<ol class="cx-list" aria-label="Shadow decisions, newest first">${li}</ol>`, 'recommendations, never trades');
}

/* ---------------------------------------------------------------- 3. specialist disagreement */
function spreadView(v) {
  if (v == null) return { html: dash('this specialist reported no value'), spread: null };
  let vals = null, lo = null, hi = null;
  if (Array.isArray(v)) vals = v.map(x => ppmFrac(isN(x) ? x : (x && (x.score ?? x.p_ppm ?? x.value)))).filter(x => x != null);
  else if (typeof v === 'object') { if (isN(v.min) && isN(v.max)) { lo = ppmFrac(v.min); hi = ppmFrac(v.max); vals = [lo, hi]; } else { const x = ppmFrac(v.score ?? v.mean ?? v.value ?? v.p_ppm); vals = x == null ? null : [x]; if (isN(v.spread_ppm ?? v.spread)) vals.spread = ppmFrac(v.spread_ppm ?? v.spread); } }
  else vals = ppmFrac(v) == null ? null : [ppmFrac(v)];
  if (!vals || !vals.length) return { html: dash('value not numeric'), spread: null };
  const neg = vals.some(x => x < 0), mn = neg ? -1 : 0, pos = (x) => (100 * (Math.max(mn, Math.min(1, x)) - mn) / (1 - mn)).toFixed(1);
  const spread = vals.spread ?? (vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : null);
  const dots = vals.map(x => `<i class="cx-dot" style="left:${pos(x)}%" title="${x.toFixed(3)}"></i>`).join('');
  const range = vals.length > 1 ? `<i class="cx-range" style="left:${pos(Math.min(...vals))}%;width:${(pos(Math.max(...vals)) - pos(Math.min(...vals))).toFixed(1)}%"></i>` : '';
  return { html: `<div class="cx-track" aria-hidden="true">${range}${dots}</div>`, spread, text: vals.map(x => x.toFixed(2)).join(' / ') };
}
function spreadSection() {
  const decs = C.ev.filter(e => e.kind === 'decision');
  const spOf = (e) => { const d = det(e); return d.specialists ?? d.spreads ?? d.spread ?? null; };
  let ev = (C.selDecision != null && decs.find(e => e.id === C.selDecision)) || decs.slice().reverse().find(e => spOf(e) && typeof spOf(e) === 'object') || decs[decs.length - 1];
  if (!ev) return sec('circuits-spread', 'Specialist disagreement', '<p class="ec-note">No decision recorded yet, so there is no specialist spread to show.</p>');
  const sp = spOf(ev), d = det(ev);
  if (!sp || typeof sp !== 'object') return sec('circuits-spread', 'Specialist disagreement', `<p class="ec-note">Decision #${ev.id} carries no specialist spread: ${dash('detail has no specialists/spreads field')}</p>`, `decision #${ev.id}`);
  const cards = ['awareness', 'timing', 'risk'].map(k => { const s = spreadView(sp[k]); return `<div class="ec-card cx-sp"><div class="k">${k}</div><div class="v">${s.html}</div><div class="s">${s.text ? esc(s.text) : ''}${s.spread != null ? ` · spread <b>${s.spread.toFixed(3)}</b>` : (sp[k] == null ? '' : ' · spread ' + dash('single value, no spread'))}</div></div>`; }).join('');
  const dis = ppmFrac(d.disagreement_ppm ?? d.disagreement);
  return sec('circuits-spread', 'Specialist disagreement', `<div class="ec-strip cx-strip3">${cards}</div><p class="ec-note">Decision #${ev.id} at ${esc(clock(ev.t))}${ev.token ? ' on <code title="' + esc(ev.token) + '">' + esc(short(ev.token)) + '</code>' : ''} · overall disagreement ${dis == null ? dash('not reported') : dis.toFixed(3)}. Dots are individual specialist values, the bar is their range.</p>`, `decision #${ev.id}`);
}

/* ---------------------------------------------------------------- 4. memory retrieval */
function episodes(arr) {
  return (arr || []).map(x => {
    if (!x || typeof x !== 'object') return null;
    const out = x.outcome_ppm ?? x.ret_ppm ?? x.outcome ?? x.return_ppm ?? null;
    return { id: x.id ?? x.episode_id ?? null, out, age: x.age_s ?? (x.closed_t != null ? Date.now() / 1000 - tsec(x.closed_t) : (x.t != null ? Date.now() / 1000 - tsec(x.t) : null)), sim: x.similarity_ppm ?? x.sim_ppm ?? x.similarity ?? null, token: x.token ?? null };
  }).filter(Boolean);
}
function epTable(eps) {
  return `<div class="ec-wrap" tabindex="0" role="region" aria-label="episodes, scrolls horizontally if needed"><table class="ec-tbl"><thead><tr><th scope="col">Episode</th><th scope="col">Outcome</th><th scope="col">Age</th><th scope="col">Similarity</th></tr></thead><tbody>${eps.map(e => `<tr><td>${orDash(e.id, 'episode id not reported')}</td><td class="${isN(e.out) ? (e.out >= 0 ? 'pos' : 'neg') : ''}">${isN(e.out) ? esc(ppmPct(e.out)) : orDash(e.out, 'outcome not reported')}</td><td>${orDash(ageS(e.age), 'age not reported')}</td><td>${isN(e.sim) ? (Math.abs(e.sim) > 1 ? esc(ppmPct(e.sim, 1)) : esc((e.sim * 100).toFixed(1) + '%')) : dash('similarity not reported')}</td></tr>`).join('')}</tbody></table></div>`;
}
function memorySection() {
  const tok = C.selToken;
  if (!tok) return sec('circuits-memory', 'Memory retrieval', `<p class="ec-note">${C.ev.some(e => e.token) ? 'Select a token in the decision timeline to see which episodes the hippocampus retrieved for it.' : 'No token has appeared in any circuit event yet, so there is nothing to look up.'}</p>`);
  const mem = C.mem.token === tok ? C.mem : null;
  const evs = C.ev.filter(e => e.kind === 'memory' && e.token === tok).slice(-5).reverse();
  let h = `<p class="ec-note">Token <code title="${esc(tok)}">${esc(short(tok))}</code>. Retrieval is time-cut: only episodes closed before the query are eligible.</p>`;
  if (evs.length) h += '<h4>Retrievals recorded as events</h4>' + evs.map(e => { const d = det(e), eps = episodes(d.episodes ?? d.retrieved ?? d.hits); return `<p class="ec-note">${esc(clock(e.t))} · ${eps.length} episode${eps.length === 1 ? '' : 's'} retrieved${isN(d.k) ? ' (k=' + d.k + ')' : ''} ${evRefs(e)}</p>${eps.length ? epTable(eps) : ''}`; }).join('');
  else h += '<p class="ec-note">No retrieval event recorded for this token yet.</p>';
  if (mem && mem.data) { const eps = episodes(Array.isArray(mem.data) ? mem.data : (mem.data.episodes || mem.data.memory || [])); h += `<h4>Episodes stored for this token</h4>${eps.length ? epTable(eps) : '<p class="ec-note">Memory holds no episodes for this token.</p>'}`; }
  else if (mem && mem.why) h += `<p class="ec-note">Stored episodes: ${dash(mem.why)} <span class="muted">· ${esc(mem.why)}</span></p>`;
  return sec('circuits-memory', 'Memory retrieval', h, 'hippocampus');
}

/* ---------------------------------------------------------------- 5. learning updates */
function learningSection() {
  const rows = C.ev.filter(e => e.kind === 'learning').slice(-20).reverse();
  if (!rows.length) return sec('circuits-learning', 'Learning updates', '<p class="ec-note">No learning updates yet. Edge weights change only on validated closed outcomes (dopamine RPE), so this stays empty until trades close.</p>');
  const li = rows.map(ev => {
    const d = det(ev), rpe = d.rpe_ppm ?? d.rpe ?? null, e = msgEdge({ ...ev, detail: d }), o = d.old_weight_ppm ?? d.old ?? d.from_weight_ppm ?? null, n = d.new_weight_ppm ?? d.new ?? d.to_weight_ppm ?? null;
    const edge = e ? `${esc(nm(e.src))} → ${esc(nm(e.dst))}` : (typeof d.edge === 'string' ? esc(d.edge) : dash('no edge reported'));
    const w = (x) => isN(x) ? (Math.abs(x) > 5 ? (x / 1e6).toFixed(3) : x.toFixed(3)) : null;
    return `<li class="cx-row" data-ev="${ev.id}"><span class="cx-t">${esc(clock(ev.t))}</span><span class="b b-paper">RPE ${isN(rpe) ? (Math.abs(rpe) > 5 ? (rpe / 1e6).toFixed(3) : rpe.toFixed(3)) : '—'}</span>
      <span class="cx-m">edge ${edge} · weight ${w(o) ?? dash('old weight not reported')} → <b class="${isN(o) && isN(n) ? (n >= o ? 'pos' : 'neg') : ''}">${w(n) ?? dash('new weight not reported')}</b>${ev.token ? ` · <code title="${esc(ev.token)}">${esc(short(ev.token))}</code>` : ''}</span><span class="cx-e">${evRefs(ev)}</span></li>`;
  }).join('');
  return sec('circuits-learning', 'Learning updates', `<ol class="cx-list" aria-label="Learning updates, newest first">${li}</ol>`, 'dopamine RPE on closed outcomes');
}

/* ---------------------------------------------------------------- 6. benchmark */
function verdictBadge(c, leadId) {
  const s = String(c.verdict ?? c.status ?? '').toLowerCase();
  if (/promot|lead/.test(s) || (leadId && leadId === c.id)) return '<span class="b b-ok" title="The API reports this candidate as leading in shadow. Shadow only: nothing is routed to live.">LEADING (SHADOW)</span>';
  if (/reject|retire|fail|cull|elimin/.test(s)) return `<span class="b b-dead" title="status: ${esc(s)}">REJECTED</span>`;
  return '<span class="b b-ins" title="Not enough closed shadow trades / significance reported by the API to call a winner.">INSUFFICIENT EVIDENCE</span>';
}
function benchSection() {
  const b = C.bench, leadId = C.st && C.st.leading && C.st.leading.candidate_id;
  if (!b) return sec('circuits-bench', 'Shadow benchmark', `<p class="ec-note">${dash(C.benchWhy || 'benchmark not available yet')} <span class="muted">· benchmark ${esc(C.benchWhy || 'not available yet')}</span></p>`);
  const en = b.ensemble || (C.st && C.st.baseline && C.st.baseline.ensemble) || {}, cs = Array.isArray(b.candidates) ? b.candidates : [];
  const cellP = (v, why) => isN(v) ? `<span class="${v >= 0 ? 'pos' : 'neg'}">${esc(ppmPct(v))}</span>` : dash(why);
  const cost = (v) => microUsd(v) ?? dash('cost per decision not reported');
  const rate = (v) => isN(v) ? esc((v <= 1 ? v * 100 : v / 1e4).toFixed(1) + '%') : dash('not reported');
  const row = (name, sub, o, isEns) => `<tr class="${isEns ? 'cx-ens' : ''}"><td><b>${esc(name)}</b>${sub ? `<div class="muted">${sub}</div>` : ''}</td><td>${isN(o.closed) ? esc(o.closed) : dash('closed shadow trades not reported')}</td><td>${cellP(o.mean_ret_ppm, 'mean return not reported')}</td>
    <td>${isEns ? '<span class="muted" title="the baseline is the reference">reference</span>' : isN(o.welch_t_vs_ensemble) ? esc(o.welch_t_vs_ensemble.toFixed(2)) : dash('Welch t not computed yet (too few closed trades)')}</td><td>${cost(isEns ? o.cost_micro_per_decision ?? o.cost_micro : o.cost_micro_per_decision)}</td>
    <td>${isEns ? '—' : rate(o.abstain_rate)}</td><td>${isEns ? '—' : (isN(o.missed_opportunity_ppm) ? esc(ppmPct(o.missed_opportunity_ppm)) : dash('counterfactual not reported'))}</td><td>${isEns ? '<span class="b b-pol">BASELINE</span>' : verdictBadge(o, leadId)}</td></tr>`;
  const rows = [row('Ensemble (unchanged)', 'win rate ' + (isN(en.win_rate) ? esc((en.win_rate <= 1 ? en.win_rate * 100 : en.win_rate / 1e4).toFixed(1)) + '%' : '—'), en, true)]
    .concat(cs.map(c => row(c.id, `${c.parent_id ? 'child of ' + esc(c.parent_id) + ' · ' : ''}born gen ${esc(c.born_gen ?? '?')} · ${esc(c.status || 'status unknown')}`, c, false)));
  return sec('circuits-bench', 'Shadow benchmark vs ensemble', `<div class="ec-wrap" tabindex="0" role="region" aria-label="benchmark table, scrolls horizontally if needed"><table class="ec-tbl cx-bench"><thead><tr><th scope="col">Configuration</th><th scope="col">Closed</th><th scope="col">Mean return</th><th scope="col">Welch t vs ensemble</th><th scope="col">Cost / decision</th><th scope="col">Abstain</th><th scope="col">Missed opp.</th><th scope="col">Verdict</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${cs.length ? '' : '<p class="ec-note">No candidate configurations are being benchmarked yet.</p>'}<p class="ec-note muted">Paper results net of fees, same tokens as the ensemble. Small samples prove nothing; verdicts stay "insufficient evidence" unless the API says otherwise. Promotion only changes which candidate is shown as leading here; it never routes to live.</p>`, 'shadow portfolios');
}

/* ---------------------------------------------------------------- 7. lineage */
function linSection() {
  const L = C.lin;
  if (!L) return sec('circuits-lineage', 'Circuit lineage', `<p class="ec-note">${dash(C.linWhy || 'lineage not available yet')} <span class="muted">· lineage ${esc(C.linWhy || 'not available yet')}</span></p>`);
  if (!L.length) return sec('circuits-lineage', 'Circuit lineage', '<p class="ec-note">No circuit configuration has been born yet beyond the base.</p>');
  const by = {}, ids = new Set(L.map(x => x.id)); L.forEach(x => (by[x.parent_id ?? ''] = by[x.parent_id ?? ''] || []).push(x));
  const seen = new Set();
  const rec = (p) => (by[p] || []).filter(x => !seen.has(x.id)).map(x => { seen.add(x.id); const dead = /reject|retire|elimin|cull/.test(String(x.status)); return `<li><span class="${dead ? 'st-eliminated' : /lead|promot/.test(String(x.status)) ? 'st-active' : 'st-challenger'}">${dead ? '✝' : '●'} ${esc(x.id)}</span> <span class="muted">gen ${esc(x.born_gen ?? '?')} · ${esc(x.status || 'status unknown')} · mutation: ${x.mutation ? esc(typeof x.mutation === 'string' ? x.mutation : JSON.stringify(x.mutation)) : dash('mutation not recorded')}${x.reason ? ' · ' + esc(x.reason) : ''}</span>${by[x.id] ? '<ul>' + rec(x.id) + '</ul>' : ''}</li>`; }).join('');
  const roots = L.filter(x => x.parent_id == null || !ids.has(x.parent_id));
  const html = roots.map(r => { if (seen.has(r.id)) return ''; return rec(r.parent_id ?? ''); }).join('') || rec('');
  const uniq = L.filter(x => !seen.has(x.id)).map(x => { seen.add(x.id); return `<li>${esc(x.id)} <span class="muted">parent ${esc(x.parent_id)} not listed</span></li>`; }).join('');
  return sec('circuits-lineage', 'Circuit lineage', `<div class="ec-lin"><ul>${html}${uniq}</ul></div>`, 'parent → child, mutation, fate');
}

/* ---------------------------------------------------------------- shell */
const SHADOW = '<div class="cx-shadow" role="note"><b>SHADOW MODE</b><span>recommendations only, never trades. Nothing on this page can move money.</span></div>';
function notice() {
  const m = { missing: ['Circuit layer not available yet', 'This server does not expose /api/circuits yet (HTTP 404). Nothing is shown rather than anything invented.'], disabled: ['Circuit layer not enabled', 'The server reports the circuit engine as off (DEGEN_CIRCUITS). Nothing is shown rather than anything invented.'], error: ['Circuit layer unreachable', C.why || 'The status endpoint failed.'], loading: ['Loading circuit state…', ''] }[C.avail];
  return `<div class="cx-off" role="status"><b>${esc(m[0])}</b><p>${esc(m[1])}${C.why && C.avail === 'disabled' ? ' ' + esc(C.why) : ''}</p></div>`;
}
function header(st) {
  return `<div class="ec-foot cx-meta"><span>mode <b>${esc(st.mode || '—')}</b></span><span>circuit version <b title="${esc(st.version)}">${esc(short(st.version) || '—')}</b></span><span title="circuit-engine generation: a separate counter from the brain generation in the page header">circuit generation <b>${st.generation ?? '—'}</b></span><span>leading in shadow <b>${st.leading && st.leading.candidate_id ? esc(st.leading.candidate_id) : dash('no candidate leads')}</b></span><span>polling <b>${C.open ? 'on' : 'off'}</b></span></div>`;
}
function render() {
  if (!C.open) return;
  if (!$('#cx-shadow', body)) body.innerHTML = '<div id="cx-shadow"></div><div id="cx-main"></div>';
  setHTML($('#cx-shadow', body), SHADOW);
  const main = $('#cx-main', body);
  if (C.avail !== 'ok') { C.graphSig = ''; setHTML(main, notice()); return; }
  const st = C.st;
  if (!$('#cx-graphsec', main)) { main.innerHTML = '<div id="cx-meta"></div><div id="cx-graphsec"></div><div id="cx-s2"></div><div id="cx-s3"></div><div id="cx-s4"></div><div id="cx-s5"></div><div id="cx-s6"></div><div id="cx-s7"></div>'; C.graphSig = ''; }
  setHTML($('#cx-meta', main), header(st));
  const g = graphSection();
  if (g.sig !== C.graphSig || !$('#cx-svg')) { C.graphSig = g.sig; $('#cx-graphsec', main).innerHTML = sec('circuits-graph', 'Circuit graph', g.html, 'recorded activation; edge weights are the current configuration'); }
  else { const sel = $('#cx-graphsec .cx-sel'); if (sel) { const tmp = document.createElement('div'); tmp.innerHTML = g.html; const ns = tmp.querySelector('.cx-sel'); if (ns && sel.innerHTML !== ns.innerHTML) sel.innerHTML = ns.innerHTML; } }
  updateGraph(); setLast();
  setHTML($('#cx-s2', main), timelineSection()); setHTML($('#cx-s3', main), spreadSection()); setHTML($('#cx-s4', main), memorySection());
  setHTML($('#cx-s5', main), learningSection()); setHTML($('#cx-s6', main), benchSection()); setHTML($('#cx-s7', main), linSection());
}

/* ---------------------------------------------------------------- live-log evidence links */
async function openObs(id) {
  const n = Number(id), L = window.DBLOG && window.DBLOG.L;
  const tg = $('#ll-toggle'), ll = $('#livelog');
  if (ll && ll.hidden && tg) tg.click();
  if (L && isN(n) && !L.seen.has(n)) {
    const r = await get('/api/events?since=' + Math.max(0, n - 1));
    if (r.ok && Array.isArray(r.data)) { const e = r.data.find(x => x.id === n); if (e) try { window.DBLOG.event(e); } catch (x) { /* ignore */ } }
    await new Promise(r2 => setTimeout(r2, 350));
  }
  const row = ll && ll.querySelector(`.ll-row[data-id="${n}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('cx-flash'); setTimeout(() => row.classList.remove('cx-flash'), 2400); announce(`Opened live-log observation ${n}.`); }
  else announce(`Observation ${id} is not in the loaded live-log window (it may be filtered out, or older than the log keeps).`);
}

/* ---------------------------------------------------------------- lifecycle */
let busy = false;
async function tick(first) {
  if (busy) return; busy = true;
  try {
    if (first || C.avail !== 'ok') await loadStatus(); else if ((C.n = (C.n || 0) + 1) % 3 === 0) await loadStatus();
    if (C.avail === 'ok') {
      await pollEvents();
      if (first || (C.k = (C.k || 0) + 1) % 8 === 0) await loadSlow();
      if (!C.selToken) { const t = C.ev.slice().reverse().find(e => e.token); if (t) C.selToken = t.token; }
      await loadMemory(false);
    }
    render();
  } finally { busy = false; }
}
function open_(focus) {
  if (!$('#economy').hidden) $('#ec-close').click();
  const hd = document.querySelector('header.top'); if (hd) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px'; // header wraps on phones
  root.hidden = false; C.open = true; document.body.classList.add('circ-open');
  C.primed = false; C.lastMsg = null; C.ev = []; C.seen = new Set(); C.cursor = 0; C.graphSig = ''; body.innerHTML = '';
  render(); tick(true);
  clearInterval(C.timer); C.timer = setInterval(() => { if (!document.hidden) tick(false); }, 2500);
  if (focus) root.focus();
}
function close_(noFocus) {
  root.hidden = true; C.open = false; document.body.classList.remove('circ-open'); clearInterval(C.timer);
  if (location.hash === '#circuits' || /^#circuits-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  if (!noFocus) { const l = $('#circ-link'); if (l) l.focus(); }
}
function badge() {
  const l = $('#circ-link'); if (!l) return;
  l.title = C.avail === 'ok' ? 'Neural circuits: SHADOW MODE, recommendations only' : C.avail === 'disabled' ? 'Neural circuits: not enabled on this server' : C.avail === 'missing' ? 'Neural circuits: not available yet' : 'Neural circuits (shadow)';
  l.classList.toggle('off', C.avail === 'disabled' || C.avail === 'missing');
}
function route() { if (location.hash === '#circuits' || /^#circuits-/.test(location.hash)) { if (root.hidden) open_(false); const t = location.hash !== '#circuits' && $(location.hash); if (t) setTimeout(() => t.scrollIntoView(), 400); } }

$('#circ-link').addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#circuits'); open_(true); });
$('#econ-link').addEventListener('click', () => { if (!root.hidden) close_(true); });
$('#circ-close').addEventListener('click', () => close_());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close_(); });
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { const hd = document.querySelector('header.top'); if (hd && !root.hidden) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px'; });
$('.circ-nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); const t = $(a.getAttribute('href')); if (t) t.scrollIntoView(); });
body.addEventListener('click', (e) => {
  const ref = e.target.closest('.cx-ref'); if (ref) { openObs(ref.dataset.obs); return; }
  const tok = e.target.closest('.cx-tok'); if (tok) { C.selToken = tok.dataset.tok; C.selDecision = Number(tok.dataset.dec); loadMemory(true).then(render); render(); announce('Selected token ' + short(tok.dataset.tok) + '.'); return; }
  const nd = e.target.closest('.cx-node'); if (nd) { C.selCircuit = C.selCircuit === nd.dataset.id ? null : nd.dataset.id; render(); }
});
body.addEventListener('keydown', (e) => { const nd = e.target.closest && e.target.closest('.cx-node'); if (nd && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); C.selCircuit = C.selCircuit === nd.dataset.id ? null : nd.dataset.id; render(); const again = $(`.cx-node[data-id="${nd.dataset.id}"]`); if (again) again.focus(); } });

/* the roadmap (economy.js) and the SSE handler (app.js) read from here */
window.CIRC = {
  C,
  get last() { return { avail: C.avail, st: C.st, why: C.why }; },
  sse(ev, type) { // only events that carry their OWN circuit-event id are used; otherwise polling /api/circuits/events delivers them
    if (!ev || !C.open) return; const p = (ev.payload && typeof ev.payload === 'object') ? ev.payload : ev;
    if (p.id == null || !(p.kind || type || p.type)) return;
    if (ingest({ ...p, kind: p.kind || String(type || p.type).replace(/^circuit_/, '') }, C.primed)) render();
  },
  tick,
};
loadStatus().then(route); setInterval(() => { if (!C.open && !document.hidden) loadStatus(); }, 30000);
})();
