/* ALPHAMORPH — data-driven brain regions (shared by the 2D brain, the 3D brain, the roadmap).
   Reads /api/state regions[] (id, name, status 'active'|'dormant', unlock_rule, unlocked_gen, progress). Nothing is invented:
   a region that the API does not list does not exist here, and unknown progress stays unknown. */
(() => {
'use strict';
const CAT = {
  awareness: { n: '01', name: 'Market Awareness', short: 'market awareness', tint: 0xB6FF4D, fn: 'Selects which new launchpad tokens are worth acting on: token age, trade count, buy pressure.' },
  timing: { n: '02', name: 'Timing / Discipline', short: 'timing / discipline', tint: 0x52D2EE, fn: 'Decides when to enter and when to leave: entry delay, take-profit, stop, maximum hold.' },
  risk: { n: '03', name: 'Risk / Conviction', short: 'risk / conviction', tint: 0xFFAE72, fn: 'Sets conviction and size: position fraction and the conviction threshold for entry.' },
  provenance: { n: '04', name: 'Provenance (who launched it)', short: 'provenance · who launched it', tint: 0xFF7AD9, fn: 'Looks at who launched the token: the creator and what they launched before.' },
  flow: { n: '05', name: 'Flow (who is trading)', short: 'flow · who is trading', tint: 0xF4D35E, fn: 'Reads who is trading the token: buyer and seller concentration, one-sided flow.' },
  curve: { n: '06', name: 'Curve (where it is on the curve)', short: 'curve · where it is on the curve', tint: 0xA48BFF, fn: 'Reads where the token sits on its bonding curve and how close it is to graduating.' },
};
const ORDER = Object.keys(CAT), CORE = ORDER.slice(0, 3);
const EXTRA = [0x7CF3B0, 0x8FB8FF, 0xFFD2A0];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

function info(st) {
  const raw = (st && Array.isArray(st.regions) && st.regions.length) ? st.regions : CORE.map(id => ({ id }));
  const gen = num(st && st.generation);
  const list = raw.map((r, k) => {
    const c = CAT[r.id];
    const meta = c || { n: String(k + 1).padStart(2, '0'), name: r.name || r.id, short: String(r.name || r.id).toLowerCase(), tint: EXTRA[k % EXTRA.length], fn: 'Region reported by the API.' };
    const status = r.status === 'dormant' ? 'dormant' : 'active';
    const rule = r.unlock_rule && typeof r.unlock_rule === 'object' ? r.unlock_rule : null;
    const pr = r.progress && typeof r.progress === 'object' ? r.progress : null;
    let pct = null;
    if (status === 'dormant' && rule && pr) { // unlocking needs BOTH conditions: progress = the slower of the two
      const rs = [];
      if (num(rule.generation) > 0 && num(pr.generation) != null) rs.push(Math.min(1, pr.generation / rule.generation));
      if (num(rule.closed_trades) > 0 && num(pr.closed_trades) != null) rs.push(Math.min(1, pr.closed_trades / rule.closed_trades));
      if (rs.length) pct = Math.min(...rs);
    }
    const need = rule ? [num(rule.generation) != null ? 'gen ' + rule.generation : null, num(rule.closed_trades) != null ? rule.closed_trades + ' trades' : null].filter(Boolean).join(' and ') : null;
    const lock = status === 'dormant'
      ? (need ? `unlocks at ${need}` : 'unlock rule not reported') + (pct != null ? `: ${Math.round(pct * 100)}%` : ': progress not reported')
      : null;
    const ug = num(r.unlocked_gen);
    const core = CORE.includes(r.id);
    const born = status === 'active' && !core && ug != null && gen != null && gen - ug <= 1;
    return { id: r.id, n: meta.n, name: meta.name, short: meta.short, tint: meta.tint, fn: meta.fn, status, rule, pct, lock, requires: rule && rule.requires, unlocked_gen: ug, born, core, strategies: r.strategies || [] };
  });
  list.sort((a, b) => { const x = ORDER.indexOf(a.id), y = ORDER.indexOf(b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  return list;
}
const sig = (list) => list.map(r => r.id + ':' + r.status + (r.born ? '!' : '')).join('|');
window.AMR = { CAT, ORDER, CORE, info, sig, hex, rgb, meta: (id) => CAT[id] || null, label: (id) => (CAT[id] ? CAT[id].name : id) };
})();
