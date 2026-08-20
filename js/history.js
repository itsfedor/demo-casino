'use strict';
/* Global bet history — every settled bet in every game lands here via logBet. */

const historyPage = {
  id: 'history',
  page: true, // registered like a game, but excluded from the lobby grid
  title: 'History',
  icon: '📋',
  filter: 'all',

  html() {
    const chips = ['all', 'dice', 'plinko', 'crash', 'mines', 'blackjack', 'slots'];
    return `
    <div class="game-card" style="max-width:760px;margin:0 auto">
      <h2>📋 Bet history</h2>
      <div class="hist-chips">
        ${chips.map(c => `<button class="chip ${c === 'all' ? 'active' : ''}" data-f="${c}">${c === 'all' ? 'All' : (games[c] ? games[c].icon + ' ' + games[c].title : c)}</button>`).join('')}
      </div>
      <div id="histList" class="hist-list"></div>
      <button class="btn btn-ghost" id="histClear">🗑 Clear history</button>
    </div>`;
  },

  init(el) {
    this.el = el;
    $$('.chip', el).forEach(c => c.addEventListener('click', () => {
      this.filter = c.dataset.f;
      $$('.chip', el).forEach(x => x.classList.toggle('active', x === c));
      this.render();
    }));
    $('#histClear', el).addEventListener('click', () => {
      localStorage.removeItem('cl_history');
      this.render();
      toast('History cleared');
    });
    this.render();
  },

  destroy() {},

  render() {
    const list = $('#histList', this.el);
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem('cl_history') || '[]'); } catch (e) { rows = []; }
    if (this.filter !== 'all') rows = rows.filter(r => r.game === this.filter);
    if (!rows.length) {
      list.innerHTML = '<p class="muted" style="padding:20px 0">No bets yet — go play something! 🎲</p>';
      return;
    }
    list.innerHTML = rows.slice(0, 100).map(r => {
      const g = games[r.game];
      const time = new Date(r.t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `
      <div class="hist-row">
        <span class="hist-time">${time}</span>
        <span class="hist-game">${g ? g.icon + ' ' + g.title : r.game}</span>
        <span class="hist-bet">bet ${fmt(r.bet)}</span>
        <span class="hist-mult ${r.profit > 0 ? 'win' : 'lose'}">${r.mult > 0 ? r.mult.toFixed(2) + '×' : '—'}</span>
        <span class="hist-profit ${r.profit > 0 ? 'win' : r.profit < 0 ? 'lose' : 'muted'}">${r.profit > 0 ? '+' : r.profit < 0 ? '−' : ''}${fmt(Math.abs(r.profit))}</span>
      </div>`;
    }).join('');
  },
};
registerGame(historyPage);
