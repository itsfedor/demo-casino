'use strict';
/* Crash — Aviator-style. Continuous round loop:
   betting window (draining bar, riders join) → flight (plane + curve +
   engine hum, riders cash out live) → FLEW AWAY (2.6s) → repeat.
   Betting for the next round can be queued mid-flight (cancelable).

   Provably fair: each round's hash sha256(client:server:nonce) is computed
   during the betting window; crash = floor(0.99/u · 100)/100 from 52 bits,
   so P(crash ≥ T) = 0.99/T — 99% RTP at every cash-out target.

   Stability contract (learned the hard way):
   - the render loop ALWAYS schedules its next frame (try/catch, reschedule
     outside the try) — one bad frame can never freeze the game;
   - the round hash is precomputed while betting, so flight starts with a
     synchronous state flip — no async window where a double click can
     double-debit;
   - every async callback carries a roundId token and is ignored if the round
     has moved on. */

const CRASH = {
  GROWTH: 0.00007,        // m(t) = e^(GROWTH·ms) → ×2 at ~9.9s, ×10 at ~33s
  CAP: 10000,
  fromHash(hash) {
    const h = parseInt(hash.slice(0, 13), 16) || 1; // 1 .. 2^52-1
    const E = 2 ** 52;
    // floor(100 × 0.99·E/h) / 100 — two-decimal crash point
    return Math.min(this.CAP, Math.floor(99 * E / h) / 100);
  },
  multAt(ms) { return Math.exp(this.GROWTH * ms); },
};

const crashGame = {
  id: 'crash',
  title: 'Crash',
  icon: '🚀',
  desc: 'Bet, watch the plane climb, cash out before it flies away.',

  BETTING_MS: 6000,
  SETTLE_MS: 2600,
  W: 460, H: 320,

  phase: 'idle',         // idle | betting | flight | crashed
  roundId: 0,
  phaseT0: 0,
  pendingHash: null,
  crashAt: 0,
  t0: 0,
  points: [],
  bet: 0,
  betLive: false,        // wagered in the current/just-finished round
  cashed: false,
  cashMult: 0,
  queued: false,         // wagered for the NEXT round
  riders: [],
  hist: [],
  raf: null,
  machine: null,
  flashT0: 0,
  lastMilestone: 1,
  lastRidersRender: 0,
  stars: [],
  exhaust: [],

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>🚀 Crash</h2>
        <div class="cr-histstrip" id="crHist" aria-label="last crash rounds"></div>
        <canvas id="crCanvas" class="cr-canvas" width="460" height="320"></canvas>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="crBet" class="num-in" value="100" min="1" step="1">
          <div class="quick-bets">
            ${[10, 50, 100, 500, 1000].map(v => `<button class="qbtn" data-v="${v}">${v}</button>`).join('')}
          </div>
        </div>
        <div class="bet-row">
          <label>Auto cash-out at (×) — leave blank for manual</label>
          <input type="number" id="crAuto" class="num-in" placeholder="e.g. 2.00" min="1.01" step="0.01">
        </div>
        <button class="btn btn-big bet-green" id="crAction">💵 Place bet</button>
        <div class="cr-result" id="crResult" aria-live="polite"></div>
      </div>
      <div class="game-card">
        <h3>Round bets · <span id="crRiderCount">0</span> players</h3>
        <div class="cr-riders" id="crRiders"></div>
        <h3 style="margin-top:16px">How it works</h3>
        <ul class="rules">
          <li>Multiplier grows from 1.00× — cash out any time to win bet × multiplier</li>
          <li>Fly away before you cash out and the bet is lost</li>
          <li>House edge 1% · max 10,000× · rounds are independent</li>
          <li>Bet during a flight to queue for the next round</li>
        </ul>
        ${fairPanel('crash')}
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.betIn = $('#crBet', el);
    this.autoIn = $('#crAuto', el);
    this.actionBtn = $('#crAction', el);
    this.resultEl = $('#crResult', el);
    this.canvas = $('#crCanvas', el);
    this.ctx = this.canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.ctx.scale(dpr, dpr);
    this.exhaust = [];
    this.stars = [];
    for (let i = 0; i < 42; i++) {
      this.stars.push({ x: Math.random() * this.W, y: Math.random() * this.H, z: 0.3 + Math.random() * 0.7 });
    }
    try { this.hist = JSON.parse(localStorage.getItem('cl_crash_hist') || '[]'); } catch (e) { this.hist = []; }

    this.actionBtn.addEventListener('click', () => this.mainAction());
    $$('.qbtn', el).forEach(b => b.addEventListener('click', () => { this.betIn.value = b.dataset.v; }));
    wireFairPanel(el, 'crash');
    this.renderHist();
    this.startBetting();
    // Timer-driven state machine (logic), rAF for rendering only. rAF halts
    // in hidden/occluded tabs — the machine keeps rounds honest at ~1 Hz even
    // then, and rendering catches up on return.
    this.machine = setInterval(() => {
      try { this.stepMachine(); }
      catch (e) { console.error('crash machine error', e); }
    }, 400);
    this.loop();
  },

  destroy() {
    // invalidate this round's async callbacks, kill audio, refund live bets
    this.roundId++;
    if (this.machine) { clearInterval(this.machine); this.machine = null; }
    if (window.sfx) sfx.engineStop();
    let refunded = false;
    if (this.betLive && !this.cashed && this.bet > 0) { App.balance += this.bet; refunded = true; }
    if (this.queued && this.bet > 0 && !(this.betLive && !this.cashed)) { App.balance += this.bet; refunded = true; }
    if (refunded) {
      saveState();
      updateBalance();
      toast('Round cancelled — bet refunded');
    }
    this.betLive = false;
    this.queued = false;
    this.phase = 'idle';
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  },

  mainAction() {
    if (this.phase === 'flight' && this.betLive && !this.cashed) this.cashOut();
    else this.placeOrCancel();
  },

  /* ---------- betting / queueing (synchronous state flips only) ---------- */
  placeOrCancel() {
    if (this.phase === 'betting') {
      if (this.betLive) {           // cancel this round's bet
        App.balance += this.bet;
        saveState(); updateBalance();
        this.betLive = false;
        toast('Bet cancelled — refunded');
        if (window.sfx) sfx.click();
      } else {                       // bet this round
        const bet = parseFloat(this.betIn.value);
        if (!canBet(bet)) return;
        this.bet = bet;
        App.balance -= bet;
        this.betLive = true;
        saveState(); updateBalance();
        if (window.sfx) sfx.bet();
      }
    } else {                         // flight or crashed: queue for next round
      if (this.queued) {
        App.balance += this.bet;
        saveState(); updateBalance();
        this.queued = false;
        toast('Queued bet cancelled — refunded');
        if (window.sfx) sfx.click();
      } else {
        const bet = parseFloat(this.betIn.value);
        if (!canBet(bet)) return;
        this.bet = bet;
        App.balance -= bet;
        this.queued = true;
        saveState(); updateBalance();
        toast('Bet accepted — in play after this flight ✈️');
        if (window.sfx) sfx.bet();
      }
    }
    this.updateButton();
    this.renderRiders();
  },

  cashOut(atMult) {
    if (this.phase !== 'flight' || !this.betLive || this.cashed) return;
    let m;
    if (atMult) {
      m = Math.min(atMult, this.crashAt);
    } else {
      // a manual click can land in the same frame the plane flies away — never pay at/after the crash
      if (this.liveMult() >= this.crashAt) { this.flewAway(); return; }
      m = this.liveMult();
    }
    const ret = this.bet * m;
    const profit = ret - this.bet;
    App.balance += ret;
    this.cashed = true;
    this.cashMult = m;
    saveState(); updateBalance();
    this.resultEl.innerHTML = `<span class="win">CASHED ${m.toFixed(2)}× · +${fmt(profit)} DEMO</span>`;
    logBet({ game: 'crash', bet: this.bet, mult: m, profit });
    if (window.sfx) sfx.cash();
    this.updateButton();
    this.renderRiders();
  },

  /* ---------- round machine ----------
     Single source of truth for phase transitions + game logic. Runs on a
     timer (hidden-tab safe); the render loop mirrors the same checks for
     frame-accurate response while visible — every transition is phase-guarded
     so double firing is harmless. */
  stepMachine() {
    const now = performance.now();
    if (this.phase === 'betting') {
      if (now - this.phaseT0 >= this.BETTING_MS && this.pendingHash) this.startFlight();
    } else if (this.phase === 'flight') {
      const m = this.liveMult();
      for (const r of this.riders) {
        if (r.state === 'in' && m >= r.target) r.state = 'cashed';
      }
      const auto = parseFloat(this.autoIn && this.autoIn.value);
      if (this.betLive && !this.cashed && auto >= 1.01 && m >= auto) this.cashOut(Math.min(auto, this.crashAt));
      if (m >= this.crashAt) this.flewAway();
    } else if (this.phase === 'crashed') {
      if (now - this.phaseT0 >= this.SETTLE_MS) this.startBetting();
    }
  },

  async startBetting() {
    if (this.phase !== 'crashed' && this.phase !== 'idle') return;
    const rid = ++this.roundId;
    this.phase = 'betting';
    this.phaseT0 = performance.now();
    this.pendingHash = null;
    this.crashAt = 0;
    this.points = [{ x: 0, y: 1 }];
    this.exhaust = [];
    this.lastMilestone = 1;
    this.resultEl.innerHTML = '';
    if (this.queued) { this.betLive = true; this.queued = false; }
    else { this.betLive = false; }
    this.cashed = false;
    this.cashMult = 0;
    this.makeRiders();
    this.renderRiders();
    this.updateButton();
    // precompute the round hash while bets come in — flight then starts
    // with a purely synchronous state flip
    try {
      const h = await nextRoundHash();
      if (this.roundId === rid) {
        this.pendingHash = h;
        refreshFairPanel(this.el, 'crash');
      }
    } catch (e) { console.error('hash failed', e); }
  },

  startFlight() {
    if (this.phase !== 'betting' || !this.pendingHash) return; // hash not ready (practically never)
    this.phase = 'flight';
    this.t0 = performance.now();
    this.phaseT0 = this.t0;
    this.crashAt = CRASH.fromHash(this.pendingHash);
    this.pendingHash = null;
    this.points = [{ x: 0, y: 1 }];
    this.lastMilestone = 1;
    for (const r of this.riders) if (r.state === 'pending') r.state = 'in';
    this.updateButton();
    this.renderRiders();
    if (window.sfx) { sfx.takeoff(); sfx.engineStart(); }
  },

  flewAway() {
    if (this.phase !== 'flight') return;
    this.phase = 'crashed';
    this.phaseT0 = performance.now();
    this.flashT0 = this.phaseT0;
    if (window.sfx) sfx.flyaway(); // includes engineStop()
    for (const r of this.riders) if (r.state === 'in' || r.state === 'pending') r.state = 'lost';
    if (this.betLive && !this.cashed) {
      this.resultEl.innerHTML = `<span class="lose">FLEW AWAY ${this.crashAt.toFixed(2)}× · −${fmt(this.bet)} DEMO</span>`;
      logBet({ game: 'crash', bet: this.bet, mult: 0, profit: -this.bet });
    } else {
      this.resultEl.innerHTML = `<span class="muted">FLEW AWAY ${this.crashAt.toFixed(2)}×</span>`;
    }
    this.pushHist(this.crashAt);
    this.updateButton();
    this.renderRiders();
  },

  liveMult() { return CRASH.multAt(performance.now() - this.t0); },

  /* ---------- simulated riders (social layer) ---------- */
  makeRiders() {
    const names = (typeof Social !== 'undefined' && Social.NAMES) ? Social.NAMES : ['player'];
    const n = 8 + Math.floor(Math.random() * 7); // 8–14 riders
    const riders = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const target = r < 0.75
        ? 1.05 + Math.pow(Math.random(), 2.2) * 6   // most cash low
        : 4 + Math.random() * 30;                    // a few ride high
      riders.push({
        name: names[(Math.random() * names.length) | 0],
        bet: Math.round(Math.exp(Math.random() * 5.2) * 8 + 10),
        target: Math.round(target * 100) / 100,
        joinAt: Math.random() * this.BETTING_MS * 0.75,
        state: 'pending', // pending → in → cashed | lost
      });
    }
    this.riders = riders;
  },

  renderRiders() {
    const list = $('#crRiders', this.el);
    if (!list) return;
    const elapsed = this.phase === 'betting' ? performance.now() - this.phaseT0 : Infinity;
    const visible = this.riders.filter(r => r.state !== 'pending' || r.joinAt <= elapsed);
    const count = visible.length + (this.betLive || this.queued ? 1 : 0);
    const cnt = $('#crRiderCount', this.el);
    if (cnt) cnt.textContent = count;

    const you = this.betLive || this.queued
      ? `<div class="cr-rider you ${this.cashed ? 'cashed' : ''}">
          <span class="cr-r-name">⭐ You</span>
          <span class="cr-r-bet">${fmt(this.bet)}</span>
          <span class="cr-r-mult ${this.cashed ? 'win' : ''}">${this.cashed ? this.cashMult.toFixed(2) + '×' : this.phase === 'flight' && this.betLive ? '✈️' : '…'}</span>
          <span class="cr-r-win ${this.cashed ? 'win' : 'muted'}">${this.cashed ? '+' + fmt(this.bet * this.cashMult - this.bet) : '—'}</span>
        </div>`
      : '';
    list.innerHTML = you + visible.map(r => {
      const cashed = r.state === 'cashed';
      return `<div class="cr-rider ${cashed ? 'cashed' : ''}">
        <span class="cr-r-name">${r.name}</span>
        <span class="cr-r-bet">${fmt(r.bet)}</span>
        <span class="cr-r-mult ${cashed ? 'win' : ''}">${cashed ? r.target.toFixed(2) + '×' : this.phase === 'flight' ? '✈️' : '…'}</span>
        <span class="cr-r-win ${cashed ? 'win' : r.state === 'lost' ? 'lose' : 'muted'}">${cashed ? '+' + fmt(r.bet * r.target - r.bet) : r.state === 'lost' ? '−' + fmt(r.bet) : '—'}</span>
      </div>`;
    }).join('');
  },

  pushHist(v) {
    this.hist.unshift(v);
    if (this.hist.length > 20) this.hist.length = 20;
    try { localStorage.setItem('cl_crash_hist', JSON.stringify(this.hist)); } catch (e) { /* blocked */ }
    this.renderHist();
  },
  renderHist() {
    const el = $('#crHist', this.el);
    if (!el) return;
    el.innerHTML = this.hist.map(v =>
      `<span class="cr-hist ${v >= 10 ? 'hi' : v >= 2 ? 'mid' : 'lo'}">${v.toFixed(2)}×</span>`).join('');
  },

  updateButton() {
    const b = this.actionBtn;
    b.classList.remove('cash', 'bet-green', 'cancel');
    if (this.phase === 'betting') {
      if (this.betLive) { b.textContent = '✖ Cancel bet'; b.classList.add('cancel'); }
      else { b.textContent = '💵 Place bet'; b.classList.add('bet-green'); }
    } else if (this.phase === 'flight' && this.betLive && !this.cashed) {
      b.classList.add('cash'); // text updated live every frame
    } else if (this.queued) {
      b.textContent = '✖ Cancel queued bet';
      b.classList.add('cancel');
    } else {
      b.textContent = '💵 Bet next round';
      b.classList.add('bet-green');
    }
  },

  /* ---------- render loop (always reschedules) ---------- */
  loop() {
    try {
      this.drawFrame();
    } catch (e) {
      console.error('crash frame error', e);
    }
    this.raf = requestAnimationFrame(() => this.loop());
  },

  drawFrame() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const now = performance.now();

    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1526');
    g.addColorStop(1, '#080b12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (this.phase === 'betting') {
      const elapsed = now - this.phaseT0;
      // reveal riders as they "join"
      if (now - this.lastRidersRender > 250) { this.lastRidersRender = now; this.renderRiders(); }
      this.drawWaiting(elapsed);
    } else if (this.phase === 'flight') {
      const m = this.liveMult();
      // frame-accurate mirrors of the machine's checks (all phase-guarded)
      let ridersChanged = false;
      for (const r of this.riders) {
        if (r.state === 'in' && m >= r.target) { r.state = 'cashed'; ridersChanged = true; }
      }
      const auto = parseFloat(this.autoIn.value);
      if (this.betLive && !this.cashed && auto >= 1.01 && m >= auto) this.cashOut(Math.min(auto, this.crashAt));
      if (m >= this.crashAt) { this.flewAway(); this.drawCrashed(); return; }
      this.stepFlight(m, now, ridersChanged);
    } else { // crashed
      this.drawCrashed();
    }

    // crash flash
    if (this.flashT0 && now - this.flashT0 < 400) {
      ctx.fillStyle = `rgba(248,113,113,${(0.28 * (1 - (now - this.flashT0) / 400)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  },

  drawStars(speed) {
    const ctx = this.ctx, W = this.W, H = this.H;
    for (const s of this.stars) {
      s.x -= (0.06 + s.z * 0.35) * speed;
      s.y += 0.02 * speed;
      if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
      if (s.y > H + 2) s.y = -2;
      ctx.fillStyle = `rgba(148,163,184,${(0.25 + s.z * 0.45).toFixed(2)})`;
      ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2);
    }
  },

  drawWaiting(elapsed) {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.drawStars(1);
    // parked plane bobbing on the "runway"
    const bob = Math.sin(performance.now() / 380) * 2;
    this.drawPlane(ctx, 52, H - 58 + bob, -0.06);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillText('WAITING FOR NEXT ROUND', W / 2, H / 2 - 46);
    // spinning propeller
    const cx = W / 2, cy = H / 2 - 14, spin = performance.now() / 40;
    ctx.strokeStyle = 'rgba(226,232,240,0.85)';
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      const a = spin + k * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16);
      ctx.lineTo(cx - Math.cos(a) * 16, cy - Math.sin(a) * 16);
      ctx.stroke();
    }
    // draining countdown bar (no digits — the drain is the tension)
    const remain = clamp(1 - elapsed / this.BETTING_MS, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(W / 2 - 110, H / 2 + 26, 220, 6);
    ctx.fillStyle = remain < 0.25 ? '#f87171' : '#22d3ee';
    ctx.fillRect(W / 2 - 110, H / 2 + 26, 220 * remain, 6);
  },

  stepFlight(m, now, ridersChanged) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const el = now - this.t0;

    // engine pitch creeps up with the climb
    if (window.sfx) sfx.engineSet(clamp(Math.log2(m) / 7, 0, 1));

    // milestone ticks
    for (const ms of [2, 5, 10, 50, 100, 1000]) {
      if (m >= ms && this.lastMilestone < ms) {
        this.lastMilestone = ms;
        if (window.sfx) sfx.tick(0.85);
      }
    }

    this.points.push({ x: el, y: m });
    // live payout on the button
    if (this.betLive && !this.cashed) {
      this.actionBtn.textContent = `💰 Cash out ${fmt(this.bet * m)} (${m.toFixed(2)}×)`;
    }
    if (ridersChanged) this.renderRiders();

    // world speed sells the climb
    this.drawStars(1 + Math.log2(m) * 1.6);

    // axes
    const xMax = Math.max(8000, el * 1.15);
    const yMax = Math.max(2, m * 1.25);
    const px = t => 40 + (t / xMax) * (W - 60);
    const py = v => H - 30 - ((v - 1) / (yMax - 1)) * (H - 64);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.fillStyle = 'rgba(139,150,171,0.65)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let gv = 1; gv <= 4; gv++) {
      const v = 1 + (yMax - 1) * gv / 4;
      const y = py(v);
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 20, y); ctx.stroke();
      ctx.fillText(v.toFixed(1) + '×', 4, y + 3);
    }
    ctx.textAlign = 'center';
    const secStep = Math.max(1, Math.round(xMax / 5000));
    for (let s = secStep; s * 5000 < xMax; s += secStep) {
      const x = px(s * 5000);
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, H - 30); ctx.stroke();
      ctx.fillText(s * 5 + 's', x, H - 16);
    }

    // curve path + area fill below it
    const pts = [];
    let prevX = -1e9;
    for (const p of this.points) {
      if (p.x - prevX < 14) continue; // decimate for stroke perf
      prevX = p.x;
      pts.push(p);
    }
    const hx = px(el), hy = py(m);
    const col = m >= 2 ? '#ffd54a' : '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(px(0), py(1));
    for (const p of pts) ctx.lineTo(px(p.x), py(p.y));
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineTo(hx, py(1));
    ctx.lineTo(px(0), py(1));
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, py(1), 0, hy);
    fill.addColorStop(0, 'rgba(245,158,11,0.02)');
    fill.addColorStop(1, 'rgba(245,158,11,0.22)');
    ctx.fillStyle = fill;
    ctx.fill();

    // exhaust particles behind the plane
    const ang = this.planeAngle(px, py, el, m);
    this.spawnExhaust(hx, hy, ang);
    this.stepExhaust(ctx);

    this.drawPlane(ctx, hx, hy, ang);

    // big multiplier readout
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.fillText(m.toFixed(2) + '×', W / 2, 54);
    ctx.shadowBlur = 0;
  },

  planeAngle(px, py, el, m) {
    // slope of the curve just behind the head
    const back = Math.max(0, el - 350);
    const y1 = py(CRASH.multAt(back));
    const y2 = py(m);
    return Math.atan2(y1 - y2, px(el) - px(back));
  },

  spawnExhaust(x, y, ang) {
    const tailX = x - Math.cos(ang) * 16;
    const tailY = y - Math.sin(ang) * 16;
    for (let i = 0; i < 2; i++) {
      this.exhaust.push({
        x: tailX + (Math.random() - 0.5) * 4,
        y: tailY + (Math.random() - 0.5) * 4,
        vx: -Math.cos(ang) * (0.8 + Math.random()) - 0.4,
        vy: -Math.sin(ang) * (0.8 + Math.random()) + 0.25,
        life: 1,
      });
    }
    if (this.exhaust.length > 70) this.exhaust.splice(0, this.exhaust.length - 70);
  },
  stepExhaust(ctx) {
    this.exhaust = this.exhaust.filter(p => p.life > 0);
    for (const p of this.exhaust) {
      p.x += p.vx; p.y += p.vy; p.life -= 0.03;
      ctx.fillStyle = `rgba(251,146,60,${(p.life * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5 + (1 - p.life) * 3, 0, 6.2832);
      ctx.fill();
    }
  },

  drawPlane(ctx, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // fuselage
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.quadraticCurveTo(10, -7, -6, -6);
    ctx.lineTo(-14, -3);
    ctx.lineTo(-14, 3);
    ctx.lineTo(-6, 6);
    ctx.quadraticCurveTo(10, 7, 16, 0);
    ctx.fill();
    // tail fin
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(-15, -14);
    ctx.lineTo(-12, -4);
    ctx.closePath();
    ctx.fill();
    // wing
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.moveTo(3, 2);
    ctx.lineTo(-6, 15);
    ctx.lineTo(-1, 15);
    ctx.lineTo(7, 2);
    ctx.closePath();
    ctx.fill();
    // cockpit
    ctx.fillStyle = '#bfdbfe';
    ctx.beginPath();
    ctx.ellipse(7, -2.5, 4, 2.5, 0, 0, 6.2832);
    ctx.fill();
    // spinning propeller blur
    const spin = Math.sin(performance.now() / 24);
    ctx.strokeStyle = 'rgba(226,232,240,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, spin * 9);
    ctx.lineTo(18, -spin * 9);
    ctx.stroke();
    ctx.restore();
  },

  drawCrashed() {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.drawStars(0.6);
    // frozen curve in red
    if (this.points.length > 1) {
      const el = this.points[this.points.length - 1].x;
      const m = this.crashAt;
      const xMax = Math.max(8000, el * 1.15);
      const yMax = Math.max(2, m * 1.25);
      const px = t => 40 + (t / xMax) * (W - 60);
      const py = v => H - 30 - ((v - 1) / (yMax - 1)) * (H - 64);
      ctx.beginPath();
      ctx.moveTo(px(0), py(1));
      let prevX = -1e9;
      for (const p of this.points) {
        if (p.x - prevX < 14) continue;
        prevX = p.x;
        ctx.lineTo(px(p.x), py(p.y));
      }
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#f87171';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f87171';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText('FLEW AWAY!', W / 2, H / 2 - 14);
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.shadowColor = '#f87171';
    ctx.shadowBlur = 16;
    ctx.fillText(this.crashAt.toFixed(2) + '×', W / 2, H / 2 + 24);
    ctx.shadowBlur = 0;
  },
};
registerGame(crashGame);
