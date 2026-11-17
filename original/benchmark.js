/* ALPHAMORPH — benchmark view (Phase 6 results). Renders ONLY the recorded /api/benchmark body, verbatim.
   Nothing is simulated or animated: every number is a field of the stored benchmark run; a missing value is a dash with the
   reason as tooltip; an API error is shown as an error, never replaced by a plausible-looking default. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#benchmark'), body = $('#bm-body');
if (!root || !body) return;

const isN = (v) => typeof v === 'number' && isFinite(v);
const dash = (why) => `<span class="na" tabindex="0" title="${esc(why || 'not reported in this benchmark run')}">—</span>`;
const num = (v, d = 0) => isN(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : null;
const ppmPct = (v, d = 2) => isN(v) ? (v / 1e4).toFixed(d) + '%' : null;            // ppm -> percent
const fracPct = (v, d = 1) => isN(v) ? (v * 100).toFixed(d) + '%' : null;            // fraction 0..1 -> percent (coverage fields)
const microUsd = (v) => isN(v) ? '$' + (v / 1e6).toFixed(Math.abs(v) < 1e4 ? 4 : 2) : null;
const or = (s, why) => s == null ? dash(why) : s;
const short = (h) => h ? (String(h).length > 16 ? String(h).slice(0, 8) + '…' + String(h).slice(-6) : String(h)) : '';
const when = (t) => isN(t) ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : null;
const sec = (id, title, inner, sub) => `<section class="ec-sec" id="${id}" aria-labelledby="${id}-h"><h3 id="${id}-h">${title}${sub ? ` <span class="muted">· ${sub}</span>` : ''}</h3>${inner}</section>`;
const card = (k, v, s, cls) => `<div class="ec-card ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
const table = (heads, rows, cls) => `<p class="bm-scrollhint" aria-hidden="true">← table scrolls sideways →</p><div class="ec-wrap" tabindex="0" role="region" aria-label="table, scrolls horizontally if needed"><table class="ec-tbl ${cls || ''}"><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

const VERDICT = {
  IMPROVEMENT_SUPPORTED: { cls: 'ok', head: 'Improvement supported', note: 'at least one comparison passed every predefined criterion on the unseen test window' },
  NO_IMPROVEMENT: { cls: 'no', head: 'Concluded', note: 'where there was enough data, no candidate beat its reference' },
  INSUFFICIENT_EVIDENCE: { cls: 'wait', head: 'Not enough evidence', note: 'the samples are too small or overlap the data used to select the candidate' },
  EVALUATION_INVALID: { cls: 'bad', head: 'Evaluation invalid', note: 'the inputs were inconsistent, so no conclusion is drawn' },
};
const vBadge = (v) => { const m = VERDICT[v]; return `<span class="bm-v bm-${m ? m.cls : 'wait'}" title="${esc(m ? m.note : v)}">${esc(String(v || '?').replace(/_/g, ' '))}</span>`; };
const CLS_NAME = { A: 'Frozen rule baseline', B: 'Evolving rule brain', C: 'AI models (arena)', D: 'AI ensemble', E: 'Neural circuits (shadow)' };
const LABEL_NOTE = { LIVE_EXECUTED: 'real transactions', PAPER_EXECUTED: 'paper trades', SHADOW_EXECUTED: 'shadow trades (circuits)', COUNTERFACTUAL: 'hypothetical, never traded', INSUFFICIENT_EVIDENCE: 'too little to judge' };

const S = { r: null, why: '', t: 0, loading: false, hist: null, histWhy: '' };

async function load() {
  if (S.loading) return; S.loading = true;
  try {
    const res = await fetch('/api/benchmark', { cache: 'no-store' });
    if (!res.ok) { S.r = null; S.why = res.status === 404 ? 'endpoint not available yet (HTTP 404)' : 'HTTP ' + res.status; }
    else { const j = await res.json(); if (j && j.error) { S.r = null; S.why = j.error + (j.reason ? ': ' + j.reason : ''); } else { S.r = j; S.why = ''; } }
  } catch (e) { S.r = null; S.why = 'fetch failed: ' + e.message; }
  try {
    const h = await fetch('/api/benchmark/history?limit=12', { cache: 'no-store' });
    if (h.ok) { const j = await h.json(); S.hist = (j && j.runs) || []; S.histWhy = ''; } else { S.hist = null; S.histWhy = 'HTTP ' + h.status; }
  } catch (e) { S.hist = null; S.histWhy = 'history fetch failed: ' + e.message; }
  S.t = Date.now(); S.loading = false; render();
}

function verdictSection(r) {
  const b = r.body, v = b.verdicts || {}, inp = b.inputs || {}, m = VERDICT[v.overall] || { cls: 'wait', head: String(v.overall || 'unknown'), note: '' };
  const counts = v.counts || {}, total = Object.values(counts).reduce((a, x) => a + x, 0);
  const stale = r.stored ? `stored run #${esc(r.run_id)} computed ${esc(when(r.created_at) || 'at an unknown time')}` : 'computed on the fly from the database';
  return sec('benchmark-verdict', 'Verdict', `
    <div class="bm-hero bm-${m.cls}" role="status">
      <div class="bm-h">${esc(m.head)}</div>
      <div class="bm-n">${esc(m.note)}.</div>
      <div class="bm-c">${Object.keys(counts).sort().map(k => `<span>${vBadge(k)} ${esc(counts[k])}</span>`).join(' ')} <span class="muted">of ${esc(total)} predefined comparisons</span></div>
    </div>
    <div class="ec-strip bm-strip">
      ${card('Observations', or(num(inp.observations)), isN(inp.obs_id_min) ? 'ids ' + esc(inp.obs_id_min) + '–' + esc(inp.obs_id_max) : '')}
      ${card('Matched opportunities', or(num(b.cohort && b.cohort.n_opportunities)), b.cohort ? num(b.cohort.n_tokens) + ' tokens' : '')}
      ${card('Frozen baseline', esc(b.baseline_identifier || '—'), 'fixed reference rule, never tuned')}
      ${card('Multiple-comparison correction', esc((b.multiple_comparisons && b.multiple_comparisons.method || '—').replace(/_/g, ' ')), b.multiple_comparisons ? 'effective candidates ' + esc(b.multiple_comparisons.m_eff_candidates) : '')}
      ${card('Reproducible', `<code title="${esc(b.result_hash)}">${esc(short(b.result_hash))}</code>`, 'same data ⇒ identical result hash')}
    </div>
    ${lastRunBanner(r)}
    <p class="ec-note">${stale}. Input fingerprint <code title="${esc(inp.inputs_hash)}">${esc(short(inp.inputs_hash))}</code>${inp.synthetic_data ? ' · <b>SYNTHETIC DATA</b>' : ' · real recorded observations'}. ${esc(v.rule || '')}</p>`);
}


const ageTxt = (sec) => !isN(sec) ? null : sec < 90 ? Math.round(sec) + ' s' : sec < 5400 ? Math.round(sec / 60) + ' min' : sec < 172800 ? (sec / 3600).toFixed(1) + ' h' : (sec / 86400).toFixed(1) + ' d';
function lastRunBanner(r) {
  const b = r.body, cv = r.coverage || null, ts = r.created_at;
  const age = isN(ts) ? Date.now() / 1000 - ts : null;
  const ob = cv ? cv.obs_id_max : (b.inputs && b.inputs.obs_id_max);
  const newer = isN(r.observations_now) && isN(ob) ? r.observations_now - ob : null;
  const stale = age != null && age > 36 * 3600;
  const cls = cv && cv.classes ? Object.keys(cv.classes).sort().map(k => { const c = cv.classes[k]; return `${esc(k)}: ${esc(c.deciding_in_test ?? '—')}/${esc(c.policies ?? '—')} deciding`; }).join(' · ') : null;
  const win = cv && cv.windows && cv.windows.test ? `test window obs ${esc(cv.windows.test.first)}–${esc(cv.windows.test.last)} (${esc(num(cv.windows.test.n_obs))} obs)` : null;
  const coh = cv && cv.cohort ? `${esc(num(cv.cohort.opportunities))} opportunities on ${esc(num(cv.cohort.tokens))} tokens` : null;
  return `<div class="bm-last ${stale ? 'bm-stale' : ''}" role="status">
    <div><b>Last completed run</b> ${or(esc(when(ts)), 'no timestamp recorded for this run')}${age != null ? ` <span class="muted">· ${esc(ageTxt(age))} ago</span>` : ''}${cv && isN(cv.duration_s) ? ` <span class="muted">· took ${esc(cv.duration_s)} s</span>` : ''}</div>
    <div>${newer != null ? (newer > 0 ? `<b>${esc(num(newer))}</b> observations have arrived since this run; they are not reflected below.` : 'No observations newer than this run.') : '<span class="muted">newer-observation count not available</span>'}${stale ? ' <b class="bm-warn">This run is more than 36 hours old.</b>' : ''}</div>
    <div class="muted">Coverage: ${coh || dash('this run has no stored coverage summary (it was started by hand, not by the schedule)')} · ${win || ''}${cls ? ' · ' + cls : ''}</div>
    ${cv && cv.tripwire ? `<div class="bm-warn">Integrity flag: ${esc(cv.tripwire)}</div>` : ''}
  </div>`;
}
function historySection(b) {
  const h = S.hist;
  if (h == null) return sec('benchmark-history', 'Run history', `<p class="ec-note">${dash(S.histWhy || 'history not loaded')} <span class="muted">${esc(S.histWhy || '')}</span></p>`);
  if (!h.length) return sec('benchmark-history', 'Run history', '<p class="ec-note">No stored runs yet.</p>');
  const rows = h.map(x => {
    const s = x.summary, v = s && s.verdict_overall;
    return `<tr><td>#${esc(x.run_id)}</td><td>${esc(when(x.created_at) || '—')}</td><td>${esc(x.bench_version)}</td>
      <td>${s ? or(num(s.observations)) : dash('run not made by the schedule: no stored summary')}</td>
      <td>${s && s.cohort ? or(num(s.cohort.opportunities)) : dash()}</td>
      <td>${v ? vBadge(v) : dash()}</td>
      <td><code title="${esc(x.inputs_hash)}">${esc(short(x.inputs_hash))}</code></td><td><code title="${esc(x.result_hash)}">${esc(short(x.result_hash))}</code></td></tr>`;
  });
  return sec('benchmark-history', 'Run history', `${table(['Run', 'Completed', 'Version', 'Observations', 'Opportunities', 'Overall verdict', 'Inputs', 'Result'], rows)}
    <p class="ec-note">Every scheduled run is kept; nothing is overwritten. The same inputs always give the same result hash. A change of version (e.g. bench-1 → bench-2) is a change of method, not of performance.</p>`, `${esc(h.length)} most recent`);
}

function windowsSection(b) {
  const w = b.windows || {}, e = w.evolution || {}, t = w.test || {}, g = w.gap || {}, pw = (b.cohort && b.cohort.per_window) || {};
  const tot = (e.n_obs || 0) + (g.n_obs || 0) + (t.n_obs || 0) || 1;
  const pct = (n) => Math.max(1, Math.round((n || 0) * 100 / tot));
  return sec('benchmark-windows', 'Walk-forward windows', `
    <div class="bm-win" role="img" aria-label="Evolution window, purge gap, unseen test window">
      <div class="bm-w bm-w-evo" style="flex:${pct(e.n_obs)}"><b>EVOLUTION</b><span>obs ${esc(e.first)}–${esc(e.last)} · ${esc(num(e.n_obs))} obs${pw.evolution ? ' · ' + esc(num(pw.evolution.opportunities)) + ' opportunities' : ''}</span></div>
      <div class="bm-w bm-w-gap" style="flex:${pct(g.n_obs)}" title="purge gap: ${esc(g.n_obs)} observations dropped so no label horizon crosses the boundary"></div>
      <div class="bm-w bm-w-test" style="flex:${pct(t.n_obs)}"><b>TEST (unseen)</b><span>obs ${esc(t.first)}–${esc(t.last)} · ${esc(num(t.n_obs))} obs${pw.test ? ' · ' + esc(num(pw.test.opportunities)) + ' opportunities' : ''}</span></div>
    </div>
    <p class="ec-note">Candidates are judged only on the test window. A policy that was selected or tuned on it is marked <b>selection overlap</b> and cannot be called an improvement. ${w.selection_marks && w.selection_marks.selection_events_in_test_window != null ? esc(w.selection_marks.selection_events_in_test_window) + ' selection events fall inside the test window.' : ''}</p>`);
}

function classesSection(b) {
  const rows = [];
  for (const k of ['A', 'B', 'C', 'D', 'E']) {
    const c = (b.classes || {})[k]; if (!c) continue;
    const w = (c.windows || {}).test || {}, ex = w.executed || {}, labels = Object.keys(ex);
    const ev = labels.length ? labels.map(l => {
      const x = ex[l], ci = Array.isArray(x.ci95_ppm) ? `[${ppmPct(x.ci95_ppm[0], 1)}, ${ppmPct(x.ci95_ppm[1], 1)}]` : null;
      return `<div class="bm-ev"><span class="bm-lab" title="${esc(LABEL_NOTE[l] || '')}">${esc(l.replace('_', ' '))}</span> ${esc(num(x.closed_trades))} trades · mean ${or(ppmPct(x.mean_return_per_trade_ppm), 'no trades')} · CI ${or(ci, x.ci_reason || 'no interval: fewer than 5 independent tokens')} ${x.evidence && x.evidence !== 'OK' ? `<span class="chip">${esc(x.evidence.replace(/_/g, ' '))}</span>` : ''}</div>`;
    }).join('') : `<span class="muted">no executed trades in the test window</span>`;
    rows.push(`<tr><td><b>${esc(k)}</b> ${esc(CLS_NAME[k] || c.name)}<div class="muted">${esc(c.cost_model || '')}</div></td>
      <td>${or(num(c.n_policies))}</td><td>${or(num(w.policies_with_decisions))}</td>
      <td>${or(fracPct(w.union_coverage), 'share of opportunities where any policy of this class decided')}</td>
      <td>${or(num(w.decisions_total))}</td><td>${or(microUsd(w.inference_spend_micro))}</td><td>${or(num(w.risk_limit_violations))}</td><td>${ev}</td></tr>`);
  }
  return sec('benchmark-classes', 'Policy classes', `
    ${table(['Class', 'Policies', 'Deciding', 'Coverage', 'Decisions', 'Inference spend', 'Gate rejects', 'Executed evidence · test window'], rows, 'bm-tbl-classes')}
    <p class="ec-note">Coverage and cost differ by construction: rules never call a model, models and the ensemble pay per decision, circuits reuse the ensemble's votes when present. Where a policy was never queried on an opportunity it is shown as <b>not covered</b>, never imputed. Evidence labels are never pooled.</p>`, 'test window');
}

function compareSection(b) {
  const cs = b.comparisons || [], kinds = {};
  cs.forEach(c => { (kinds[c.kind] = kinds[c.kind] || { n: 0, v: {} }).n++; kinds[c.kind].v[c.verdict] = (kinds[c.kind].v[c.verdict] || 0) + 1; });
  const rows = Object.keys(kinds).sort().map(k => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${esc(kinds[k].n)}</td><td>${Object.keys(kinds[k].v).sort().map(v => `${vBadge(v)} ${esc(kinds[k].v[v])}`).join(' &nbsp; ')}</td></tr>`);
  const reasons = {};
  cs.forEach(c => { if (c.verdict === 'INSUFFICIENT_EVIDENCE') { const r = String(c.reason || 'unspecified').replace(/\s*\(.*$/, '').trim(); reasons[r] = (reasons[r] || 0) + 1; } });
  const rk = Object.keys(reasons).sort((a, c) => reasons[c] - reasons[a]).slice(0, 5);
  const noimpAll = cs.filter(c => c.verdict === 'NO_IMPROVEMENT'), noimp = noimpAll.slice(0, 8);
  return sec('benchmark-compare', 'Comparisons', `
    ${table(['Comparison', 'Count', 'Verdicts'], rows)}
    ${rk.length ? `<h4>Why evidence is insufficient</h4><ul class="bm-list">${rk.map(r => `<li>${esc(reasons[r])} × <code>${esc(r)}</code></li>`).join('')}</ul>` : ''}
    ${noimp.length ? `<h4>Concluded (enough data) <span class="muted">· showing ${esc(noimp.length)} of ${esc(noimpAll.length)}; the full list is in the JSON from <code>/api/benchmark?full=1</code></span></h4>${table(['Candidate', 'Against', 'Paired', 'Tokens', 'Mean difference', 'Reason'], noimp.map(c => `<tr><td title="${esc(c.candidate)}">${esc(String(c.candidate).slice(0, 36))}</td><td title="${esc(c.reference)}">${esc(String(c.reference).slice(0, 28))}</td><td>${or(num(c.pairs))}</td><td>${or(num(c.tokens))}</td><td>${or(ppmPct(c.mean_diff_ppm))}</td><td>${esc(c.reason || '')}</td></tr>`))}` : ''}`,
    `${esc(cs.length)} comparisons`);
}

function evolutionSection(b) {
  const p = b.evolution_progress || {}, rows = p.rows || [];
  const ct = {};
  rows.forEach(x => { ['child_vs_parent', 'child_vs_frozen_baseline', 'child_vs_champion'].forEach(k => { if (x[k]) { ct[k] = ct[k] || {}; ct[k][x[k].verdict] = (ct[k][x[k].verdict] || 0) + 1; } }); });
  const lines = Object.keys(ct).map(k => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${Object.keys(ct[k]).sort().map(v => `${vBadge(v)} ${esc(ct[k][v])}`).join(' &nbsp; ')}</td></tr>`);
  return sec('benchmark-evolution', 'Evolutionary progress', `
    <div class="ec-strip bm-strip3">
      ${card('Neural lineages', or(num(p.n_lineages)), 'frozen c0 plus evolved candidates')}
      ${card('Supported improvements', or(num(p.supported_improvements)), 'parent or baseline verdict IMPROVEMENT_SUPPORTED', p.supported_improvements ? 'real' : '')}
      ${card('Generation count', '<span class="na" title="deliberately not used as evidence">not evidence</span>', 'progress is never inferred from generations')}
    </div>
    ${lines.length ? table(['Per-lineage comparison (each evolved candidate once)', 'Verdicts across lineages'], lines) : '<p class="ec-note">No lineage comparisons were recorded.</p>'}
    <p class="ec-note">${esc(p.note || '')}</p>`);
}

function methodSection(b, r) {
  const sp = (b.config && b.config.split) || {}, rp = b.replay || {};
  return sec('benchmark-method', 'Method and limits', `
    <ul class="bm-list">
      <li>Opportunity: ${esc((b.cohort && b.cohort.definition) || '—')}</li>
      <li>Outcomes: ${esc((b.cohort && b.cohort.outcome_basis) || '—')}</li>
      <li>Split: ${esc(sp.evolution_pct)}% evolution, ${esc(sp.gap_obs)}-observation gap, remainder test. ${esc(sp.purge || '')}</li>
      <li>Replay: ${esc(num(rp.observations))} observations, ${esc(num(rp.vote_records))} recorded ensemble vote records, ${esc(num(rp.layer_errors))} circuit-layer errors.</li>
      <li>${esc(b.label_note || '')}</li>
      <li>Read-only: this view cannot start trades, move funds or change any limit. Nothing is animated: values change only when the stored run changes.</li>
    </ul>
    <p class="ec-note">Reproduce: <code>python -m degenbrain bench --db degen.db</code>. Same database in, byte-identical JSON out. Bench version ${esc(b.bench_version)}.</p>`);
}

function render() {
  let html;
  if (!S.r) {
    html = `<div class="bm-off"><b>${S.t ? 'Benchmark not available' : 'Loading /api/benchmark'}</b><p>${esc(S.why || 'Fetching the stored run.')}</p>${S.t ? '<p class="muted">Nothing is shown in place of a result. The benchmark is computed offline and stored; until a run exists there is no conclusion to display.</p>' : ''}</div>`;
  } else {
    const b = S.r.body; if (!b) { html = '<div class="bm-off"><b>Benchmark response had no body</b></div>'; }
    else html = `<div class="bm-shadow"><b>EVIDENCE ONLY</b> Paper, shadow and hypothetical outcomes. No live trade depends on this page. ${b.valid === false ? '<b>This run is flagged INVALID.</b>' : ''}</div>`
      + verdictSection(S.r) + windowsSection(b) + classesSection(b) + compareSection(b) + evolutionSection(b) + historySection(b) + methodSection(b, S.r);
  }
  if (body._h !== html) { body._h = html; body.innerHTML = html; }
}

let timer = 0;
function open_(focus) {
  if (!$('#economy').hidden) $('#ec-close').click();
  const c = $('#circuits'); if (c && !c.hidden) $('#circ-close').click();
  const hd = document.querySelector('header.top'); if (hd) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px';
  root.hidden = false; document.body.classList.add('bm-open'); render(); load();
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  if (focus) root.focus();
}
function close_(noFocus) {
  root.hidden = true; document.body.classList.remove('bm-open'); clearInterval(timer);
  if (location.hash === '#benchmark' || /^#benchmark-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  if (!noFocus) { const l = $('#bm-link'); if (l) l.focus(); }
}
function route() { if (location.hash === '#benchmark' || /^#benchmark-/.test(location.hash)) { if (root.hidden) open_(false); const t = location.hash !== '#benchmark' && $(location.hash); if (t) setTimeout(() => t.scrollIntoView(), 300); } }

$('#bm-link').addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#benchmark'); open_(true); });
$('#econ-link').addEventListener('click', () => { if (!root.hidden) close_(true); });
$('#circ-link').addEventListener('click', () => { if (!root.hidden) close_(true); });
$('#bm-close').addEventListener('click', () => close_());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close_(); });
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { const hd = document.querySelector('header.top'); if (hd && !root.hidden) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px'; });
$('.bm-nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); const t = $(a.getAttribute('href')); if (t) t.scrollIntoView(); });
route();
})();
