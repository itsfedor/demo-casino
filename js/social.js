'use strict';
/* Social layer — live bet feed with simulated players + weekly wager race.
   Everything here is local simulation for demo vibes; your own bets are real
   (they come from logBet) and feed the race. */

const Social = {
  feed: [],
  NAMES: ['cryptok1ng', 'LuckyMike', 'nv_degen', 'MoonBoi', 'satosh1', 'VegasKat', '0xGambler',
    'PlinkoPete', 'BananaJoe', 'wagmi_alex', 'deg3n_dave', 'CardShark', 'miss_fortune', 'taprootTina',
    'rUGpull_Rob', 'HighRollerZ', 'exit_liquidity', 'gm_gambler', 'BlockBetty', 'yolo_yuri'],
  RACE_BOTS: 12,

  gameLabel(id) {
    const g = (typeof games !== 'undefined' ? games : {})[id];
    return g ? `${g.icon} ${g.title}` : id;
  },

  push(entry) {
    entry.t = Date.now();
    this.feed.unshift(entry);
    if (this.feed.length > 16) this.feed.length = 16;
    this.renderFeed();
  },
  renderFeed() {
    const list = $('#feedList');
    if (!list) return;
    if (!this.feed.length) {
      list.innerHTML = '<p class="muted">Waiting for bets…</p>';
      return;
    }
    list.innerHTML = this.feed.map(f => `
      <div class="feed-row ${f.you ? 'you' : ''}">
        <span class="feed-name">${f.you ? '⭐ You' : f.name}</span>
        <span class="feed-game">${this.gameLabel(f.game)}</span>
        <span class="feed-bet">${fmt(f.bet)}</span>
        <span class="feed-mult ${f.profit > 0 ? 'win' : 'lose'}">${f.profit > 0 ? f.mult.toFixed(2) + '×' : '—'}</span>
        <span class="feed-profit ${f.profit > 0 ? 'win' : 'lose'}">${f.profit > 0 ? '+' : '−'}${fmt(Math.abs(f.profit))}</span>
      </div>`).join('');
  },

  /* ---------- bot bets ---------- */
  botBet() {
    const gameIds = ['dice', 'plinko', 'crash', 'mines', 'blackjack', 'slots'];
    const game = gameIds[(Math.random() * gameIds.length) | 0];
    const bet = Math.round(Math.exp(Math.random() * 6.2) * 8 + 10); // ~10..~6,700, log-ish
    let mult = 0;
    if (Math.random() < 0.46) { // winner — plausible multiplier per game
      const pools = {
        dice: [1.1, 1.5, 2, 3.1, 4.9, 9.9, 19.8, 49.5, 99],
        plinko: [1.1, 1.4, 2, 3.5, 6, 11, 24, 33, 170],
        crash: [1.2, 1.5, 1.9, 2.4, 3.2, 4.7, 8, 15, 42],
        mines: [1.1, 1.3, 1.9, 2.8, 4.5, 8, 14, 25],
        blackjack: [2, 2, 2, 2.5],
        slots: [2.4, 3.6, 6, 9, 18, 36, 90, 180],
      };
      const pool = pools[game];
      // weight low multipliers heavily, big ones rarely
      mult = pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 2.6) * pool.length))];
    }
    const profit = mult > 0 ? bet * (mult - 1) : -bet;
    this.push({ name: this.NAMES[(Math.random() * this.NAMES.length) | 0], game, bet, mult, profit });
  },

  onPlayerBet(e) {
    this.push({ you: true, game: e.game, bet: e.bet, mult: e.mult, profit: e.profit });
  },

  /* ---------- weekly wager race ----------
     Bots have a per-week base wager and an hourly rate so the race moves,
     but a grinding player can realistically catch the top. */
  botRacers() {
    const hours = Math.max(0, (Date.now() - (Meta.weekStart || Date.now())) / 3600000);
    const out = [];
    for (let i = 0; i < this.RACE_BOTS; i++) {
      const r = ((Meta.weekStart + i * 7919) % 1000) / 1000; // deterministic per week
      const base = 3000 + r * 120000;
      const rate = 150 + r * 2200; // DEMO wagered per hour
      out.push({
        name: this.NAMES[(i * 3 + 2) % this.NAMES.length],
        wagered: base + rate * hours,
        bot: true,
      });
    }
    return out;
  },
  raceRows() {
    const rows = this.botRacers();
    rows.push({ name: 'You', wagered: Meta.weekly || 0, you: true });
    rows.sort((a, b) => b.wagered - a.wagered);
    return rows;
  },
  renderRace() {
    const prev = $('#racePreview');
    if (!prev) return;
    const rows = this.raceRows().slice(0, 4);
    prev.innerHTML = rows.map((r, i) => `
      <div class="race-row ${r.you ? 'you' : ''}">
        <span class="race-rank">${['🥇', '🥈', '🥉', '4'][i] || i + 1}</span>
        <span class="race-name">${r.you ? '⭐ You' : r.name}</span>
        <span class="race-wager">${fmt(Math.floor(r.wagered))}</span>
      </div>`).join('') +
      `<p class="muted" style="font-size:12px;margin-top:8px">Wagered this week — resets Monday. Your real bets count; rivals are simulated.</p>`;
    const list = $('#lbList');
    if (list && !$('#leaderboardOverlay').classList.contains('hidden')) this.renderLeaderboard();
  },
  renderLeaderboard() {
    const list = $('#lbList');
    if (!list) return;
    const rows = this.raceRows();
    list.innerHTML = rows.map((r, i) => `
      <div class="race-row ${r.you ? 'you' : ''}">
        <span class="race-rank">${['🥇', '🥈', '🥉'][i] || (i + 1)}</span>
        <span class="race-name">${r.you ? '⭐ You' : r.name}</span>
        <span class="race-wager">${fmt(Math.floor(r.wagered))}</span>
      </div>`).join('');
  },
  openLeaderboard() {
    this.renderLeaderboard();
    $('#leaderboardOverlay').classList.remove('hidden');
  },

  init() {
    const loop = () => {
      this.botBet();
      setTimeout(loop, 2200 + Math.random() * 3800);
    };
    loop();
    setInterval(() => this.renderRace(), 12000);
    // re-render panels when the lobby is re-created by navigation
    window.addEventListener('hashchange', () => setTimeout(() => {
      this.renderFeed();
      this.renderRace();
    }, 60));
    this.renderRace();
    this.renderFeed();
  },
};
document.addEventListener('DOMContentLoaded', () => Social.init());
window.Social = Social;
