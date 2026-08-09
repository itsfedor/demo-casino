'use strict';
/* Classic Blackjack — 6 decks, dealer stands on all 17s, blackjack pays 3:2, double on first two cards. */

const blackjackGame = {
  id: 'blackjack',
  title: 'Blackjack',
  icon: '🃏',
  desc: 'Beat the dealer: hit, stand or double. Blackjack pays 3:2.',
  suits: ['♠', '♥', '♦', '♣'],
  phase: 'bet',
  busy: false,
  bet: 0,
  holeVisible: false,

  html() {
    return `
    <div class="game-wrap bj-wrap">
      <div class="game-card">
        <h2>🃏 Blackjack</h2>
        <div class="bet-row">
          <label>Bet amount (DEMO)</label>
          <input type="number" id="bjBet" class="num-in" value="100" min="1" step="1">
        </div>
        <div class="bj-table">
          <div class="bj-hand-row">
            <div class="bj-label">Dealer</div>
            <div class="bj-cards" id="bjDealerCards"></div>
            <div class="bj-total" id="bjDealerTotal"></div>
          </div>
          <div class="bj-hand-row">
            <div class="bj-label">You</div>
            <div class="bj-cards" id="bjPlayerCards"></div>
            <div class="bj-total" id="bjPlayerTotal"></div>
          </div>
          <div class="bj-status" id="bjStatus">Press Deal to start.</div>
        </div>
        <div class="bj-actions">
          <button class="btn btn-big" id="bjDeal">🂠 Deal</button>
          <button class="btn" id="bjHit">Hit</button>
          <button class="btn" id="bjStand">Stand</button>
          <button class="btn" id="bjDouble">Double</button>
        </div>
        <div class="bj-last" id="bjLast"></div>
      </div>
      <div class="game-card">
        <h3>Rules</h3>
        <ul class="rules">
          <li>6 decks, reshuffled automatically</li>
          <li>Dealer stands on all 17s</li>
          <li>Blackjack pays 3:2</li>
          <li>Double down allowed on your first two cards</li>
          <li>Push returns your bet</li>
        </ul>
      </div>
    </div>`;
  },

  init(el) {
    this.el = el;
    this.betIn = $('#bjBet', el);
    this.dealerCards = $('#bjDealerCards', el);
    this.playerCards = $('#bjPlayerCards', el);
    this.dealerTotal = $('#bjDealerTotal', el);
    this.playerTotal = $('#bjPlayerTotal', el);
    this.status = $('#bjStatus', el);
    this.last = $('#bjLast', el);
    this.dealBtn = $('#bjDeal', el);
    this.hitBtn = $('#bjHit', el);
    this.standBtn = $('#bjStand', el);
    this.doubleBtn = $('#bjDouble', el);
    this.deck = this.makeDeck();
    this.playerHand = [];
    this.dealerHand = [];
    this.holeVisible = false;

    this.dealBtn.addEventListener('click', () => this.deal());
    this.hitBtn.addEventListener('click', () => this.hit());
    this.standBtn.addEventListener('click', () => this.stand());
    this.doubleBtn.addEventListener('click', () => this.doubleDown());
    this.setPhase('bet');
    this.render();
  },

  destroy() {},

  makeDeck() {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];
    for (let d = 0; d < 6; d++)
      for (const s of this.suits)
        for (const r of ranks) deck.push({ r, s });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  },

  draw() {
    if (this.deck.length < 60) this.deck = this.makeDeck();
    return this.deck.pop();
  },

  value(hand) {
    let sum = 0, aces = 0;
    for (const c of hand) {
      if (c.r === 'A') { aces++; sum += 11; }
      else if (c.r === 'K' || c.r === 'Q' || c.r === 'J') sum += 10;
      else sum += parseInt(c.r);
    }
    while (sum > 21 && aces) { sum -= 10; aces--; }
    return sum;
  },

  setPhase(p) {
    this.phase = p;
    this.dealBtn.disabled = p !== 'bet' && p !== 'done';
    this.hitBtn.disabled = p !== 'play';
    this.standBtn.disabled = p !== 'play';
    this.doubleBtn.disabled = !(p === 'play' && this.playerHand && this.playerHand.length === 2 && this.bet * 2 <= App.balance);
  },

  cardEl(c, faceDown) {
    const d = document.createElement('div');
    d.className = 'card' + (faceDown ? ' down' : '');
    if (!faceDown) {
      const red = c.s === '♥' || c.s === '♦';
      d.innerHTML = `<span class="cr ${red ? 'red' : ''}">${c.r}</span><span class="cs ${red ? 'red' : ''}">${c.s}</span>`;
    }
    return d;
  },

  render() {
    const hasHands = this.playerHand && this.playerHand.length > 0;
    if (!hasHands) {
      this.dealerCards.innerHTML = '<span class="muted" style="font-size:12px">—</span>';
      this.playerCards.innerHTML = '<span class="muted" style="font-size:12px">—</span>';
      this.dealerTotal.textContent = '';
      this.playerTotal.textContent = '';
      return;
    }
    this.dealerCards.innerHTML = '';
    this.dealerCards.appendChild(this.cardEl(this.dealerHand[0], !this.holeVisible && this.phase === 'play'));
    for (let i = 1; i < this.dealerHand.length; i++) this.dealerCards.appendChild(this.cardEl(this.dealerHand[i], false));
    this.playerCards.innerHTML = '';
    for (const c of this.playerHand) this.playerCards.appendChild(this.cardEl(c, false));
    const hideDealer = !this.holeVisible && this.phase === 'play';
    this.dealerTotal.textContent = hideDealer ? '?' : this.value(this.dealerHand);
    this.playerTotal.textContent = this.value(this.playerHand);
  },

  async deal() {
    if (this.busy) return;
    const bet = parseFloat(this.betIn.value);
    if (!canBet(bet)) { toast('Enter a valid bet you can afford', 'warn'); return; }
    this.busy = true;
    this.bet = bet;
    App.balance -= bet;
    saveState();
    updateBalance();
    this.playerHand = [this.draw(), this.draw()];
    this.dealerHand = [this.draw(), this.draw()];
    this.holeVisible = false;
    this.last.textContent = '';
    this.setPhase('play');
    this.status.textContent = 'Your turn — hit, stand or double.';
    this.render();

    const pv = this.value(this.playerHand);
    const dv = this.value(this.dealerHand);
    if (pv === 21) {
      if (dv === 21) {
        this.status.textContent = 'Both have blackjack — push.';
        this.holeVisible = true;
        await sleep(700);
        await this.settle();
      } else {
        this.status.textContent = 'Blackjack! 3:2 payout.';
        await sleep(700);
        App.balance += this.bet * 2.5;
        saveState();
        updateBalance();
        this.last.innerHTML = `<span class="win">+${fmt(this.bet * 1.5)} DEMO</span>`;
        this.setPhase('done');
        this.busy = false;
      }
      return;
    }
    if (dv === 21) {
      this.status.textContent = 'Dealer has blackjack — you lose.';
      this.holeVisible = true;
      await sleep(700);
      await this.settle();
      return;
    }
    this.busy = false;
  },

  hit() {
    if (this.busy || this.phase !== 'play') return;
    this.playerHand.push(this.draw());
    this.render();
    if (this.value(this.playerHand) > 21) {
      this.status.textContent = 'Bust!';
      this.busy = true;
      this.settle();
    }
  },

  stand() {
    if (this.busy || this.phase !== 'play') return;
    this.busy = true;
    this.status.textContent = 'Standing on ' + this.value(this.playerHand) + '…';
    this.settle();
  },

  doubleDown() {
    if (this.busy || this.phase !== 'play' || this.playerHand.length !== 2) return;
    if (App.balance < this.bet) { toast('Not enough balance to double', 'warn'); return; }
    App.balance -= this.bet;
    this.bet *= 2;
    saveState();
    updateBalance();
    this.busy = true;
    this.playerHand.push(this.draw());
    this.render();
    if (this.value(this.playerHand) > 21) this.status.textContent = 'Bust!';
    this.settle();
  },

  async settle() {
    this.holeVisible = true;
    this.render();
    await sleep(600);
    while (this.value(this.dealerHand) < 17) {
      this.dealerHand.push(this.draw());
      this.render();
      await sleep(480);
    }
    const dv = this.value(this.dealerHand);
    const pv = this.value(this.playerHand);
    let msg, profit;
    if (pv > 21) { msg = 'Bust — you lose.'; profit = -this.bet; }
    else if (dv > 21) { msg = 'Dealer busts — you win!'; profit = this.bet; }
    else if (dv > pv) { msg = 'Dealer wins.'; profit = -this.bet; }
    else if (pv > dv) { msg = 'You win!'; profit = this.bet; }
    else { msg = 'Push — bet returned.'; profit = 0; }
    if (profit > 0) { App.balance += this.bet * 2; }
    else if (profit === 0) { App.balance += this.bet; }
    saveState();
    updateBalance();
    this.status.textContent = msg;
    this.last.innerHTML = `<span class="${profit >= 0 ? 'win' : 'lose'}">${profit >= 0 ? '+' : '−'}${fmt(Math.abs(profit))} DEMO</span>`;
    this.setPhase('done');
    this.busy = false;
  },
};
registerGame(blackjackGame);
