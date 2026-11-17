/* AlphaMorph // REBUS LAB: read-only playback of a recorded computational experiment.
 * Every animated or plotted value is read from the result files (rebus-data/*.json).
 * Constants below are layout (node positions), palette, and pixel scales that map data ranges to screen units.
 * No randomness, no wall clock, no synthetic motion: see tests/test_rebus_ui.py. */
(function () {
'use strict';

var PHASES = ['BASELINE', 'ONSET', 'PEAK', 'RECOVERY', 'POST'];     // phase codes 0..4 (docs/REBUS-SCHEMA.md 3.1)
var PHCOL = { BASELINE: '#4A5763', ONSET: '#9B7BFF', PEAK: '#FF5A4E', RECOVERY: '#E7C46A', POST: '#2FD6E8' };
var LAYOUT = {   // schematic placement only (circuit topology itself comes from the data)
  thalamus: [90, 70], prefrontal: [300, 48], hippocampus: [520, 84],
  amygdala: [78, 232], basal_ganglia_go: [292, 196], basal_ganglia_nogo: [292, 336],
  acc: [512, 252], cerebellum: [520, 382], dopamine: [78, 380]
};
var NODE_R = 21, VBW = 620, VBH = 440;
var HYP = {   // registered hypothesis names (docs/REBUS-PREREGISTRATION.md section 6)
  H1: 'M1 memory prior: Go drive changes where memory is active',
  H2: 'M2 dynamics: activation entropy rises at PEAK',
  H3: 'M3 plasticity: directed extra learning (deterministic criterion)',
  H3b: 'M3 learning persists: POST shadow-decision divergence',
  H4: 'Combined: PEAK decision divergence vs CONTROL',
  H5: 'Specificity: REBUS vs magnitude-matched RANDOM',
  H6: 'Persistence: POST decision divergence vs CONTROL',
  H8: 'Margin stage: divergence among decisions that reach the Go/No-Go competition (ONSET+PEAK+RECOVERY)'
};
var VERDICT_CLASS = {
  DIVERGENCE_DETECTED: 'v-pos', SUPPORTED: 'v-pos', PERSISTENCE_DETECTED: 'v-pos', DIFFERS_FROM_RANDOM: 'v-pos', PERFORMANCE_DIFFERENCE_SUPPORTED: 'v-pos',
  NO_MEANINGFUL_DIFFERENCE: 'v-nul', NO_PERSISTENCE: 'v-nul', NOT_DISTINGUISHABLE_FROM_RANDOM: 'v-nul', NOT_SUPPORTED: 'v-nul',
  INSUFFICIENT_EVIDENCE: 'v-unk', INCONCLUSIVE: 'v-unk'
};
var GLOSS = {
  DIVERGENCE_DETECTED: 'A difference beyond the registered margin was measured.',
  SUPPORTED: 'Holm-adjusted p < 0.05 and the estimate is beyond the registered margin.',
  PERSISTENCE_DETECTED: 'A difference was still present after recovery.',
  DIFFERS_FROM_RANDOM: 'The REBUS arm differed from magnitude-matched random perturbation.',
  PERFORMANCE_DIFFERENCE_SUPPORTED: 'Outcome difference supported (minimum evidence met).',
  NO_MEANINGFUL_DIFFERENCE: 'The 95% interval lies inside the registered margin: any difference is too small to matter at this sample size.',
  NO_PERSISTENCE: 'No difference from CONTROL remained after recovery.',
  NOT_DISTINGUISHABLE_FROM_RANDOM: 'Real and random perturbations produced indistinguishable decision changes.',
  NOT_SUPPORTED: 'The hypothesis was tested and the evidence did not support it.',
  INSUFFICIENT_EVIDENCE: 'Not enough data to decide. This is a statement about sample size, not a result.',
  INCONCLUSIVE: 'The interval is too wide to call the effect present or absent.'
};

var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fx(v, n) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(n == null ? 3 : n); }
function ppm(v, n) { return v == null ? '—' : (v / 1e6).toFixed(n == null ? 3 : n); }
function pct(v, n) { return v == null ? '—' : (v * 100).toFixed(n == null ? 2 : n) + '%'; }
function ppmPct(v, n) { return v == null ? '—' : (v / 1e4).toFixed(n == null ? 1 : n) + '%'; }
function sg(v, s) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + s(Math.abs(v)); }
function short(s) { s = String(s || ''); return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s; }
function ci(a, f) { return a ? '[' + f(a[0]) + ', ' + f(a[1]) + ']' : '—'; }
function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var st = { D: null, R: null, man: null, i: 0, playing: false, timer: null, mode: 'compare', cond: 'REBUS_HIGH', panes: [], S: null, byId: {}, kind: '', tl: null };

/* ---------------------------------------------------------------- loading */
function getJSON(url) {
  return fetch(url, { credentials: 'omit' }).then(function (r) {
    if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
    return r.text().then(function (t) { var j = JSON.parse(t); j.__bytes = t.length; return j; });
  });
}
function pickEntry(man) {
  var m = /[?&]exp=([A-Za-z0-9-]+)/.exec(location.search);                 // experiment selector: ?exp=<id> (default: the primary entry, Experiment 001)
  var byExp = m && man.datasets.filter(function (d) { return d.id === m[1]; })[0];
  if (byExp) return byExp;
  var want = /[?&]data=fixture\b/.test(location.search) ? 'fixture' : 'primary';
  var e = man.datasets.filter(function (d) { return d.role === want; })[0];
  return e || man.datasets[0];
}
function expNav() {
  var ds = st.man.datasets.filter(function (d) { return d.id; });
  if (ds.length < 2) return;
  $('rb-expnav').hidden = false;
  $('rb-expnav').innerHTML = '<span class="rb-k">Experiment</span> ' + ds.map(function (d) {
    var cur = d === st.entry;
    return cur ? '<b class="rb-expcur" aria-current="page">' + esc(d.id) + '</b>' : '<a href="rebus?exp=' + esc(d.id) + '">' + esc(d.id) + '</a>';
  }).join(' · ') + ' <span class="mut">' + esc(st.entry.label || '') + '</span>';
}
function load() {
  getJSON('rebus-data/manifest.json').then(function (man) {
    st.man = man;
    var e = pickEntry(man);
    st.entry = e;
    return Promise.all([getJSON(e.ui), getJSON(e.results).catch(function () { return null; })]);
  }).then(function (a) {
    st.D = a[0]; st.R = a[1];
    init();
  }).catch(function (err) {
    $('rb-loading').hidden = true;
    var e = $('rb-error'); e.hidden = false;
    e.textContent = 'Could not load the recorded result files (' + err.message + '). The static summary above, if present, is the only content available.';
  });
}

/* ---------------------------------------------------------------- init */
function init() {
  var D = st.D, S = D.series;
  st.S = S;
  st.kind = D.dataset.kind || D.experiment.dataset_kind;
  D.conditions.forEach(function (c) { st.byId[c.id] = c; });
  $('rb-loading').hidden = true;
  $('rb-title').textContent = D.experiment.title;
  expNav();
  document.title = D.experiment.title + (st.kind === 'SYNTHETIC_FIXTURE' ? ' [SYNTHETIC_FIXTURE]' : '') + ' | REBUS LAB';
  banners();
  verdictSection();
  ['rb-verdict', 'rb-lab', 'rb-results', 'rb-repro'].forEach(function (id) { $(id).hidden = false; });
  buildControls();
  buildPanes();
  buildTimeline();
  results();
  repro();
  var r = $('rb-range'); r.max = String(S.keys.length - 1);
  // start at the first row of PEAK so the first view shows the perturbation (a phase boundary from the schedule)
  var peakFirst = D.schedule.phases.filter(function (p) { return p.name === 'PEAK'; })[0];
  st.i = peakFirst ? nearestRow(peakFirst.first_obs) : 0;
  render(false);
}

function banners() {
  var D = st.D, e = D.experiment, h = '';
  if (st.kind === 'SYNTHETIC_FIXTURE') {
    h += '<div class="rb-ban syn" role="alert"><b>SYNTHETIC_FIXTURE</b> Generated test data used to develop this page. It is not market data and <b>not a research finding</b>. Nothing below is evidence.</div>';
  } else {
    h += '<div class="rb-ban rec"><b>RECORDED</b> Replay of a recorded observation stream through the AlphaMorph circuit, offline. No live data, no orders, no wallet.</div>';
  }
  if (e.evidence_class) {
    h += '<div class="rb-ban disc"><b>' + esc(e.evidence_class.replace(/_/g, ' ')) + '</b> ' + esc(e.evidence_note || '') + '</div>';
  } else if (e.status === 'DISCOVERY_ONLY' || e.window_role === 'DISCOVERY') {
    h += '<div class="rb-ban disc"><b>DISCOVERY WINDOW</b> Mechanics check on the development window. <b>Not confirmatory</b>; the held-out run is the registered test.</div>';
  }
  $('rb-banners').innerHTML = h;
}

function vbadge(v, big) {
  return '<span class="rb-vb ' + (VERDICT_CLASS[v] || 'v-unk') + (big ? ' big' : '') + '">' + esc(v) + '</span>';
}
function verdictSection() {
  var V = st.D.verdicts, T = st.D.tests;
  var h = '<div class="rb-vmain"><div><p class="rb-k">Overall verdict (decision divergence, H4)</p>' + vbadge(V.overall, true) + '<p class="rb-gloss">' + esc(GLOSS[V.overall] || '') + '</p></div>';
  h += '<div class="rb-vchips" role="list" aria-label="Verdict per question">';
  Object.keys(V.per_hypothesis).filter(function (k) { return k !== 'overall'; }).forEach(function (k) {
    var v = V.per_hypothesis[k];
    h += '<div class="rb-vchip" role="listitem"><span>' + esc(k.replace(/_/g, ' ')) + '</span>' + vbadge(v) + '</div>';
  });
  h += '</div></div>';
  h += '<p class="rb-note">Verdicts are reported exactly as computed by the registered rules (' + esc(V.definitions_ref) + '). “No meaningful difference” and “insufficient evidence” are results, shown with the same weight as a positive finding.</p>';
  h += '<details class="rb-det" open><summary>Registered tests (' + T.primary.length + ')</summary><div class="rb-scroll"><table class="rb-tab"><thead><tr><th>test</th><th>what it asks</th><th>estimate</th><th>95% CI</th><th>n</th><th>Holm p</th><th>decision</th></tr></thead><tbody>';
  T.primary.forEach(function (t) {
    var est = t.estimate != null ? t.estimate : (t.path_length_ratio != null ? t.path_length_ratio : null);
    h += '<tr><td><b>' + esc(t.id) + '</b></td><td>' + esc(HYP[t.id] || '') + '<br><span class="mut">' + esc(t.unit || t.criterion || '') + '</span></td><td>' + (est == null ? '—' : fx(est, Math.abs(est) >= 100 ? 0 : 4)) + '</td><td>' + (t.ci95 ? ci(t.ci95, function (x) { return fx(x, Math.abs(x) >= 100 ? 0 : 4); }) : '—') + '</td><td>' + (t.n != null ? t.n : (t.learn_events != null ? t.learn_events + ' ev' : '—')) + '</td><td>' + (t.p_holm == null ? '—' : fx(t.p_holm, 4)) + '</td><td>' + vbadge(t.decision) + '</td></tr>';
  });
  h += '</tbody></table></div><p class="rb-note">' + esc(T.multiple_comparison_note) + '</p></details>';
  $('rb-verdict-body').innerHTML = h;
}

/* ---------------------------------------------------------------- controls */
function condLabel(c) { return c.id + (c.kind === 'REBUS' && c.mechanisms && !(c.mechanisms.M1 && c.mechanisms.M2 && c.mechanisms.M3) ? ' (ablation)' : ''); }
function buildControls() {
  var sel = $('rb-cond'), D = st.D, ids = Object.keys(D.series.by_condition);
  var groups = [['REBUS (all mechanisms)', function (c) { return c.kind === 'REBUS' && c.mechanisms.M1 && c.mechanisms.M2 && c.mechanisms.M3; }],
    ['Ablations (one mechanism)', function (c) { return c.kind === 'REBUS' && !(c.mechanisms.M1 && c.mechanisms.M2 && c.mechanisms.M3); }],
    ['PLACEBO (no change)', function (c) { return c.kind === 'PLACEBO'; }],
    ['RANDOM comparators', function (c) { return c.kind === 'RANDOM'; }],
    ['CONTROL', function (c) { return c.kind === 'CONTROL'; }]];
  var h = '';
  groups.forEach(function (g) {
    var items = D.conditions.filter(function (c) { return ids.indexOf(c.id) >= 0 && g[1](c); });
    if (!items.length) return;
    h += '<optgroup label="' + esc(g[0]) + '">' + items.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.id) + '</option>'; }).join('') + '</optgroup>';
  });
  sel.innerHTML = h;
  if (ids.indexOf(st.cond) < 0) st.cond = ids.filter(function (x) { return x !== 'CONTROL'; })[0] || 'CONTROL';
  sel.value = st.cond;
  sel.addEventListener('change', function () { st.cond = sel.value; buildTimeline(); render(false); });
  $('rb-prev').addEventListener('click', function () { pause(); step(-1); announce(); });
  $('rb-next').addEventListener('click', function () { pause(); step(1); announce(); });
  $('rb-play').addEventListener('click', function () { st.playing ? pause() : play(); });
  $('rb-speed').addEventListener('change', function () { if (st.playing) { play(); } });
  $('rb-range').addEventListener('input', function (e) { st.i = +e.target.value; render(true); });
  $('rb-range').addEventListener('change', announce);
  $('rb-m-single').addEventListener('click', function () { setMode('single'); });
  $('rb-m-compare').addEventListener('click', function () { setMode('compare'); });
}
function setMode(m) {
  st.mode = m;
  $('rb-m-single').setAttribute('aria-pressed', String(m === 'single'));
  $('rb-m-compare').setAttribute('aria-pressed', String(m === 'compare'));
  buildPanes(); render(false);
}
function step(d) {
  var n = st.S.keys.length;
  st.i = Math.max(0, Math.min(n - 1, st.i + d));
  render(true);
}
function play() {
  pause();
  st.playing = true;
  var b = $('rb-play'); b.textContent = '❚❚ pause'; b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-label', 'Pause');
  var rate = +$('rb-speed').value || 1;
  if (st.i >= st.S.keys.length - 1) st.i = 0;
  st.timer = setInterval(function () {
    if (st.i >= st.S.keys.length - 1) { pause(); announce(); return; }
    step(1);
  }, Math.round(1000 / rate));
}
function pause() {
  if (st.timer) clearInterval(st.timer);
  st.timer = null; st.playing = false;
  var b = $('rb-play'); b.textContent = '▶ play'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Play');
}
function announce() {
  var S = st.S, i = st.i;
  $('rb-sr').textContent = 'Observation ' + S.keys[i][0] + ', phase ' + PHASES[S.phase[i]] + ', row ' + (i + 1) + ' of ' + S.keys.length + '.';
}
function nearestRow(obs) {
  var K = st.S.keys, lo = 0, hi = K.length - 1;
  while (lo < hi) { var m = (lo + hi) >> 1; if (K[m][0] < obs) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(K[lo - 1][0] - obs) <= Math.abs(K[lo][0] - obs)) lo--;
  return lo;
}

/* ---------------------------------------------------------------- network panes */
function armOf(role) { return role === 'normal' ? 'CONTROL' : st.cond; }
function buildPanes() {
  var host = $('rb-panes'), D = st.D, roles = st.mode === 'compare' ? ['normal', 'perturbed'] : ['perturbed'];
  host.className = 'rb-panes ' + (roles.length === 2 ? 'two' : 'one');
  host.innerHTML = '';
  st.panes = roles.map(function (role, k) {
    var sec = document.createElement('figure'); sec.className = 'rb-pane ' + role;
    var uid = 'p' + k;
    var topo = D.topology, edges = topo.edges, nodes = topo.nodes, idx = {};
    nodes.forEach(function (n, j) { idx[n.id] = j; });
    var defs = '<defs><marker id="ma-' + uid + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 1 L9 5 L0 9 Z" fill="#B6FF4D"/></marker>' +
      '<marker id="mi-' + uid + '" viewBox="0 0 10 12" refX="5" refY="6" markerWidth="10" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto"><path d="M5 0 V12" stroke="#FF5A4E" stroke-width="3"/></marker></defs>';
    var under = '', over = '';
    var geo = edges.map(function (e) { return edgePath(e); });
    edges.forEach(function (e, j) {
      under += '<path class="rb-eu" data-e="' + j + '" d="' + geo[j] + '" fill="none"/>';
      over += '<path class="rb-e ' + (e.sign < 0 ? 'inh' : 'exc') + '" data-e="' + j + '" d="' + geo[j] + '" fill="none" marker-end="url(#' + (e.sign < 0 ? 'mi-' : 'ma-') + uid + ')"><title></title></path>';
    });
    var ng = '';
    nodes.forEach(function (n, j) {
      var p = LAYOUT[n.id] || [VBW / 2, VBH / 2];
      ng += '<g class="rb-n" data-n="' + j + '" tabindex="0" role="img" transform="translate(' + p[0] + ' ' + p[1] + ')" aria-label="' + esc(n.label) + '"><title>' + esc(n.label + ': ' + n.role) + '</title>' +
        '<circle class="halo" r="' + (NODE_R + 8) + '"/><circle class="disc" r="' + NODE_R + '"/><circle class="fill" r="0"/>' +
        '<text class="nm" y="' + (NODE_R + 15) + '" text-anchor="middle">' + esc(n.label) + '</text><text class="pc" y="4" text-anchor="middle"></text></g>';
    });
    sec.innerHTML = '<figcaption class="rb-pcap"><span class="rb-role">' + (role === 'normal' ? 'NORMAL BRAIN (control)' : 'PERTURBED BRAIN (' + 'selected arm' + ')') + '</span> <b class="rb-arm"></b> <span class="rb-tag ' + tagClass(st.kind) + '">' + esc(st.kind) + '</span></figcaption>' +
      '<svg viewBox="0 0 ' + VBW + ' ' + VBH + '" role="group" aria-label="Circuit network, nodes sized by recorded activation, edges by recorded effective weight">' + defs + '<g>' + under + '</g><g>' + over + '</g><g>' + ng + '</g></svg>' +
      '<p class="rb-leg"><i class="lg-e"></i>excitatory<i class="lg-i"></i>inhibitory (T terminal)<i class="lg-u"></i>weight change vs CONTROL<span class="mut"> · node fill = activation · edge width = effective weight</span></p>';
    host.appendChild(sec);
    return { role: role, el: sec, arm: sec.querySelector('.rb-arm'), eu: [].slice.call(sec.querySelectorAll('.rb-eu')), e: [].slice.call(sec.querySelectorAll('.rb-e')),
      n: [].slice.call(sec.querySelectorAll('.rb-n')), prev: null };
  });
}
function edgePath(e) {
  var a = LAYOUT[e.src], b = LAYOUT[e.dst];
  if (!a || !b) return '';
  if (e.src === e.dst) {
    var x = a[0], y = a[1] - NODE_R;
    return 'M' + (x - 9) + ' ' + y + ' C' + (x - 46) + ' ' + (y - 52) + ' ' + (x + 46) + ' ' + (y - 52) + ' ' + (x + 9) + ' ' + (y - 3);
  }
  var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  var off = 16, cx = (a[0] + b[0]) / 2 - uy * off * 2, cy = (a[1] + b[1]) / 2 + ux * off * 2;
  var s = unit(cx - a[0], cy - a[1]), t = unit(b[0] - cx, b[1] - cy);
  return 'M' + (a[0] + s[0] * NODE_R).toFixed(1) + ' ' + (a[1] + s[1] * NODE_R).toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + (b[0] - t[0] * (NODE_R + 5)).toFixed(1) + ' ' + (b[1] - t[1] * (NODE_R + 5)).toFixed(1);
}
function unit(x, y) { var l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function tagClass(k) { return k === 'RECORDED' ? 't-rec' : k === 'SYNTHETIC_FIXTURE' ? 't-syn' : k === 'REALIZED_SHADOW' ? 't-real' : k === 'COUNTERFACTUAL_RESEARCH' ? 't-cf' : ''; }

function renderPane(p, i) {
  var S = st.S, topo = st.D.topology, id = armOf(p.role), B = S.by_condition[id];
  if (!B) return;
  p.arm.textContent = id;
  if (!B.act[i]) { p.arm.textContent = id + ' (no matched decision at this row)'; p.prev = null; return; }   // arm made no decision here (recorded as null)
  var act = B.act[i], w = B.w_eff[i], dw = B.dw_vs_control[i], prev = p.prev && p.prevId === id ? p.prev : null;
  p.n.forEach(function (g, j) {
    var a = act[j] / 1e6;
    g.querySelector('.fill').setAttribute('r', (NODE_R * a).toFixed(2));
    g.querySelector('.fill').style.opacity = String(0.25 + 0.75 * a);
    g.querySelector('.pc').textContent = a.toFixed(2);
    var halo = g.querySelector('.halo');
    halo.style.strokeOpacity = String(0.15 + 0.85 * a);
    g.setAttribute('aria-label', topo.nodes[j].label + ' activation ' + a.toFixed(3));
    g.setAttribute('data-act', String(act[j]));
    if (prev && !reduced) {
      var d = Math.abs(act[j] - prev[j]) / 1e6;
      if (d > 0) { g.style.setProperty('--f', String(Math.min(1, d * 3))); g.classList.remove('pulse'); void g.getBoundingClientRect(); g.classList.add('pulse'); }
    }
  });
  p.e.forEach(function (el, j) {
    var m = Math.abs(w[j]) / 1e6;
    el.style.strokeWidth = (0.8 + 6 * m).toFixed(2);
    el.style.strokeOpacity = String(0.3 + 0.7 * Math.min(1, m));
    el.setAttribute('data-w', String(w[j]));
    el.firstChild.textContent = topo.edges[j].id + ' · ' + (topo.edges[j].sign < 0 ? 'inhibitory' : 'excitatory') + ' · effective weight ' + (w[j] / 1e6).toFixed(3) + (dw[j] ? ' (' + sg(dw[j], function (x) { return (x / 1e6).toFixed(3); }) + ' vs control)' : '');
  });
  p.eu.forEach(function (el, j) {
    var m = Math.abs(dw[j]) / 1e6;
    el.style.strokeWidth = m ? (2 + 18 * Math.min(1, m)).toFixed(2) : '0';
    el.style.strokeOpacity = m ? '0.5' : '0';
    el.setAttribute('data-dw', String(dw[j]));
  });
  p.prev = act; p.prevId = id;
}

/* ---------------------------------------------------------------- timeline */
function armLevel(id) {
  var c = st.byId[id], lv = c && c.level ? st.D.schedule.levels[c.level] : 0;
  return (lv || 0) / 1e6;
}
function buildTimeline() {
  var D = st.D, S = st.S, sch = D.schedule, svg = $('rb-tl');
  var x0 = 44, x1 = 884, first = sch.first, last = sch.last;
  var xs = function (o) { return x0 + (o - first) / Math.max(1, last - first) * (x1 - x0); };
  var h = '<title id="rb-tl-t">Phase timeline and perturbation intensity</title><desc id="rb-tl-d">Phases over observation id and the effective multiplier recorded for ' + esc(st.cond) + '.</desc>';
  sch.phases.forEach(function (p) {
    var a = xs(p.first_obs), b = xs(p.last_obs + 1);
    h += '<g><rect x="' + a.toFixed(1) + '" y="14" width="' + Math.max(1, b - a).toFixed(1) + '" height="24" fill="' + PHCOL[p.name] + '" fill-opacity=".28" stroke="' + PHCOL[p.name] + '"/>' +
      '<text x="' + (a + 4).toFixed(1) + '" y="30" class="tl-ph">' + (b - a > 44 ? esc(p.name) : esc(p.name.slice(0, 2))) + '</text>' +
      '<text x="' + a.toFixed(1) + '" y="146" class="tl-ob">' + p.first_obs + '</text></g>';
  });
  h += '<text x="' + x1 + '" y="146" class="tl-ob" text-anchor="end">' + last + '</text>';
  h += '<line x1="' + x0 + '" x2="' + x1 + '" y1="124" y2="124" class="tl-ax"/><line x1="' + x0 + '" x2="' + x0 + '" y1="52" y2="124" class="tl-ax"/>' +
    '<text x="' + (x0 - 6) + '" y="127" class="tl-y" text-anchor="end">0</text><text x="' + (x0 - 6) + '" y="56" class="tl-y" text-anchor="end">1</text>';
  var lv = armLevel(st.cond), pts = [], areaPts = ['' + x0.toFixed(1) + ',124'];
  for (var i = 0; i < S.keys.length; i++) {
    var m = S.mult_ppm[i] / 1e6 * lv, x = xs(S.keys[i][0]), y = 124 - 72 * m;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  h += '<polyline class="tl-line" points="' + pts.join(' ') + '" fill="none"/>';
  h += '<line id="rb-cur" class="tl-cur" x1="0" x2="0" y1="10" y2="128"/>';
  h += '<rect id="rb-tlhit" x="' + x0 + '" y="10" width="' + (x1 - x0) + '" height="120" fill="transparent"/>';
  svg.innerHTML = h;
  st.tl = { xs: xs, x0: x0, x1: x1, first: first, last: last };
  $('rb-tl-tag').className = 'rb-tag ' + tagClass(st.kind); $('rb-tl-tag').textContent = st.kind;
  $('rb-tlhit').addEventListener('pointerdown', function (ev) {
    var r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * 900;
    var o = st.tl.first + (vx - st.tl.x0) / (st.tl.x1 - st.tl.x0) * (st.tl.last - st.tl.first);
    pause(); st.i = nearestRow(o); render(true); announce();
  });
}

/* ---------------------------------------------------------------- side panels */
function tagHtml(k) { return '<span class="rb-tag ' + tagClass(k) + '">' + esc(k) + '</span>'; }
function readout(i) {
  var S = st.S, K = S.keys[i], ph = PHASES[S.phase[i]], lv = armLevel(st.cond), mult = S.mult_ppm[i] / 1e6;
  var dsn = S.downsample;
  var h = '<h3 class="rb-h3">Now</h3><dl class="rb-dl">' +
    '<dt>observation</dt><dd>' + K[0] + '</dd><dt>phase</dt><dd><span class="rb-ph" style="--c:' + PHCOL[ph] + '">' + ph + '</span></dd>' +
    '<dt>schedule multiplier</dt><dd>' + mult.toFixed(3) + '</dd><dt>arm intensity</dt><dd>' + (lv * mult).toFixed(3) + ' <span class="mut">(' + esc(st.byId[st.cond] && st.byId[st.cond].level || 'no level') + ' × multiplier)</span></dd>' +
    '<dt>token</dt><dd>' + esc(short(K[1])) + (K[2] ? ' <span class="rb-tag">sensory</span>' : '') + '</dd>' +
    '<dt>row</dt><dd>' + (i + 1) + ' / ' + S.keys.length + '</dd></dl>' +
    '<p class="rb-note">Rows are the control’s recorded decisions' + (dsn && dsn.k > 1 ? ', every ' + dsn.k + 'th plus every row where any arm differs (' + dsn.n_kept + ' of ' + dsn.n_total + ')' : '') + '. No interpolation between rows.</p>';
  $('rb-readout').innerHTML = h;
  $('rb-obsout').textContent = 'obs ' + K[0] + ' · ' + ph;
  var r = $('rb-range'); r.value = String(i); r.setAttribute('aria-valuetext', 'observation ' + K[0] + ', phase ' + ph + ', row ' + (i + 1) + ' of ' + S.keys.length);
}
function paramsPanel(i) {
  var c = st.byId[st.cond], mult = st.S.by_condition[st.cond] ? st.S.mult_ppm[i] / 1e6 : 0, pp = c && c.peak_params;
  if (!pp || !pp.at_peak) { $('rb-params').innerHTML = '<h3 class="rb-h3">Perturbed parameters</h3><p class="rb-note">No parameter record for this arm.</p>'; return; }
  var pk = pp.at_peak, base = pk.base, post = pp.at_post || {};
  var rows = [];
  function add(name, mech, b, p) { rows.push([name, mech, b, p]); }
  add('memory scale', 'M1', post.mem_scale_ppm, pk.mem_scale_ppm);
  add('carry', 'M2', base.carry_ppm, pk.carry_ppm);
  add('leak', 'M2', base.leak_ppm, pk.leak_ppm);
  Object.keys(base.edges || {}).forEach(function (k) { add('edge ' + k.replace(/basal_ganglia_/g, 'bg_'), 'M2', base.edges[k], pk.edges[k]); });
  add('learning rate', 'M3', base.lr_ppm, pk.lr_ppm);
  var active = c.mechanisms ? Object.keys(c.mechanisms).filter(function (k) { return c.mechanisms[k]; }).join('+') : '';
  var h = '<h3 class="rb-h3">Perturbed parameters <span class="mut">' + esc(st.cond) + (active ? ' · ' + esc(active) : '') + '</span></h3><div class="rb-scroll"><table class="rb-tab sm"><thead><tr><th>param</th><th>mech</th><th>original</th><th>now</th><th>at peak</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    if (r[2] == null || r[3] == null) return;
    var now = r[2] + (r[3] - r[2]) * mult, moved = r[3] !== r[2];
    h += '<tr class="' + (moved ? 'mv' : '') + '"><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td><td>' + ppm(r[2]) + '</td><td><b>' + ppm(now) + '</b></td><td>' + ppm(r[3]) + '</td></tr>';
  });
  h += '</tbody></table></div><p class="rb-note">original and peak values are recorded for this arm (obs ' + esc(pk.obs) + '); “now” follows the recorded schedule multiplier linearly between them (schema §3.1).</p>';
  $('rb-params').innerHTML = h;
}

function bar(v, cls) { return '<span class="rb-bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, v / 1e4)).toFixed(1) + '%"></i></span>'; }
function diffPanel(i) {
  var S = st.S, D = st.D, N = S.by_condition.CONTROL, P = S.by_condition[st.cond];
  if (!N || !P) return;
  var ph = PHASES[S.phase[i]];
  var h = '<h3 class="rb-h3">Row comparison <span class="mut">NORMAL = CONTROL · PERTURBED = ' + esc(st.cond) + ' · obs ' + S.keys[i][0] + ' · ' + ph + '</span></h3><div class="rb-dgrid">';
  // activations
  h += '<div><h4>Node activation</h4><div class="rb-scroll"><table class="rb-tab sm"><thead><tr><th>node</th><th>normal</th><th>perturbed</th><th>Δ</th></tr></thead><tbody>';
  D.topology.nodes.forEach(function (n, j) {
    var a = N.act[i][j], b = P.act[i][j];
    h += '<tr><td>' + esc(n.label) + '</td><td>' + ppm(a) + bar(a) + '</td><td>' + ppm(b) + bar(b, 'p') + '</td><td class="' + (a === b ? 'mut' : 'chg') + '">' + sg(b - a, function (x) { return (x / 1e6).toFixed(3); }) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  // decision + memory
  function dec(B) {
    var a = B.action[i];
    return a == null ? '<span class="mut">no matched decision in this arm</span>' : '<b class="act-' + esc(a) + '">' + esc(a) + '</b> · ' + esc(B.stage[i]) + '<br><span class="mut">' + esc(B.reason[i]) + '</span>';
  }
  h += '<div><h4>Decision</h4><dl class="rb-dl w"><dt>normal</dt><dd>' + dec(N) + '</dd><dt>perturbed</dt><dd>' + dec(P) + '</dd>' +
    '<dt>different?</dt><dd>' + (P.changed_vs_control[i] ? '<b class="chg">YES</b> ' + esc(P.why[i]) : 'no') + '</dd>' +
    '<dt>go / no-go</dt><dd>' + ppm(N.go[i]) + ' / ' + ppm(N.nogo[i]) + ' → ' + ppm(P.go[i]) + ' / ' + ppm(P.nogo[i]) + '</dd>' +
    '<dt>shadow action</dt><dd>' + esc(N.shadow_action[i]) + ' → ' + esc(P.shadow_action[i]) + ' ' + tagHtml('COUNTERFACTUAL_RESEARCH') + '</dd></dl>';
  h += '<h4>Memory contribution</h4><dl class="rb-dl w"><dt>hippocampal drive</dt><dd>' + ppm(N.hippo[i]) + ' → ' + ppm(P.hippo[i]) + '</dd><dt>raw drive</dt><dd>' + ppm(N.hippo_raw[i]) + ' → ' + ppm(P.hippo_raw[i]) + '</dd>' +
    '<dt>memories used</dt><dd>' + N.mem_n[i] + ' → ' + P.mem_n[i] + '</dd><dt>memory return</dt><dd>' + ppm(N.mem_ret[i]) + ' → ' + ppm(P.mem_ret[i]) + '</dd></dl></div>';
  // connectivity + outcomes
  var dw = P.dw_vs_control[i], order = dw.map(function (v, j) { return j; }).filter(function (j) { return dw[j] !== 0; }).sort(function (a, b) { return Math.abs(dw[b]) - Math.abs(dw[a]); });
  h += '<div><h4>Connectivity change</h4>';
  if (!order.length) h += '<p class="mut">No effective edge weight differs from control at this row.</p>';
  else h += '<p class="mut">' + order.length + ' of ' + dw.length + ' edges differ from control.</p><ul class="rb-ul">' + order.slice(0, 5).map(function (j) { return '<li>' + esc(D.topology.edges[j].id.replace(/basal_ganglia_/g, 'bg_')) + ' <b class="chg">' + sg(dw[j], function (x) { return (x / 1e6).toFixed(3); }) + '</b></li>'; }).join('') + '</ul>';
  h += '<h4>Recorded outcomes in this phase window</h4>' + outcomesCell(ph) + '</div></div>';
  $('rb-diff').innerHTML = h;
}
function outcomesCell(ph) {
  var M = st.D.metrics.per_condition;
  function one(id) {
    var o = M[id] && M[id].outcomes && M[id].outcomes[ph];
    if (!o) return '<td colspan="2" class="mut">no record</td>';
    var r = o.REALIZED_SHADOW || {}, c = o.COUNTERFACTUAL_RESEARCH || {};
    return '<td>n=' + (r.n == null ? '—' : r.n) + ' · net ' + (r.net_pnl_micro == null ? '—' : r.net_pnl_micro) + ' µ</td><td>n=' + (c.n == null ? '—' : c.n) + ' · mean ret ' + (c.mean_ret_ppm == null ? '—' : ppmPct(c.mean_ret_ppm)) + '</td>';
  }
  return '<table class="rb-tab sm"><thead><tr><th></th><th>' + tagHtml('REALIZED_SHADOW') + '</th><th>' + tagHtml('COUNTERFACTUAL_RESEARCH') + '</th></tr></thead><tbody><tr><td>normal</td>' + one('CONTROL') + '</tr><tr><td>perturbed</td>' + one(st.cond) + '</tr></tbody></table>' +
    '<p class="rb-note">Whole-window aggregates from metrics.per_condition.*.outcomes, not this single row. Realized-shadow = paper book; counterfactual = fixed-notional what-if, not a trade.</p>';
}

function render(fromUser) {
  var i = st.i;
  st.panes.forEach(function (p) { renderPane(p, i); });
  readout(i); paramsPanel(i); diffPanel(i);
  var c = $('rb-cur');
  if (c && st.tl) { var x = st.tl.xs(st.S.keys[i][0]); c.setAttribute('x1', x.toFixed(1)); c.setAttribute('x2', x.toFixed(1)); }
  document.body.setAttribute('data-obs', String(st.S.keys[i][0]));
  document.body.setAttribute('data-row', String(i));
}

/* ---------------------------------------------------------------- charts (inline SVG, no libraries) */
var PAL = ['#B6FF4D', '#9B7BFF', '#2FD6E8', '#E7C46A', '#FF5A4E', '#C9D3DC', '#7E8C99'];
function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function legendLayout(names, W, L, R) {   // wraps legend items; returns positions and row count
  var x = L, row = 0, pos = [];
  names.forEach(function (n) { var w = n.length * 5.9 + 26; if (x + w > W - R && x > L) { x = L; row++; } pos.push([x, row]); x += w; });
  return { pos: pos, rows: row + 1 };
}
function legendSvg(names, lay, y0) {
  return names.map(function (nm, k) { var p = lay.pos[k], y = y0 + p[1] * 14; return '<rect x="' + p[0].toFixed(1) + '" y="' + y + '" width="9" height="9" fill="' + PAL[k % PAL.length] + '"/><text x="' + (p[0] + 13).toFixed(1) + '" y="' + (y + 8) + '" class="lgd">' + esc(nm) + '</text>'; }).join('');
}
function barChart(o) {   // o: {title, groups:[{label, bars:[{v, lo, hi}]}], names:[], unit, fmt}
  var W = 640, L = 52, R = 10, T = 14, lay = legendLayout(o.names, W, L, R), B = 40 + lay.rows * 14, H = 190 + B, gw = (W - L - R) / o.groups.length, n = o.names.length, bw = Math.min(26, (gw - 10) / n);
  var mx = 0; o.groups.forEach(function (g) { g.bars.forEach(function (b) { if (b && b.v != null) mx = Math.max(mx, b.hi != null ? b.hi : b.v, b.v); }); });
  mx = niceMax(mx); var fmt = o.fmt || function (v) { return fx(v, 3); };
  var y = function (v) { return T + (H - T - B) * (1 - v / mx); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rb-chart" role="img" aria-label="' + esc(o.title + '. ' + (o.summary || '')) + '">';
  [0, 0.5, 1].forEach(function (f) { var v = mx * f; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="gl"/><text x="' + (L - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" class="ay" text-anchor="end">' + esc(fmt(v)) + '</text>'; });
  o.groups.forEach(function (g, gi) {
    var gx = L + gi * gw, bx0 = gx + (gw - bw * n) / 2;
    g.bars.forEach(function (b, bi) {
      if (!b || b.v == null) return;
      var x = bx0 + bi * bw, yy = y(b.v), hh = Math.max(b.v > 0 ? 1 : 0, y(0) - yy);
      s += '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + (bw - 3) + '" height="' + hh.toFixed(1) + '" fill="' + PAL[bi % PAL.length] + '"><title>' + esc(o.names[bi] + ' · ' + g.label + ': ' + fmt(b.v) + (b.lo != null ? ' (95% CI ' + fmt(b.lo) + ' to ' + fmt(b.hi) + ')' : '')) + '</title></rect>';
      if (b.lo != null) { var cx = x + (bw - 3) / 2; s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + y(b.lo).toFixed(1) + '" y2="' + y(b.hi).toFixed(1) + '" class="wh"/><line x1="' + (cx - 3) + '" x2="' + (cx + 3) + '" y1="' + y(b.hi).toFixed(1) + '" y2="' + y(b.hi).toFixed(1) + '" class="wh"/>'; }
    });
    s += '<text x="' + (gx + gw / 2).toFixed(1) + '" y="' + (H - B + 16) + '" class="ax" text-anchor="middle">' + esc(g.label) + '</text>';
  });
  s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="bl"/>';
  s += legendSvg(o.names, lay, H - B + 26);
  return s + '</svg>';
}
function lineChart(o) {  // o: {title, series:[{name, pts:[[x,y]]}], x:[a,b], fmt, bands}
  var W = 640, L = 52, R = 10, T = 12, mx = 0, names = o.series.map(function (q) { return q.name; }), lay = legendLayout(names, W, L, R), B = 36 + lay.rows * 14, H = 170 + B;
  o.series.forEach(function (s) { s.pts.forEach(function (p) { if (p[1] > mx) mx = p[1]; }); });
  mx = niceMax(mx); var fmt = o.fmt || function (v) { return fx(v, 3); };
  var x = function (v) { return L + (v - o.x[0]) / Math.max(1, o.x[1] - o.x[0]) * (W - L - R); }, y = function (v) { return T + (H - T - B) * (1 - v / mx); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rb-chart" role="img" aria-label="' + esc(o.title + '. ' + (o.summary || '')) + '">';
  (o.bands || []).forEach(function (b) { s += '<rect x="' + x(b.a).toFixed(1) + '" y="' + T + '" width="' + Math.max(1, x(b.b) - x(b.a)).toFixed(1) + '" height="' + (H - T - B) + '" fill="' + PHCOL[b.name] + '" fill-opacity=".13"/><text x="' + (x(b.a) + 3).toFixed(1) + '" y="' + (T + 10) + '" class="ay">' + esc(b.name.slice(0, 3)) + '</text>'; });
  [0, 0.5, 1].forEach(function (f) { var v = mx * f; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="gl"/><text x="' + (L - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" class="ay" text-anchor="end">' + esc(fmt(v)) + '</text>'; });
  o.series.forEach(function (se, k) {
    s += '<polyline fill="none" stroke="' + PAL[k % PAL.length] + '" stroke-width="1.6" ' + (se.dash ? 'stroke-dasharray="4 3"' : '') + ' points="' + se.pts.filter(function (p) { return p[1] != null; }).map(function (p) { return x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1); }).join(' ') + '"><title>' + esc(se.name) + '</title></polyline>';
  });
  s += legendSvg(names, lay, H - B + 24);
  s += '<text x="' + L + '" y="' + (H - B + 14) + '" class="ay">obs ' + o.x[0] + '</text><text x="' + (W - R) + '" y="' + (H - B + 14) + '" class="ay" text-anchor="end">obs ' + o.x[1] + '</text>';
  return s + '</svg>';
}
function rasterChart(o) { // o: {rows:[{name, obs:[...]}], x:[a,b], bands}
  var W = 640, rh = 18, T = 8, L = 118, R = 10, H = T + o.rows.length * rh + 26;
  var x = function (v) { return L + (v - o.x[0]) / Math.max(1, o.x[1] - o.x[0]) * (W - L - R); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rb-chart" role="img" aria-label="' + esc(o.title + '. ' + (o.summary || '')) + '">';
  (o.bands || []).forEach(function (b) { s += '<rect x="' + x(b.a).toFixed(1) + '" y="' + T + '" width="' + Math.max(1, x(b.b) - x(b.a)).toFixed(1) + '" height="' + (o.rows.length * rh) + '" fill="' + PHCOL[b.name] + '" fill-opacity=".13"/>'; });
  o.rows.forEach(function (r, k) {
    var yy = T + k * rh;
    s += '<text x="' + (L - 6) + '" y="' + (yy + 12) + '" class="ay" text-anchor="end">' + esc(r.name) + '</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + (yy + 9) + '" y2="' + (yy + 9) + '" class="gl"/>';
    r.obs.forEach(function (ob) { s += '<line x1="' + x(ob).toFixed(1) + '" x2="' + x(ob).toFixed(1) + '" y1="' + (yy + 2) + '" y2="' + (yy + 16) + '" stroke="' + (r.hot ? '#FF5A4E' : '#C9D3DC') + '" stroke-width="1.6"><title>' + esc(r.name + ' differs at obs ' + ob) + '</title></line>'; });
  });
  s += '<text x="' + L + '" y="' + (H - 6) + '" class="ay">obs ' + o.x[0] + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" class="ay" text-anchor="end">obs ' + o.x[1] + '</text>';
  return s + '</svg>';
}
function fig(title, tags, svg, cap, tableHtml) {
  return '<figure class="rb-fig"><figcaption><b>' + esc(title) + '</b> ' + tags.map(tagHtml).join(' ') + '</figcaption>' + svg + (cap ? '<p class="rb-cap">' + cap + '</p>' : '') + (tableHtml || '') + '</figure>';
}
function table(head, rows, cls) {
  return '<div class="rb-scroll"><table class="rb-tab ' + (cls || '') + '"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, k) { return k ? '<td>' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}

/* ---------------------------------------------------------------- results: the six questions */
function randIds(level) { return Object.keys(st.D.metrics.per_condition).filter(function (k) { return k.indexOf('RANDOM_' + level + '_S') === 0; }); }
function pw(id, w) { var m = st.D.metrics.per_condition[id]; return m && m.per_window && m.per_window[w]; }
function randMean(level, w, f) { var v = randIds(level).map(function (id) { var p = pw(id, w); return p ? f(p) : null; }).filter(function (x) { return x != null; }); return mean(v); }
function bands() { return st.D.schedule.phases.map(function (p) { return { name: p.name, a: p.first_obs, b: p.last_obs + 1 }; }); }
function qBox(n, title, verdictHtml, body) {
  return '<article class="rb-q"><h3><span class="qn">' + n + '</span> ' + esc(title) + '</h3>' + (verdictHtml ? '<div class="rb-qv">' + verdictHtml + '</div>' : '') + body + '</article>';
}
function results() {
  var D = st.D, M = D.metrics, W = M.windows, PH = D.verdicts.per_hypothesis, h = '', sch = D.schedule, kind = st.kind;
  var mechOf = {}; Object.keys(sch.mechanism_params).forEach(function (m) { sch.mechanism_params[m].forEach(function (p) { mechOf[p] = m; }); });
  var lv = sch.levels, X2 = D.metrics.exp002 || null, XT = X2 && X2.table_v2_extreme;

  // Q1
  var rows = Object.keys(sch.maxima).map(function (k) {
    var v = sch.maxima[k], nm = k === 'mem' ? 'memory-prior weight (how much recalled memory shapes the Go/No-Go drive)' : k === 'lr' ? 'learning rate' : k === 'carry' ? 'state carry-over' : k === 'leak' ? 'leak' : k.replace(/^e:/, 'edge gain ').replace(/basal_ganglia_/g, 'bg_');
    return [esc(nm), esc(mechOf[k] || '—'), '<b>' + sg(v, function (x) { return ppmPct(x, 0); }) + '</b>', sg(v * lv.LOW / 1e6, function (x) { return ppmPct(x, 0); }), sg(v * lv.MEDIUM / 1e6, function (x) { return ppmPct(x, 0); }), sg(v * lv.HIGH / 1e6, function (x) { return ppmPct(x, 0); })].concat(XT ? [sg(XT[k], function (x) { return ppmPct(x, 0); })] : []);
  });
  var sf = D.safety, okx = function (b) { return b ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'; };
  h += qBox(1, 'What parameters were changed?', '',
    '<p>Three mechanisms inspired by REBUS were applied together (REBUS_*) or one at a time (ablations): <b>M1</b> relaxed prior (memory influence), <b>M2</b> altered network dynamics (edge gains, carry, leak), <b>M3</b> increased plasticity. Changes are relative to each parameter’s original value, ramped linearly through ONSET, held through PEAK, and ramped back through RECOVERY.</p>' +
    table(['parameter', 'mechanism', 'change at registered max (HIGH)', 'LOW', 'MEDIUM', 'HIGH'].concat(XT ? ['EXTREME'] : []), rows) +
    '<p class="rb-note">Levels are multipliers of the registered maxima: LOW ' + ppm(lv.LOW, 2) + ', MEDIUM ' + ppm(lv.MEDIUM, 2) + ', HIGH ' + ppm(lv.HIGH, 2) + '. Safety-class edges (veto, threat, conflict) are not perturbable.</p>' +
    '<ul class="rb-chk"><li>' + okx(sf.params_at_peak_equal_registered_maxima) + ' parameters at peak equal the registered maxima</li><li>' + okx(sf.params_after_recovery_equal_original) + ' parameters after recovery equal the originals (reversible)</li><li>' + okx(sf.safety_hash_equal_all_conditions) + ' safety subset identical in every condition</li><li>' + okx(sf.production_module_hashes_before_after_equal) + ' production modules unchanged before/after</li><li>' + okx(sf.db_opened_read_only) + ' recorded database opened read-only</li></ul>' +
    '<h4>Schedule</h4>' + table(['phase', 'first obs', 'last obs', 'observations'], sch.phases.map(function (p) { return ['<span class="rb-ph" style="--c:' + PHCOL[p.name] + '">' + p.name + '</span>', p.first_obs, p.last_obs, p.n_obs]; })));

  // Q2
  var lvls = ['LOW', 'MEDIUM', 'HIGH'], names2 = ['REBUS_LOW', 'REBUS_MEDIUM', 'REBUS_HIGH', 'RANDOM_HIGH (' + randIds('HIGH').length + '-seed mean)'];
  var g2 = W.filter(function (w) { return w !== 'BASELINE'; }).map(function (w) {
    return { label: w, bars: lvls.map(function (l) { var p = pw('REBUS_' + l, w); return { v: p ? p.mean_abs_dact_vs_control_ppm / 1e6 : null }; }).concat([{ v: randMean('HIGH', w, function (p) { return p.mean_abs_dact_vs_control_ppm / 1e6; }) }]) };
  });
  var bars2 = barChart({ title: 'Mean absolute activation change vs CONTROL per phase', groups: g2, names: names2, fmt: function (v) { return fx(v, 3); }, summary: 'REBUS_HIGH ' + g2.map(function (g) { return g.label + ' ' + fx(g.bars[2].v, 3); }).join(', ') });
  var S = st.S, C = S.by_condition.CONTROL;
  function rowDiv(id) { var B = S.by_condition[id]; return S.keys.map(function (k, i) { if (!B.act[i] || !C.act[i]) return [k[0], null]; var s = 0; for (var j = 0; j < 9; j++) s += Math.abs(B.act[i][j] - C.act[i][j]); return [k[0], s / 9 / 1e6]; }); }
  var rh = rowDiv('REBUS_HIGH'), rp = rowDiv('PLACEBO'), rr = randIds('HIGH').filter(function (id) { return S.by_condition[id]; }).map(rowDiv);
  var rrm = rr.length ? rh.map(function (p, i) { return [p[0], mean(rr.map(function (r) { return r[i][1]; }).filter(function (x) { return x != null; }))]; }) : [];
  var line2 = lineChart({ title: 'State divergence over time: mean absolute activation difference from CONTROL, per recorded row', series: [{ name: 'REBUS_HIGH', pts: rh }, { name: 'RANDOM_HIGH mean', pts: rrm, dash: true }, { name: 'PLACEBO', pts: rp }], x: [sch.first, sch.last], bands: bands(), summary: 'max REBUS_HIGH ' + fx(Math.max.apply(null, rh.map(function (p) { return p[1]; })), 3) })
  var entNames = ['CONTROL', 'PLACEBO', 'REBUS_LOW', 'REBUS_MEDIUM', 'REBUS_HIGH'];
  var entG = W.map(function (w) { return { label: w, bars: entNames.map(function (n) { var p = pw(n, w); return { v: p ? p.activation_entropy_bits : null }; }) }; });
  var ent = barChart({ title: 'Activation entropy (bits) per phase', groups: entG, names: entNames, fmt: function (v) { return fx(v, 2); }, summary: 'diversity of visited network states' });
  var tRows = W.map(function (w) {
    var c = pw('CONTROL', w), r = pw('REBUS_HIGH', w), rm = randMean('HIGH', w, function (p) { return p.mean_abs_dact_vs_control_ppm; });
    return [w, r ? ppm(r.mean_abs_dact_vs_control_ppm) : '—', rm == null ? '—' : ppm(rm), r ? ppm(r.mean_abs_dgo_vs_control_ppm, 4) : '—', c && r ? fx(c.activation_entropy_bits, 2) + ' → ' + fx(r.activation_entropy_bits, 2) : '—', c && r ? c.distinct_states + ' → ' + r.distinct_states : '—', r ? r.novel_states_vs_control : '—'];
  });
  var h1 = D.tests.primary.filter(function (t) { return t.id === 'H1'; })[0], h2 = D.tests.primary.filter(function (t) { return t.id === 'H2'; })[0];
  h += qBox(2, 'How did neural activity change?', vbadge(PH.dynamics_diversity || 'INCONCLUSIVE') + ' ' + vbadge(PH.memory_prior || 'INCONCLUSIVE'),
    '<p>' + (h1 ? 'Memory-prior test H1: ' + vbadge(h1.decision) + ' mean |ΔGO| ' + fx(h1.estimate, 1) + ' ppm (95% CI ' + ci(h1.ci95, function (x) { return fx(x, 1); }) + ', n=' + h1.n + ').' : '') + ' ' + (h2 ? 'Dynamics test H2: ' + vbadge(h2.decision) + ' entropy difference ' + fx(h2.estimate, 3) + ' bits (95% CI ' + ci(h2.ci95, function (x) { return fx(x, 3); }) + ').' : '') + '</p>' +
    fig('Activation change vs CONTROL', [kind], bars2, 'Grouped by phase. ' + esc(names2[names2.length - 1]) + ' is the magnitude-matched random comparator (mean over its seeds).') +
    fig('State divergence over time', [kind], line2, 'Computed from the recorded per-row node activations of each arm and CONTROL. Phase shading from the schedule. Rows are the downsampled recorded decisions.') +
    fig('Entropy / diversity of network states', [kind], ent, 'Activation entropy, 4 equal bins per node (registered definition).') +
    table(['phase', 'mean |Δact| REBUS_HIGH', 'mean |Δact| RANDOM_HIGH', 'mean |ΔGO|', 'entropy ctl → rebus (bits)', 'distinct states ctl → rebus', 'novel states'], tRows) +
    '<p class="rb-note">Per-phase figures are descriptive and not multiplicity-corrected. Activation values are fractions of full scale.</p>');

  // Q3
  var DV = ['REBUS_LOW', 'REBUS_MEDIUM', 'REBUS_HIGH', 'PLACEBO'], dvN = DV.concat(['RANDOM_HIGH mean']);
  var g3 = W.map(function (w) {
    return { label: w, bars: DV.map(function (id) { var p = pw(id, w), d = p && p.divergence_vs_control; return d ? { v: d.rate, lo: d.ci95 && d.ci95[0], hi: d.ci95 && d.ci95[1] } : null; }).concat([{ v: randMean('HIGH', w, function (p) { return p.divergence_vs_control && p.divergence_vs_control.rate; }) }]) };
  });
  var dvc = barChart({ title: 'Decision divergence rate vs CONTROL per phase (95% CI, token-cluster bootstrap)', groups: g3, names: dvN, fmt: function (v) { return pct(v, 1); }, summary: 'share of matched decisions that differ from CONTROL' });
  var changedBy = function (id) { var B = S.by_condition[id]; return B ? S.keys.filter(function (k, i) { return B.changed_vs_control[i]; }).map(function (k) { return k[0]; }) : []; };
  var rasterRows = [{ name: 'REBUS_HIGH', obs: changedBy('REBUS_HIGH'), hot: 1 }, { name: 'REBUS_MEDIUM', obs: changedBy('REBUS_MEDIUM'), hot: 1 }, { name: 'REBUS_LOW', obs: changedBy('REBUS_LOW'), hot: 1 }, { name: 'PLACEBO', obs: changedBy('PLACEBO') }].concat(randIds('HIGH').map(function (id) { return { name: id, obs: changedBy(id) }; }));
  var nCh = rasterRows.map(function (r) { return r.name + ' ' + r.obs.length; }).join(', ');
  var rst = rasterChart({ title: 'Where a decision differed from CONTROL', rows: rasterRows, x: [sch.first, sch.last], bands: bands(), summary: 'differing rows: ' + nCh });
  var DR = M.dose_response || {};
  var drRows = ['LOW', 'MEDIUM', 'HIGH'].filter(function (l) { return DR[l]; }).map(function (l) { return [l, pct(DR[l].rebus_peak_divergence, 2), pct(DR[l].random_peak_divergence_mean, 2)]; });
  var peakH = pw('REBUS_HIGH', 'PEAK'), reasons = peakH && peakH.divergence_vs_control && peakH.divergence_vs_control.reasons || {};
  var rk = Object.keys(reasons);
  var h4 = D.tests.primary.filter(function (t) { return t.id === 'H4'; })[0], h5 = D.tests.primary.filter(function (t) { return t.id === 'H5'; })[0];
  h += qBox(3, 'Did the brain make different decisions?', vbadge(PH.divergence || D.verdicts.overall) + ' ' + vbadge(PH.specificity || 'INCONCLUSIVE'),
    '<p>' + (peakH ? 'At PEAK, REBUS_HIGH differed from CONTROL on <b>' + peakH.divergence_vs_control.changed + ' of ' + peakH.divergence_vs_control.matched + '</b> matched decisions (' + pct(peakH.divergence_vs_control.rate, 2) + ', 95% CI ' + ci(peakH.divergence_vs_control.ci95, function (x) { return pct(x, 2); }) + ').' : '') + ' ' + (h4 ? 'H4: ' + vbadge(h4.decision) + '. ' : '') + (h5 ? 'Against random perturbation of equal magnitude (H5): ' + vbadge(h5.decision) + '.' : '') + '</p>' +
    fig('Decision divergence by phase', [kind], dvc, 'PLACEBO must be exactly zero by construction; a non-zero PLACEBO would indicate a harness fault.') +
    fig('Decision differences along the experiment', [kind], rst, 'One tick per recorded row where that arm’s decision differs from CONTROL’s. Every differing row is kept by the downsampling rule.') +
    (drRows.length ? '<h4>Dose-response (PEAK divergence)</h4>' + table(['level', 'REBUS', 'RANDOM mean'], drRows) : '') +
    (rk.length ? '<h4>What changed (REBUS_HIGH, PEAK)</h4><ul class="rb-ul">' + rk.map(function (k) { return '<li><code>' + esc(k) + '</code> × ' + reasons[k] + '</li>'; }).join('') + '</ul>' : '<p class="mut">No decision-reason transitions were recorded at PEAK for REBUS_HIGH.</p>') +
    jumpList() + exp002Block());

  // Q4
  var PS = M.persistence_summary || {}, pk = ['REBUS_LOW', 'REBUS_MEDIUM', 'REBUS_HIGH', 'REBUS_HIGH_M1', 'REBUS_HIGH_M2', 'REBUS_HIGH_M3', 'PLACEBO'].filter(function (k) { return PS[k]; });
  var psRow = function (k) { var p = PS[k], d = p.post_decision_divergence; return [esc(k), d ? pct(d.rate, 2) + ' <span class="mut">(' + d.changed + '/' + d.matched + ')</span>' : '—', p.recovery_decision_divergence ? pct(p.recovery_decision_divergence.rate, 2) : '—', ppm(p.post_state_distance_ppm, 4), ppm(p.weight_distance_real_ppm_at_post_start, 4), p.post_shadow_decision_divergence ? pct(p.post_shadow_decision_divergence.rate, 2) : '—']; };
  var rnd = Object.keys(PS).filter(function (k) { return k.indexOf('RANDOM_HIGH_S') === 0; });
  var pg = [{ label: 'POST state distance', bars: pk.concat([]).map(function (k) { return { v: PS[k].post_state_distance_ppm / 1e6 }; }).concat([{ v: mean(rnd.map(function (k) { return PS[k].post_state_distance_ppm / 1e6; })) }]) },
    { label: 'weight distance at POST start', bars: pk.map(function (k) { return { v: PS[k].weight_distance_real_ppm_at_post_start / 1e6 }; }).concat([{ v: mean(rnd.map(function (k) { return PS[k].weight_distance_real_ppm_at_post_start / 1e6; })) }]) }];
  var perChart = barChart({ title: 'Residual difference from CONTROL after recovery', groups: pg, names: pk.concat(['RANDOM_HIGH mean']), fmt: function (v) { return fx(v, 3); }, summary: 'distance of the final network state and learned weights from CONTROL' });
  var h6 = D.tests.primary.filter(function (t) { return t.id === 'H6'; })[0], h3b = D.tests.primary.filter(function (t) { return t.id === 'H3b'; })[0];
  h += qBox(4, 'Did those changes persist afterwards?', vbadge(PH.persistence || 'INCONCLUSIVE') + ' ' + vbadge(PH.plasticity_persistence || 'INCONCLUSIVE'),
    '<p>' + (h6 ? 'H6, POST decision divergence of REBUS_HIGH vs CONTROL: ' + vbadge(h6.decision) + ' ' + pct(h6.estimate, 2) + ' (95% CI ' + ci(h6.ci95, function (x) { return pct(x, 2); }) + ', n=' + h6.n + '). ' : '') + (h3b ? 'H3b, learned-weight (shadow) decisions in POST ' + tagHtml('COUNTERFACTUAL_RESEARCH') + ': ' + vbadge(h3b.decision) + ' ' + pct(h3b.estimate, 2) + '.' : '') + '</p>' +
    fig('Persistence', [kind, 'COUNTERFACTUAL_RESEARCH'], perChart, 'Distances are fractions of full scale: final activation state, and learned real weights at the start of POST. Shadow weights are a counterfactual research construct and never drive the actual decision.') +
    table(['arm', 'POST decision divergence', 'RECOVERY divergence', 'POST state distance', 'weight distance @POST', 'POST shadow-decision divergence'], pk.map(psRow)));

  // Q5
  var perf = M.performance || {}, outRows = [];
  ['PEAK', 'POST'].forEach(function (w) {
    ['CONTROL', 'REBUS_HIGH'].forEach(function (id) {
      var o = M.per_condition[id] && M.per_condition[id].outcomes && M.per_condition[id].outcomes[w];
      if (!o) return;
      var r = o.REALIZED_SHADOW || {}, c = o.COUNTERFACTUAL_RESEARCH || {};
      outRows.push([w, esc(id), r.n, r.net_pnl_micro, c.n, c.mean_ret_ppm == null ? '—' : ppmPct(c.mean_ret_ppm), o.inference_cost_micro]);
    });
  });
  var pc = perf.per_condition || {};
  h += qBox(5, 'Did performance improve, deteriorate or remain inconclusive?', vbadge(perf.decision || PH.performance || 'INSUFFICIENT_EVIDENCE', true),
    '<p>' + esc(perf.reason || '') + '</p>' +
    table(['arm', 'realized closes (all phases)', 'tokens', 'counterfactual closes'], Object.keys(pc).map(function (k) { return [esc(k), pc[k].realized_closes_total, pc[k].realized_tokens, pc[k].cf_closes_total]; })) +
    '<h4>Descriptive outcomes by window</h4><p class="mut">Two label families, never pooled. ' + tagHtml('REALIZED_SHADOW') + ' paper-book results net of modelled fees. ' + tagHtml('COUNTERFACTUAL_RESEARCH') + ' fixed-notional positions opened at abstentions (selection-biased; not trades). µ = micro-units of the paper book.</p>' +
    table(['window', 'arm', 'REALIZED_SHADOW n', 'net PnL µ', 'COUNTERFACTUAL n', 'mean return', 'inference cost µ'], outRows) +
    '<p class="rb-note">No confirmatory performance test is registered. These numbers do not show that REBUS helped or hurt.</p>');

  // Q6
  h += qBox(6, 'What prevents stronger conclusions?', '',
    '<ul class="rb-ul lim">' + D.limitations.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
    (D.experiment.window_role === 'DISCOVERY' ? '<p class="rb-warn">This file is from the discovery window: it checks that the machinery works and cannot confirm any hypothesis.</p>' : '') +
    (kind === 'SYNTHETIC_FIXTURE' ? '<p class="rb-warn">Synthetic fixture: every number on this page is generated test data.</p>' : ''));
  $('rb-q').innerHTML = h;
  [].forEach.call(document.querySelectorAll('.rb-jump'), function (b) {
    b.addEventListener('click', function () { pause(); st.i = nearestRow(+b.getAttribute('data-obs')); st.cond = b.getAttribute('data-cond'); $('rb-cond').value = st.cond; buildTimeline(); render(false); announce(); $('rb-lab').scrollIntoView({ block: 'start' }); });
  });
}
function exp002Block() {
  var X = st.D.metrics.exp002;
  if (!X) return '';
  var h = '<h4>Which decisions reach the Go/No-Go margin stage, and which flipped</h4>';
  var rows = [];
  Object.keys(X.margin_stage_counts).forEach(function (id) {
    st.D.metrics.windows.forEach(function (w) { var c = X.margin_stage_counts[id][w]; rows.push([esc(id), w, c.decisions, c.margin_stage, c.entries]); });
  });
  h += table(['arm', 'phase', 'decisions', 'reached margin stage', 'entries'], rows);
  Object.keys(X.flip_analysis).forEach(function (id) {
    var f = X.flip_analysis[id], d = f.direction;
    h += '<p><b>' + esc(id) + ' PEAK:</b> ' + f.flipped_total + ' flipped (abstain→enter ' + d['abstain->enter'] + ', enter→abstain ' + d['enter->abstain'] + ', reason change ' + d['abstain->abstain (reason changed)'] + '). Mean |CONTROL margin gap| flipped ' + (f.mean_abs_control_margin_gap_ppm_flipped == null ? '—' : ppm(f.mean_abs_control_margin_gap_ppm_flipped, 3)) + ' vs unflipped margin-stage ' + (f.mean_abs_control_margin_gap_ppm_unflipped_margin_stage == null ? '—' : ppm(f.mean_abs_control_margin_gap_ppm_unflipped_margin_stage, 3)) + '.' + (f.attribution_to_single_mechanisms ? ' Attribution to single-mechanism ablations: ' + esc(JSON.stringify(f.attribution_to_single_mechanisms)) : '') + '</p>';
  });
  return h + '<p class="rb-note">Descriptive, uncorrected. Margin stage = CONTROL reason ' + esc(X.margin_stage_reasons.join(', ')) + ' or an entry.</p>';
}
function jumpList() {
  var S = st.S, out = [];
  ['REBUS_HIGH', 'REBUS_MEDIUM', 'REBUS_LOW'].forEach(function (id) {
    var B = S.by_condition[id]; if (!B) return;
    S.keys.forEach(function (k, i) { if (B.changed_vs_control[i] && out.length < 12) out.push([id, k[0], PHASES[S.phase[i]], B.why[i]]); });
  });
  if (!out.length) return '<p class="mut">No REBUS arm differs from CONTROL on any recorded row.</p>';
  return '<h4>Rows where a REBUS arm decided differently</h4><ul class="rb-ul">' + out.map(function (o) { return '<li><button type="button" class="rb-jump" data-obs="' + o[1] + '" data-cond="' + esc(o[0]) + '" aria-label="Open ' + esc(o[0]) + ' at observation ' + o[1] + ' in the playback">obs ' + o[1] + '</button> ' + esc(o[0]) + ' · ' + o[2] + ' · <span class="mut">' + esc(o[3]) + '</span></li>'; }).join('') + '</ul>';
}

/* ---------------------------------------------------------------- reproducibility */
function repro() {
  var D = st.D, R = st.R, e = D.experiment, ds = D.dataset, det = D.determinism || {}, seeds = D.conditions.filter(function (c) { return c.seed != null; }).map(function (c) { return c.seed; });
  var uniq = seeds.filter(function (s, i) { return seeds.indexOf(s) === i; }).sort(function (a, b) { return a - b; });
  var ctl = st.byId.CONTROL, dg = R && R.series_digest;
  function kv(k, v, mono) { return '<dt>' + esc(k) + '</dt><dd' + (mono ? ' class="hash"' : '') + '>' + v + '</dd>'; }
  var h = '<div class="rb-rgrid"><dl class="rb-dl w">' +
    kv('experiment id', esc(e.id) + ' v' + esc(e.version)) + kv('status / window', esc(e.status) + ' · ' + esc(e.window_role)) + kv('dataset kind', tagHtml(ds.kind)) +
    kv('code revision', esc(e.code_revision) + (e.code_dirty_at_run ? ' (dirty)' : ' (clean)'), 1) + kv('protocol sha256', esc(e.protocol_sha256), 1) + kv('dataset sha256', esc(ds.db_sha256) + ' <span class="mut">(' + esc(ds.hash_of || '') + ')</span>', 1) +
    kv('observations', ds.obs_first + ' … ' + ds.obs_last + ' (' + ds.n_obs + ')') + kv('control decisions', ds.c0_decisions) +
    kv('RANDOM seeds', uniq.length ? uniq.join(', ') : '—') + kv('bootstrap', esc(D.tests.bootstrap.resamples) + ' resamples · seed ' + esc(D.tests.bootstrap.seed) + ' · cluster ' + esc(D.tests.bootstrap.cluster)) +
    kv('CONTROL decision hash', esc(ctl && ctl.decision_hash), 1) + (dg ? kv('full telemetry sha256', esc(dg.telemetry_sha256), 1) : '') +
    kv('schema', esc(D.schema)) + kv('preregistration', esc(e.preregistration)) + kv('feature flag', esc(e.flag) + ' <span class="mut">(default off)</span>') +
    '</dl><div><h4>Invariants checked by the harness</h4><ul class="rb-chk">' +
    [['control equals placebo', det.control_equals_placebo], ['control equals plain replay', det.control_equals_plain_replay], ['re-run is bit-identical', det.rerun_identical], ['threat/risk vetoes preserved', D.safety.safety_hash_equal_all_conditions], ['no production module changed', D.safety.production_module_hashes_before_after_equal], ['database opened read-only', D.safety.db_opened_read_only]].map(function (x) { return '<li>' + (x[1] ? '<span class="ok">✓</span>' : '<span class="no">✗</span>') + ' ' + esc(x[0]) + '</li>'; }).join('') +
    '</ul></div></div>';
  h += '<h4>Method in brief</h4><p>The recorded observation stream is replayed offline through AlphaMorph’s nine-node circuit with a separate in-memory state. CONTROL runs it unchanged; PLACEBO runs the harness with no change (must equal CONTROL); REBUS arms apply the registered parameter schedule; RANDOM arms apply random changes of matched magnitude (several seeds); ablations apply one mechanism. Decisions are matched across arms by token and observation, and intervals are token-cluster bootstrap. Full protocol: <code>' + esc(e.preregistration) + '</code>.</p>';
  h += '<h4>Downloads</h4><ul class="rb-dl-list">' + [['results', st.entry.results, R], ['playback series', st.entry.ui, D]].map(function (f) {
    var name = f[1].split('/').pop();
    return '<li><a href="' + esc(f[1]) + '" download="' + esc(name) + '">' + esc(name) + '</a> <span class="mut">' + f[0] + (f[2] ? ' · ' + (f[2].__bytes / 1048576).toFixed(2) + ' MB' : '') + '</span></li>';
  }).join('') + '</ul><p class="rb-note">Files are the exact JSON this page reads; every figure is addressable by a JSON path (docs/REBUS-SCHEMA.md).</p>';
  $('rb-repro-body').innerHTML = h;
}

load();
})();
