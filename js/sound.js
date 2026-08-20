'use strict';
/* WebAudio-synthesized SFX — no audio files, no network. Mute persists.
   Design follows the "rise, pause, click, finish" arc: subtle loops that
   intensify, sparse betting phase, crisp result sounds, impactful but
   non-fatiguing busts. */
const sfx = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('cl_muted') === '1'; } catch (e) { /* blocked storage */ }

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers block audio until a user gesture — warm the context on the first one.
  document.addEventListener('pointerdown', () => { if (!muted) { try { ac(); } catch (e) { /* no audio */ } } },
    { once: true, passive: true });

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted) return;
    try {
      const c = ac();
      const t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (e) { /* audio unavailable */ }
  }
  function noise(dur, vol, filterFreq) {
    if (muted) return;
    try {
      const c = ac();
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf;
      g.gain.value = vol || 0.1;
      if (filterFreq) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = filterFreq;
        src.connect(f).connect(g);
      } else {
        src.connect(g);
      }
      g.connect(c.destination);
      src.start();
    } catch (e) { /* audio unavailable */ }
  }

  /* ---- persistent flight engine loop (Crash) ---- */
  let engOsc = null, engGain = null;
  function engineStart() {
    if (muted || engOsc) return;
    try {
      const c = ac();
      engOsc = c.createOscillator();
      engGain = c.createGain();
      engOsc.type = 'sawtooth';
      engOsc.frequency.value = 64;
      engGain.gain.value = 0.0;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420;
      engOsc.connect(lp).connect(engGain).connect(c.destination);
      engOsc.start();
      engGain.gain.linearRampToValueAtTime(0.035, c.currentTime + 0.5);
    } catch (e) { engOsc = null; }
  }
  function engineSet(p) { // p ∈ 0..1 — pitch/volume creep up with the multiplier
    if (!engOsc || muted) return;
    try {
      engOsc.frequency.value = 64 + p * 150;
      engGain.gain.value = 0.03 + p * 0.045;
    } catch (e) { /* gone */ }
  }
  function engineStop() {
    if (!engOsc) return;
    try {
      const o = engOsc, g = engGain, c = ctx;
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value || 0.03, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.12);
      o.stop(c.currentTime + 0.15);
    } catch (e) { /* already stopped */ }
    engOsc = null; engGain = null;
  }

  return {
    isMuted: () => muted,
    toggle() {
      muted = !muted;
      try { localStorage.setItem('cl_muted', muted ? '1' : '0'); } catch (e) { /* blocked */ }
      if (muted) engineStop();
      else tone(660, 0.08, 'sine', 0.1);
      return muted;
    },

    /* UI + bets */
    click() { tone(520, 0.05, 'triangle', 0.07); },
    bet() { tone(320, 0.09, 'square', 0.06, 180); },

    /* dice */
    drum(p) { tone(85 + p * 55, 0.03, 'square', 0.05); }, // suspense roll, p ∈ 0..1 rising
    tick(p) { tone(300 + (p || 0) * 600, 0.05, 'sine', 0.05); },

    /* plinko */
    drop() { tone(620, 0.16, 'sine', 0.05, 190); },
    peg(row) { tone(170 + row * 26, 0.045, 'square', 0.035); }, // pitch rises down the board

    /* slots */
    spinTick() { tone(240, 0.02, 'square', 0.025); },
    reelStop(i) { tone(150 - i * 12, 0.09, 'square', 0.09, 95); noise(0.05, 0.04, 900); },
    antic(p) { tone(500 + p * 700, 0.06, 'sine', 0.07); }, // anticipation, rising
    lineWin(k) { tone(620 + k * 130, 0.12, 'sine', 0.1); tone(930 + k * 130, 0.14, 'sine', 0.08, null, 0.08); },

    /* results */
    win() { tone(523, 0.1, 'sine', 0.12); tone(659, 0.12, 'sine', 0.12, null, 0.09); tone(784, 0.16, 'sine', 0.12, null, 0.19); },
    bigwin() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'sine', 0.13, null, i * 0.09));
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f * 2, 0.14, 'triangle', 0.05, null, 0.45 + i * 0.07));
    },
    lose() { tone(220, 0.18, 'sine', 0.09, 140); },
    bust() { noise(0.35, 0.16); tone(160, 0.4, 'sawtooth', 0.12, 60); },
    cash() { tone(880, 0.09, 'sine', 0.14); tone(1320, 0.16, 'sine', 0.12, null, 0.08); },
    coin() { tone(988, 0.07, 'square', 0.06); tone(1319, 0.12, 'square', 0.05, null, 0.06); },
    level() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.13, null, i * 0.1)); },
    ach() { tone(784, 0.1, 'sine', 0.12); tone(988, 0.1, 'sine', 0.12, null, 0.1); tone(1319, 0.2, 'sine', 0.12, null, 0.2); },

    /* crash flight arc */
    engineStart, engineSet, engineStop,
    takeoff() { tone(140, 0.5, 'triangle', 0.07, 520); },
    flyaway() { engineStop(); noise(0.4, 0.17, 1400); tone(210, 0.45, 'sawtooth', 0.12, 55); },
  };
})();
window.sfx = sfx;
