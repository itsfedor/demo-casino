'use strict';
/* Provably-fair Dice — roll 0.00–99.99, win if under/over target. 1% house edge (RTP 99%).
   Rolls are integers k/100, k ∈ 0..9999.
   Under c wins on k < 100c  → exactly c% of outcomes.
   Over  wins on k ≥ 10000−100c → exactly c% of outcomes. Both modes pay 99/c. */

const diceGame = {
  id: 'dice',
  title: 'Dice',
  icon: '🎲',
  desc: 'Provably-fair rolls verified by SHA-256. Pick your chance and roll.',
  rolls: [],
  mode: 'under',
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
          <label>Chance to win — <b id="diceChanceVal">50</b>% · pays <b id="dicePayout">1.98×</b></label>
          <input type="range" id="diceChance" min="1" max="95" value="50" step="1" aria-label="chance to win">
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
    this.chanceIn = $('#diceChance', el);
    this.rollBtn = $('#diceRoll', el);
    this.result = $('#diceResult', el);
    this.rollNum = $('#diceRollNum', el);
    this.outcome = $('#diceOutcome', el);
    this.rollsList = $('#diceRolls', el);
    this.mode = 'under';

    try { this.rolls = JSON.parse(localStorage.getItem('cl_dice_rolls') || '[]'); } catch (e) { this.rolls = []; }

    this.renderRolls();
    this.updateLabels();

    this.chanceIn.addEventListener('input', () => this.updateLabels());
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

  updateLabels() {
    const chance = parseInt(this.chanceIn.value) || 50;
    $('#diceChanceVal', this.el).textContent = chance;
    $('#dicePayout', this.el).textContent = (99 / chance).toFixed(2) + '×';
    $('#segUnder', this.el).textContent = 'Roll under ' + chance;
    $('#segOver', this.el).textContent = 'Roll over ' + (100 - chance);
  },

  async doRoll() {
    if (this.busy) return;
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) { AutoBet.stop(this, 'Auto stopped'); return; }
    const chance = clamp(parseInt(this.chanceIn.value) || 50, 1, 95);
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

    // suspense animation
    for (let i = 0; i < 14; i++) {
      this.rollNum.textContent = (Math.random() * 100).toFixed(2);
      await sleep(50 + i * 18);
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
    const target = over ? 100 - chance : chance;
    // rolls are k/100 for k ∈ 0..9999: `k < 100·c` and `k ≥ 10000−100·c` both win exactly c%
    const win = over ? roll >= target : roll < target;
    const mult = win ? 99 / chance : 0;
    const profit = win ? bet * (mult - 1) : -bet;
    if (win) {
      App.balance += bet * mult;
      saveState();
    }
    updateBalance();
    logBet({ game: 'dice', bet, mult, profit });
    AutoBet.onResult(this, profit);
    if (window.sfx) { win ? (mult >= 10 ? sfx.bigwin() : sfx.win()) : sfx.lose(); }

    this.rollNum.textContent = roll.toFixed(2);
    this.rollNum.className = 'roll-num ' + (win ? 'win' : 'lose');
    const rel = over ? (win ? '≥' : '<') : (win ? '<' : '≥');
    this.outcome.textContent = win
      ? `WIN +${fmt(profit)} DEMO · ${roll.toFixed(2)} ${rel} ${target}`
      : `LOSE −${fmt(bet)} DEMO · ${roll.toFixed(2)} ${rel} ${target}`;
    this.outcome.className = 'roll-outcome ' + (win ? 'win' : 'lose');

    this.rolls.unshift({
      roll: roll.toFixed(2), target, over, win, profit, bet,
      hash: hash.slice(0, 16) + '…', nonce,
    });
    if (this.rolls.length > 8) this.rolls.pop();
    try { localStorage.setItem('cl_dice_rolls', JSON.stringify(this.rolls)); } catch (e) { /* blocked */ }
    this.renderRolls();
    wireFairPanel(this.el, 'dice');

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
