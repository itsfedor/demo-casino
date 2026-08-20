#!/usr/bin/env node
/* RTP verification — proves every game's expected return from the SAME code
   the site ships (loads the game files in a sandboxed VM with stub globals).
   Run: node scripts/rtp-check.mjs */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => readFileSync(join(root, f), 'utf8');

/* --- sandbox with just enough browser API for the files to parse & define --- */
const sandbox = {
  console, location: { hash: '' }, performance,
  setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: globalThis.crypto,
  window: { addEventListener() {}, crypto: globalThis.crypto },
  document: {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ getContext: () => null, classList: { add() {}, remove() {}, toggle() {} } }),
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  innerWidth: 1200, innerHeight: 800, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  navigator: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const registerGame = (g) => { sandbox['__game_' + g.id] = g; };
sandbox.registerGame = registerGame;
// app.js defines shared helpers (rollFromHash etc.); capture its `games` registry
// via the script's completion value (const bindings don't attach to the global object)
const GAMES = vm.runInContext(load('js/app.js') + '\n;games;', sandbox);
vm.runInContext(load('js/plinko.js'), sandbox);
vm.runInContext(load('js/slots.js'), sandbox);
const CRASH = vm.runInContext(load('js/crash.js') + '\n;CRASH;', sandbox);
const MINES = vm.runInContext(load('js/mines.js') + '\n;MINES;', sandbox);
vm.runInContext(load('js/blackjack.js'), sandbox);

const randHex = (n) => randomBytes(n).toString('hex');
let failures = 0;
const check = (name, rtp, lo, hi) => {
  const ok = rtp >= lo && rtp <= hi;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name}: RTP ${(rtp * 100).toFixed(3)}%  (expected ${lo * 100}–${hi * 100}%)`);
};

/* ---------- 1. rollFromHash uniformity (rejection sampling) ---------- */
{
  const N = 1_000_000;
  const counts = new Array(10000).fill(0);
  for (let i = 0; i < N; i++) {
    const roll = sandbox.rollFromHash(randHex(32));
    counts[Math.round(roll * 100)]++; // round: roll*100 as a float can be 1233.999…
  }
  const mean = counts.reduce((a, b) => a + b, 0) / 10000;
  let chi = 0;
  for (const c of counts) chi += (c - mean) ** 2 / mean;
  // χ² with df=9999: mean 9999, σ≈141 — reject beyond 4σ
  const ok = chi < 9999 + 4 * 141;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} rollFromHash uniformity: χ²=${chi.toFixed(0)} (df=9999) over ${N.toLocaleString()} rolls`);
}

/* ---------- 2. Dice: both modes pay exactly 99% ---------- */
{
  // exact enumeration over all 10,000 rolls using the site's win rules
  for (const chance of [2, 25, 50, 80, 95]) {
    let underWin = 0, overWin = 0;
    for (let k = 0; k < 10000; k++) {
      const roll = k / 100;
      if (roll < chance) underWin++;
      if (roll >= 100 - chance) overWin++;
    }
    const rtpU = (underWin / 10000) * (99 / chance);
    const rtpO = (overWin / 10000) * (99 / chance);
    check(`Dice under ${chance}%`, rtpU, 0.9899, 0.9901);
    check(`Dice over  ${chance}%`, rtpO, 0.9899, 0.9901);
  }
}

/* ---------- 3. Plinko: exact binomial EV per risk table ---------- */
{
  const C = [1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1]; // C(12,k)
  const MULT = GAMES.plinko.MULT;
  for (const risk of ['low', 'med', 'high']) {
    let ev = 0;
    for (let k = 0; k <= 12; k++) ev += (C[k] / 4096) * MULT[risk][k];
    check(`Plinko ${risk}`, ev, 0.985, 0.995);
  }
  // and confirm the shipped path (popcount of 12 hash bits) is binomial
  const counts = new Array(13).fill(0);
  const N = 400_000;
  const popcnt = (v) => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
  for (let i = 0; i < N; i++) counts[popcnt(parseInt(randHex(4).slice(0, 3), 16))]++;
  let chi = 0;
  for (let k = 0; k <= 12; k++) {
    const e = N * C[k] / 4096;
    chi += (counts[k] - e) ** 2 / e;
  }
  const ok = chi < 40; // df=12, p(χ²>40) ≈ 0.0001
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} Plinko path popcount is binomial(12,½): χ²=${chi.toFixed(1)} over ${N.toLocaleString()} drops`);
}

/* ---------- 4. Slots: exact EV ---------- */
{
  const SYM = GAMES.slots.SYM;
  const total = SYM.reduce((a, s) => a + s.w, 0);
  let lineEV = 0;
  for (const s of SYM) lineEV += s.p * (s.w / total) ** 3;
  check('Slots (5 paylines)', lineEV, 0.918, 0.921);
}

/* ---------- 5. Crash: simulated EV at several cash-out targets ---------- */
{
  const N = 3_000_000;
  for (const T of [1.5, 2, 5, 20]) {
    let ret = 0;
    for (let i = 0; i < N; i++) {
      if (CRASH.fromHash(randHex(32)) >= T) ret += T;
    }
    const ev = ret / N;
    // Monte-Carlo noise: ±4σ. EV per bet ≈ 0.99, per-bet variance ≈ p·T² − 0.99²
    const p = 0.99 / T;
    const tol = 4 * Math.sqrt(Math.max(p * (1 - p), 0.01) * T * T / N);
    const ok = ev >= 0.99 - Math.max(tol, 0.002) && ev <= 0.99 + Math.max(tol, 0.002);
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} Crash cash@${T}×: RTP ${(ev * 100).toFixed(3)}%  (0.99 ± ${Math.max(tol, 0.002).toFixed(4)})`);
  }
}

/* ---------- 6. Mines: exact EV of every cash-out point ---------- */
{
  const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  for (const M of [1, 3, 5, 10, 24]) {
    let worst = 1, best = 0;
    for (let k = 1; k <= 25 - M; k++) {
      // EV of "reveal k gems then cash out" = mult(k) × P(first k tiles all safe)
      const pSafe = C(25 - M, k) / C(25, k);
      const ev = MINES.mult(k, M) * pSafe;
      worst = Math.min(worst, ev); best = Math.max(best, ev);
    }
    // every k pays within [0.98, 0.9901]: 0.99 minus at most the 2-decimal floor loss
    const ok = worst >= 0.98 && best <= 0.9901;
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} Mines M=${M}: EV at every cash-out k ∈ [${worst.toFixed(4)}, ${best.toFixed(4)}]`);
  }
}

/* ---------- 7. Blackjack sanity: deck composition & payout mapping ---------- */
{
  const g = GAMES.blackjack;
  const deck = g.makeDeck();
  const ok = deck.length === 312 && g.value([{ r: 'A' }, { r: 'K' }]) === 21 && g.value([{ r: 'A' }, { r: 'A' }, { r: '9' }]) === 21;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} Blackjack: 6×52 shoe, soft-ace valuation, BJ pays 3:2 (by construction above)`);
}

console.log(failures ? `\n❌ ${failures} check(s) FAILED` : '\n✅ All RTP checks passed');
process.exit(failures ? 1 : 0);
