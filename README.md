# ⚡ ChainLuck: Demo Casino (Play Money Only)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-live-39d353?logo=githubpages&logoColor=fff)](https://itsfedor.github.io/demo-casino)

A 100% client-side demo crypto casino: six games, provably-fair hashing, a full
progression loop (XP, levels, daily streak bonus, achievements, weekly wager
race, live bet feed, auto-bet) in vanilla JS with **no build step, no
dependencies, no backend**. Every balance is fictional play money.

**This is a demo.** No real funds, no blockchain transactions, nothing is ever
signed or sent. MetaMask connect is read-only (address display only). 18+.

<p align="center">
  <img src="assets/preview.jpg" alt="ChainLuck: Demo Casino" width="80%" />
</p>

## Run

```bash
# any static server works
python3 -m http.server 8080
# or: npx serve .
```

Open http://localhost:8080. Note: on `file://` or plain HTTP the SHA-256
fallback is a deterministic non-cryptographic hash (a browser limit, since real
`crypto.subtle` requires a secure context); the games still work.

Deploy: push to `main`. GitHub Actions deploys to GitHub Pages and cache-busts
asset URLs with the run number automatically.

## Verify the math

```bash
node scripts/rtp-check.mjs
```

Loads the actual game files in a VM sandbox and proves every paytable:

| Game | RTP (verified) | Method |
|---|---|---|
| Dice | **99.000%** both under & over | exact enumeration of all 10,000 rolls |
| Plinko (low/med/high) | 98.98% / 98.99% / 99.12% | exact binomial(12,½) EV + χ² path test |
| Crash | **99.0%** at every cash-out target | P(crash ≥ T) = 0.99/T, Monte-Carlo confirmed |
| Mines | 98.3–99.0% at every cash-out point | exact combinatorics, 1% edge design |
| Slots | 91.94% | exact EV over 8 weighted symbols × 5 lines |
| Blackjack | ~97.5%+ with basic strategy | standard rules: 6 decks, stand all 17, BJ 3:2 |

## Games

- **🚀 Crash**: Aviator-style continuous loop: 6s betting window (draining bar, simulated riders joining) → flight (canvas plane, parallax starfield, engine hum rising with the multiplier, riders cashing out live in the round-bets panel) → "FLEW AWAY" → repeat. Queue bets mid-flight, auto-cash-out, history strip (blue <2× / purple 2–10× / pink ≥10×). Round logic runs on a timer (hidden-tab safe); rendering on rAF.
- **💣 Mines**: 5×5 grid, 1/3/5/10/24 mines, cash out any time
- **🎲 Dice**: Stake-style controls: slider sets the target (2–98), the under/over toggle picks the side and mirrors the chance; ~3s drumroll suspense
- **🔺 Plinko**: up to 8 balls in flight, 3 risk tables, ~2s canvas-physics drops with peg-hit ticks (pitch rises down the board)
- **🃏 Blackjack**: hit/stand/double, keyboard H/S/D
- **🎰 Slots**: 3×3, 5 paylines, ~3s spins with per-reel stop clunks and the two-reels-match anticipation stretch

## Provably fair (Dice, Crash, Mines, Plinko path)

Every round consumes one hash: `sha256(clientSeed:serverSeed:nonce)`.

- Dice: rejection-sampled uniform roll from the first 52 bits
- Crash: crash = `floor(0.99/u · 100)/100` where u = h/2^52
- Mines: hash seeds a Fisher-Yates shuffle of the 25 tiles
- Plinko: 12 hash bits = one L/R decision per peg row, so balls land on a binomial distribution

The seed pair lives in your browser (`cl_seeds`). Press **Rotate & reveal
server seed** in any game to reveal the old seed and verify past rounds against
the previous commitment. Since the "server" seed is stored client-side, this is
verifiable by you, not tamper-proof.

## Retention & progression loop

XP = every DEMO wagered, then quadratic levels, level-up DEMO rewards, and a
topbar progress bar. Daily 🎁 bonus with a streak multiplier (20h cooldown, 48h
streak window). 🚰 Faucet appears when you go broke (15 min cooldown). 16
achievements with DEMO rewards. Weekly wager race vs simulated players (resets
Monday, your real bets count). Live bet feed mixing bot bets with yours.
Auto-bet for Dice/Plinko/Slots (bet count, on-win/on-loss scaling, profit/loss
stops). Global bet history page. Synthesized WebAudio SFX with mute. Confetti at
10×+, mega at 50×+.

## Responsible play (kept, and made real)

Session timer with 30-minute break nags, session net tracker, a **configurable
session loss limit** (Settings ⚙️, actually enforced by `canBet()`), honest RTP
published and machine-verified, and a zero-balance faucet instead of dead ends.

## Layout

```
index.html          shell: sticky head (topbar+tabs), modals, script tags
styles.css          full theme (dark neon, glassy cards, one breakpoint)
js/app.js           state, persistence, fair primitives, router, logBet ledger
js/sound.js         WebAudio-synthesized SFX
js/meta.js          XP/levels, daily bonus, faucet, achievements, confetti, settings
js/social.js        live bet feed bots + weekly wager race
js/autobet.js       shared auto-bet panel (dice/plinko/slots)
js/history.js       #/history page
js/wallet.js        read-only MetaMask / simulated wallet, fake deposits
js/{dice,plinko,blackjack,slots,crash,mines}.js   the games
scripts/rtp-check.mjs   math verification (CI-runnable, exits non-zero on failure)
```

State lives in `localStorage` (`cl_*` keys); Settings → Reset wipes everything.

## License

[MIT](LICENSE)
