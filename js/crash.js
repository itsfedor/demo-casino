'use strict';
/* Crash — the multiplier tension game. Bet, watch the curve climb, cash out
   before it busts.
   Provably fair: crash point = f(sha256(client:server:nonce)) with a 1% edge:
     h = first 52 bits of the hash (1..2^52-1), treated as uniform u = h/2^52
     crash = floor(0.99 / u × 100) / 100, capped at 10,000×
   P(crash ≥ T) = 0.99/T exactly, so the EV of cashing out at ANY target is 0.99. */

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
  desc: 'Bet, watch the rocket climb, cash out before it busts.',
  phase: 'idle',     // idle | starting | running | crashed | cashed
  bet: 0,
  crashAt: 0,
  t0: 0,
  points: [],
  raf: null,
  lastTickMult: 1,
  hist: [],

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>🚀 Crash</h2>
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
        <canvas id="crCanvas" class="cr-canvas" width="460" height="300"></canvas>
        <button class="btn btn-big" id="crAction">🚀 Place bet &amp; launch</button>
        <div class="cr-result" id="crResult"></div>
      </div>
      <div class="game-card">
        <h3>Last crashes</h3>
        <div id="crHist" class="cr-hist"></div>
        <h3 style="margin-top:16px">How it works</h3>
        <ul class="rules">
          <li>Multiplier grows from 1.00× — cash out any time to win bet × multiplier</li>
          <li>Bust before you cash out and the bet is lost</li>
          <li>House edge 1% · max 10,000×</li>
          <li>Every round is derived from a revealed-able SHA-256 seed</li>
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
    this.canvas.width = 460 * dpr; this.canvas.height = 300 * dpr;
    this.ctx.scale(dpr, dpr);
    this.phase = 'idle';
    this.points = [];
    try { this.hist = JSON.parse(localStorage.getItem('cl_crash_hist') || '[]'); } catch (e) { this.hist = []; }
    this.renderHist();
    wireFairPanel(el, 'crash');
    this.actionBtn.addEventListener('click', () => this.mainAction());
    $$('.qbtn', el).forEach(b => b.addEventListener('click', () => { this.betIn.value = b.dataset.v; }));
    this.draw();
  },

  destroy() {
    // Leaving mid-round with a live bet: refund it and cancel the round.
    if ((this.phase === 'starting' || this.phase === 'running') && this.bet > 0) {
      App.balance += this.bet;
      saveState();
      updateBalance();
      toast('Round cancelled — bet refunded');
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.phase = 'idle';
  },

  mainAction() {
    if (this.phase === 'idle' || this.phase === 'crashed' || this.phase === 'cashed') this.placeBet();
    else if (this.phase === 'running') this.cashOut();
  },

  async placeBet() {
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) return;
    this.bet = bet;
    App.balance -= bet;
    saveState();
    updateBalance();
    this.resultEl.innerHTML = '';
    this.actionBtn.disabled = true;
    if (window.sfx) sfx.bet();

    this.roundHash = await nextRoundHash();
    wireFairPanel(this.el, 'crash'); // refresh nonce display
    this.crashAt = CRASH.fromHash(this.roundHash);

    this.phase = 'starting';
    this.actionBtn.disabled = false;
    this.actionBtn.textContent = '🚀 Launching…';
    for (let i = 3; i > 0; i--) {
      this.resultEl.innerHTML = `<span class="muted">Launching in ${i}…</span>`;
      if (window.sfx) sfx.tick(0.2);
      await sleep(450);
    }
    if (this.phase !== 'starting') return; // destroyed while counting down
    this.phase = 'running';
    this.t0 = performance.now();
    this.points = [{ x: 0, y: 1 }];
    this.lastTickMult = 1;
    this.lastTickAt = 0;
    this.actionBtn.textContent = '💰 Cash out —';
    this.actionBtn.classList.add('cash');
  },

  liveMult() { return CRASH.multAt(performance.now() - this.t0); },

  cashOut(atMult) {
    if (this.phase !== 'running') return;
    // a manual click can land in the same frame the rocket busts — never pay at/after the crash point
    if (!atMult && this.liveMult() >= this.crashAt) { this.bust(); return; }
    const m = Math.min(atMult || this.liveMult(), this.crashAt);
    const ret = this.bet * m;
    const profit = ret - this.bet;
    App.balance += ret;
    saveState();
    updateBalance();
    this.phase = 'cashed';
    this.pushHist(this.crashAt);
    this.resultEl.innerHTML = `<span class="win">CASHED ${m.toFixed(2)}× · +${fmt(profit)} DEMO</span>`;
    this.actionBtn.textContent = '🚀 Place bet & launch';
    this.actionBtn.classList.remove('cash');
    this.endRound(m, profit);
    if (window.sfx) sfx.cash();
  },

  bust() {
    this.phase = 'crashed';
    this.pushHist(this.crashAt);
    this.resultEl.innerHTML = `<span class="lose">💥 BUSTED at ${this.crashAt.toFixed(2)}× · −${fmt(this.bet)} DEMO</span>`;
    this.actionBtn.textContent = '🚀 Place bet & launch';
    this.actionBtn.classList.remove('cash');
    this.endRound(0, -this.bet);
    if (window.sfx) sfx.bust();
  },

  endRound(mult, profit) {
    logBet({ game: 'crash', bet: this.bet, mult, profit });
    if (window.sfx && profit > 0 && mult < 10) sfx.win();
    setTimeout(() => {
      if (this.phase === 'crashed' || this.phase === 'cashed') this.phase = 'idle';
    }, 400);
  },

  pushHist(v) {
    this.hist.unshift(v);
    if (this.hist.length > 14) this.hist.length = 14;
    try { localStorage.setItem('cl_crash_hist', JSON.stringify(this.hist)); } catch (e) { /* blocked */ }
    this.renderHist();
  },
  renderHist() {
    const el = $('#crHist', this.el);
    if (!el) return;
    el.innerHTML = this.hist.map(v =>
      `<span class="cr-chip ${v >= 10 ? 'hi' : v >= 2 ? 'mid' : 'lo'}">${v.toFixed(2)}×</span>`).join('')
      || '<p class="muted">No rounds yet</p>';
  },

  /* ---------- rendering ---------- */
  draw() {
    const ctx = this.ctx, W = 460, H = 300;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101a30'); g.addColorStop(1, '#0a0e17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (this.phase === 'running') {
      const el = performance.now() - this.t0;
      const m = this.liveMult();
      if (m >= this.crashAt) { this.bust(); return; }

      const auto = parseFloat(this.autoIn.value);
      if (auto >= 1.01 && m >= auto) { this.cashOut(auto); return; }

      // rising tick, pitch climbs with the multiplier
      const now = performance.now();
      if (m - this.lastTickMult >= 0.1 || now - this.lastTickAt >= 600) {
        this.lastTickMult = m;
        this.lastTickAt = now;
        if (window.sfx) sfx.tick(Math.min(1, (m - 1) / 9));
      }

      this.points.push({ x: el, y: m });
      this.actionBtn.textContent = `💰 Cash out ${m.toFixed(2)}×`;

      const xMax = Math.max(8000, el * 1.15);
      const yMax = Math.max(2, m * 1.25);
      const px = t => 40 + (t / xMax) * (W - 60);
      const py = v => H - 34 - ((v - 1) / (yMax - 1)) * (H - 70);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.fillStyle = 'rgba(139,150,171,0.7)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      for (let gv = 1; gv <= 4; gv++) {
        const v = 1 + (yMax - 1) * gv / 4;
        const y = py(v);
        ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 20, y); ctx.stroke();
        ctx.fillText(v.toFixed(1) + '×', 4, y + 3);
      }
      const secLine = Math.max(1, Math.round(xMax / 5000));
      ctx.textAlign = 'center';
      for (let s = secLine; s * 5000 < xMax; s += secLine) {
        const x = px(s * 5000);
        ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, H - 34); ctx.stroke();
        ctx.fillText(s * 5 + 's', x, H - 20);
      }

      // curve
      const col = m >= 2 ? '#ffd54a' : '#22d3ee';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(px(0), py(1));
      let prev = 0;
      for (const p of this.points) {
        if (p.x - prev < 16) continue; // decimate for stroke perf
        prev = p.x;
        ctx.lineTo(px(p.x), py(p.y));
      }
      ctx.lineTo(px(el), py(m));
      ctx.stroke();
      ctx.shadowBlur = 0;

      // rocket head
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px(el), py(m), 5, 0, 6.2832);
      ctx.fill();
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(m.toFixed(2) + '×', W / 2, 52);
    } else if (this.phase === 'crashed') {
      this.drawIdle('#f87171', `💥 ${this.crashAt.toFixed(2)}×`);
    } else if (this.phase === 'cashed') {
      this.drawIdle('#4ade80', this.resultEl.textContent || '');
    } else {
      this.drawIdle('#22d3ee', 'Place a bet to launch 🚀');
    }

    this.raf = requestAnimationFrame(() => this.draw());
  },

  drawIdle(color, text) {
    const ctx = this.ctx, W = 460, H = 300;
    // faint resting curve
    ctx.strokeStyle = 'rgba(34,211,238,0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, H - 34);
    ctx.quadraticCurveTo(W * 0.55, H - 60, W - 20, 26);
    ctx.stroke();
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillText(text.slice(0, 34), W / 2, H / 2 - 6);
    ctx.shadowBlur = 0;
  },
};
registerGame(crashGame);
