'use strict';
/* Mines — 5×5 grid of hidden gems and bombs. Reveal gems to raise the
   multiplier, cash out before you hit a bomb.
   Provably fair: the round hash sha256(client:server:nonce) seeds a Fisher-Yates
   shuffle of the 25 tiles; the first M shuffled positions are the mines.
   Multiplier after k safe reveals = 0.99 × C(25,k)/C(25−M,k) — every individual
   cash-out point has exactly 1% house edge. */

const MINES = {
  edge: 0.99,
  mult(k, M) {
    let m = 1;
    for (let i = 0; i < k; i++) m *= (25 - i) / (25 - M - i);
    return Math.floor(m * this.edge * 100) / 100;
  },
  // deterministic PRNG seeded from the round hash
  rng(hash) {
    let a = parseInt(hash.slice(0, 8), 16) || 1;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  place(hash, M) {
    const rand = this.rng(hash);
    const idx = [...Array(25).keys()];
    for (let i = 24; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return new Set(idx.slice(0, M));
  },
};

const minesGame = {
  id: 'mines',
  title: 'Mines',
  icon: '💣',
  desc: 'Uncover gems, dodge the bombs, cash out any time.',
  M: 3,
  phase: 'idle',   // idle | live | done
  bet: 0,
  picks: 0,
  mines: null,

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>💣 Mines</h2>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="mnBet" class="num-in" value="100" min="1" step="1">
          <div class="quick-bets">
            ${[10, 50, 100, 500, 1000].map(v => `<button class="qbtn" data-v="${v}">${v}</button>`).join('')}
          </div>
        </div>
        <div class="bet-row">
          <label>Mines</label>
          <div class="mode-toggle">
            ${[1, 3, 5, 10, 24].map(m => `<button class="seg ${m === 3 ? 'active' : ''}" data-m="${m}">${m}</button>`).join('')}
          </div>
        </div>
        <div class="mn-stats">
          <div>Current: <b id="mnCur">1.00×</b></div>
          <div>Next: <b id="mnNext">${MINES.mult(1, 3).toFixed(2)}×</b></div>
          <div>Gems: <b id="mnPicks">0</b></div>
        </div>
        <div class="mn-grid" id="mnGrid">
          ${[...Array(25).keys()].map(i => `<button class="mn-tile" data-i="${i}" aria-label="tile ${i + 1}"></button>`).join('')}
        </div>
        <button class="btn btn-big" id="mnAction">💣 Start game</button>
        <div class="mn-result" id="mnResult"></div>
      </div>
      <div class="game-card">
        <h3>How it works</h3>
        <ul class="rules">
          <li>25 tiles hide your chosen number of mines — the rest are gems</li>
          <li>Each gem raises the multiplier; cash out any time to bank it</li>
          <li>Hit a mine and the bet is lost</li>
          <li>1% house edge at every cash-out point</li>
        </ul>
        <div id="mnTable" class="pk-table" style="margin-top:12px"></div>
        ${fairPanel('mines')}
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.betIn = $('#mnBet', el);
    this.actionBtn = $('#mnAction', el);
    this.resultEl = $('#mnResult', el);
    this.M = 3;
    this.phase = 'idle';
    this.picks = 0;
    this.mines = null;
    this.revealed = new Set();

    $$('.seg[data-m]', el).forEach(b => b.addEventListener('click', () => {
      if (this.phase === 'live') { toast('Finish the round first', 'warn'); return; }
      this.M = parseInt(b.dataset.m);
      $$('.seg[data-m]', el).forEach(x => x.classList.toggle('active', x === b));
      this.updateStats();
      this.renderTable();
    }));
    $$('.qbtn', el).forEach(b => b.addEventListener('click', () => { this.betIn.value = b.dataset.v; }));
    this.actionBtn.addEventListener('click', () => this.mainAction());
    $('#mnGrid', el).addEventListener('click', (e) => {
      const t = e.target.closest('.mn-tile');
      if (t) this.reveal(parseInt(t.dataset.i));
    });
    this.updateStats();
    this.renderTable();
    wireFairPanel(el, 'mines');
  },

  destroy() {
    if (this.phase === 'live' && this.bet > 0) {
      App.balance += this.bet;
      saveState();
      updateBalance();
      toast('Round cancelled — bet refunded');
    }
    this.phase = 'idle';
  },

  mainAction() {
    if (this.phase === 'live') {
      if (this.picks > 0) this.cashOut();
      else toast('Reveal at least one gem first 💎', 'warn');
    } else this.start();
  },

  async start() {
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) return;
    this.bet = bet;
    App.balance -= bet;
    saveState();
    updateBalance();
    if (window.sfx) sfx.bet();

    const hash = await nextRoundHash();
    this.mines = MINES.place(hash, this.M);
    this.picks = 0;
    this.revealed = new Set();
    this.phase = 'live';
    this.resultEl.innerHTML = '';
    this.actionBtn.textContent = '💰 Cash out';
    this.actionBtn.classList.add('cash');
    $$('.mn-tile', this.el).forEach(t => { t.className = 'mn-tile'; t.textContent = ''; });
    this.updateStats();
  },

  reveal(i) {
    if (this.phase !== 'live' || this.revealed.has(i)) return;
    this.revealed.add(i);
    const tile = $(`.mn-tile[data-i="${i}"]`, this.el);
    if (this.mines.has(i)) {
      tile.classList.add('boom');
      tile.textContent = '💣';
      this.bust();
      return;
    }
    tile.classList.add('gem');
    tile.textContent = '💎';
    this.picks++;
    if (window.sfx) sfx.tick(0.2 + 0.1 * this.picks);
    this.updateStats();
    if (this.picks === 25 - this.M) this.cashOut(); // board cleared — max payout
  },

  updateStats() {
    const cur = this.picks > 0 ? MINES.mult(this.picks, this.M) : 1;
    $('#mnCur', this.el).textContent = cur.toFixed(2) + '×';
    $('#mnNext', this.el).textContent = this.picks < 25 - this.M
      ? MINES.mult(this.picks + 1, this.M).toFixed(2) + '×' : '—';
    $('#mnPicks', this.el).textContent = this.picks;
    if (this.phase === 'live' && this.picks > 0) {
      this.actionBtn.textContent = `💰 Cash out ${cur.toFixed(2)}× (+${fmt(this.bet * cur - this.bet)})`;
    }
  },
  renderTable() {
    const t = $('#mnTable', this.el);
    if (!t) return;
    const ks = [1, 2, 3, 4, 5, 7, 10];
    t.innerHTML = ks.map(k => `<span class="pk-chip">${k}💎 = ${MINES.mult(k, this.M).toFixed(2)}×</span>`).join('');
  },

  bust() {
    this.phase = 'done';
    // show all remaining mines
    $$('.mn-tile', this.el).forEach(t => {
      const i = parseInt(t.dataset.i);
      if (this.mines.has(i) && !t.classList.contains('boom')) {
        t.classList.add('mine'); t.textContent = '💣';
      }
    });
    this.resultEl.innerHTML = `<span class="lose">💥 Boom — −${fmt(this.bet)} DEMO</span>`;
    this.actionBtn.textContent = '💣 Start game';
    this.actionBtn.classList.remove('cash');
    logBet({ game: 'mines', bet: this.bet, mult: 0, profit: -this.bet });
    this.phase = 'idle';
    if (window.sfx) sfx.bust();
  },

  cashOut() {
    if (this.phase !== 'live' || this.picks === 0) return;
    const m = MINES.mult(this.picks, this.M);
    const ret = this.bet * m;
    const profit = ret - this.bet;
    App.balance += ret;
    saveState();
    updateBalance();
    $$('.mn-tile', this.el).forEach(t => {
      const i = parseInt(t.dataset.i);
      if (this.mines.has(i) && !this.revealed.has(i)) { t.classList.add('mine'); t.textContent = '💣'; }
    });
    this.resultEl.innerHTML = `<span class="win">💎 Cashed ${m.toFixed(2)}× · +${fmt(profit)} DEMO</span>`;
    this.actionBtn.textContent = '💣 Start game';
    this.actionBtn.classList.remove('cash');
    logBet({ game: 'mines', bet: this.bet, mult: m, profit });
    this.phase = 'idle';
    if (window.sfx) { sfx.cash(); if (m < 10) sfx.win(); }
  },
};
registerGame(minesGame);
