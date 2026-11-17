/* ALPHAMORPH — Live Log drawer + real-trading panel. No deps. Consumes /api/events, SSE live events (via DBLOG.event) and /api/live.
   Nothing is invented: every row is an event the API delivered; the real-trading panel renders /api/live verbatim. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const MAX = 300, BACKFILL = 100;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (a) => a ? String(a).slice(0, 6) + '…' + String(a).slice(-4) : '';
const utc = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(11, 19) : '--:--:--');
const strat = (id) => String(id || '').replace(/^(aw|ti|ri)-/, '');
const comp = (c) => String(c || '').replace(/^C:/, '').split('|').map(strat).join(' · ');

const L = { rows: [], seen: new Set(), filter: 'all', paused: false, open: false, symbols: new Map(), live: null, renderT: 0, pending: 0, backfilled: false };

const REASON = {
  signal: 'strategies agreed on a signal',
  entry: 'entry signal',
  take_profit: 'take-profit level reached',
  stop_loss: 'stop-loss level hit',
  max_hold: 'held for the maximum allowed time',
  graduation_unquoted: 'token graduated, so the position was closed at its last quote',
  below_min_order_after_limits: 'order would be too small once risk limits were applied',
  daily_loss_halt: 'daily-loss halt is active',
  drawdown_halt: 'drawdown halt is active',
  per_token_limit: 'would exceed the per-token size limit',
  gross_limit: 'would exceed total exposure limit',
  depth_limit: 'would be too large for the pool depth',
  leverage_limit: 'not enough cash (no leverage allowed)',
  daily_loss: 'daily loss limit reached',
  drawdown: 'drawdown limit reached',
  kill: 'kill switch engaged',
  insufficient_evidence: 'not enough closed trades to judge',
};
const ABORT = { halt: 'a halt is active', blocklist: 'token is blocklisted', max_open_positions: 'too many open real positions', duplicate: 'already holding this token',
  quote_asset: 'token is not quoted in the native coin', graduated: 'graduated tokens are excluded', max_trade: 'trade size computed as zero', min_wallet_reserve: 'would dip below the wallet reserve',
  quote: 'quote returned nothing', gas: 'gas price above the cap', simulation: 'simulation failed', balance: 'balance too low', approve: 'approval not confirmed' };
const plain = (r, map = REASON) => String(r ?? '').split(',').map(x => x.trim()).filter(Boolean).map(x => map[x] || x.replace(/_/g, ' ')).join('; ');

function sym(p, token) { return (p && p.symbol) || L.symbols.get(token) || ''; }

/* classify one event into a row, or null to skip (heartbeats etc.) */
function toRow(ev) {
  const p = ev.payload || {}, t = ev.type;
  const token = p.token || '';
  const r = { id: ev.id, ts: ev.ts, type: t, cat: 'evo', badge: 'pol', text: '', comp: ev.composition || p.composition || '', strat: ev.strategy || '', token, symbol: '', dry: false, tx: p.tx_hash || '' };
  if (t === 'observation') {
    if (p.symbol && token) L.symbols.set(token, p.symbol);
    r.cat = 'tokens'; r.badge = ev.label === 'SYNTHETIC_TEST' ? 'synth' : (p.recorded ? 'rec' : 'live');
    r.text = ({ created: 'new token seen', trade: 'trade seen', graduated: 'token graduated', mark: 'price check' })[p.kind] || ('seen: ' + (p.kind || 'event'));
    r.text += p.block != null ? ' · block ' + p.block : '';
  } else if (t === 'decision') {
    if (p.control) { r.cat = 'decisions'; r.text = 'control: ' + p.control; }
    else {
      r.cat = 'decisions'; const a = p.action;
      const verb = { enter: 'ENTER', skip: 'SKIP', risk_reject: 'RISK REJECT', exit: 'EXIT' }[a] || String(a || 'decision').toUpperCase();
      r.text = verb + (p.reason ? ' — ' + plain(p.reason) : '');
      r.action = a;
    }
    r.comp = p.composition || r.comp;
    r.badge = ev.label === 'SYNTHETIC_TEST' ? 'synth' : 'pol';
  } else if (t === 'fill') {
    r.cat = 'paper'; r.badge = 'paper';
    r.text = `paper ${p.side || 'fill'}${p.qty ? ' · qty ' + p.qty : ''}${p.pnl_micro != null && p.side === 'sell' ? ' · pnl ' + (p.pnl_micro / 1e6).toFixed(4) : ''} · no real order`;
  } else if (t === 'halt') {
    r.cat = 'decisions'; r.badge = 'pol';
    r.text = 'HALT — ' + (plain(p.reason || p.control) || (p.killed != null ? (p.killed ? 'kill switch engaged' : 'kill switch released') : 'halt'));
  } else if (t === 'generation') {
    r.badge = ev.label === 'SYNTHETIC_TEST' ? 'synth' : 'pol';
    r.text = `generation ${p.n} verdict: ${plain(p.verdict) || '—'}` + ((p.eliminated || []).length ? ` · ${p.eliminated.length} eliminated` : '') + ((p.born || []).length ? ` · ${p.born.length} born` : '');
  } else if (t === 'elimination') {
    r.text = `ELIMINATED ${strat(p.strategy || ev.strategy)}` + (p.region ? ' (' + p.region + ')' : '') + (p.generation != null ? ' · gen ' + p.generation : '');
    r.badge = ev.label === 'SYNTHETIC_TEST' ? 'synth' : 'pol';
  } else if (t === 'birth') {
    r.text = `BORN ${strat(p.strategy || ev.strategy)} from ${strat(p.parent_id)}` + (p.generation != null ? ' · gen ' + p.generation : '');
    r.badge = ev.label === 'SYNTHETIC_TEST' ? 'synth' : 'pol';
  } else if (t === 'live_intent') {
    r.cat = 'real'; r.badge = 'real'; r.dry = !!p.dryrun || p.status === 'dryrun_simulated';
    if (p.status === 'aborted') r.text = `real ${p.side || ''} NOT SENT at ${p.stage || 'check'} — ${plain(p.stage, ABORT) || ''}${p.reason ? ' (' + p.reason + ')' : ''}`.replace(/\s+/g, ' ');
    else if (p.status === 'champion_changed') r.text = `real-trading champion changed to ${comp(p.to) || 'none'}`;
    else r.text = `real ${p.side || ''} ${p.kind || ''} ${r.dry ? 'signed + simulated, NOT broadcast' : 'signed'}${p.value_native ? ' · ' + fmtEth(p.value_native) + ' ETH' : ''}`.replace(/\s+/g, ' ');
    r.comp = p.to || r.comp;
  } else if (t === 'live_tx') {
    r.cat = 'real'; r.badge = 'real'; r.text = `real tx ${p.kind || ''} ${p.status || ''}${p.gas_used ? ' · gas ' + p.gas_used : ''}`.replace(/\s+/g, ' ');
  } else if (t === 'live_fill') {
    r.cat = 'real'; r.badge = 'real'; r.dry = !!p.dryrun;
    r.text = `real ${p.side || 'fill'} filled${p.quote_native ? ' · ' + fmtEth(p.quote_native) + ' ETH' : ''}${p.pnl_native && p.side === 'sell' ? ' · pnl ' + p.pnl_native : ''}${r.dry ? ' · virtual (dry run)' : ''}`;
  } else if (t === 'live_halt') {
    r.cat = 'real'; r.badge = 'real'; r.text = 'REAL TRADING HALT — ' + (plain(p.reason) || 'halt');
  } else return null;
  r.symbol = sym(p, token);
  if (!r.symbol && token && L.symbols.has(token)) r.symbol = L.symbols.get(token);
  return r;
}

const CATS = { all: null, tokens: ['tokens'], decisions: ['decisions'], paper: ['paper'], real: ['real'], evo: ['evo'] };
const BADGE = {
  real: ['b-real', 'REAL TRADE', 'A real transaction on the network'],
  paper: ['b-paper', 'PAPER', 'Simulated fill. No real order.'],
  live: ['b-live', 'LIVE', 'Observed on the network live'],
  rec: ['b-rec', 'RECORDED', 'Genuine network logs, replayed. Not live.'],
  synth: ['b-synth', 'SYNTH TEST', 'Generated test data'],
  pol: ['b-pol', 'POLICY', 'Output of a deterministic strategy'],
};

function add(ev) {
  if (!ev || ev.id == null || L.seen.has(ev.id)) return false;
  L.seen.add(ev.id);
  const r = toRow(ev); if (!r) return false;
  L.rows.push(r);
  L.rows.sort((a, b) => b.id - a.id);
  if (L.rows.length > MAX) { const dropped = L.rows.splice(MAX); for (const d of dropped) L.seen.delete(d.id); }
  return true;
}

function rowHtml(r) {
  const [bc, bt, bh] = BADGE[r.badge] || BADGE.pol;
  const who = r.comp ? comp(r.comp) : (r.strat ? strat(r.strat) : '');
  const open = r.comp ? `data-lc="${esc(r.comp)}"` : (r.strat ? `data-ls="${esc(r.strat)}"` : '');
  const tx = r.tx ? `<button type="button" class="cp" data-copy="${esc(r.tx)}" aria-label="Copy transaction hash">tx ${esc(short(r.tx))} ⧉</button>` : '';
  return `<li class="ll-row ll-${esc(r.cat)}${r.badge === 'real' ? ' is-real' : ''}" data-id="${r.id}">
    <button type="button" class="ll-main" ${open} ${open ? '' : 'disabled'} aria-label="${esc(bt + ' ' + r.text)}">
      <span class="ll-t">${utc(r.ts)}</span>
      <span class="ll-b"><span class="b ${bc}" title="${esc(bh)}">${bt}</span>${r.dry ? ' <span class="b b-dry" title="Signed and simulated, not broadcast">DRY RUN</span>' : ''}</span>
      <span class="ll-x">${esc(r.text)}</span>
      <span class="ll-m">${who ? '<span class="ll-w">' + esc(who) + '</span>' : ''}${r.symbol ? '<b class="ll-s">' + esc(r.symbol) + '</b>' : ''}${r.token ? '<span class="ll-a" title="' + esc(r.token) + '">' + esc(short(r.token)) + '</span>' : ''}</span>
    </button>${tx}</li>`;
}

function render() {
  L.renderT = 0;
  const list = $('#ll-list'); if (!list) return;
  const f = CATS[L.filter];
  const rows = f ? L.rows.filter(r => f.includes(r.cat)) : L.rows;
  list.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<li class="empty ll-empty">${L.filter === 'real' ? 'No real-trade events yet.' : 'No events yet. Rows appear only when the API delivers them.'}</li>`;
  $('#ll-count').textContent = String(L.rows.length);
  $('#ll-meta').textContent = `${rows.length} shown · ${L.rows.length}/${MAX} kept · newest first`;
  if (!L.paused) list.scrollTop = 0;
}
function schedule() {
  if (L.paused) { L.pending++; $('#ll-pause').textContent = `Paused · ${L.pending} new`; return; }
  if (!L.renderT) L.renderT = setTimeout(render, 150);
}

async function backfill() {
  try {
    let last = (window.DBAPP && window.DBAPP.S.lastEventId) || 0;
    if (!last) {  // stream not connected yet: ask the server for the head so we backfill the NEWEST events, not #1..
      try { const h = await (await fetch('/healthz', { cache: 'no-store' })).json(); last = h.last_event_id || 0; } catch (e) {}
    }
    const r = await fetch('/api/events?since=' + Math.max(0, last - BACKFILL), { cache: 'no-store' });
    if (r.ok) { const evs = await r.json(); let n = 0; for (const e of evs.slice(-BACKFILL)) if (add(e)) n++; if (n) render(); }
  } catch (e) { /* log still fills from the stream */ }
  L.backfilled = true; render();
}

/* ---------------------------------------------------------------- real trading */
function copy(txt, btn) {
  const done = (ok) => { const o = btn.dataset.l || btn.textContent; btn.dataset.l = o; btn.textContent = ok ? 'copied' : 'copy failed'; clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = o; }, 1400); };
  navigator.clipboard.writeText(txt).then(() => done(true), () => {
    try { const t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); done(ok); } catch (e) { done(false); }
  });
}
function realState(d) {
  if (!d || d.armed === false) return ['off', 'Real trading: not armed'];
  const h = Object.keys(d.halted || {});
  if (h.length) return ['halt', 'HALTED — ' + plain(h.join(','))];
  if (d.dryrun) return ['dry', 'DRY RUN — signed and simulated, not broadcast'];
  return ['armed', 'ARMED — real trades are being sent'];
}
function renderReal() {
  const d = L.live, box = $('#realpanel'), chip = $('#real-chip');
  if (!d) { box.innerHTML = '<p class="empty">Real-trading state unavailable. Retrying.</p>'; return; }
  const [k, label] = realState(d);
  chip.className = 'pill real-chip rc-' + k;
  chip.textContent = ({ off: 'REAL · NOT ARMED', dry: 'REAL · DRY RUN', halt: 'REAL · HALTED', armed: 'REAL · ARMED' })[k];
  chip.title = label;
  let h = `<div class="rp-head"><span class="b b-real">REAL TRADE</span><b class="rp-state rs-${k}">${esc(label)}</b></div>`;
  if (!d.armed) {
    h += `<p class="rp-note">No wallet, no real orders. Everything above this panel is paper unless a row is badged REAL TRADE.${d.arm_reason ? ' <span class="muted">(' + esc(String(d.arm_reason).slice(0, 120)) + ')</span>' : ''}</p>`;
  } else {
    const v = d.dryrun ? ' <span class="muted">(virtual)</span>' : '';
    const pos = d.positions || [], txs = (d.last_txs || []).slice(0, 5), pn = d.pnl || {};
    h += `<div class="rp-addr"><span class="muted">wallet</span> <code title="${esc(d.address)}">${esc(short(d.address))}</code> <button type="button" class="cp" data-copy="${esc(d.address)}" aria-label="Copy wallet address">copy</button></div>
    <dl class="rp-grid">
      <div><dt>native balance</dt><dd>${d.balance_native == null ? '—' : esc(fmtEth(d.balance_native)) + ' ETH'}${v}</dd></div>
      <div><dt>open real positions</dt><dd>${pos.length}</dd></div>
    </dl>`;
    if (pos.length) h += `<ul class="rp-pos">${pos.map(p => `<li>${esc(sym({}, p.token) || short(p.token))} <span class="ll-a">${esc(short(p.token))}</span> · cost ${esc(fmtEth(p.cost_native))} ETH${p.virtual ? ' · virtual' : ''}</li>`).join('')}</ul>`;
    h += `<div class="rp-tx"><span class="h-label">last real txs</span>` + (txs.length ? `<ul>${txs.map(t => `<li><span class="muted">${utc(t.ts)}</span> ${esc(t.kind || t.side || '')} · ${esc(t.status)}${t.dryrun ? ' <span class="b b-dry">DRY RUN</span>' : ''} <a class="txl" href="https://robinhoodchain.blockscout.com/tx/${esc(t.tx_hash)}" target="_blank" rel="noopener" title="${esc(t.tx_hash)}">${esc(short(t.tx_hash))}</a> <button type="button" class="cp" data-copy="${esc(t.tx_hash)}" aria-label="Copy transaction hash">copy</button></li>`).join('')}</ul>` : ' <span class="muted">none yet</span>') + '</div>';
  }
  box.innerHTML = h;
}
function fmtEth(v) { if (v == null || v === '') return '\u2014'; const n = Number(v); if (!isFinite(n)) return String(v); return (Math.abs(n) < 1e-9 ? '0' : n.toFixed(6)); }
async function loadLive() {
  try { const r = await fetch('/api/live', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); L.live = await r.json(); }
  catch (e) { L.live = null; }
  renderReal();
}

/* ---------------------------------------------------------------- UI */
const wide = () => matchMedia('(min-width:1101px)').matches;
function setOpen(o) {
  L.open = o; const d = $('#livelog'), t = $('#ll-toggle');
  d.hidden = !o; t.setAttribute('aria-expanded', String(o)); document.body.classList.toggle('ll-open', o);
  if (o) { backfill(); loadLive(); clearInterval(L.liveT); L.liveT = setInterval(loadLive, 10000); d.focus({ preventScroll: true }); }
  else { clearInterval(L.liveT); t.focus({ preventScroll: true }); }
}
function setPaused(p) {
  L.paused = p; const b = $('#ll-pause'); b.setAttribute('aria-pressed', String(p));
  if (p) b.textContent = 'Paused · 0 new'; else { L.pending = 0; b.textContent = 'Auto-scroll: on'; render(); }
}
document.addEventListener('click', (e) => {
  const cp = e.target.closest('[data-copy]'); if (cp) { copy(cp.dataset.copy, cp); return; }
  if (e.target.closest('#ll-toggle')) { setOpen(!L.open); return; }
  if (e.target.closest('#real-chip')) { setOpen(true); return; }
  if (e.target.closest('#ll-close')) { setOpen(false); return; }
  const ch = e.target.closest('#ll-chips button'); if (ch) {
    L.filter = ch.dataset.f; document.querySelectorAll('#ll-chips button').forEach(b => b.setAttribute('aria-pressed', String(b === ch))); render(); return;
  }
  if (e.target.closest('#ll-pause')) { setPaused(!L.paused); return; }
  const row = e.target.closest('.ll-main'); if (row && window.DBAPP) {
    const c = row.dataset.lc, s = row.dataset.ls;
    if (c || s) { if (!wide()) setOpen(false); window.DBAPP.select(c ? 'c' : 's', c || s); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && L.open) setOpen(false); });

window.DBLOG = {
  L,
  event(ev) {
    if (ev.type === 'heartbeat' || ev.type === 'data_status') return;
    if (add(ev)) { schedule(); if (ev.type.startsWith('live_')) { clearTimeout(L.liveR); L.liveR = setTimeout(loadLive, 600); } }
  },
};
if (location.hash === '#livelog') setOpen(true);
loadLive(); setInterval(() => { if (!L.open) loadLive(); }, 20000);
})();
