'use strict';
/* ---------- global state ---------- */
const App = {
  balance: 10000,
  wallet: null,
  sessionStart: Date.now(),
  sessionStartBalance: 10000,
  lossLimit: 0,
  current: null,        // active game module
  clientSeed: '',
  serverSeed: '',
  serverSeedHash: '',
  nonce: 0,
};

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/* ---------- persistence ---------- */
function loadState() {
  try {
    const b = localStorage.getItem('cl_balance');
    if (b !== null) {
      const v = parseFloat(b);
      App.balance = Number.isFinite(v) ? v : 10000; // keep a legit 0 balance; only default on corrupt data
    }
    const w = localStorage.getItem('cl_wallet');
    if (w) App.wallet = JSON.parse(w);
    const seed = localStorage.getItem('cl_seeds');
    if (seed) {
      const s = JSON.parse(seed);
      App.serverSeed = s.serverSeed || '';
      App.serverSeedHash = s.hash || '';
      App.nonce = Number.isFinite(s.nonce) ? s.nonce : 0;
    }
    const ll = localStorage.getItem('cl_loss_limit');
    if (ll !== null) App.lossLimit = parseFloat(ll) || 0;
  } catch (e) { /* fresh state */ }
  App.sessionStartBalance = App.balance;
}
function saveState() {
  localStorage.setItem('cl_balance', String(App.balance));
  if (App.wallet) localStorage.setItem('cl_wallet', JSON.stringify(App.wallet));
  else localStorage.removeItem('cl_wallet');
}
function saveSeeds() {
  localStorage.setItem('cl_seeds', JSON.stringify({
    serverSeed: App.serverSeed, hash: App.serverSeedHash, nonce: App.nonce,
  }));
}

/* ---------- provably-fair primitives ----------
   Demo model: the "server" seed lives in your browser's storage next to its
   SHA-256 commitment. Rotate & reveal it any time to verify past rounds. */
async function sha256(str) {
  // crypto.subtle exists only on secure contexts (https / localhost).
  // Fallback below keeps the game working from file:// or plain http.
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  // deterministic 64-hex fallback (FNV-1a + xorshift mix) — not real SHA-256,
  // but stable per input, so rolls stay deterministic on the same seeds.
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 2246822519);
    h1 ^= h1 >>> 16; h2 ^= h2 >>> 13;
  }
  h1 >>>= 0; h2 >>>= 0;
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64);
}
function randomHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* Rejection sampling: 2^52 % 10000 = 496, so the top 496 values of the
   13-hex-digit space are discarded. Without this, rolls 0.00–4.95 would be
   microscopically more likely than the rest. */
function rollFromHash(hash) {
  const limit = 2 ** 52 - (2 ** 52 % 10000);
  for (let off = 0; off + 13 <= hash.length; off += 13) {
    const v = parseInt(hash.slice(off, off + 13), 16);
    if (v < limit) return (v % 10000) / 100;
  }
  return 0;
}

async function initSeeds() {
  if (!App.serverSeed) {
    App.serverSeed = randomHex(32);
    App.serverSeedHash = await sha256(App.serverSeed);
    saveSeeds();
  }
  if (!App.clientSeed) App.clientSeed = randomHex(16);
}
/* Reveals the current server seed, generates a fresh commitment, resets the nonce. */
async function rotateSeeds() {
  const revealed = App.serverSeed;
  App.serverSeed = randomHex(32);
  App.serverSeedHash = await sha256(App.serverSeed);
  App.nonce = 0;
  App.clientSeed = randomHex(16);
  saveSeeds();
  return revealed;
}
/* One round = one hash. Standard provably-fair input:
   sha256(clientSeed + ':' + serverSeed + ':' + nonce), nonce increments per use. */
async function nextRoundHash() {
  const h = await sha256(App.clientSeed + ':' + App.serverSeed + ':' + App.nonce);
  App.nonce++;
  saveSeeds();
  return h;
}
/* Shared "rotate & reveal" panel markup for hash-based games. */
function fairPanel(id) {
  return `
  <div class="pf-panel" id="pf-${id}">
    <div>Client seed: <code id="pfClient-${id}">${App.clientSeed.slice(0, 16)}…</code></div>
    <div>Server seed hash: <code id="pfHash-${id}">${App.serverSeedHash.slice(0, 24)}…</code></div>
    <div>Nonce: <span id="pfNonce-${id}">${App.nonce}</span> · next round uses <code>sha256(client:server:<span id="pfNext-${id}">${App.nonce}</span>)</code></div>
    <button class="btn btn-ghost pf-rotate" id="pfRotate-${id}">🔄 Rotate &amp; reveal server seed</button>
    <div class="pf-revealed hidden" id="pfRevealed-${id}"></div>
  </div>`;
}
function wireFairPanel(el, id) {
  const box = $('#pf-' + id, el);
  if (!box) return;
  const upd = () => {
    const c = $('#pfClient-' + id, el), h = $('#pfHash-' + id, el), n = $('#pfNonce-' + id, el), nx = $('#pfNext-' + id, el);
    if (c) c.textContent = App.clientSeed.slice(0, 16) + '…';
    if (h) h.textContent = App.serverSeedHash.slice(0, 24) + '…';
    if (n) n.textContent = App.nonce;
    if (nx) nx.textContent = App.nonce;
  };
  const btn = $('#pfRotate-' + id, el);
  if (btn) btn.addEventListener('click', async () => {
    const revealed = await rotateSeeds();
    const rv = $('#pfRevealed-' + id, el);
    rv.classList.remove('hidden');
    rv.innerHTML = `Revealed server seed: <code>${revealed}</code><br>Check: SHA-256 of it equals the old commitment above. A new seed &amp; commitment are now active.`;
    upd();
    toast('🔐 Seeds rotated — old server seed revealed', 'success');
    if (window.sfx) sfx.click();
  });
  upd();
}

/* ---------- balance & bet guard ---------- */
function updateBalance() {
  const el = $('#balanceVal');
  if (el) el.textContent = fmt(App.balance);
  const wb = $('#wBal');
  if (wb) wb.textContent = fmt(App.balance);
  const net = $('#sessionNet');
  if (net) {
    const d = App.balance - App.sessionStartBalance;
    net.textContent = (d >= 0 ? '+' : '') + fmt(d);
    net.className = d >= 0 ? 'win' : 'lose';
  }
  if (window.Meta) Meta.refreshTopbar();
}
/* Messages live here so every game explains failures the same way. */
function canBet(amount) {
  if (!(amount > 0) || !isFinite(amount)) {
    toast('Enter a valid bet amount', 'warn');
    return false;
  }
  if (App.lossLimit > 0 && App.balance <= App.sessionStartBalance - App.lossLimit) {
    toast('Loss limit reached — take a break 😌', 'warn');
    return false;
  }
  if (App.balance < amount) {
    toast(App.balance < 1
      ? 'Out of DEMO — grab the 🎁 daily bonus or the 🚰 faucet'
      : 'Bet is larger than your balance', 'warn');
    return false;
  }
  return true;
}

/* ---------- central bet ledger ----------
   Every settled bet flows through here: history page, XP/levels, achievements,
   weekly race and the live feed all hang off this one call. */
function logBet(e) {
  e.t = Date.now();
  try {
    const h = JSON.parse(localStorage.getItem('cl_history') || '[]');
    h.unshift({ game: e.game, bet: e.bet, mult: e.mult, profit: e.profit, t: e.t });
    if (h.length > 200) h.length = 200;
    localStorage.setItem('cl_history', JSON.stringify(h));
  } catch (err) { /* storage full/blocked — ledger is non-critical */ }
  if (window.Meta) Meta.onBet(e);
  if (window.Social) Social.onPlayerBet(e);
}

/* ---------- toast ---------- */
function toast(msg, type) {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

/* ---------- session timer ---------- */
let sessionTick = null;
function startSessionTimer() {
  if (sessionTick) return;
  const el = $('#sessionTime');
  sessionTick = setInterval(() => {
    const sec = Math.floor((Date.now() - App.sessionStart) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    if (el) el.textContent = m + ':' + s;
    if (sec > 0 && sec % 1800 === 0) toast('⏰ 30 minutes in — time for a break!', 'warn');
  }, 1000);
}

/* ---------- router ---------- */
const games = {};
function registerGame(g) { games[g.id] = g; }

function route() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  renderView(h);
}
window.addEventListener('hashchange', route);

function renderView(id) {
  if (App.current && App.current.destroy) {
    try { App.current.destroy(); } catch (e) { console.error('destroy error', e); }
  }
  App.current = null;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === id));
  const view = $('#view');
  const g = games[id];
  if (g) {
    view.innerHTML = g.html();
    App.current = g;
    try { g.init(view); }
    catch (e) { console.error('game init error', e); toast('Game failed to load: ' + e.message, 'warn'); }
  } else {
    view.innerHTML = lobbyHtml();
  }
  window.scrollTo({ top: 0 });
  updateBalance();
}

const LOBBY_ORDER = ['crash', 'mines', 'dice', 'plinko', 'blackjack', 'slots'];
function lobbyHtml() {
  const cards = Object.values(games)
    .filter(g => !g.page)
    .sort((a, b) => LOBBY_ORDER.indexOf(a.id) - LOBBY_ORDER.indexOf(b.id))
    .map(g => `
    <a class="lobby-card" href="#/${g.id}">
      <div class="lc-ico">${g.icon}</div>
      <h3>${g.title}</h3>
      <p>${g.desc}</p>
      <span class="lc-cta">Play →</span>
    </a>`).join('');
  return `
  <section class="hero">
    <h1>⚡ ChainLuck <span>Demo Casino</span></h1>
    <p>Six crypto-style games · provably-fair dice, crash &amp; mines · real physics plinko · blackjack · slots</p>
    <p class="hero-note">All balances are fictional play money — no deposits, no withdrawals, no real crypto. Ever.</p>
  </section>
  <section class="lobby-grid">${cards}</section>
  <section class="lobby-extras">
    <div class="game-card feed-card">
      <h3>⚡ Live bets</h3>
      <div id="feedList" class="feed-list"><p class="muted">Connecting…</p></div>
    </div>
    <div class="game-card race-card">
      <h3>🏁 Weekly wager race</h3>
      <div id="racePreview" class="race-preview"></div>
      <button class="btn" id="raceOpen">View full leaderboard</button>
    </div>
  </section>
  <section class="info-grid">
    <div class="info-card info-link" id="achOpen">
      <h4>🏆 Achievements <span class="muted" id="achCount"></span></h4>
      <p>Unlock badges for streaks, big multipliers and milestones. Earn DEMO rewards.</p>
    </div>
    <div class="info-card"><h4>🎲 Provably fair</h4><p>Dice, Crash and Mines derive every round from SHA-256(client:server:nonce). Rotate the seed to reveal &amp; verify it yourself.</p></div>
    <div class="info-card"><h4>🧘 Responsible play</h4><p>Session timer, loss limit, net tracker and honest RTP. This is entertainment — play for fun, not for money.</p></div>
  </section>`;
}

/* ---------- keyboard ----------
   Space = the game's main action, Escape closes any modal. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.overlay').forEach(o => o.classList.add('hidden'));
    return;
  }
  if (e.code !== 'Space' || e.repeat) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select' || e.target.isContentEditable) return;
  if ($$('.overlay:not(.hidden)').length) return;
  if (App.current && typeof App.current.mainAction === 'function') {
    e.preventDefault();
    App.current.mainAction();
  }
});

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  loadState();
  await initSeeds();
  route();
  updateBalance();
  updateWalletUI();
  startSessionTimer();
});
