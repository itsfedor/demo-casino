'use strict';
/* Meta — progression & rewards: XP/levels, daily bonus + streak, faucet,
   achievements, confetti celebrations, settings (loss limit, sound, reset).
   All state lives in the single cl_meta localStorage key. */

const Meta = {
  xp: 0,
  level: 1,
  dailyLast: 0,
  dailyStreak: 0,
  faucetLast: 0,
  ach: {},          // id -> unlock timestamp
  stats: { bets: 0, wins: 0, streak: 0, wager: 0, best: 0 },
  games: {},        // game id -> 1 (played)
  weekly: 0,        // wagered this week (for the race)
  weekStart: 0,

  DAILY_COOLDOWN: 20 * 3600 * 1000,
  STREAK_WINDOW: 48 * 3600 * 1000,
  FAUCET_COOLDOWN: 15 * 60 * 1000,
  FAUCET_BALANCE: 100,

  /* Cumulative XP needed to reach level L (level 1 = 0). Quadratic growth:
     250·Σi² — level 2 at 250 XP, 5 at 4,000, 10 at 71,250 wagered. */
  xpForLevel(L) {
    let s = 0;
    for (let i = 1; i < L; i++) s += 250 * i * i;
    return s;
  },

  load() {
    try {
      const m = JSON.parse(localStorage.getItem('cl_meta') || '{}');
      Object.assign(this, {
        xp: m.xp || 0, level: m.level || 1,
        dailyLast: m.dailyLast || 0, dailyStreak: m.dailyStreak || 0,
        faucetLast: m.faucetLast || 0, ach: m.ach || {},
        stats: Object.assign({ bets: 0, wins: 0, streak: 0, wager: 0, best: 0 }, m.stats || {}),
        games: m.games || {}, weekly: m.weekly || 0, weekStart: m.weekStart || 0,
      });
    } catch (e) { /* fresh */ }
    // Weekly race resets Monday 00:00 local time
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    if (this.weekStart !== monday.getTime()) {
      this.weekStart = monday.getTime();
      this.weekly = 0;
    }
  },
  save() {
    try {
      localStorage.setItem('cl_meta', JSON.stringify({
        xp: this.xp, level: this.level, dailyLast: this.dailyLast, dailyStreak: this.dailyStreak,
        faucetLast: this.faucetLast, ach: this.ach, stats: this.stats, games: this.games,
        weekly: this.weekly, weekStart: this.weekStart,
      }));
    } catch (e) { /* blocked */ }
  },

  /* ---------- daily bonus & faucet ---------- */
  dailyReady() { return Date.now() - this.dailyLast >= this.DAILY_COOLDOWN; },
  dailyNext() { return Math.max(0, this.DAILY_COOLDOWN - (Date.now() - this.dailyLast)); },
  claimDaily() {
    if (!this.dailyReady()) {
      const h = Math.floor(this.dailyNext() / 3600000), m = Math.ceil((this.dailyNext() % 3600000) / 60000);
      toast(`Daily bonus ready in ${h}h ${m}m ⏳`, 'warn');
      return;
    }
    this.dailyStreak = (Date.now() - this.dailyLast <= this.STREAK_WINDOW && this.dailyLast > 0)
      ? this.dailyStreak + 1 : 1;
    this.dailyLast = Date.now();
    const reward = 500 + 250 * Math.min(this.dailyStreak, 15);
    App.balance += reward;
    saveState();
    this.save();
    this.refreshTopbar();
    updateBalance();
    toast(`🎁 Daily bonus: +${fmt(reward)} DEMO · ${this.dailyStreak}-day streak!`, 'success');
    if (window.sfx) sfx.coin();
  },
  faucetAvailable() { return App.balance < this.FAUCET_BALANCE && Date.now() - this.faucetLast >= this.FAUCET_COOLDOWN; },
  claimFaucet() {
    if (App.balance >= this.FAUCET_BALANCE) { toast('Faucet is only for broke balances 🚰', 'warn'); return; }
    if (Date.now() - this.faucetLast < this.FAUCET_COOLDOWN) {
      const m = Math.ceil((this.FAUCET_COOLDOWN - (Date.now() - this.faucetLast)) / 60000);
      toast(`Faucet recharging — try again in ${m} min`, 'warn');
      return;
    }
    this.faucetLast = Date.now();
    App.balance += 1000;
    saveState();
    this.save();
    this.refreshTopbar();
    updateBalance();
    toast('🚰 Faucet: +1,000 DEMO. Spend it wisely!', 'success');
    if (window.sfx) sfx.coin();
  },

  /* ---------- the central hook: every settled bet lands here ---------- */
  onBet(e) {
    this.stats.bets++;
    this.stats.wager += e.bet;
    this.weekly += e.bet;
    this.games[e.game] = 1;
    if (e.profit > 0) { this.stats.wins++; this.stats.streak++; }
    else if (e.profit < 0) { this.stats.streak = 0; }
    if (e.mult > this.stats.best) this.stats.best = e.mult;

    // XP = total wagered (classic comp model)
    const oldLevel = this.level;
    const betWon = e.profit > 0;
    this.xp += e.bet;
    while (this.xp >= this.xpForLevel(this.level + 1)) {
      this.level++;
      const reward = 300 * this.level;
      App.balance += reward;
      saveState();
      toast(`⬆️ Level ${this.level}! +${fmt(reward)} DEMO level reward`, 'success');
      // stagger meta audio AFTER the game's own result sound; confetti only
      // when the triggering bet actually won — no celebration stacked on a loss
      setTimeout(() => {
        if (window.sfx) sfx.level();
        if (betWon) celebrate(1);
      }, 900);
    }
    if (this.level !== oldLevel) updateBalance();

    // win celebrations by multiplier tier
    if (e.profit > 0 && e.mult >= 50) celebrate(2);
    else if (e.profit > 0 && e.mult >= 10) celebrate(1);

    this.checkAchievements(e);
    this.save();
    this.refreshTopbar();
  },

  /* ---------- achievements ---------- */
  ACH: [
    { id: 'first', icon: '🎯', name: 'First bet', desc: 'Place your first bet', reward: 100, check: s => s.bets >= 1 },
    { id: 'bets10', icon: '🎰', name: 'Warming up', desc: 'Place 10 bets', reward: 250, check: s => s.bets >= 10 },
    { id: 'bets100', icon: '🔥', name: 'Century club', desc: 'Place 100 bets', reward: 1000, check: s => s.bets >= 100 },
    { id: 'bets1000', icon: '💀', name: 'Degen mode', desc: 'Place 1,000 bets', reward: 5000, check: s => s.bets >= 1000 },
    { id: 'streak3', icon: '🎲', name: 'Hot hand', desc: 'Win 3 bets in a row', reward: 300, check: s => s.streak >= 3 },
    { id: 'streak5', icon: '⚡', name: 'Unstoppable', desc: 'Win 5 bets in a row', reward: 800, check: s => s.streak >= 5 },
    { id: 'x10', icon: '💥', name: 'Big hit', desc: 'Win at 10× or more', reward: 500, check: (s, e) => e && e.profit > 0 && e.mult >= 10 },
    { id: 'x50', icon: '🌟', name: 'Moonshot', desc: 'Win at 50× or more', reward: 2500, check: (s, e) => e && e.profit > 0 && e.mult >= 50 },
    { id: 'allgames', icon: '🕹️', name: 'Full tour', desc: 'Play all six games', reward: 1000, check: s => s.gamesCount >= 6 },
    { id: 'wager10k', icon: '💰', name: 'High roller I', desc: 'Wager 10,000 DEMO total', reward: 500, check: s => s.wager >= 10000 },
    { id: 'wager100k', icon: '🐋', name: 'High roller II', desc: 'Wager 100,000 DEMO total', reward: 5000, check: s => s.wager >= 100000 },
    { id: 'level5', icon: '🎖️', name: 'Rising star', desc: 'Reach level 5', reward: 400, check: s => s.level >= 5 },
    { id: 'level10', icon: '👑', name: 'Casino royalty', desc: 'Reach level 10', reward: 2000, check: s => s.level >= 10 },
    { id: 'natural', icon: '🃏', name: 'Natural 21', desc: 'Win a blackjack hand', reward: 300, check: (s, e) => e && e.game === 'blackjack' && e.profit > 0 },
    { id: 'crash5', icon: '🚀', name: 'Astro cash-out', desc: 'Cash out Crash at 5×+', reward: 600, check: (s, e) => e && e.game === 'crash' && e.mult >= 5 },
    { id: 'minesweeper', icon: '💣', name: 'Mine sweeper', desc: 'Cash out Mines at 4×+', reward: 600, check: (s, e) => e && e.game === 'mines' && e.mult >= 4 },
  ],
  checkAchievements(e) {
    const s = {
      bets: this.stats.bets, wins: this.stats.wins, streak: this.stats.streak,
      wager: this.stats.wager, best: this.stats.best, level: this.level,
      gamesCount: Object.keys(this.games).length,
    };
    for (const a of this.ACH) {
      if (this.ach[a.id]) continue;
      let ok = false;
      try { ok = !!a.check(s, e); } catch (err) { ok = false; }
      if (ok) {
        this.ach[a.id] = Date.now();
        App.balance += a.reward;
        saveState();
        toast(`🏆 Achievement: ${a.icon} ${a.name} · +${fmt(a.reward)} DEMO`, 'success');
        // delayed so it never lands on top of a losing bet's sound
        setTimeout(() => { if (window.sfx) sfx.ach(); }, 900);
      }
    }
  },

  /* ---------- topbar UI ---------- */
  refreshTopbar() {
    const cur = this.xpForLevel(this.level);
    const next = this.xpForLevel(this.level + 1);
    const pct = clamp((this.xp - cur) / (next - cur) * 100, 0, 100);
    const fill = $('#xpFill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    const lvl = $('#lvlChip');
    if (lvl) lvl.textContent = 'Lv ' + this.level;
    const tt = $('#xpWrap');
    if (tt) tt.title = `Level ${this.level} · ${fmt(Math.floor(this.xp - cur))} / ${fmt(next - cur)} XP to level ${this.level + 1}`;

    const gift = $('#dailyBtn');
    if (gift) {
      gift.classList.toggle('ready', this.dailyReady());
      gift.title = this.dailyReady()
        ? `🎁 Daily bonus ready! (${this.dailyStreak}-day streak ×${Math.min(this.dailyStreak || 1, 15)})`
        : `Daily bonus in ${Math.ceil(this.dailyNext() / 60000)} min`;
    }
    const f = $('#faucetBtn');
    if (f) f.classList.toggle('hidden', !this.faucetAvailable());
  },

  renderAchievements() {
    const list = $('#achList');
    if (!list) return;
    const unlocked = Object.keys(this.ach).length;
    $('#achProgress').textContent = `${unlocked} / ${this.ACH.length} unlocked`;
    list.innerHTML = this.ACH.map(a => {
      const got = !!this.ach[a.id];
      return `<div class="ach-row ${got ? 'got' : ''}">
        <span class="ach-ico">${got ? a.icon : '🔒'}</span>
        <span class="ach-txt"><b>${a.name}</b><small>${a.desc}</small></span>
        <span class="ach-reward ${got ? 'win' : 'muted'}">+${fmt(a.reward)}</span>
      </div>`;
    }).join('');
  },
};

/* ---------- confetti celebrations ---------- */
function celebrate(tier) {
  const cv = $('#confetti');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#22d3ee', '#f43f8e', '#ffd54a', '#4ade80', '#60a5fa', '#f97316'];
  const N = tier >= 2 ? 260 : 130;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.35,
      y: innerHeight * (tier >= 2 ? 0.35 : 0.55),
      vx: (Math.random() - 0.5) * (tier >= 2 ? 16 : 11),
      vy: -Math.random() * (tier >= 2 ? 16 : 11) - 3,
      w: 5 + Math.random() * 7, h: 3 + Math.random() * 5,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
      col: colors[(Math.random() * colors.length) | 0],
      life: 1,
    });
  }
  const t0 = performance.now();
  const step = (t) => {
    const dt = Math.min((t - t0) / 1600, 1);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.life = 1 - dt;
      if (p.life <= 0 || p.y > innerHeight + 20) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(step);
}

/* ---------- wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  Meta.load();
  Meta.refreshTopbar();

  $('#dailyBtn')?.addEventListener('click', () => Meta.claimDaily());
  $('#faucetBtn')?.addEventListener('click', () => Meta.claimFaucet());
  $('#soundBtn')?.addEventListener('click', (ev) => {
    const m = sfx.toggle();
    ev.currentTarget.textContent = m ? '🔇' : '🔊';
    toast(m ? 'Sound off' : 'Sound on');
  });
  if (sfx.isMuted()) { const b = $('#soundBtn'); if (b) b.textContent = '🔇'; }

  // settings modal
  $('#settingsBtn')?.addEventListener('click', () => {
    $('#lossLimitIn').value = App.lossLimit || '';
    $('#settingsOverlay').classList.remove('hidden');
  });
  $('#lossLimitSave')?.addEventListener('click', () => {
    const v = parseFloat($('#lossLimitIn').value) || 0;
    App.lossLimit = v > 0 ? v : 0;
    try { localStorage.setItem('cl_loss_limit', String(App.lossLimit)); } catch (e) { /* blocked */ }
    $('#settingsOverlay').classList.add('hidden');
    toast(App.lossLimit > 0
      ? `Loss limit set to ${fmt(App.lossLimit)} DEMO for this session`
      : 'Loss limit cleared');
  });
  let resetArmed = false;
  $('#resetDataBtn')?.addEventListener('click', (ev) => {
    if (!resetArmed) {
      resetArmed = true;
      ev.currentTarget.textContent = '⚠️ Click again to wipe everything';
      setTimeout(() => { resetArmed = false; const b = $('#resetDataBtn'); if (b) b.textContent = '🗑 Reset all demo data'; }, 3000);
      return;
    }
    try {
      Object.keys(localStorage).filter(k => k.startsWith('cl_')).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* blocked */ }
    location.reload();
  });

  // achievements modal (opens from lobby card or topbar trophy)
  const openAch = () => { Meta.renderAchievements(); $('#achOverlay').classList.remove('hidden'); };
  $('#achBtn')?.addEventListener('click', openAch);
  document.addEventListener('click', (e) => {
    if (e.target.closest('#achOpen')) openAch();
    if (e.target.closest('#raceOpen') && window.Social) Social.openLeaderboard();
  });

  // keep the daily countdown fresh
  setInterval(() => Meta.refreshTopbar(), 60000);
});
window.Meta = Meta;
