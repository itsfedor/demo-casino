'use strict';
/* Plinko — canvas physics ball drop. 12 rows of pegs, 13 payout slots, 3 risk levels. */

const plinkoGame = {
  id: 'plinko',
  title: 'Plinko',
  icon: '🔺',
  desc: 'Drop the ball through the peg field and chase the multipliers.',
  MULT: {
    low:  [0.5, 0.7, 1.0, 1.4, 2.0, 2.8, 4.0, 2.8, 2.0, 1.4, 1.0, 0.7, 0.5],
    med:  [0.3, 0.5, 0.8, 1.3, 2.0, 3.5, 6.0, 3.5, 2.0, 1.3, 0.8, 0.5, 0.3],
    high: [0.2, 0.4, 0.7, 1.2, 2.4, 5.0, 12.0, 5.0, 2.4, 1.2, 0.7, 0.4, 0.2],
  },
  ROWS: 12,
  W: 460, H: 560,
  balls: [],
  raf: null,
  risk: 'med',
  busy: false,
  lastSlot: -1,

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>🔺 Plinko</h2>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="pkBet" class="num-in" value="100" min="1" step="1">
        </div>
        <div class="bet-row">
          <label>Risk</label>
          <div class="mode-toggle">
            <button class="seg" data-risk="low">Low</button>
            <button class="seg active" data-risk="med">Medium</button>
            <button class="seg" data-risk="high">High</button>
          </div>
        </div>
        <button class="btn btn-big" id="pkDrop">🔻 Drop ball</button>
        <canvas id="pkCanvas" class="pk-canvas"></canvas>
        <div class="pk-result" id="pkResult"></div>
      </div>
      <div class="game-card">
        <h3>Payouts</h3>
        <div id="pkTable" class="pk-table"></div>
        <p class="muted" style="margin-top:10px;font-size:12.5px">Multipliers apply to your bet. A drop below 1.00× loses part of the bet — that is the house edge.</p>
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.canvas = $('#pkCanvas', el);
    this.ctx = this.canvas.getContext('2d');
    this.dropBtn = $('#pkDrop', el);
    this.resultEl = $('#pkResult', el);
    this.risk = 'med';
    this.balls = [];
    this.busy = false;
    this.lastSlot = -1;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.scale(dpr, dpr);

    this.pegR = 4.5;
    this.ballR = 9;
    this.margin = 34;
    this.topPad = 56;
    this.rowGap = (this.H - this.topPad - 78) / this.ROWS;
    this.bucketY = this.H - 52;
    this.buildPegs();

    $$('.seg[data-risk]', el).forEach(b => b.addEventListener('click', () => {
      this.risk = b.dataset.risk;
      $$('.seg[data-risk]', el).forEach(x => x.classList.toggle('active', x === b));
      this.renderTable();
    }));
    this.dropBtn.addEventListener('click', () => this.drop());
    this.renderTable();
    this.tick();
  },

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  },

  buildPegs() {
    this.pegs = [];
    const n = 12;
    const span = this.W - 2 * this.margin;
    const gap = span / (n - 1);
    for (let r = 0; r < this.ROWS; r++) {
      const off = (r % 2 === 1) ? gap / 2 : 0;
      for (let i = 0; i < n; i++) {
        this.pegs.push({ x: this.margin + off + i * gap, y: this.topPad + r * this.rowGap });
      }
    }
    this.slots = [];
    for (let i = 0; i < this.ROWS + 1; i++) {
      this.slots.push(this.margin + i * (span / this.ROWS));
    }
  },

  renderTable() {
    const t = $('#pkTable', this.el);
    if (!t) return;
    const mults = this.MULT[this.risk];
    t.innerHTML = mults.map((m, i) => {
      const col = m >= 5 ? 'var(--gold)' : m >= 1.5 ? 'var(--green)' : m >= 1 ? 'var(--cyan)' : 'var(--red)';
      return `<span class="pk-chip" style="color:${col};border-color:${col}55">${m.toFixed(1)}×</span>`;
    }).join('');
  },

  drop() {
    if (this.busy) return;
    const bet = parseFloat($('#pkBet', this.el).value);
    if (!canBet(bet)) { toast('Enter a valid bet you can afford', 'warn'); return; }
    this.busy = true;
    this.dropBtn.disabled = true;
    App.balance -= bet;
    saveState();
    updateBalance();
    this.resultEl.innerHTML = '';
    this.lastSlot = -1;
    this.balls.push({
      x: this.W / 2,
      y: this.topPad - 24,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 0,
      bet,
      mults: this.MULT[this.risk],
      trail: [],
      settling: false,
      done: false,
      slotIdx: 0,
    });
  },

  physics(b) {
    b.vy = Math.min(b.vy + 0.42, 11);
    b.vx *= 0.995;
    b.vy *= 0.996;
    b.x += b.vx;
    b.y += b.vy;
    // walls
    if (b.x < this.ballR) { b.x = this.ballR; b.vx = Math.abs(b.vx) * 0.75; }
    if (b.x > this.W - this.ballR) { b.x = this.W - this.ballR; b.vx = -Math.abs(b.vx) * 0.75; }
    // pegs
    const pr = this.pegR + this.ballR;
    for (const p of this.pegs) {
      if (Math.abs(p.y - b.y) > pr + 4) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < pr * pr) {
        const d = Math.sqrt(d2) || 1;
        const nx = dx / d, ny = dy / d;
        b.x = p.x + nx * pr;
        b.y = p.y + ny * pr;
        b.vx = nx * 3.6 + (Math.random() - 0.5) * 2.4;
        b.vy = -Math.abs(ny) * 3.0 + (Math.random() - 0.5) * 0.5;
      }
    }
    // start settling at the bucket line
    if (!b.settling && b.y >= this.bucketY - this.ballR) {
      b.settling = true;
      let best = 0, bd = 1e9;
      for (let i = 0; i < this.slots.length; i++) {
        const d = Math.abs(b.x - this.slots[i]);
        if (d < bd) { bd = d; best = i; }
      }
      b.slotIdx = best;
    }
  },

  finalize(b) {
    const mult = b.mults[b.slotIdx];
    const ret = b.bet * mult;
    const profit = ret - b.bet;
    App.balance += ret;
    saveState();
    updateBalance();
    this.lastSlot = b.slotIdx;
    this.resultEl.innerHTML = `<span class="${profit >= 0 ? 'win' : 'lose'}">${mult.toFixed(2)}×</span> ${profit >= 0 ? '+' : '−'}${fmt(Math.abs(profit))} DEMO`;
    this.busy = false;
    this.dropBtn.disabled = false;
  },

  tick() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#111a2e');
    g.addColorStop(1, '#0a0e17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // payout slots
    const mults = this.MULT[this.risk];
    for (let i = 0; i < this.slots.length; i++) {
      const x = this.slots[i];
      const m = mults[i];
      const col = m >= 5 ? '#ffd54a' : m >= 1.5 ? '#4ade80' : m >= 1 ? '#38bdf8' : '#f87171';
      ctx.fillStyle = col + (this.lastSlot === i ? 'ff' : '44');
      ctx.fillRect(x - 13, this.bucketY, 26, this.H - this.bucketY);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.toFixed(1) + '×', x, this.bucketY + 17);
    }

    // pegs
    ctx.fillStyle = '#3b4a63';
    for (const p of this.pegs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.pegR, 0, 6.2832);
      ctx.fill();
    }

    // balls
    for (const b of this.balls) {
      if (b.done) continue;
      this.physics(b);
      if (b.settling) {
        const tx = this.slots[b.slotIdx];
        b.x += (tx - b.x) * 0.18;
        b.y += 1.8;
        if (Math.abs(tx - b.x) < 0.8) { b.done = true; this.finalize(b); }
      }
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 14) b.trail.shift();
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i];
        ctx.fillStyle = 'rgba(56,189,248,' + ((i / b.trail.length) * 0.35).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(t.x, t.y, this.ballR * (0.4 + 0.6 * i / b.trail.length), 0, 6.2832);
        ctx.fill();
      }
      const glow = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, 16);
      glow.addColorStop(0, 'rgba(255,213,74,0.9)');
      glow.addColorStop(1, 'rgba(255,213,74,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 16, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(b.x, b.y, this.ballR, 0, 6.2832);
      ctx.fill();
    }
    this.balls = this.balls.filter(b => !b.done);

    this.raf = requestAnimationFrame(() => this.tick());
  },
};
registerGame(plinkoGame);
