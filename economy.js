/* ALPHAMORPH — economy view. Renders /api/economy verbatim; null => "not available yet" with the server's reason as tooltip. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#economy'), body = $('#ec-body');
let timer = 0, D = null, TOUR = null, STATE = null;
const na = (why) => `<span class="na" tabindex="0" title="${esc(why || 'not available yet')}">not available yet</span>`;
const n = (v, d = 4) => (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : null;
const val = (v, fmt, why) => { const s = v == null ? null : fmt(v); return s == null ? na(why) : s; };
const eth = (v, why) => val(v, x => n(x, 6) + ' ETH', why);
const usd = (v, why) => val(v, x => '$' + n(x, 2), why);
const pct = (v, why) => val(v, x => n(x * 100, 1) + '%', why);
const short = (h) => h ? String(h).slice(0, 8) + '…' + String(h).slice(-6) : '';
const when = (ts) => ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
const txl = (t) => !t || !t.hash ? '—' : (t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t.hash)}">${esc(short(t.hash))}</a>` : `<code title="no explorer link: unverified">${esc(short(t.hash))}</code>`);
const sec = (id, title, inner) => `<section class="ec-sec" id="${id}" aria-labelledby="${id}-h"><h3 id="${id}-h">${title}</h3>${inner}</section>`;
const card = (k, v, s, cls) => `<div class="ec-card ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
const unavail = (o, what) => `<p class="ec-note">${na(o && o.reason)} <span class="muted">· ${what}${o && o.reason ? ': ' + esc(o.reason) : ''}</span></p>`;
const table = (heads, rows) => `<div class="ec-wrap" tabindex="0" role="region" aria-label="table, scrolls horizontally if needed"><table class="ec-tbl"><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

function overview(d) {
  const o = d.overview, r = o.reasons || {}, rt = d.rate || {};
  const usdNote = rt.usd_per_eth ? `at $${n(rt.usd_per_eth, 2)}/ETH` : 'no ETH/USD rate';
  return sec('economy-overview', 'Overview', `<div class="ec-strip">
    ${card('Real PnL <span class="b b-real">REAL</span>', eth(o.real_pnl_eth, r.real_pnl), o.real_pnl_usd != null ? usd(o.real_pnl_usd) + ' · ' + usdNote : usdNote, 'real')}
    ${card('Simulated PnL <span class="b b-paper">PAPER</span>', val(o.simulated_pnl_micro, x => n(x, 0) + ' µ'), 'paper units, not money', 'sim')}
    ${card('Inference spend', usd(o.inference_spend_usd, r.inference_spend), 'USD, AI layer')}
    ${card('Creator fees collected', eth(o.fees_collected_eth, r.fees), o.fees_collected_usd != null ? usd(o.fees_collected_usd) : '')}
    ${card('Tokens burned (verified)', val(o.burned, x => n(x, 2), r.burned), 'only on-chain verified amounts')}
  </div>`);
}

/* ---------------------------------------------------------------- tournament + evolution (contract: GET /api/intel/tournament) */
const ppm = (v, d = 3) => (typeof v === 'number' && isFinite(v)) ? (v / 1e6).toFixed(d) : null;
const dash = (v, why) => v == null ? `<span class="na" tabindex="0" title="${esc(why || 'unknown: not reported by the tournament')}">—</span>` : v;
const microUsd = (v) => (typeof v === 'number' && isFinite(v)) ? '$' + (v / 1e6).toFixed(Math.abs(v) < 1e4 ? 5 : 2) : null;
const frac = (v) => (typeof v === 'number' && isFinite(v)) ? (v > 1 ? v / 1e6 : v) : null;
const chip = (t, cls) => t == null || t === '' ? '' : `<span class="chip ${cls || ''}">${esc(t)}</span>`;
const famCls = (f) => 'fam-' + ((String(f || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)) % 6);
const lid = (id) => 'lad-' + String(id).replace(/[^\w-]/g, '_');
const plink = (id) => id ? `<a href="#${lid(id)}" data-lad="${esc(lid(id))}" title="parent ${esc(id)}">${esc(id)}</a>` : '<span class="muted" title="no parent: seed">seed</span>';
const stBadge = (st) => `<span class="stg stg-${esc(st)}">${esc(String(st || '?').toUpperCase())}</span>`;

function tourData() { // direct endpoint wins; else whatever /api/economy embedded
  const t = TOUR && TOUR.ok ? TOUR.data : null;
  if (t && t.available !== false) return { d: t };
  const e = D && D.tournament;
  if (e && e.available !== false && typeof e === 'object') return { d: e };
  return { d: null, why: (e && e.reason) || (TOUR && TOUR.why) || 'tournament endpoint not available yet' };
}

function funnel(t) {
  const L = t.ladder || [], P = t.params || {}, pop = t.population || {};
  const fin = L.filter(x => x.stage === 'finalist' || x.stage === 'funded').length, fun = L.filter(x => x.stage === 'funded').length;
  const arena = pop.active ?? L.length, cf = frac(P.cull_frac);
  const st = (cls, k, big, sub) => `<div class="fn-st ${cls}"><div class="fn-k">${k}</div><div class="fn-n">${big}</div><div class="fn-s">${sub}</div></div>`;
  return `<div class="funnel" role="group" aria-label="Tournament stages">
    ${st('fn-arena', 'ARENA', dash(arena == null ? null : n(arena, 0)) + ' <small>models</small>', `paper-trading, ${P.arena_min != null ? 'min ' + esc(P.arena_min) + ' · ' : ''}${P.arena_target != null ? 'target ' + esc(P.arena_target) : 'target unknown'}`)}
    <div class="fn-arr" aria-hidden="true"><span>${cf == null ? 'bottom culled' : 'bottom ' + Math.round(cf * 100) + '% culled'}</span>→</div>
    ${st('fn-fin', 'FINALISTS', `${n(fin, 0)} <small>of top ${dash(P.finalists_max == null ? null : esc(P.finalists_max))}</small>`, P.finalist_min_trades != null ? `need ${esc(P.finalist_min_trades)}+ closed paper trades` : 'trade minimum unknown')}
    <div class="fn-arr" aria-hidden="true"><span>top ${dash(P.funded_k == null ? null : esc(P.funded_k))} only</span>→</div>
    ${st('fn-fund', 'FUNDED', `${n(fun, 0)} <small>of top ${dash(P.funded_k == null ? null : esc(P.funded_k))}</small>`, '<b>real money</b>' + (P.funded_min_trades != null ? ` · need ${esc(P.funded_min_trades)}+ trades` : ''))}
  </div>
  <div class="ec-strip tour-facts">
    ${card('Generation', dash(t.generation == null ? null : esc(t.generation)), P.grace_gens != null ? 'grace: ' + esc(P.grace_gens) + ' gens before culling' : '')}
    ${card('Distinct models', dash(pop.distinct_models == null ? null : n(pop.distinct_models, 0)), 'not the same model many times')}
    ${card('Distinct families', dash(pop.distinct_families == null ? null : n(pop.distinct_families, 0)), 'e.g. one lab = one family')}
    ${card('Challengers', dash(pop.challengers == null ? null : n(pop.challengers, 0)), 'on probation, smoke-tested')}
    ${card('Cull per round', cf == null ? dash(null) : Math.round(cf * 100) + '%', 'of the arena, worst first')}
  </div>`;
}

function ladderRow(x, P, i) {
  const wr = x.win_rate == null ? null : n((x.win_rate > 1 ? x.win_rate / 1e6 : x.win_rate) * 100, 1) + '%';
  const pnl = (typeof x.realized_micro === 'number') ? `<span class="${x.realized_micro > 0 ? 'pos' : x.realized_micro < 0 ? 'neg' : ''}">${x.realized_micro > 0 ? '+' : ''}${n(x.realized_micro, 0)} µ</span> <small class="muted">paper</small>` : null;
  const icd = x.inference_cost_per_decision_micro ?? null;
  return `<li class="lad-row stage-${esc(x.stage)}" id="${lid(x.policy_id)}" tabindex="-1">
    <div class="c-rank" data-l="rank"><b>#${esc(x.rank)}</b></div>
    <div class="c-model" data-l="model"><b class="mname">${esc(x.model || x.policy_id)}</b><div class="msub"><code>${esc(x.policy_id)}</code> ${chip(x.family, 'fam ' + famCls(x.family))}${chip(x.provider, 'prov')}</div></div>
    <div class="c-stage" data-l="stage">${stBadge(x.stage)}${x.live_eligible ? ' <span class="b b-real" title="Passed every gate: allowed to trade real money">LIVE-ELIGIBLE</span>' : ''}</div>
    <div class="c-fit" data-l="fitness / score"><b>${dash(ppm(x.fitness_ppm))}</b> <small class="muted">/ ${dash(ppm(x.score_ppm))}</small></div>
    <div class="c-tr" data-l="closed paper trades">${dash(x.closed_trades == null ? null : n(x.closed_trades, 0))}</div>
    <div class="c-pnl" data-l="realized PnL (paper units)">${dash(pnl)}</div>
    <div class="c-cost" data-l="inference cost / decision">${dash(microUsd(icd), 'no costed decisions yet')}</div>
    <div class="c-wr" data-l="win rate">${dash(wr, 'no closed trades yet')}</div>
    <div class="c-age" data-l="born">${dash(x.born_gen == null ? null : 'gen ' + esc(x.born_gen))}</div>
    <div class="c-par" data-l="parent · kind">${plink(x.parent_id)} ${chip(x.kind, 'kind kind-' + esc(x.kind))}</div>
  </li>`;
}

function leaderboard(t) {
  const P = t.params || {}, L = (t.ladder || []).slice().sort((a, b) => a.rank - b.rank);
  const fm = P.finalists_max ?? 10, hk = P.funded_k;
  const head = `<div class="lad-head" aria-hidden="true"><div>rank</div><div>model</div><div>stage</div><div>fitness / score</div><div>trades</div><div>PnL (paper)</div><div>cost / decision</div><div>win</div><div>born</div><div>parent · kind</div></div>`;
  const top = L.filter(x => x.rank <= fm), rest = L.filter(x => x.rank > fm), CAP = 30;
  const cut = (label, cls) => `<li class="lad-cut ${cls || ''}" role="separator" aria-label="${esc(label)}"><span>${esc(label)}</span></li>`;
  let rows = '';
  top.forEach((x, i) => { rows += ladderRow(x, P, i); if (hk != null && x.rank === hk && top.length > hk) rows += cut(`── real-money line: top ${hk} funded, below this only paper ──`, 'cut-fund'); });
  if (rest.length) rows += cut(`✂ CUT LINE · top ${fm} are finalists; everything below fights to survive the next cull ✂`, 'cut-main');
  rest.slice(0, CAP).forEach((x, i) => rows += ladderRow(x, P, i));
  return `<h4>Leaderboard <span class="muted">· ranked by fitness · paper PnL is in paper units, never money</span></h4>
    <div class="lad" tabindex="0" role="region" aria-label="Tournament leaderboard">${head}<ol class="lad-list">${rows}</ol></div>
    ${rest.length > CAP ? `<p class="ec-note">Showing the top ${fm + CAP} of ${L.length} models.</p>` : ''}`;
}

function graveyard(t) {
  const C = t.culled_recent || [], B = t.births_recent || [], R = t.promotions_recent || [];
  const dead = C.length ? `<ul class="feed">${C.map(x => `<li class="f-dead"><span class="f-ic" aria-hidden="true">✝</span><div><b>${esc(x.model || x.policy_id)}</b> ${chip(x.family, 'fam ' + famCls(x.family))}<div class="muted">gen ${esc(x.generation ?? '?')} · ranked ${dash(x.rank == null ? null : '#' + esc(x.rank) + (x.of != null ? ' of ' + esc(x.of) : ''))} · final score ${dash(ppm(x.score_ppm))} · <i>${esc(x.reason || 'reason not reported')}</i></div></div></li>`).join('')}</ul>` : '<p class="ec-note">Nobody has been culled yet. Deaths will be listed here with generation, rank and reason.</p>';
  const born = B.length ? `<ul class="feed">${B.map(x => `<li class="f-born"><span class="f-ic" aria-hidden="true">✦</span><div><b>${esc(x.model || x.policy_id)}</b> ${chip(x.family, 'fam ' + famCls(x.family))} ${chip(x.kind, 'kind kind-' + esc(x.kind))}<div class="muted">born gen ${esc(x.generation ?? '?')} · parent ${plink(x.parent_id)}</div></div></li>`).join('')}</ul>` : '<p class="ec-note">No births recorded yet.</p>';
  const promo = R.length ? `<p class="ec-note">Promotions: ${R.map(x => `<code>${esc(x.policy_id)}</code> → <b>${esc(x.to_stage)}</b> (gen ${esc(x.generation ?? '?')})`).join(' · ')}</p>` : '';
  return `<div class="ec-two"><div class="ec-box grave"><h4>The graveyard <span class="muted">recently culled</span></h4>${dead}</div><div class="ec-box births"><h4>Recent births</h4>${born}${promo}</div></div>`;
}

function budget(t) {
  const b = t.budget;
  if (!b) return `<p class="ec-note">${na('budget not reported')} <span class="muted">· inference budget</span></p>`;
  const sp = b.spent_today_micro, dl = b.daily_micro, pr = b.projected_daily_micro;
  const pct = (typeof sp === 'number' && dl > 0) ? Math.min(100, sp / dl * 100) : null;
  const over = typeof pr === 'number' && dl > 0 && pr > dl;
  return `<div class="budget"><div class="ec-strip bud-cards">
    ${card('Daily inference budget', dash(microUsd(dl)), 'USD, whole tournament')}
    ${card('Spent today', dash(microUsd(sp)), pct == null ? '' : n(pct, 1) + '% of budget')}
    ${card('Projected today', `<span class="${over ? 'neg' : ''}">${dash(microUsd(pr))}</span>`, over ? 'over budget: the arena shrinks' : 'at current pace')}
    ${card('Arena size', b.arena_shrunk_reason ? '<span class="neg">shrunk</span>' : 'normal', esc(b.arena_shrunk_reason || 'no shrink: budget is not binding'))}
  </div>${pct == null ? '' : `<div class="bar" role="img" aria-label="${n(pct, 0)}% of daily inference budget spent"><i style="width:${pct}%" class="${over ? 'over' : ''}"></i></div>`}</div>`;
}

function tournament() {
  const { d: t, why } = tourData();
  const h = 'The Tournament';
  if (!t) return sec('economy-tournament', h, `<p class="ec-note">${na(why)} <span class="muted">· ${esc(why)}</span></p><p class="ec-note">Nothing is shown rather than made up.</p>`);
  if (t.enabled === false) return sec('economy-tournament', h, `<div class="warm">Tournament is switched off${t.reason ? ': ' + esc(t.reason) : ''}. No models are competing.</div>`);
  const L = t.ladder || [];
  if (!L.length) return sec('economy-tournament', h, `<div class="warm"><b>Tournament warming up:</b> models are being discovered and smoke-tested. Rankings appear here once models have closed paper trades. No rows are shown until then.</div>${t.population ? funnel(t) : ''}${t.budget ? '<h4>Inference budget</h4>' + budget(t) : ''}${graveyard(t)}`);
  return sec('economy-tournament', h, `<p class="ec-note lead">Many AI models trade on paper at once. Every generation the weakest are <b>culled</b>, the best become finalists, and only the top few get <b>real money</b>.</p>${funnel(t)}${leaderboard(t)}<h4>Deaths &amp; births</h4>${graveyard(t)}<h4>Inference budget</h4>${budget(t)}`);
}

/* roadmap: stages are derived from live data only */
function stages(t, st) {
  const L = (t && t.ladder) || [], reg = (window.AMR && st) ? AMR.info(st) : [];
  const grown = reg.filter(r => !r.core), active = grown.filter(r => r.status === 'active'), dorm = grown.filter(r => r.status === 'dormant');
  const fund = L.filter(x => x.stage === 'funded'), elig = fund.filter(x => x.live_eligible);
  const tOn = !!(t && t.enabled !== false);
  const s1 = { k: 'Stage 1', t: 'Current brain', d: '3 regions, rule-based strategies compete on paper', s: 'done', note: st ? `${reg.filter(r => r.core).length} core regions live` : 'state not loaded' };
  const s2 = { k: 'Stage 2', t: 'Model arena', d: 'many AI models compete on paper; the bottom is culled', s: !t ? 'locked' : tOn ? 'progress' : 'locked',
    note: !t ? 'tournament not reachable yet' : !tOn ? 'tournament switched off' : L.length ? `${L.length} models in the arena, gen ${t.generation ?? '?'}` : 'warming up: discovering and smoke-testing models' };
  const s3 = { k: 'Stage 3', t: 'Finalists + funded', d: 'the top few get real money', s: fund.length ? 'progress' : 'locked',
    note: fund.length ? `${fund.length} funded, ${elig.length} live-eligible` : (t ? 'no model has earned funding yet' : 'locked behind stage 2') };
  const s4 = { k: 'Stage 4+', t: 'New regions grow in', d: 'provenance, flow, curve', s: active.length ? 'progress' : 'locked',
    note: !grown.length ? 'API lists no growth regions yet' : active.length ? `${active.length} of ${grown.length} grown` + (dorm.length ? `, ${dorm.length} embryonic` : '') : `${dorm.length} embryonic, none unlocked` };
  const cz = window.CIRC && window.CIRC.last, cOn = cz && cz.avail === 'ok';
  const sC = { k: 'Shadow track', t: 'Neural circuits (shadow)', d: 'eight circuits make recommendations next to the ensemble; never trade', s: cOn ? 'progress' : 'locked',
    note: cOn ? `shadow only, gen ${cz.st.generation ?? '?'}, recommendations never trade` : !cz || cz.avail === 'loading' ? 'checking the circuit layer' : cz.avail === 'disabled' ? 'built, not enabled on this server' : 'not available yet on this server' };
  const s5 = { k: 'Goal', t: 'Superbrain', d: 'all regions grown, funded models acting on them', s: 'locked',
    note: grown.length && active.length === grown.length && fund.length ? 'all conditions present: verify live' : 'not reached' };
  if (s5.note.startsWith('all')) s5.s = 'progress';
  return [s1, s2, s3, sC, s4, s5];
}
const STL = { done: 'DONE', progress: 'IN PROGRESS', locked: 'LOCKED' };
function roadmap(t, st) {
  const S_ = stages(t, st);
  const cur = S_.map((x, i) => x.s === 'progress' && x.k !== 'Shadow track' ? i : -1).filter(i => i >= 0).pop();
  return `<div class="road" role="list" aria-label="Evolution roadmap">${S_.map((x, i) => `<div class="rd rd-${x.s}${i === cur ? ' rd-now' : ''}" role="listitem">
    <div class="rd-k">${esc(x.k)}${i === cur ? ' <em>· WE ARE HERE</em>' : ''}</div><div class="rd-t">${esc(x.t)}</div><div class="rd-d">${esc(x.d)}</div>
    <div class="rd-s"><span class="rd-b">${STL[x.s]}</span> ${esc(x.note)}</div></div>${i < S_.length - 1 ? '<div class="rd-arr" aria-hidden="true">›</div>' : ''}`).join('')}</div>`;
}
function events(t, st) {
  const ev = [];
  ((t && t.culled_recent) || []).forEach(x => ev.push({ g: x.generation, k: 'cull', txt: `culled <b>${esc(x.model || x.policy_id)}</b> (rank ${esc(x.rank ?? '?')}${x.of != null ? ' of ' + esc(x.of) : ''}${x.reason ? ', ' + esc(x.reason) : ''})` }));
  ((t && t.promotions_recent) || []).forEach(x => ev.push({ g: x.generation, k: 'promo', txt: `promoted <b>${esc(x.policy_id)}</b> to ${esc(x.to_stage)}` }));
  ((t && t.births_recent) || []).forEach(x => ev.push({ g: x.generation, k: 'birth', txt: `born <b>${esc(x.model || x.policy_id)}</b>${x.parent_id ? ' from ' + esc(x.parent_id) : ''}` }));
  if (window.AMR && st) AMR.info(st).filter(r => !r.core && r.status === 'active' && r.unlocked_gen != null).forEach(r => ev.push({ g: r.unlocked_gen, k: 'region', txt: `region <b>${esc(r.name)}</b> unlocked` }));
  ev.sort((a, b) => (b.g ?? -1) - (a.g ?? -1) || (a.k === 'region' ? -1 : 1));
  if (!ev.length) return '<p class="ec-note">No evolution events yet. Region births, cull rounds and promotions will be listed here as they happen.</p>';
  return `<ol class="tl">${ev.slice(0, 40).map(e => `<li class="tl-${e.k}"><span class="tl-g">gen ${e.g == null ? '?' : esc(e.g)}</span><span class="tl-i" aria-hidden="true"></span><span class="tl-t">${e.txt}</span></li>`).join('')}</ol>`;
}
function evolution() {
  const { d: t } = tourData(), st = STATE;
  const bs = st && st.brain_stage != null ? `<p class="ec-note">Brain stage reported by the API: <b>${esc(st.brain_stage)}</b>${st.brain_stage_max != null ? ' of ' + esc(st.brain_stage_max) : ''}.</p>` : '';
  const dormant = (window.AMR && st) ? AMR.info(st).filter(r => r.status === 'dormant') : [];
  const emb = dormant.length ? `<ul class="emb">${dormant.map(r => `<li><b>🔒 ${esc(r.name)}</b> <span class="muted">${esc(r.lock)}${r.requires ? ' · requires ' + esc(r.requires) : ''}</span></li>`).join('')}</ul>` : '';
  return sec('economy-evolution', 'Evolution roadmap: from a small brain to a superbrain', `<p class="ec-note lead">ALPHAMORPH starts as a simple 3-region brain and grows by selection. This is early: most stages below are not reached yet, and the status is computed from live data, not promised.</p>${roadmap(t, st)}${bs}${emb}<h4>Evolution timeline <span class="muted">· real events only</span></h4>${events(t, st)}`);
}

function models(d) {
  const m = d.models, g = d.generations;
  let h = m.available ? table(['Model', 'Provider', 'Role', 'Weight', 'Status'], (m.models || []).map(x => `<tr><td>${esc(x.id || x.model_id || '—')}</td><td>${esc(x.provider || '—')}</td>
    <td>${esc(x.role || [x.awareness, x.timing, x.risk, x.ensemble].filter(Boolean).join(' / ') || '—')}</td><td>${x.weight == null ? na(x.weight_reason || 'weight not reported') : (typeof x.weight === 'object' ? esc(Object.entries(x.weight).map(([k, v]) => k + ' ' + (v == null ? '—' : (v / 1e6).toFixed(2))).join(' · ')) : esc(n(x.weight, 3)))}</td>
    <td class="st-${esc(x.status)}">${esc(x.status || '—')}</td></tr>`)) + ((m.models || []).length ? '' : '<p class="ec-note">No models registered yet.</p>') : unavail(m, 'models');
  const hist = (g.history || []).length ? table(['Gen', 'Started', 'Born', 'Eliminated', 'Verdict'], g.history.slice().reverse().map(x => `<tr><td>${esc(x.n)}</td><td>${when(x.started_at)}</td><td>${esc((x.born || []).length)}</td><td>${esc((x.eliminated || []).length)}</td><td>${esc(x.verdict || '—')}</td></tr>`)) : '<p class="ec-note">No completed generations yet.</p>';
  const famOf = {}; const { d: tt } = tourData();
  [...((tt && tt.ladder) || []), ...((tt && tt.culled_recent) || []), ...((tt && tt.births_recent) || [])].forEach(x => { if (x.family) famOf[x.policy_id] = x.family; });
  const tree = (nodes) => { const by = {}; nodes.forEach(x => (by[x.parent || ''] = by[x.parent || ''] || []).push(x)); const ids = new Set(nodes.map(x => x.id));
    const alive = (x) => x.status !== 'eliminated';
    const rec = (p, seen) => (by[p] || []).filter(x => !seen.has(x.id)).map(x => { seen.add(x.id); return `<li><span class="st-${esc(x.status)}">${alive(x) ? '●' : '✝'} ${esc(x.id)}</span> <span class="muted">${alive(x) ? 'ALIVE' : 'ELIMINATED'} · born gen ${esc(x.born_gen ?? '?')}${x.eliminated_gen != null ? ' · died gen ' + esc(x.eliminated_gen) : ''}</span>${by[x.id] ? '<ul>' + rec(x.id, seen) + '</ul>' : ''}</li>`; }).join('');
    const roots = nodes.filter(x => !x.parent || !ids.has(x.parent));
    const groups = {}; roots.forEach(x => (groups[famOf[x.id] || 'family unknown'] = groups[famOf[x.id] || 'family unknown'] || []).push(x));
    const seen = new Set();
    return Object.entries(groups).map(([f, rs]) => { const all = []; const walk = (x) => { all.push(x); (by[x.id] || []).forEach(walk); }; rs.forEach(walk);
      const al = all.filter(alive).length;
      return `<div class="lin-fam"><h5>${chip(f, 'fam ' + famCls(f))} <span class="muted">${al} alive · ${all.length - al} eliminated</span></h5><ul>${rs.map(x => { seen.add(x.id); return `<li><span class="st-${esc(x.status)}">${alive(x) ? '●' : '✝'} ${esc(x.id)}</span> <span class="muted">${alive(x) ? 'ALIVE' : 'ELIMINATED'} · born gen ${esc(x.born_gen ?? '?')}${x.eliminated_gen != null ? ' · died gen ' + esc(x.eliminated_gen) : ''}</span>${by[x.id] ? '<ul>' + rec(x.id, seen) + '</ul>' : ''}</li>`; }).join('')}</ul></div>`; }).join('') || '<p class="ec-note">No lineage yet.</p>'; };
  const lin = g.lineage && g.lineage.available ? `<div class="ec-lin">${tree(g.lineage.nodes || [])}</div>` : unavail(g.lineage, 'lineage');
  return sec('economy-models', 'Lineage &amp; generations', `<p class="ec-note">Current generation: <b>${g.current ?? na('unknown')}</b></p><h4>Lineage by family <span class="muted">· parent → child, alive vs eliminated</span></h4>${lin}<h4>Generation history</h4>${hist}<details class="ec-raw"><summary>Registered models (raw list)</summary>${h}</details>`);
}

function decisions(d) {
  const x = d.decisions;
  if (!x.available) return sec('economy-decisions', 'Decisions', unavail(x, 'decisions'));
  return sec('economy-decisions', 'Decisions', table(['Time', 'Action', 'Reason', 'Voted', 'Cost', 'Request'], x.rows.map(r => `<tr><td>${when(r.ts)}</td><td>${esc(r.action || '—')}</td><td>${esc(r.reason || '—')}</td>
    <td>${esc(Array.isArray(r.specialists) ? r.specialists.join(', ') : (r.specialists ?? '—'))}</td><td>${r.cost_usd == null ? na('cost not recorded for this decision') : usd(r.cost_usd)}</td><td><code>${esc(String(r.request_hash || r.intent || '').slice(0, 10)) || '—'}</code></td></tr>`)) + `<p class="ec-note">${esc(x.note || '')}</p>`);
}

function perf(d) {
  const R = d.performance.real, S = d.performance.simulated;
  const real = `<div class="ec-box real"><h4><span class="b b-real">REAL</span> on-chain fills ${R.dryrun ? '<span class="b b-dry">DRY-RUN</span>' : ''}</h4>
    <dl class="ec-kv"><dt>Real fills</dt><dd>${R.fills == null ? na(R.fills_reason) : esc(R.fills)}</dd>
    <dt>Open positions</dt><dd>${esc(R.open_positions ?? '—')}</dd>
    <dt>Win rate</dt><dd>${pct(R.win_rate, R.win_rate_reason)}</dd>
    <dt>Today (UTC)</dt><dd>${eth(R.realized_today_eth, R.fills_reason)}</dd>
    <dt>Wallet balance</dt><dd>${eth(R.balance_eth, 'balance not reported')} ${R.balance_usd != null ? '· ' + usd(R.balance_usd) : ''}</dd></dl>
    ${R.sample_note ? `<p class="ec-warn">${esc(R.sample_note)}</p>` : ''}
    ${(R.recent_txs || []).length ? '<p class="ec-note">Recent transactions: ' + R.recent_txs.map(t => txl(t)).join(' · ') + '</p>' : ''}</div>`;
  const sim = `<div class="ec-box sim"><h4><span class="b b-paper">SIMULATED</span> paper books</h4>
    <dl class="ec-kv"><dt>Paper fills</dt><dd>${esc(S.fills)}</dd><dt>Closed trades</dt><dd>${esc(S.closed_trades)}</dd>
    <dt>Win rate</dt><dd>${pct(S.win_rate, S.win_rate_reason)}</dd><dt>Realized PnL</dt><dd>${esc(n(S.realized_pnl_micro, 0))} µ <span class="muted">paper units</span></dd>
    <dt>In USD</dt><dd>${na(S.pnl_usd_reason)}</dd></dl><p class="ec-note">Paper fills use quoted prices; no order exists.</p></div>`;
  return sec('economy-perf', 'Real vs simulated', `<div class="ec-two">${real}${sim}</div><p class="ec-note">${esc(d.performance.note)}</p>`);
}

function treasury(d) {
  const F = d.fees, T = d.team, B = d.burns, Rs = d.treasury.reserves, L = d.treasury.ledger, I = d.inference;
  const inf = I.available ? `<dl class="ec-kv"><dt>Total spent</dt><dd>${usd(I.total_usd)}</dd><dt>Today</dt><dd>${usd(I.today_usd)}</dd><dt>Remaining budget</dt><dd>${usd(I.remaining_budget_usd, 'budget not reported')}</dd><dt>Cost per decision</dt><dd>${usd(I.cost_per_decision_usd, 'no decisions costed yet')}</dd></dl>
    ${breakdown('Per model', I.per_model)}${breakdown('Per purpose', I.per_purpose)}` : unavail(I, 'inference spend') + (I.adapter ? `<p class="ec-note">Adapter: ${I.adapter.enabled ? 'enabled' : 'disabled'}${I.adapter.reason ? ' (' + esc(I.adapter.reason) + ')' : ''} · calls ${esc(I.adapter.calls ?? '—')}. Dollar cost is not recorded.</p>` : '');
  const fees = F.available ? `<dl class="ec-kv"><dt>Collected</dt><dd>${eth(F.collected_eth)} · ${usd(F.collected_usd, 'no ETH/USD rate')}</dd></dl>${(F.claims || []).length ? '<p class="ec-note">Claim txs: ' + F.claims.map(txl).join(' · ') + '</p>' : '<p class="ec-note">No claims yet.</p>'}` : unavail(F, 'creator fees');
  const team = T.available ? `<dl class="ec-kv"><dt>Allocated</dt><dd>${eth(T.allocated_eth)}</dd><dt>Paid out</dt><dd>${eth(T.paid_out_eth)}</dd><dt>Pending</dt><dd>${eth(T.pending_eth)}</dd></dl>` : unavail(T, 'team allocations');
  const SP = d.split || {}, pc = (k, dflt) => (SP.pct && SP.pct[k] != null ? SP.pct[k] : dflt);
  const bucket = (o, what) => o && o.available ? `<dl class="ec-kv"><dt>Allocated</dt><dd>${eth(o.allocated_eth)}</dd><dt>Paid out</dt><dd>${eth(o.paid_out_eth)}</dd><dt>Pending</dt><dd>${eth(o.pending_eth)}</dd></dl>` : `<p class="ec-note">${na('not available yet')} <span class="muted">· ${what}${o && o.reason ? ': ' + esc(o.reason) : ''}</span></p>`;
  const infb = bucket(SP.inference, 'inference funding'), trdb = bucket(SP.trading, 'trading capital');
  const burn = B.available === false && B.program === false ? `<p class="ec-note">No burn program (buyback disabled by Founder decision)</p>` : B.available ? `<dl class="ec-kv"><dt>Verified burned</dt><dd>${val(B.verified_amount, x => n(x, 2))}</dd><dt>% of supply</dt><dd>${val(B.pct_of_supply, x => n(x, 4) + '%')}</dd></dl>${(B.txs || []).length ? '<p class="ec-note">Burn txs: ' + B.txs.map(txl).join(' · ') + '</p>' : '<p class="ec-note">No burn transactions verified.</p>'}` : unavail(B, 'burns');
  const res = Rs.available ? `<dl class="ec-kv"><dt>Reserves</dt><dd>${eth(Rs.eth)} · ${usd(Rs.usd, 'no ETH/USD rate')}</dd></dl>` : unavail(Rs, 'reserves');
  const led = L.available ? `<dl class="ec-kv"><dt>Ledger head</dt><dd><code title="${esc(L.head_hash)}">${esc(short(L.head_hash))}</code></dd><dt>Chain</dt><dd>${L.chain_ok === true ? '<span class="b b-ok">CHAIN OK</span>' : L.chain_ok === false ? '<span class="b b-dead">CHAIN BROKEN</span>' : na('not reported')}</dd></dl>` : unavail(L, 'ledger');
  const b = (t, c) => `<div class="ec-box"><h4>${t}</h4>${c}</div>`;
  return sec('economy-treasury', 'Treasury &amp; spend', `<div class="ec-two">${b('Inference expenditure (USD)', inf)}${b('Creator fees', fees)}${b('Inference funding (' + pc('inference', 20) + '%)', infb)}${b('Trading capital (' + pc('trading', 50) + '%)', trdb)}${b('Team (' + pc('team', 30) + '%)', team)}${b('Tokens burned', burn)}${b('Treasury reserves', res)}${b('Ledger', led)}</div>`);
}
function breakdown(t, rows) {
  if (!rows || !rows.length) return '';
  const r = Array.isArray(rows) ? rows : Object.entries(rows).map(([k, v]) => ({ name: k, usd: v }));
  return `<p class="ec-note">${t}: ` + r.map(x => `${esc(x.name || x.model || x.purpose || x.id)} ${usd(x.usd ?? x.total_usd)}`).join(' · ') + '</p>';
}

function method(d) {
  return sec('economy-method', 'Methodology', `<div class="honesty" style="margin:0"><p><b>Real</b> = on-chain fills by the live executor on Robinhood Chain, in ETH, converted to USD at the stated rate. <b>Simulated</b> = paper books against quoted prices. They are never added together.</p>
    <p><b>Unknown is shown as unknown.</b> A missing figure means the source did not report it, not zero.</p><p><b>The AI layer is experimental.</b> Real money is tiny and early; small samples prove nothing. This is not financial advice, and you can lose everything.</p></div>`);
}

function footer(d) {
  const f = d.freshness || {}, rt = d.rate || {};
  return `<footer class="ec-foot"><span>source <b>${esc(f.source ?? '—')}</b></span><span>last block <b>${esc(f.last_block ?? '—')}</b> · age ${f.last_block_age_s == null ? '—' : esc(f.last_block_age_s) + ' s'}</span><span>git <b>${esc(f.git_rev ?? '—')}</b></span><span>ETH/USD ${rt.usd_per_eth ? '$' + n(rt.usd_per_eth, 2) + ' (Pangea' + (rt.as_of ? ' ' + esc(rt.as_of) : '') + ')' : na(rt.reason)}</span><span>generated <b>${when(d.generated_at)}</b></span></footer>`;
}

function render(d) {
  const keep = body.scrollTop;
  body.innerHTML = evolution() + tournament() + overview(d) + models(d) + decisions(d) + perf(d) + treasury(d) + method(d) + footer(d);
  body.scrollTop = keep;
}
async function load() {
  try {
    const r = await fetch('/api/economy', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    D = await r.json();
    const [tr, sr] = await Promise.all([
      fetch('/api/intel/tournament', { cache: 'no-store' }).then(async x => x.ok ? { ok: true, data: await x.json() } : { ok: false, why: x.status === 404 ? 'tournament endpoint not available yet (HTTP 404)' : 'HTTP ' + x.status }).catch(e => ({ ok: false, why: 'tournament fetch failed: ' + e.message })),
      fetch('/api/state', { cache: 'no-store' }).then(x => x.ok ? x.json() : null).catch(() => null)]);
    TOUR = tr; STATE = sr || (window.DBAPP && window.DBAPP.S.state) || null; render(D);
  } catch (e) { if (!D) body.innerHTML = `<p class="ec-note">${na('/api/economy failed: ' + e.message)}</p>`; }
}
function open_(focus) {
  root.hidden = false; document.body.classList.add('econ-open'); load();
  clearInterval(timer); timer = setInterval(load, 15000);
  if (focus) root.focus();
}
function close_() { root.hidden = true; document.body.classList.remove('econ-open'); clearInterval(timer); if (location.hash.startsWith('#economy')) history.replaceState(null, '', location.pathname + location.search); $('#econ-link').focus(); }
function route() { if (location.hash === '#economy' || /^#economy-/.test(location.hash)) { const was = root.hidden; if (was) open_(false); const t = location.hash !== '#economy' && $(location.hash); if (t) setTimeout(() => t.scrollIntoView(), 50); } }
$('#econ-link').addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#economy'); open_(true); });
$('#ec-close').addEventListener('click', close_);
body.addEventListener('click', (e) => { const a = e.target.closest('a[data-lad]'); if (!a) return; e.preventDefault(); const t = document.getElementById(a.dataset.lad); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600); } });
$('.ec-nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); const t = $(a.getAttribute('href')); if (t) t.scrollIntoView(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close_(); });
window.addEventListener('hashchange', route);
window.addEventListener('circ-status', () => { if (D && !root.hidden) render(D); });
route();
})();
