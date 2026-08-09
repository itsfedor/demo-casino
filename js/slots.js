'use strict';
/* Slots — 3×3 grid, 5 paylines (3 rows + 2 diagonals), ~92% RTP. */

const slotsGame = {
  id: 'slots',
  title: 'Slots',
  icon: '🎰',
  desc: 'Classic reels with 5 paylines. Spin and match!',
  SYM: [
    { s: '🍒', w: 30, p: 12 },
    { s: '🍋', w: 25, p: 18 },
    { s: '🍇', w: 18, p: 30 },
    { s: '⭐', w: 12, p: 45 },
    { s: '🔔', w: 8, p: 90 },
    { s: '💎', w: 4, p: 180 },
    { s: '🍀', w: 2, p: 360 },
    { s: '7️⃣', w: 1, p: 900 },
  ],
  spinning: false,

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>🎰 Slots</h2>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="slBet" class="num-in" value="100" min="1" step="1">
          <div class="quick-bets">
            ${[10, 50, 100, 500, 1000].map(v => `<button class="qbtn" data-v="${v}">${v}</button>`).join('')}
          </div>
        </div>
        <div class="slot-machine">
          <div class="reels">
            ${[0, 1, 2].map(c => `<div class="reel" id="reel${c}">${[0, 1, 2].map(() => '<div class="cell">🍒</div>').join('')}</div>`).join('')}
          </div>
        </div>
        <button class="btn btn-big" id="slSpin">🎰 Spin</button>
        <div class="sl-result" id="slResult"></div>
      </div>
      <div class="game-card">
        <h3>Payouts</h3>
        <div class="pay-table" id="slPayTable"></div>
        <p class="muted" style="margin-top:10px;font-size:12.5px">5 paylines: 3 rows + 2 diagonals. Line bet = 1/5 of your total bet. RTP ≈ 92%.</p>
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.betIn = $('#slBet', el);
    this.spinBtn = $('#slSpin', el);
    this.resultEl = $('#slResult', el);
    this.spinning = false;

    $$('.qbtn', el).forEach(b => b.addEventListener('click', () => {
      this.betIn.value = b.dataset.v;
    }));
    this.spinBtn.addEventListener('click', () => this.spin());

    const table = $('#slPayTable', el);
    table.innerHTML = this.SYM.map(s => `
      <div class="pay-row">
        <span class="sym">${s.s} ${s.s} ${s.s}</span>
        <span class="val">${s.p / 5}× bet</span>
      </div>`).join('');
  },

  destroy() {},

  pick() {
    const total = this.SYM.reduce((a, s) => a + s.w, 0);
    let r = Math.random() * total;
    for (const s of this.SYM) {
      r -= s.w;
      if (r <= 0) return s;
    }
    return this.SYM[0];
  },

  spin() {
    if (this.spinning) return;
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) { toast('Enter a valid bet you can afford', 'warn'); return; }
    this.spinning = true;
    this.spinBtn.disabled = true;
    this.resultEl.textContent = '';
    App.balance -= bet;
    saveState();
    updateBalance();

    // precompute final grid: 3 reels × 3 rows
    const grid = [[], [], []];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) grid[c].push(this.pick());

    const cells = [];
    for (let c = 0; c < 3; c++) cells.push($$('#reel' + c + ' .cell', this.el));

    const spinReel = (c, duration) => new Promise(res => {
      const t0 = performance.now();
      const step = (t) => {
        for (const cell of cells[c]) cell.textContent = this.pick().s;
        if (t - t0 < duration) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });

    const setCol = (c, col) => {
      for (let r = 0; r < 3; r++) {
        cells[c][r].textContent = col[r].s;
        cells[c][r].classList.add('pop');
        setTimeout(() => cells[c][r].classList.remove('pop'), 320);
      }
    };

    (async () => {
      const p1 = spinReel(0, 800).then(() => setCol(0, grid[0]));
      const p2 = spinReel(1, 1100).then(() => setCol(1, grid[1]));
      const p3 = spinReel(2, 1400).then(() => setCol(2, grid[2]));
      await Promise.all([p1, p2, p3]);
      await sleep(300);
      this.evalWin(grid, bet);
      this.spinning = false;
      this.spinBtn.disabled = false;
    })();
  },

  evalWin(grid, bet) {
    const lines = [
      [[0, 0], [1, 0], [2, 0]],
      [[0, 1], [1, 1], [2, 1]],
      [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[0, 2], [1, 1], [2, 0]],
    ];
    let win = 0;
    const wonLines = [];
    lines.forEach((line, li) => {
      const a = grid[line[0][0]][line[0][1]];
      const b = grid[line[1][0]][line[1][1]];
      const c = grid[line[2][0]][line[2][1]];
      if (a.s === b.s && b.s === c.s) {
        win += bet / 5 * a.p;
        wonLines.push(li + 1);
      }
    });
    if (win > 0) {
      App.balance += win;
      saveState();
      updateBalance();
      const profit = win - bet;
      this.resultEl.innerHTML = `<span class="win">WIN +${fmt(profit)} DEMO</span> <span class="muted">· lines ${wonLines.join(', ')}</span>`;
      toast('🎉 Win on line(s) ' + wonLines.join(', ') + '!');
    } else {
      this.resultEl.innerHTML = `<span class="lose">LOSE −${fmt(bet)} DEMO</span>`;
    }
  },
};
registerGame(slotsGame);
