/* Local archive adapter. Original source files are preserved in ../original/. */
(() => {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const nativeFetch = window.fetch.bind(window);
  const indexReady = nativeFetch(new URL('snapshots/index.json', base)).then(r => r.json());
  const cache = new Map();
  const response = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'X-Archive-Mode': 'snapshot' }
  });
  const read = file => {
    if (!cache.has(file)) cache.set(file, nativeFetch(new URL('snapshots/' + file, base)).then(r => r.json()));
    return cache.get(file).then(x => structuredClone(x));
  };
  window.ALPHAMORPH_ARCHIVE = true;
  window.fetch = async function(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const path = url.pathname;
    if (url.origin !== location.origin || !(path.startsWith('/api/') || path === '/healthz')) {
      if (url.origin === location.origin && path === '/site-config.json') return nativeFetch(new URL('site-config.json', base), init);
      return nativeFetch(input, init);
    }
    const method = (init?.method || input?.method || 'GET').toUpperCase();
    if (method !== 'GET') return response({ error: 'READ_ONLY_ARCHIVE', message: 'This local copy contains recorded data only.' }, 405);
    const meta = await indexReady;
    const key = path + url.search;
    let match = meta.endpoints[key] ? key : path;
    if (!meta.endpoints[match]) {
      match = Object.keys(meta.endpoints).find(k => k.split('?')[0] === path);
    }
    if (!match && path.startsWith('/api/league/lineage/')) {
      const league = await read(meta.endpoints['/api/league']);
      const id = decodeURIComponent(path.split('/').pop());
      const row = league.lineages.find(x => x.root_policy_id === id || x.lineage_id === id);
      if (row) match = '/api/league/lineage/' + row.lineage_id;
    }
    if (!match || !meta.endpoints[match]) return response({error:'NOT_CAPTURED',message:'This endpoint needs the original backend and is not included in this snapshot.'},503);
    let data = await read(meta.endpoints[match]);
    if (path === '/api/state' || path === '/healthz') data.data_status = 'recorded';
    if (path === '/healthz') data.last_error = 'Local snapshot; captured ' + meta.captured_at;
    if (Array.isArray(data)) {
      if (path === '/api/events' || path === '/api/circuits/events') {
        const since = Number(url.searchParams.get('since') || 0);
        data = data.filter(x => x.id > since);
      }
      const limit = Number(url.searchParams.get('limit'));
      if (limit > 0) data = data.slice(0, limit);
    }
    return response(data);
  };
  // Preserve the EventSource interface without fabricating live events.
  class RecordedStream extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    constructor(url) { super(); this.url=String(url); this.readyState=2; }
    close() { this.readyState=2; }
  }
  window.EventSource = RecordedStream;
  document.addEventListener('DOMContentLoaded', async () => {
    const meta = await indexReady;
    const banner = document.createElement('aside');
    banner.id = 'archive-note';
    banner.textContent = 'LOCAL SNAPSHOT · ' + meta.captured_at.slice(0,10) + ' · Recorded data. No live feed or transactions.';
    banner.style.cssText = 'position:fixed;bottom:12px;left:12px;max-width:calc(100vw - 24px);padding:7px 11px;border:1px solid #9b7bff;border-radius:5px;background:#10131bf2;color:#d6caff;font:11px/1.5 monospace;z-index:2147483646;box-sizing:border-box';
    document.body.appendChild(banner);
    const labelStream = () => { const el = document.getElementById('stream'); if(el) { el.textContent='stream · snapshot';el.style.color='#9b7bff'; } };
    labelStream(); setInterval(labelStream,2000);
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-act]');
    if (button && ['connect','reown','switch','approve','mint','signin','claim','signout'].includes(button.dataset.act)) {
      e.preventDefault();e.stopImmediatePropagation();
      alert('This is a read-only frontend archive. Wallet actions and private reports require the original backend.');
    }
  }, true);
})();
