// Tiny synthesized UI sounds (no sampled audio is shipped).

let ctx = null;
let enabled = true;

function tone(freq, duration, { type = 'sine', gain = 0.06, slide = 0 } = {}) {
  if (!enabled) return;
  try {
    ctx = ctx || new AudioContext();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  } catch { /* audio unavailable */ }
}

export const sounds = {
  setEnabled(v) { enabled = v; },
  move: () => tone(1250, 0.05, { type: 'triangle', gain: 0.035 }),
  pivot: () => tone(620, 0.12, { type: 'sine', slide: 1.6 }),
  select: () => { tone(880, 0.08); setTimeout(() => tone(1320, 0.12), 60); },
  back: () => tone(700, 0.12, { slide: 0.6 }),
  error: () => tone(180, 0.25, { type: 'square', gain: 0.03 }),
};
