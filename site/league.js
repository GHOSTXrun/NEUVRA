/* ALPHAMORPH — Model Lineage League view. Renders ONLY what /api/league* returns; nothing is simulated.
   Disabled by default: when the API answers 404/503 or enabled!=true the section shows a "coming soon" state and this file
   never touches window.ethereum (no wallet prompt, no wallet probing).
   Wallet access is EIP-1193 with hand-encoded ABI calls. Two providers feed the SAME code paths: the injected window.ethereum, and the
   Reown AppKit (WalletConnect) walletProvider from a vendored, lazily imported bundle (web/vendor/reown-appkit.<v>.js, built by
   tools/reown, no CDN). The bundle is imported only after the league is live AND the user clicks Connect (or had a Reown session).
   Experimental research access, not an investment. No returns, no profit sharing. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#league'), body = $('#lg-body');
if (!root || !body) return;

const API = '/api/league';
const SEL = { balanceOf: '0x70a08231', allowance: '0xdd62ed3e', approve: '0x095ea7b3', mint: '0xadf2cead', mintPrice: '0xc002d23d', ownerOf: '0x6352211e' };
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RECEIPT_TIMEOUT_MS = 180000;
// Known production network (Founder-verified). Used ONLY to offer wallet_addEthereumChain and explorer links when the API reports this
// chain id; the chain id, token and contract the page actually transacts with always come from /api/league, never from here.
const KNOWN_CHAINS = {
  4663: { chainName: 'Robinhood Chain', rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://robin.etherscan.io'],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
};
const explorerTx = (h) => { const k = S.cfg && KNOWN_CHAINS[S.cfg.contract.chain_id]; return k ? k.blockExplorerUrls[0] + '/tx/' + h : null; };

// Reown (WalletConnect) project id: a public identifier, allowlisted per domain in the Reown dashboard.
const REOWN = { projectId: 'c3019a6e0e0bd48e6291c3c02339128d', url: '/vendor/reown-appkit.1.8.24.js', kit: null, mod: null, loading: null, flag: 'lg.reown' };
const S = {
  cfg: null, state: 'loading', why: '',            // state: loading | live | disabled | unavailable
  w: { prov: null, kind: '', acct: '', chain: null, bal: null, allow: null, price: null, busy: '', epoch: 0, wname: '' },
  sess: null, view: { name: 'list' },
  data: {}, msg: {}, tx: null, loading: false,
};
try { const j = JSON.parse(sessionStorage.getItem('lg.sess') || 'null'); if (j && j.token && Date.parse(j.expires_at) > Date.now()) S.sess = j; } catch (e) { /* none */ }

// ------------------------------------------------------------------ small helpers
const isN = (v) => typeof v === 'number' && isFinite(v);
const short = (a) => a ? String(a).slice(0, 6) + '…' + String(a).slice(-4) : '';
const when = (t) => isN(t) ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
const hex32 = (h) => String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const addrArg = (a) => hex32(a);
const bigArg = (n) => BigInt(n).toString(16).padStart(64, '0');
function fmtUnits(raw, dec, maxFrac = 4) {
  try {
    const n = BigInt(raw), d = 10n ** BigInt(dec), w = n / d, f = (n % d).toString().padStart(Number(dec), '0').slice(0, maxFrac).replace(/0+$/, '');
    return w.toLocaleString('en-US') + (f ? '.' + f : '');
  } catch (e) { return '—'; }
}
const VERDICT_TXT = { IMPROVEMENT_SUPPORTED: 'Improvement supported', INSUFFICIENT_EVIDENCE: 'Not enough evidence', EVALUATION_INVALID: 'Evaluation invalid' };
const NOTICE_FALLBACK = 'Experimental research access, not an investment. No returns, no profit sharing. Past results do not predict future results.';
const ERR_TXT = {
  unauthorized: 'Your sign-in has expired or is missing. Sign in again with your wallet.',
  not_your_token: 'This wallet does not currently own that token. Access follows the on-chain owner.',
  entitlement_required: 'This report needs an entitlement that this token does not have.',
  entitlement_unclaimed: 'This report is available after you claim the entitlement (see Entitlements).',
  chain_unavailable: 'The chain could not be reached, so ownership cannot be verified. Access is denied until it can (fails closed). Try again shortly.',
  chain_not_configured: 'The league contract is not configured on the server, so premium access is closed.',
  auth_not_configured: 'Sign-in is not configured on the server.',
  league_unavailable: 'The league service is temporarily unavailable.',
  rate_limited: 'Too many requests. Wait a moment and retry.', cap_reached: 'Daily claim cap reached for this token. Try again tomorrow (UTC).',
  already_claimed: 'That entitlement is already claimed.', unknown_token: 'No such token on chain.', unknown_report: 'Unknown report.',
  unknown_entitlement: 'Unknown entitlement.', unknown_lineage: 'Unknown lineage.', wrong_domain: 'The sign-in message was for a different site.',
  wrong_chain_id: 'The sign-in message was for a different chain.', nonce_expired: 'The sign-in request expired. Try again.',
  nonce_replayed: 'That sign-in request was already used. Try again.', bad_signature: 'The signature did not verify.',
};
const errText = (r) => (r && r.data && ERR_TXT[r.data.error]) || (r && r.status === 404 ? 'Not found.' : r && r.status === 0 ? 'Network error: could not reach the server.' : 'Request failed (HTTP ' + (r ? r.status : '?') + (r && r.data && r.data.error ? ', ' + r.data.error : '') + ').');

async function api(path, opt = {}) {
  const h = { Accept: 'application/json' };
  if (opt.auth && S.sess) h.Authorization = 'Bearer ' + S.sess.token;
  if (opt.json) h['Content-Type'] = 'application/json';
  try {
    const res = await fetch(API + path, { method: opt.method || 'GET', headers: h, body: opt.json ? JSON.stringify(opt.json) : undefined, cache: 'no-store' });
    let data = null; try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401 && opt.auth) { S.sess = null; try { sessionStorage.removeItem('lg.sess'); } catch (e) { /* */ } }
    return { ok: res.ok, status: res.status, data };
  } catch (e) { return { ok: false, status: 0, data: null }; }
}

// ------------------------------------------------------------------ wallet (EIP-1193: injected or Reown walletProvider)
const prov = () => window.ethereum || null;
const rpc = (method, params = []) => { if (!S.w.prov) return Promise.reject(Object.assign(new Error('No wallet connected'), { code: 4900 })); return S.w.prov.request({ method, params }); };
const price = () => S.w.price;
const isSessionErr = (e) => { const c = e && (e.code ?? (e.data && e.data.code)), m = String((e && (e.message || e.reason)) || e || ''); return c === 4900 || c === 4901 || /session.*(expired|not found|deleted|disconnect|closed)|no matching key|please call connect|disconnected|proposal expired|request expired|pairing.*(expired|not found)/i.test(m); };
function walletErr(e) {
  const c = e && (e.code ?? (e.data && e.data.code)), m = String((e && (e.message || e.reason)) || e || '');
  if (c === 4001 || /user (rejected|denied)|rejected the request/i.test(m)) return 'You rejected the request in your wallet. Nothing was sent.';
  if (c === -32002) return 'Your wallet already has a pending request. Open it and respond first.';
  if (c === 4902) return 'Your wallet does not know this network. Add it in the wallet, then retry.';
  if (isSessionErr(e)) { if (S.w.kind === 'reown') setTimeout(() => walletGone(''), 0); return 'Your wallet session ended or the request expired. Connect your wallet again and retry. If a transaction hash is shown below, check it on the explorer before sending anything again.'; }
  if (/insufficient funds/i.test(m)) return 'Not enough native gas currency in this wallet to pay transaction fees.';
  if (/revert|execution/i.test(m)) return 'The transaction was rejected by the contract (' + m.slice(0, 160) + ').';
  return 'Wallet error: ' + (m.slice(0, 200) || 'unknown');
}
const clearSess = () => { S.sess = null; try { sessionStorage.removeItem('lg.sess'); } catch (e) { /* */ } S.data.mine = null; };
const bound = new WeakSet();
function bindProv(p) {                                    // idempotent per provider object; handlers ignore providers that are no longer active
  if (!p || !p.on || bound.has(p)) return; bound.add(p);
  const act = () => S.w.prov === p;
  p.on('accountsChanged', (a) => { if (!act()) return; const n = (a && a[0] || '').toLowerCase(); if (!n) { if (S.w.kind === 'reown') walletGone('Your wallet disconnected.'); return; } if (n !== S.w.acct) { S.w.acct = n; clearSess(); refreshWallet().then(render); } });
  p.on('chainChanged', (c) => { if (!act()) return; S.w.chain = typeof c === 'string' ? parseInt(c, c.startsWith('0x') ? 16 : 10) : Number(c); refreshWallet().then(render); });
  p.on('disconnect', () => { if (act() && S.w.kind === 'reown') walletGone('Your wallet session ended. Connect again to continue.'); });
  p.on('session_delete', () => { if (act() && S.w.kind === 'reown') walletGone('Your wallet session ended. Connect again to continue.'); });
}
async function connect() {                                // injected browser wallet (window.ethereum)
  if (!prov()) { S.msg.wallet = { cls: 'bad', t: 'No browser wallet detected. Install an EIP-1193 wallet (for example MetaMask) and reload this page, or use CONNECT WALLET for WalletConnect / mobile wallets. Browsing the league needs no wallet.' }; return render(); }
  S.w.prov = prov(); S.w.kind = 'injected'; S.w.wname = 'Browser wallet'; S.w.busy = 'connecting'; render();
  try {
    const acc = await rpc('eth_requestAccounts');
    S.w.acct = (acc && acc[0] || '').toLowerCase();
    S.w.chain = parseInt(await rpc('eth_chainId'), 16);
    S.msg.wallet = null;
    bindProv(S.w.prov);
    await refreshWallet();
  } catch (e) { S.msg.wallet = { cls: 'bad', t: walletErr(e) }; }
  S.w.busy = ''; render();
}
// ---- Reown AppKit (lazy)
function loadReown() {
  if (S.state !== 'live') return Promise.reject(new Error('league not live'));          // never load while disabled
  if (REOWN.kit) return Promise.resolve(REOWN.kit);
  if (REOWN.loading) return REOWN.loading;
  REOWN.loading = import(REOWN.url).then((mod) => {
    const id = S.cfg.contract.chain_id, nets = [mod.robinhoodChain()];
    if (id !== 4663) nets.push(mod.defineChain({ id, caipNetworkId: 'eip155:' + id, chainNamespace: 'eip155', name: 'League chain ' + id, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [location.origin + '/api/league/rpc-unused'] } } }));
    const net = nets.find(n => n.id === id) || nets[0];
    const css = getComputedStyle(document.documentElement), lime = (css.getPropertyValue('--lime') || '').trim();
    const home = /(^|\.)alphamorph\.si$/.test(location.hostname) ? 'https://alphamorph.si' : location.origin;
    const kit = mod.init({ projectId: REOWN.projectId, networks: nets, defaultNetwork: net,
      metadata: { name: 'ALPHAMORPH', description: 'ALPHAMORPH Model Lineage League: experimental research access.', url: home, icons: [home + '/favicon.svg', home + '/og.png'] },
      themeVariables: Object.assign({ '--w3m-font-family': 'inherit', '--w3m-border-radius-master': '1px' }, lime ? { '--w3m-accent': lime } : {}) });
    REOWN.mod = mod; REOWN.kit = kit; window.__lgReown = kit;
    kit.subscribeAccount((a) => onReownAccount(a));
    kit.subscribeNetwork((n) => { if (S.w.kind === 'reown' && n && n.chainId != null && Number(n.chainId) !== S.w.chain) { S.w.chain = Number(n.chainId); refreshWallet().then(render); } });
    kit.subscribeState((st) => { if (st && st.open === false && S.w.busy === 'connecting' && S.w.kind !== 'reown') { S.w.busy = ''; render(); } });   // modal closed without connecting
    return kit;
  });
  REOWN.loading.catch(() => { REOWN.loading = null; });
  return REOWN.loading;
}
function onReownAccount(a) {
  if (!a) return;
  if (a.isConnected && a.address) adoptReown(String(a.address).toLowerCase());
  else if (a.status === 'disconnected' && S.w.kind === 'reown') walletGone('Your wallet disconnected. Connect again to continue.');
}
async function adoptReown(addr) {
  const kit = REOWN.kit, p = kit.getWalletProvider();
  if (!p) return;
  const same = S.w.kind === 'reown' && S.w.prov === p && S.w.acct === addr;
  if (S.w.acct && S.w.acct !== addr) clearSess();
  S.w.prov = p; S.w.kind = 'reown'; S.w.acct = addr;
  try { const wi = kit.getWalletInfo && kit.getWalletInfo(); S.w.wname = (wi && wi.name) || 'WalletConnect'; } catch (e) { S.w.wname = 'WalletConnect'; }
  try { localStorage.setItem(REOWN.flag, '1'); } catch (e) { /* */ }
  bindProv(p);
  let ch = Number(kit.getChainId && kit.getChainId());
  if (!isFinite(ch) || !ch) { try { ch = parseInt(await rpc('eth_chainId'), 16); } catch (e) { ch = null; } }
  const chainSame = S.w.chain === ch; S.w.chain = ch; S.msg.wallet = null; S.w.busy = '';
  if (!same || !chainSame) await refreshWallet();
  render();
}
async function connectReown() {                           // opens the Reown modal (extension wallets, WalletConnect QR, mobile deeplinks, Coinbase, Rainbow, Trust ...)
  S.w.busy = 'connecting'; S.msg.wallet = null; render();
  try {
    const kit = await loadReown();
    await kit.open({ view: 'Connect' });
  } catch (e) {
    S.w.busy = '';
    S.msg.wallet = { cls: 'bad', t: 'The wallet connector could not be loaded (' + String((e && e.message) || e).slice(0, 120) + '). ' + (prov() ? 'You can still use your browser wallet below.' : 'Check your connection and retry.') };
    render();
  }
}
async function restoreReown() {                           // only if this browser connected through Reown before; AppKit re-attaches its stored session
  let f = null; try { f = localStorage.getItem(REOWN.flag); } catch (e) { /* */ }
  if (f !== '1' || S.state !== 'live' || S.w.acct) return;
  try { await loadReown(); } catch (e) { /* stay disconnected */ }
}
function walletGone(text) {                               // session expired / wallet disconnected mid-flow: never leave the UI stuck
  S.w.epoch++; S.w.kind = ''; S.w.prov = null; S.w.acct = ''; S.w.bal = S.w.allow = null; S.w.busy = ''; S.w.wname = '';
  try { localStorage.removeItem(REOWN.flag); } catch (e) { /* */ }
  clearSess();
  if (text) S.msg.wallet = { cls: 'bad', t: text };
  else if (!S.msg.wallet) S.msg.wallet = { cls: 'bad', t: 'Your wallet session ended. Connect again to continue.' };
  render();
}
async function disconnectWallet() {                       // user-initiated
  const k = S.w.kind;
  S.w.epoch++; S.w.kind = ''; S.w.prov = null; S.w.acct = ''; S.w.bal = S.w.allow = null; S.w.busy = ''; S.w.wname = ''; S.msg.wallet = null; S.msg.mint = null;
  try { localStorage.removeItem(REOWN.flag); } catch (e) { /* */ }
  clearSess(); render();
  if (k === 'reown' && REOWN.kit) { try { await REOWN.kit.disconnect(); } catch (e) { /* already gone */ } }
}
const rightChain = () => S.cfg && S.w.chain === S.cfg.contract.chain_id;
async function switchChain() {
  const id = '0x' + S.cfg.contract.chain_id.toString(16);
  try {
    if (S.w.kind === 'reown' && REOWN.kit) {              // AppKit updates the WalletConnect session (and asks the wallet to add the chain if needed)
      const net = REOWN.kit.getCaipNetworks().find(n => n.id === S.cfg.contract.chain_id);
      if (!net) throw Object.assign(new Error('unknown network'), { code: 4902 });
      await REOWN.kit.switchNetwork(net, { throwOnFailure: true });
      const ch = Number(REOWN.kit.getChainId());
      if (ch !== S.cfg.contract.chain_id) throw Object.assign(new Error('network not switched'), { code: 4001 });   // refused or ignored: stay locked
      S.w.chain = ch;
    } else {
      try { await rpc('wallet_switchEthereumChain', [{ chainId: id }]); }
      catch (e) {
        const k = KNOWN_CHAINS[S.cfg.contract.chain_id];
        if (e && e.code === 4902 && k) await rpc('wallet_addEthereumChain', [Object.assign({ chainId: id }, k)]);   // unknown to the wallet: offer to add it (the wallet asks the user)
        else throw e;
      }
      S.w.chain = parseInt(await rpc('eth_chainId'), 16);
    }
    S.msg.wallet = null; await refreshWallet();
  } catch (e) {
    S.msg.wallet = { cls: 'bad', t: S.w.kind === 'reown' && !isSessionErr(e) && !(e && e.code === 4902) ? 'Your wallet did not switch to chain ' + S.cfg.contract.chain_id + ' (you rejected it, or the wallet does not support it). Switch the network inside your wallet, then retry. Nothing was sent.' : walletErr(e) };
  }
  render();
}
async function refreshWallet() {
  S.w.bal = S.w.allow = null;
  if (!S.cfg || !S.w.acct || !rightChain()) return;
  const c = S.cfg.contract;
  if (!c.configured || !c.token || !c.address) return;
  try {
    S.w.bal = BigInt(await rpc('eth_call', [{ to: c.token, data: SEL.balanceOf + addrArg(S.w.acct) }, 'latest']));
    S.w.allow = BigInt(await rpc('eth_call', [{ to: c.token, data: SEL.allowance + addrArg(S.w.acct) + addrArg(c.address) }, 'latest']));
    // exact price: read it from the contract itself; JSON numbers lose precision above 2^53
    let p = null;
    try { p = BigInt(await rpc('eth_call', [{ to: c.address, data: SEL.mintPrice }, 'latest'])); } catch (e) { /* fall through */ }
    if (p === null && c.mint_price_raw_str) p = BigInt(c.mint_price_raw_str);
    if (p === null) p = 1000000n * 10n ** BigInt(c.decimals);
    S.w.price = p;
  } catch (e) { S.msg.wallet = { cls: 'bad', t: 'Could not read the token from this chain: ' + walletErr(e) }; }
}
async function waitReceipt(hash, label) {
  const t0 = Date.now(), p = S.w.prov, ep = S.w.epoch;
  S.tx = { hash, label, state: 'pending' }; render();
  while (Date.now() - t0 < RECEIPT_TIMEOUT_MS) {
    if (S.w.prov !== p || S.w.epoch !== ep) { S.tx = { hash, label, state: 'timeout' }; render(); return null; }      // wallet disconnected: stop polling, keep the hash visible
    let r = null; try { r = await rpc('eth_getTransactionReceipt', [hash]); } catch (e) { /* retry */ }
    if (r) { S.tx = { hash, label, state: r.status === '0x1' ? 'ok' : 'failed', receipt: r }; render(); return r; }
    await new Promise(res => setTimeout(res, 1000));
  }
  S.tx = { hash, label, state: 'timeout' }; render(); return null;
}
async function sendTx(to, data, label) {
  const hash = await rpc('eth_sendTransaction', [{ from: S.w.acct, to, data }]);
  return waitReceipt(hash, label);
}
function guard(needBal) {
  if (!S.cfg.contract.configured) return 'The league contract is not configured yet.';
  if (!S.w.acct) return 'Connect a wallet first.';
  if (!rightChain()) return 'Wrong network: switch your wallet to chain ' + S.cfg.contract.chain_id + '.';
  if (S.w.price == null || S.w.bal == null) return 'Balances not loaded yet; try again.';
  if (needBal && S.w.bal < S.w.price) return 'Insufficient ' + S.cfg.contract.symbol_ + ' balance: you have ' + fmtUnits(S.w.bal, S.cfg.contract.decimals) + ', the price is ' + fmtUnits(S.w.price, S.cfg.contract.decimals) + '.';
  return '';
}
async function doApprove() {
  const g = guard(true); if (g) { S.msg.mint = { cls: 'bad', t: g }; return render(); }
  S.w.busy = 'approve'; S.msg.mint = null; render();
  try {
    const rc = await sendTx(S.cfg.contract.token, SEL.approve + addrArg(S.cfg.contract.address) + bigArg(S.w.price), 'approve');   // exact price, never unlimited
    if (rc && rc.status === '0x1') { await refreshWallet(); S.msg.mint = { cls: 'ok', t: 'Approval confirmed for exactly the mint price.' }; }
    else S.msg.mint = { cls: 'bad', t: rc ? 'The approval transaction failed on chain.' : 'Timed out waiting for the approval receipt. Check your wallet; nothing else was sent.' };
  } catch (e) { S.msg.mint = { cls: 'bad', t: walletErr(e) }; S.tx = null; }
  S.w.busy = ''; render();
}
async function doMint(lineageId) {
  const g = guard(true); if (g) { S.msg.mint = { cls: 'bad', t: g }; return render(); }
  if (S.w.allow < S.w.price) { S.msg.mint = { cls: 'bad', t: 'Approve the exact mint price first.' }; return render(); }
  S.w.busy = 'mint'; S.msg.mint = null; render();
  try {
    const rc = await sendTx(S.cfg.contract.address, SEL.mint + hex32(lineageId), 'mint');
    if (rc && rc.status === '0x1') {
      let id = null;
      for (const l of rc.logs || []) if (l.address.toLowerCase() === S.cfg.contract.address.toLowerCase() && l.topics && l.topics[0] === TRANSFER_TOPIC && l.topics.length === 4) id = BigInt(l.topics[3]).toString();
      S.msg.mint = { cls: 'ok', t: 'Minted' + (id ? ' token #' + id : '') + ' in block ' + parseInt(rc.blockNumber, 16) + '. It appears under My Lineages after the indexer’s next sync (a short delay is normal).' };
      S.minted = id; S.data.list = null;
      await refreshWallet(); loadList();
    } else S.msg.mint = { cls: 'bad', t: rc ? 'The mint transaction failed on chain. No NFT was issued; check your balance and allowance.' : 'Timed out waiting for the mint receipt. Check your wallet or the block explorer before retrying.' };
  } catch (e) { S.msg.mint = { cls: 'bad', t: walletErr(e) }; S.tx = null; }
  S.w.busy = ''; render();
}

// ------------------------------------------------------------------ sign-in
async function signIn() {
  if (!S.w.acct) return connectReown();
  S.w.busy = 'signin'; S.msg.auth = null; render();
  try {
    const n = await api('/auth/nonce', { method: 'POST', json: { address: S.w.acct } });
    if (!n.ok) throw { local: errText(n) };
    const msg = n.data.message;
    const hexMsg = '0x' + Array.from(new TextEncoder().encode(msg)).map(b => b.toString(16).padStart(2, '0')).join('');
    const sig = await rpc('personal_sign', [hexMsg, S.w.acct]);
    const v = await api('/auth/verify', { method: 'POST', json: { message: msg, signature: sig } });
    if (!v.ok) throw { local: errText(v) };
    S.sess = { token: v.data.token, address: v.data.address, expires_at: v.data.expires_at };
    try { sessionStorage.setItem('lg.sess', JSON.stringify(S.sess)); } catch (e) { /* */ }
    S.msg.auth = { cls: 'ok', t: 'Signed in as ' + short(v.data.address) + '. This signature authorized no transaction.' };
  } catch (e) { S.msg.auth = { cls: 'bad', t: e && e.local ? e.local : walletErr(e) }; }
  S.w.busy = ''; S.data.mine = null; render(); if (S.sess && S.view.name === 'mine') loadMine();
}
async function signOut() {
  if (S.sess) await api('/auth/logout', { method: 'POST', auth: true });
  S.sess = null; try { sessionStorage.removeItem('lg.sess'); } catch (e) { /* */ }
  S.data.mine = null; S.msg.auth = { cls: 'ok', t: 'Signed out.' }; render();
}

// ------------------------------------------------------------------ data loading
async function loadCfg() {
  const r = await api('');
  if (r.status === 404) { S.state = 'disabled'; S.cfg = null; }
  else if (r.ok && r.data && r.data.enabled === true) {
    S.state = 'live'; S.cfg = r.data; S.cfg.contract.symbol_ = (r.data.mint_price_display || '').replace(/^[\d,\.\s]+/, '') || '$MORPH';
    S.data.list = r.data.lineages;
  } else { S.state = 'unavailable'; S.why = r.status ? 'HTTP ' + r.status : 'network error'; }
  render();
}
async function silentRestore() {      // only after a previous sign-in; eth_accounts never opens a wallet prompt
  if (!S.sess || S.w.acct || !prov()) return;
  try {
    S.w.prov = prov(); S.w.kind = 'injected'; S.w.wname = 'Browser wallet';
    const acc = await rpc('eth_accounts');
    if (acc && acc[0] && acc[0].toLowerCase() === S.sess.address.toLowerCase()) {
      S.w.acct = acc[0].toLowerCase(); S.w.chain = parseInt(await rpc('eth_chainId'), 16); bindProv(S.w.prov); await refreshWallet(); render();
    } else { S.w.prov = null; S.w.kind = ''; S.w.wname = ''; }
  } catch (e) { S.w.prov = null; S.w.kind = ''; S.w.wname = ''; }
}
async function loadList() { const r = await api(''); if (r.ok && r.data && r.data.enabled) { const sym = S.cfg && S.cfg.contract.symbol_; S.cfg = r.data; S.cfg.contract.symbol_ = sym || '$MORPH'; S.data.list = r.data.lineages; render(); } }
async function loadLineage(id) {
  S.data.lin = null; S.msg.lin = null; render();
  const r = await api('/lineage/' + encodeURIComponent(id));
  if (r.ok) S.data.lin = r.data; else S.msg.lin = { cls: 'bad', t: errText(r) };
  render();
}
async function loadMine() {
  if (!S.sess) return;
  S.data.mine = { loading: true }; render();
  const [t, e] = await Promise.all([api('/me/tokens', { auth: true }), api('/me/entitlements', { auth: true })]);
  if (!t.ok) { S.data.mine = { err: errText(t) }; return render(); }
  S.data.mine = { tokens: t.data.tokens, ents: e.ok ? e.data.entitlements : [], entErr: e.ok ? '' : errText(e), notice: t.data.notice, benchmark: t.data.benchmark };
  render();
}
async function lookupToken(id) {
  S.msg.lookup = null;
  if (!S.sess) { S.msg.lookup = { cls: 'bad', t: 'Sign in first.' }; return render(); }
  if (!/^\d{1,18}$/.test(id)) { S.msg.lookup = { cls: 'bad', t: 'Enter a numeric token id.' }; return render(); }
  const r = await api('/me/tokens/' + id, { auth: true });
  if (!r.ok) { S.msg.lookup = { cls: 'bad', t: errText(r) }; return render(); }
  S.data.token = S.data.token || {}; S.data.token[id] = r.data; S.msg.lookup = { cls: 'ok', t: 'Token #' + id + ' is owned by the signed-in wallet.' };
  const m = S.data.mine && S.data.mine.tokens ? S.data.mine : (S.data.mine = { tokens: [], ents: [] });
  if (!m.tokens.some(x => String(x.token_id) === id)) m.tokens.push({ token_id: Number(id), lineage_id: r.data.lineage_id, direct: true });
  render();
}
async function openReport(tid, key) {
  S.data.report = { tid, key, loading: true }; render();
  const r = await api('/me/reports/' + tid + '/' + key, { auth: true });
  S.data.report = r.ok ? { tid, key, body: r.data } : { tid, key, err: errText(r), status: r.status, code: r.data && r.data.error };
  render();
  const el = $('#lg-report'); if (el) el.focus();
}
async function claim(id) {
  S.msg.claim = null; S.w.busy = 'claim'; render();
  const r = await api('/me/entitlements/' + id + '/claim', { method: 'POST', auth: true });
  S.msg.claim = r.ok ? { cls: 'ok', t: 'Entitlement #' + id + ' claimed. The advanced audit report is now open for that token.' } : { cls: 'bad', t: errText(r) };
  S.w.busy = ''; await loadMine();
}

// ------------------------------------------------------------------ rendering
const badge = (t, cls) => `<span class="lg-b lg-${cls || 'n'}">${esc(t)}</span>`;
const msg = (m) => m ? `<p class="lg-msg lg-${m.cls}" role="${m.cls === 'bad' ? 'alert' : 'status'}">${esc(m.t)}</p>` : '';
const sec = (id, title, inner, sub) => `<section class="ec-sec" id="${id}" aria-labelledby="${id}-h"><h3 id="${id}-h">${title}${sub ? ` <span class="muted">· ${sub}</span>` : ''}</h3>${inner}</section>`;
const card = (k, v, s) => `<div class="ec-card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
const table = (heads, rows) => `<div class="ec-wrap" tabindex="0" role="region" aria-label="table, scrolls horizontally if needed"><table class="ec-tbl"><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

function noticeBlock(d) {
  const b = (d && d.benchmark) || (S.cfg && S.cfg.benchmark) || null, n = (d && d.notice) || (S.cfg && S.cfg.notice) || NOTICE_FALLBACK;
  const v = b && b.overall;
  return `<div class="lg-notice" role="note"><b>EXPERIMENTAL RESEARCH ACCESS · NOT AN INVESTMENT</b><p>${esc(n)}</p>` +
    `<p><a href="#benchmark">See the benchmark</a></p></div>`;
}
function soon() {
  return `<div class="lg-soon"><h3>Model Lineage League</h3><p><b>Coming soon.</b> This feature is not live. Nothing here can be bought or signed yet.</p>` +
    `<p class="muted">Experimental research access, not an investment. When it opens, this page shows the exact price and what each pass includes before any wallet is asked for anything.</p></div>`;
}
function walletBox() {
  const w = S.w, c = S.cfg.contract, sym = c.symbol_;
  let h = '';
  if (!w.acct) {
    h = `<p class="muted">No wallet connected. Viewing needs no wallet. Connect with a browser extension, a mobile wallet (QR code or app link), Coinbase Wallet, Rainbow, Trust and others.</p><button type="button" class="lg-btn lg-go" data-act="reown"${w.busy ? ' disabled' : ''}>${w.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}</button>` +
      (prov() ? `<button type="button" class="lg-btn lg-ghost" data-act="connect"${w.busy ? ' disabled' : ''}>Use browser wallet</button>` : '');
  } else {
    h = `<dl class="ec-kv"><dt>Account</dt><dd><code title="${esc(w.acct)}" id="lg-addr">${esc(short(w.acct))}</code>${w.wname ? ` <span class="muted">· ${esc(w.wname)}</span>` : ''}</dd><dt>Network</dt><dd>${rightChain() ? badge('chain ' + w.chain, 'ok') : badge('wrong network (' + w.chain + ')', 'bad')}</dd>` +
      (rightChain() ? `<dt>${esc(sym)} balance</dt><dd>${w.bal == null ? '—' : esc(fmtUnits(w.bal, c.decimals))}</dd><dt>Allowance to league</dt><dd>${w.allow == null ? '—' : esc(fmtUnits(w.allow, c.decimals))}</dd>` : '') + `</dl>`;
    if (!rightChain()) h += `<p class="lg-msg lg-bad" role="alert">Your wallet is on chain ${esc(w.chain)}; the league lives on chain ${esc(c.chain_id)}.</p><button type="button" class="lg-btn" data-act="switch">SWITCH NETWORK</button> `;
    h += `<button type="button" class="lg-btn lg-ghost" data-act="forget">Disconnect</button>`;
    if (w.kind === 'reown' && ['approve', 'mint', 'signin'].includes(w.busy)) {
      const dl = deeplink();
      h += `<p class="lg-msg lg-wait" role="status">Waiting for your wallet. Open your wallet app to approve or sign.${dl ? ` <a href="${esc(dl.href)}" rel="noopener noreferrer">Open ${esc(dl.name || 'wallet app')}</a>` : ''}</p>`;
    }
  }
  return `<div class="ec-box lg-wallet" id="lg-wallet"><h4>WALLET</h4>${h}${msg(S.msg.wallet)}</div>`;
}
function deeplink() {                                     // WalletConnect remembers which wallet app the user picked on this device (mobile)
  try { const d = JSON.parse(localStorage.getItem('WALLETCONNECT_DEEPLINK_CHOICE') || 'null'); if (d && typeof d.href === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(d.href) && !/^(javascript|data|vbscript):/i.test(d.href)) return { href: d.href, name: d.name }; } catch (e) { /* none */ }
  return null;
}
function txBox() {
  const t = S.tx; if (!t) return '';
  const label = { pending: 'Waiting for confirmation…', ok: 'Confirmed', failed: 'Failed on chain', timeout: 'No receipt yet' }[t.state];
  return `<p class="lg-tx" role="status" aria-live="polite"><b>${esc(t.label)}</b> · ${esc(label)} · ${explorerTx(t.hash) ? `<a href="${esc(explorerTx(t.hash))}" target="_blank" rel="noopener noreferrer">${esc(short(t.hash))}</a>` : `<code>${esc(short(t.hash))}</code>`}</p>`;
}
function mintBox(ln) {
  const c = S.cfg.contract, sym = c.symbol_, w = S.w;
  const priceTxt = esc(S.cfg.mint_price_display);
  let why = '';
  if (!c.configured) why = 'Minting is not open: the contract is not configured on this server.';
  else if (!ln.mintable) why = ln.status !== 'active' ? 'This lineage is eliminated. It stays visible as history and cannot be minted.' : 'This lineage is not currently mintable.';
  else if (ln.cap && ln.minted >= ln.cap) why = 'Sold out: ' + ln.minted + ' of ' + ln.cap + ' minted.';
  const steps = [];
  const ok1 = !!w.acct, ok2 = ok1 && rightChain(), enough = ok2 && w.bal != null && w.price != null && w.bal >= w.price, approved = ok2 && w.allow != null && w.price != null && w.allow >= w.price;
  steps.push(`<li class="${ok2 ? 'done' : ''}">Connect a wallet on chain ${esc(c.chain_id)}</li>`);
  steps.push(`<li class="${approved ? 'done' : ''}">Approve exactly ${priceTxt} for the league contract (never unlimited)</li>`);
  steps.push(`<li>Mint: one transaction; the payment goes straight to the treasury address, the contract holds no funds</li>`);
  const btns = !why && ok2 ? `<button type="button" class="lg-btn" data-act="approve"${w.busy || approved || !enough ? ' disabled' : ''}>${w.busy === 'approve' ? 'APPROVING…' : 'APPROVE ' + priceTxt.toUpperCase()}</button> ` +
    `<button type="button" class="lg-btn lg-go" data-act="mint" data-lid="${esc(ln.lineage_id)}"${w.busy || !approved || !enough ? ' disabled' : ''}>${w.busy === 'mint' ? 'MINTING…' : 'MINT'}</button>` : '';
  const need = ok2 && !enough && w.bal != null ? `<p class="lg-msg lg-bad" role="alert">Insufficient ${esc(sym)} balance: you have ${esc(fmtUnits(w.bal, c.decimals))}, the price is ${priceTxt}.</p>` : '';
  return `<div class="ec-box lg-mint" id="lg-mint"><h4>MINT THIS LINEAGE <span class="muted">· price ${priceTxt}</span></h4>` +
    (why ? `<p class="lg-msg lg-wait" role="status">${esc(why)}</p>` : `<ol class="lg-steps">${steps.join('')}</ol>${need}<div class="lg-actions">${btns}</div>`) +
    `${txBox()}${msg(S.msg.mint)}<p class="muted lg-fine">Experimental research access to this lineage’s stored reports. Not an investment: no returns, no profit sharing. The price is fixed in the contract.</p></div>`;
}
const survTag = (k) => k === 'M_SURVIVOR';
const KIND = { M_SURVIVOR: 'Survivor', M_PROMOTED: 'Promoted', M_CHAMPION: 'Champion', M_RANK: 'Top rank' };
function milestoneRow(m) {
  const arch = survTag(m.kind);
  let st;
  if (m.state === 'cutoff_unknown') st = badge('cutoff unknown · no access granted', 'wait');
  else if (arch) st = badge('archive achievement', 'n');
  else if (m.ent_state === 'pending_index') st = badge('pending index', 'wait');
  else st = badge('settled', 'ok');
  const elig = arch ? '<span class="muted">history only; not a holder benefit</span>' : (m.state === 'cutoff_unknown' ? '—' : (m.ent_state === 'pending_index' ? '<span class="muted">computed after the indexer passes the cutoff</span>' : esc(m.n_eligible ?? 0) + ' token(s) minted before the cutoff'));
  return `<tr><td>${esc(KIND[m.kind] || m.kind)}</td><td>${esc(m.generation)}</td><td>${st}</td><td>${elig}</td><td>${m.cutoff_ts ? esc(when(m.cutoff_ts)) : '—'}<div class="muted">${esc(m.cutoff_source || '')}</div></td></tr>`;
}
function provBadge(p) { return badge(p === 'archive' ? 'archive' : 'live', p === 'archive' ? 'wait' : 'ok'); }

function viewList() {
  const L = (S.data.list || []).slice().sort((a, b) => (b.mintable ? 1 : 0) - (a.mintable ? 1 : 0)), d = S.cfg, c = d.contract;
  const rows = L.map(x => `<tr><td><a href="#league/lineage/${esc(x.root_policy_id)}" data-act="open" data-id="${esc(x.root_policy_id)}"><b>${esc(x.model || x.root_policy_id)}</b></a><div class="muted">${esc(x.root_policy_id)}</div></td>` +
    `<td>${esc(x.family || '—')}</td><td>${badge(x.status, x.status === 'active' ? 'ok' : 'n')}</td><td>${esc(x.born_gen)}</td><td>${esc(x.minted)}${x.cap ? ' / ' + esc(x.cap) : ''}</td>` +
    `<td>${x.results ? esc(x.results.active) + ' active · ' + esc(x.results.eliminated) + ' eliminated' : '—'}</td><td>${provBadge(x.provenance)}</td><td>${x.mintable ? `<a class="lg-btn lg-go" href="#league/lineage/${esc(x.root_policy_id)}" data-act="open" data-id="${esc(x.root_policy_id)}">MINT →</a>` : badge('read-only', 'n')}</td></tr>`);
  return sec('league-lineages', 'Lineages', `<div class="ec-strip lg-strip">${card('Mint price', esc(d.mint_price_display), 'fixed in the contract')}${card('Minted', esc(d.supply.minted) + (d.supply.max ? ' / ' + esc(d.supply.max) : ''), 'all lineages')}` +
    `${card('Network', c.chain_id ? 'chain ' + esc(c.chain_id) : '—', c.configured ? 'contract configured' : 'contract NOT configured')}</div>` +
    (rows.length ? table(['Lineage', 'Family', 'Status', 'Born gen', 'Minted', 'Members', 'Source', 'Mint'], rows) : '<p class="empty">No lineages yet.</p>') +
    `<p class="muted lg-fine">A lineage is one root model policy plus the policies evolved from it. Eliminated lineages stay visible as read-only history. “archive” means the live tournament no longer holds it and the data comes from the league’s own append-only archive.</p>`);
}
function viewLineage() {
  const d = S.data.lin;
  if (S.msg.lin) return `<p class="empty">${msg(S.msg.lin)}<a href="#league" data-act="list">Back to the list</a></p>`;
  if (!d) return '<p class="empty">Loading lineage.</p>';
  const lst = (S.data.list || []).find(x => x.lineage_id === d.lineage_id) || { lineage_id: d.lineage_id, status: d.status, mintable: d.status === 'active', minted: d.chain && d.chain.minted || 0, cap: d.chain && d.chain.cap };
  const mem = (d.models || []).map(m => `<tr><td><code>${esc(m.policy_id)}</code></td><td>${esc(m.model || '—')}</td><td>${badge(m.status, m.status === 'active' ? 'ok' : 'n')}</td><td>${esc(m.born_gen)}</td><td>${esc(m.eliminated_gen ?? '—')}</td><td>${esc(m.rank ?? '—')}</td></tr>`);
  const ms = (d.milestones || []).map(milestoneRow);
  const hist = (d.history || []).slice(-40).map(h => `<tr><td>${esc(h.generation)}</td><td>${esc(h.status)}</td><td>${esc(h.active_members)} / ${esc(h.members)}</td><td>${esc(h.best_rank ?? '—')}${h.of_n ? ' of ' + esc(h.of_n) : ''}</td><td>${esc(when(h.observed_ts))}</td></tr>`);
  return `<p><a href="#league" data-act="list">← all lineages</a></p>` +
    sec('league-profile', esc(d.model || d.root_policy_id), `<div class="ec-strip lg-strip">${card('Status', esc(d.status), 'current generation ' + esc(d.current_generation ?? '—'))}${card('Source', esc(d.provenance), d.provenance === 'archive' ? 'the live tournament no longer has this lineage' : 'read from the live tournament')}` +
      `${card('Minted', esc(d.chain && d.chain.minted != null ? d.chain.minted : '—') + (d.chain && d.chain.cap ? ' / ' + esc(d.chain.cap) : ''), 'on chain')}</div>` +
      `<p class="muted">Lineage id <code>${esc(d.lineage_id)}</code></p>`, esc(d.family || '')) +
    sec('league-mint', 'Mint', S.state === 'live' ? `<div class="ec-two">${walletBox()}${mintBox(lst)}</div>` : '') +
    sec('league-members', 'Models in this lineage', mem.length ? table(['Policy', 'Model', 'Status', 'Born gen', 'Eliminated gen', 'Rank'], mem) : '<p class="empty">None.</p>', 'root plus real descendants only') +
    sec('league-milestones', 'Milestones', (ms.length ? table(['Milestone', 'Generation', 'State', 'Research access', 'Cutoff (mint must precede it)'], ms) : '<p class="empty">No milestones recorded yet.</p>') +
      `<p class="muted lg-fine">A token qualifies for a milestone’s research access only if it was minted strictly before the cutoff. If the cutoff cannot be established, nothing is granted. “Survivor” is an archive achievement shown for history; it is not a benefit of holding a token.</p>`) +
    sec('league-history', 'Survival history', hist.length ? table(['Generation', 'Status', 'Active / members', 'Best rank', 'Observed'], hist) : '<p class="empty">No snapshots archived yet.</p>', 'provenance: ' + esc(d.provenance)) +
    `<p class="muted lg-fine">Cutoff and eligibility rule: ${esc(d.rule_version || '')}. Source of each number: the stored tournament and the league archive, never a projection.</p>`;
}
function renderValue(v, depth = 0) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="muted">none</span>';
    if (v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = Array.from(new Set(v.slice(0, 50).flatMap(Object.keys))).slice(0, 10);
      return table(keys.map(esc), v.slice(0, 50).map(r => `<tr>${keys.map(k => `<td>${typeof r[k] === 'object' && r[k] ? `<code>${esc(JSON.stringify(r[k])).slice(0, 120)}</code>` : esc(r[k] ?? '—')}</td>`).join('')}</tr>`)) + (v.length > 50 ? `<p class="muted">first 50 of ${v.length} rows</p>` : '');
    }
    return '<span>' + v.slice(0, 50).map(esc).join(', ') + '</span>';
  }
  if (typeof v === 'object') return depth > 2 ? `<code>${esc(JSON.stringify(v)).slice(0, 200)}</code>` : `<dl class="ec-kv lg-kv">${Object.keys(v).map(k => `<dt>${esc(k)}</dt><dd>${renderValue(v[k], depth + 1)}</dd>`).join('')}</dl>`;
  return esc(v);
}
function reportBox() {
  const r = S.data.report; if (!r) return '';
  let inner;
  if (r.loading) inner = '<p class="empty">Loading report.</p>';
  else if (r.err) {
    inner = msg({ cls: 'bad', t: r.err });
    if (r.code === 'entitlement_unclaimed') inner += '<p>Claim the entitlement below, then open the report again.</p>';
    if (r.status === 401) inner += '<button type="button" class="lg-btn" data-act="signin">SIGN IN AGAIN</button>';
  } else {
    const b = r.body, rest = Object.assign({}, b); ['benchmark', 'notice', 'provenance', 'token_id', 'lineage_id'].forEach(k => delete rest[k]);
    inner = `<p class="muted">Token #${esc(b.token_id)} · source ${esc(b.provenance)} · stored data only, no inference was run for this report.</p>${renderValue(rest)}${noticeBlock(b)}`;
  }
  return `<section class="ec-sec lg-report" id="lg-report" tabindex="-1" aria-label="Report"><h3>${esc(String(r.key).replace(/_/g, ' '))} <span class="muted">· token #${esc(r.tid)}</span> <button type="button" class="lg-btn lg-ghost" data-act="closereport">close</button></h3>${inner}</section>`;
}
function viewMine() {
  const c = S.cfg.contract;
  let h = `<div class="ec-two">${walletBox()}<div class="ec-box" id="lg-auth"><h4>SIGN IN</h4>` + (S.sess
    ? `<p>Signed in as <code>${esc(short(S.sess.address))}</code>. Access follows the wallet that owns the token on chain right now.</p><button type="button" class="lg-btn lg-ghost" data-act="signout">SIGN OUT</button>`
    : `<p class="muted">Sign a message to prove you own this wallet. It is free, authorizes no transaction and spends no tokens.</p><button type="button" class="lg-btn" data-act="signin"${S.w.busy ? ' disabled' : ''}>${S.w.busy === 'signin' ? 'WAITING FOR SIGNATURE…' : S.w.acct ? 'SIGN IN WITH WALLET' : 'CONNECT WALLET TO SIGN IN'}</button>`) + `${msg(S.msg.auth)}</div></div>`;
  if (!S.sess) return h + '<p class="empty">Sign in to see the lineages you own, your reports and entitlements.</p>';
  const m = S.data.mine;
  if (!m || m.loading) return h + '<p class="empty">Loading your lineages.</p>';
  if (m.err) return h + msg({ cls: 'bad', t: m.err }) + '<button type="button" class="lg-btn" data-act="reload">RETRY</button>';
  const ents = m.ents || [];
  const trs = m.tokens.map(t => {
    const mine = ents.filter(e => e.token_id === t.token_id);
    return `<tr><td><b>#${esc(t.token_id)}</b>${t.direct ? '<div class="muted">found by id</div>' : ''}</td><td>${t.model ? esc(t.model) : '<span class="muted">—</span>'}<div class="muted"><code>${esc(short(t.lineage_id))}</code></div></td><td>${t.status ? badge(t.status, t.status === 'active' ? 'ok' : 'n') : '—'}</td><td>${t.provenance ? provBadge(t.provenance) : '—'}</td>` +
      `<td class="lg-rep">${['performance_analysis', 'model_comparison', 'experiment_history', 'risk_metrics', 'inference_costs', 'decision_analysis', 'advanced_lineage_audit'].map(k => `<button type="button" class="lg-btn lg-sm${k === 'advanced_lineage_audit' ? ' lg-adv' : ''}" data-act="report" data-tid="${esc(t.token_id)}" data-key="${k}">${esc(k.replace(/_/g, ' '))}</button>`).join(' ')}</td></tr>`;
  });
  h += sec('league-mine', 'My lineages', (trs.length ? table(['Token', 'Lineage', 'Status', 'Source', 'Reports'], trs) : `<p class="empty">This wallet owns no league tokens that the indexer has seen yet.</p>`) +
    `<p class="muted lg-fine">The list comes from the indexer and can lag a new mint or transfer until its next sync. Ownership is always re-checked on chain before any report. A token you just received works immediately by id:</p>` +
    `<form class="lg-lookup" data-act="lookup"><label for="lg-tid">Token id</label> <input id="lg-tid" inputmode="numeric" pattern="[0-9]*" size="8" autocomplete="off"> <button type="submit" class="lg-btn lg-sm">OPEN</button></form>${msg(S.msg.lookup)}`);
  h += reportBox();
  const entRows = ents.map(e => `<tr><td>#${esc(e.id)}</td><td>#${esc(e.token_id)}</td><td>${esc(e.report_key.replace(/_/g, ' '))}</td><td>${e.state === 'claimed' ? badge('claimed', 'ok') + `<div class="muted">${esc(when(e.claimed_ts))}</div>` : badge('unclaimed', 'wait')}</td>` +
    `<td>${e.state === 'unused' ? `<button type="button" class="lg-btn lg-sm" data-act="claim" data-id="${esc(e.id)}"${S.w.busy ? ' disabled' : ''}>CLAIM</button>` : ''}</td></tr>`);
  h += sec('league-ents', 'Entitlements', (entRows.length ? table(['ID', 'Token', 'Report', 'State', ''], entRows) : '<p class="empty">No entitlements. They exist only for tokens minted strictly before a milestone’s cutoff; the set is computed once the indexer has passed that cutoff (state “pending index” until then).</p>') +
    (m.entErr ? msg({ cls: 'bad', t: m.entErr }) : '') + msg(S.msg.claim) + `<p class="muted lg-fine">An entitlement belongs to the token, not the wallet: if you transfer the token, the new owner holds its unused entitlements and you lose access.</p>`);
  return h;
}

function render() {
  if (root.hidden) return;
  const nav = $('#lg-nav');
  if (nav) nav.hidden = S.state !== 'live';
  if (nav) { nav.querySelectorAll('a').forEach(a => { const on = (a.dataset.v === 'mine') === (S.view.name === 'mine'); a.setAttribute('aria-current', on ? 'page' : 'false'); }); }
  const keepY = body.scrollTop, act = document.activeElement && document.activeElement.id;
  let h;
  if (S.state === 'loading') h = '<p class="empty">Loading.</p>';
  else if (S.state === 'disabled') h = soon();
  else if (S.state === 'unavailable') h = `<div class="lg-soon"><h3>Model Lineage League</h3><p>The league service is not reachable right now (${esc(S.why)}). Nothing was asked of your wallet.</p><button type="button" class="lg-btn" data-act="retry">RETRY</button></div>`;
  else {
    h = noticeBlock(S.cfg);
    if (S.view.name === 'mine') h += viewMine();
    else if (S.view.name === 'lineage') h += viewLineage() + (S.data.lin ? '' : '');
    else h += `<div class="ec-two">${walletBox()}<div class="ec-box"><h4>HOW IT WORKS</h4><ol class="lg-steps"><li>Pick a lineage and read its history.</li><li>Approve exactly the mint price, then mint.</li><li>Sign in with the wallet to open its stored reports.</li></ol><p class="muted lg-fine">Reports are deterministic summaries of stored paper-trading and research data. They are not signals, advice or predictions.</p></div></div>` + viewList();
  }
  body.innerHTML = h;
  if (act) { const e = document.getElementById(act); if (e && !e.disabled) e.focus({ preventScroll: true }); }
  body.scrollTop = keepY;
  const live = $('#lg-live'); if (live && S.tx) live.textContent = S.tx.label + ' ' + S.tx.state;
}

// ------------------------------------------------------------------ routing and events
function route() {
  const h = location.hash;
  if (!/^#league/.test(h)) return;
  if (root.hidden) open_(false);
  const m = h.match(/^#league\/lineage\/(.+)$/);
  if (m) { const id = decodeURIComponent(m[1]); if (S.view.name !== 'lineage' || S.view.id !== id) { S.view = { name: 'lineage', id }; if (S.state === 'live') loadLineage(id); } }
  else if (h === '#league/mine') { S.view = { name: 'mine' }; if (S.sess && !S.data.mine && S.state === 'live') loadMine(); }
  else S.view = { name: 'list' };
  render();
}
function open_(focus) {
  const e = $('#economy'); if (e && !e.hidden) $('#ec-close').click();
  const c = $('#circuits'); if (c && !c.hidden) $('#circ-close').click();
  const b = $('#benchmark'); if (b && !b.hidden) $('#bm-close').click();
  const hd = document.querySelector('header.top'); if (hd) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px';
  root.hidden = false; document.body.classList.add('lg-open');
  if (S.state === 'loading' || S.state === 'unavailable' || S.state === 'disabled') { S.state = 'loading'; render(); loadCfg().then(() => { if (S.state === 'live') { restoreReown(); silentRestore(); } if (S.state === 'live' && S.view.name === 'lineage') loadLineage(S.view.id); if (S.state === 'live' && S.view.name === 'mine' && S.sess) loadMine(); }); } else render();
  if (focus) root.focus();
}
function close_(noFocus) {
  root.hidden = true; document.body.classList.remove('lg-open');
  if (/^#league/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  if (!noFocus) { const l = $('#lg-link'); if (l) l.focus(); }
}
function setHash(h) { if (location.hash !== h) location.hash = h; else route(); }

body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t || t.tagName === 'FORM') return;
  const a = t.dataset.act;
  if (a === 'open') { e.preventDefault(); setHash('#league/lineage/' + encodeURIComponent(t.dataset.id)); }
  else if (a === 'list') { e.preventDefault(); setHash('#league'); }
  else if (a === 'connect') connect();
  else if (a === 'reown') connectReown();
  else if (a === 'switch') switchChain();
  else if (a === 'forget') disconnectWallet();
  else if (a === 'approve') doApprove();
  else if (a === 'mint') doMint(t.dataset.lid);
  else if (a === 'signin') signIn();
  else if (a === 'signout') signOut();
  else if (a === 'report') openReport(t.dataset.tid, t.dataset.key);
  else if (a === 'closereport') { S.data.report = null; render(); }
  else if (a === 'claim') claim(t.dataset.id);
  else if (a === 'reload') loadMine();
  else if (a === 'retry') { S.state = 'loading'; render(); loadCfg(); }
});
body.addEventListener('submit', (e) => { const f = e.target.closest('form[data-act="lookup"]'); if (!f) return; e.preventDefault(); lookupToken($('#lg-tid').value.trim()); });
$('#lg-nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); setHash(a.getAttribute('href')); });
$('#lg-link').addEventListener('click', (e) => { e.preventDefault(); if (!/^#league/.test(location.hash)) history.replaceState(null, '', '#league'); route(); if (root.hidden) open_(true); else root.focus(); });
['econ-link', 'circ-link', 'bm-link'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { if (!root.hidden) close_(true); }); });
$('#lg-close').addEventListener('click', () => close_());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close_(); });
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { const hd = document.querySelector('header.top'); if (hd && !root.hidden) root.style.top = Math.ceil(hd.getBoundingClientRect().bottom) + 'px'; });
route();
})();
