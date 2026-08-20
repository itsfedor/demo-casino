'use strict';
/* Auto-bet — shared panel for dice / plinko / slots.
   Contract with the host game:
     game.betIn      — the bet <input> element
     game.mainAction — kicks off one bet
     game calls AutoBet.onResult(this, profit) after every settled bet
     game.destroy()  — calls AutoBet.stop(this) */

const AutoBet = {
  panelHtml() {
    return `
    <details class="auto-box" id="abPanel">
      <summary>⚙️ Auto bet</summary>
      <div class="auto-grid">
        <label>Number of bets<small>0 = endless</small>
          <input type="number" id="abCount" value="0" min="0" step="1"></label>
        <label>On win +%<small>0 = reset to base</small>
          <input type="number" id="abWinPct" value="0" min="0" step="1"></label>
        <label>On loss +%<small>0 = reset to base</small>
          <input type="number" id="abLossPct" value="0" min="0" step="1"></label>
        <label>Stop at profit<small>DEMO · 0 = off</small>
          <input type="number" id="abStopWin" value="0" min="0" step="1"></label>
        <label>Stop at loss<small>DEMO · 0 = off</small>
          <input type="number" id="abStopLoss" value="0" min="0" step="1"></label>
      </div>
      <button class="btn btn-big auto-toggle" id="abToggle">▶ Start auto</button>
    </details>`;
  },

  wire(el, game) {
    const box = $('#abPanel', el);
    if (!box || !game.betIn) return;
    const btn = $('#abToggle', el);
    btn.addEventListener('click', () => {
      if (game.auto && game.auto.on) this.stop(game, 'Auto stopped');
      else this.start(game, el);
    });
  },

  start(game, el) {
    const base = parseFloat(game.betIn.value);
    if (!(base > 0) || !isFinite(base)) { toast('Set a valid bet amount first', 'warn'); return; }
    game.auto = {
      on: true, baseBet: base, curBet: base, done: 0, profit: 0,
      count: Math.max(0, parseInt($('#abCount', el).value) || 0),
      winPct: Math.max(0, parseFloat($('#abWinPct', el).value) || 0),
      lossPct: Math.max(0, parseFloat($('#abLossPct', el).value) || 0),
      stopWin: Math.max(0, parseFloat($('#abStopWin', el).value) || 0),
      stopLoss: Math.max(0, parseFloat($('#abStopLoss', el).value) || 0),
    };
    const btn = $('#abToggle');
    if (btn) { btn.textContent = '■ Stop auto'; btn.classList.add('stop'); }
    toast('🤖 Auto bet started');
    if (window.sfx) sfx.click();
    game.mainAction();
  },

  stop(game, msg) {
    if (game.auto) game.auto.on = false;
    const btn = $('#abToggle');
    if (btn) { btn.textContent = '▶ Start auto'; btn.classList.remove('stop'); }
    if (msg) toast(msg);
  },

  onResult(game, profit) {
    const a = game.auto;
    if (!a || !a.on) return;
    a.done++;
    a.profit += profit;
    const pct = profit > 0 ? a.winPct : a.lossPct;
    a.curBet = pct > 0 ? Math.max(1, a.curBet * (1 + pct / 100)) : a.baseBet;
    game.betIn.value = Math.round(a.curBet * 100) / 100;

    if (a.count > 0 && a.done >= a.count) return this.stop(game, `🤖 Auto done — ${a.done} bets, net ${a.profit >= 0 ? '+' : ''}${fmt(a.profit)}`);
    if (a.stopWin > 0 && a.profit >= a.stopWin) return this.stop(game, `🤖 Profit target hit: +${fmt(a.profit)} DEMO`);
    if (a.stopLoss > 0 && a.profit <= -a.stopLoss) return this.stop(game, `🤖 Auto loss limit hit: −${fmt(Math.abs(a.profit))} DEMO`);
    if (App.balance < a.curBet) return this.stop(game, '🤖 Auto stopped — balance too low');

    setTimeout(() => {
      if (a.on && App.current === game) game.mainAction();
    }, 420);
  },
};
