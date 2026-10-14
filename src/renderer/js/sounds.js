// Tiny synthesized UI sounds (no sampled audio is shipped).
//
// Every blip creates an oscillator and a gain node. They are disconnected as
// soon as they finish, so nothing stays attached to the audio graph, and the
// AudioContext is suspended after a short idle period so the audio thread
// isn't kept running between sounds.

let ctx = null;
let enabled = true;
let idleTimer = null;
const IDLE_SUSPEND_MS = 4000;

function context() {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (ctx && ctx.state === 'running') ctx.suspend();
  }, IDLE_SUSPEND_MS);
  return ctx;
}

function tone(freq, duration, { type = 'sine', gain = 0.06, slide = 0 } = {}) {
  if (!enabled) return;
  try {
    const c = context();
    const osc = c.createOscillator();
    const amp = c.createGain();
    const t = c.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(c.destination);
    osc.onended = () => {
      osc.onended = null;
      osc.disconnect();
      amp.disconnect();
    };
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
