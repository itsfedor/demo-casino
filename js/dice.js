'use strict';
/* Provably-fair Dice — roll 0.00–99.99. 1% house edge (RTP 99%).
   Stake-style controls: the slider sets the TARGET on the number line (2–98),
   the toggle picks which side you're betting — flipping it mirrors the chance
   (under t → t%, over t → (100−t)%).
   Rolls are integers k/100, k ∈ 0..9999:
     under t wins on k < 100t   → exactly t%
     over  t wins on k ≥ 100t   → exactly (100−t)%
   Both pay 99/chance, so RTP is exactly 99.000% in both modes. */

const diceGame = {
  id: 'dice',
  title: 'Dice',
  icon: '🎲',
  desc: 'Provably-fair rolls verified by SHA-256. Pick your chance and roll.',
  rolls: [],
  mode: 'under',
  target: 50,
  busy: false,

  html() {
    return `
    <div class="game-wrap">
      <div class="game-card">
        <h2>🎲 Provably-fair Dice</h2>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="diceBet" class="num-in" value="100" min="1" step="1">
          <div class="quick-bets">
            ${[10, 50, 100, 500, 1000].map(v => `<button class="qbtn" data-v="${v}">${v}</button>`).join('')}
          </div>
        </div>
        <div class="bet-row">
          <label>Target <b id="diceTargetVal">50</b> — chance <b id="diceChanceVal">50</b>% · pays <b id="dicePayout">1.98×</b></label>
          <input type="range" id="diceTarget" min="2" max="98" value="50" step="1" aria-label="roll target">
        </div>
        <div class="mode-toggle">
          <button class="seg active" id="segUnder">Roll under 50</button>
          <button class="seg" id="segOver">Roll over 50</button>
        </div>
        <button class="btn btn-big" id="diceRoll">🎲 Roll</button>
        ${AutoBet.panelHtml()}
        <div class="roll-result hidden" id="diceResult">
          <div class="roll-num" id="diceRollNum">—</div>
          <div class="roll-outcome" id="diceOutcome"></div>
        </div>
        ${fairPanel('dice')}
      </div>
      <div class="game-card">
        <h3>Recent rolls</h3>
        <div id="diceRolls" class="rolls-list"></div>
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.betIn = $('#diceBet', el);
    this.targetIn = $('#diceTarget', el);
    this.rollBtn = $('#diceRoll', el);
    this.result = $('#diceResult', el);
    this.rollNum = $('#diceRollNum', el);
    this.outcome = $('#diceOutcome', el);
    this.rollsList = $('#diceRolls', el);
    this.mode = 'under';
    this.target = 50;

    try { this.rolls = JSON.parse(localStorage.getItem('cl_dice_rolls') || '[]'); } catch (e) { this.rolls = []; }

    this.renderRolls();
    this.updateLabels();

    this.targetIn.addEventListener('input', () => this.updateLabels());
    this.rollBtn.addEventListener('click', () => this.mainAction());

    $$('.qbtn', el).forEach(b => b.addEventListener('click', () => {
      this.betIn.value = b.dataset.v;
    }));
    const u = $('#segUnder', el), o = $('#segOver', el);
    u.addEventListener('click', () => { this.mode = 'under'; u.classList.add('active'); o.classList.remove('active'); this.updateLabels(); });
    o.addEventListener('click', () => { this.mode = 'over'; o.classList.add('active'); u.classList.remove('active'); this.updateLabels(); });

    AutoBet.wire(el, this);
    wireFairPanel(el, 'dice');
  },

  destroy() {
    AutoBet.stop(this);
  },

  mainAction() { this.doRoll(); },

  chance() { return this.mode === 'under' ? this.target : 100 - this.target; },

  updateLabels() {
    this.target = clamp(parseInt(this.targetIn.value) || 50, 2, 98);
    const c = this.chance();
    $('#diceTargetVal', this.el).textContent = this.target;
    $('#diceChanceVal', this.el).textContent = c;
    $('#dicePayout', this.el).textContent = (99 / c).toFixed(2) + '×';
    $('#segUnder', this.el).textContent = 'Roll under ' + this.target;
    $('#segOver', this.el).textContent = 'Roll over ' + this.target;
  },

  async doRoll() {
    if (this.busy) return;
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) { AutoBet.stop(this, 'Auto stopped'); return; }
    this.target = clamp(parseInt(this.targetIn.value) || 50, 2, 98);
    const chance = this.chance();
    this.busy = true;
    this.rollBtn.disabled = true;

    App.balance -= bet;
    saveState();
    updateBalance();
    if (window.sfx) sfx.bet();

    this.result.classList.remove('hidden');
    this.rollNum.textContent = '—';
    this.rollNum.className = 'roll-num';
    this.outcome.textContent = '';

    // ~3s suspense scramble with an accelerating drumroll
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      this.rollNum.textContent = (Math.random() * 100).toFixed(2);
      if (window.sfx) sfx.drum(i / (steps - 1));
      await sleep(55 + i * 17);
    }

    let hash, roll, nonce;
    try {
      hash = await nextRoundHash();
      roll = rollFromHash(hash);
      nonce = App.nonce - 1;
    } catch (err) {
      console.error('roll failed, refunding bet', err);
      App.balance += bet;
      saveState();
      updateBalance();
      this.result.classList.add('hidden');
      this.busy = false;
      this.rollBtn.disabled = false;
      toast('Roll failed — bet refunded', 'warn');
      return;
    }

    const over = this.mode === 'over';
    const t = this.target;
    const win = over ? roll >= t : roll < t;
    const mult = win ? 99 / chance : 0;
    const profit = win ? bet * (mult - 1) : -bet;
    if (win) {
      App.balance += bet * mult;
      saveState();
    }
    updateBalance();
    refreshFairPanel(this.el, 'dice');
    logBet({ game: 'dice', bet, mult, profit });
    AutoBet.onResult(this, profit);
    if (window.sfx) { win ? (mult >= 10 ? sfx.bigwin() : sfx.win()) : sfx.lose(); }

    this.rollNum.textContent = roll.toFixed(2);
    this.rollNum.className = 'roll-num ' + (win ? 'win' : 'lose');
    const rel = over ? (win ? '≥' : '<') : (win ? '<' : '≥');
    this.outcome.textContent = win
      ? `WIN +${fmt(profit)} DEMO · ${roll.toFixed(2)} ${rel} ${t}`
      : `LOSE −${fmt(bet)} DEMO · ${roll.toFixed(2)} ${rel} ${t}`;
    this.outcome.className = 'roll-outcome ' + (win ? 'win' : 'lose');

    this.rolls.unshift({
      roll: roll.toFixed(2), target: t, over, win, profit, bet,
      hash: hash.slice(0, 16) + '…', nonce,
    });
    if (this.rolls.length > 8) this.rolls.pop();
    try { localStorage.setItem('cl_dice_rolls', JSON.stringify(this.rolls)); } catch (e) { /* blocked */ }
    this.renderRolls();

    this.busy = false;
    this.rollBtn.disabled = false;
  },

  renderRolls() {
    if (!this.rollsList) return;
    if (!this.rolls.length) { this.rollsList.innerHTML = '<p class="muted">No rolls yet — go ahead!</p>'; return; }
    this.rollsList.innerHTML = this.rolls.map(r => `
      <div class="roll-row ${r.win ? 'win' : 'lose'}">
        <span class="rr-roll">${r.roll}</span>
        <span class="rr-info">${r.over ? '≥' : '<'} ${r.target} · nonce ${r.nonce} · ${r.hash}</span>
        <span class="rr-profit ${r.win ? 'win' : 'lose'}">${r.win ? '+' : '−'}${fmt(Math.abs(r.profit))}</span>
      </div>`).join('');
  },
};
registerGame(diceGame);
