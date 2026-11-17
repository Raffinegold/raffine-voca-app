/**
 * 게임 효과음 — 오디오 파일 없이 WebAudio 오실레이터·노이즈로만 만듭니다.
 * 아이패드·아이폰은 첫 제스처(버튼 터치) 안에서 AudioContext 를 열어야 소리가 납니다.
 */

const MUTE_KEY = 'rafine-voca-sound-muted-v1';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationMs: number, delayMs = 0, type: OscillatorType = 'sine', volume = 0.14) {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

/** 주파수를 미끄러뜨리는 소리 (레이저·휘두르기·하강음) */
function sweep(from: number, to: number, durationMs: number, delayMs = 0, type: OscillatorType = 'sawtooth', volume = 0.1) {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + durationMs / 1000);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

/** 폭발·타격용 노이즈 (짧은 화이트노이즈를 로우패스로 깎아 씁니다) */
function noise(durationMs: number, volume = 0.12, filterFreq = 1200, delayMs = 0) {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delayMs / 1000;
  const len = Math.max(1, Math.floor((ac.sampleRate * durationMs) / 1000));
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(120, filterFreq * 0.35), start + durationMs / 1000);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(start);
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (!next) tone(660, 90);
}

export const sfx = {
  /* --- 공통 --- */
  flip() {
    tone(520, 70, 0, 'triangle', 0.08);
  },
  tap() {
    tone(740, 45, 0, 'triangle', 0.05);
  },
  match(combo = 1) {
    const base = 620 + Math.min(combo - 1, 4) * 80;
    tone(base, 110, 0, 'sine', 0.12);
    tone(base * 1.5, 140, 90, 'sine', 0.1);
  },
  combo(n = 2) {
    const notes = [784, 988, 1175, 1568];
    notes.slice(0, Math.min(3, n + 1)).forEach((f, i) => tone(f, 110, i * 60, 'triangle', 0.09));
  },
  miss() {
    tone(240, 150, 0, 'sawtooth', 0.07);
    tone(180, 180, 110, 'sawtooth', 0.06);
  },
  fail() {
    sweep(520, 140, 320, 0, 'sawtooth', 0.08);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 200, i * 110, 'sine', 0.12));
  },
  reward() {
    [880, 1175].forEach((f, i) => tone(f, 140, i * 90, 'triangle', 0.1));
  },
  coin() {
    tone(988, 60, 0, 'triangle', 0.08);
    tone(1480, 100, 55, 'triangle', 0.07);
  },

  /* --- 슈팅 · 타자 디펜스 --- */
  laser() {
    sweep(1600, 320, 150, 0, 'square', 0.05);
  },
  explode() {
    noise(280, 0.16, 1600);
    sweep(420, 90, 260, 0, 'sine', 0.1);
    tone(70, 200, 20, 'sine', 0.12);
  },
  hurt() {
    sweep(320, 90, 240, 0, 'sawtooth', 0.1);
    noise(130, 0.08, 700);
  },
  alarm() {
    [0, 160].forEach((d) => tone(760, 110, d, 'square', 0.07));
  },
  charge() {
    sweep(180, 900, 280, 0, 'sine', 0.06);
  },

  /* --- 전투 --- */
  slash() {
    noise(150, 0.1, 3200);
    sweep(1800, 500, 140, 0, 'sawtooth', 0.06);
  },
  hit() {
    tone(170, 90, 0, 'square', 0.1);
    noise(90, 0.1, 900);
  },
  hurtPlayer() {
    tone(150, 180, 0, 'square', 0.09);
    sweep(240, 110, 200, 0, 'sawtooth', 0.07);
  },
  chargeUp() {
    sweep(240, 1200, 420, 0, 'sine', 0.05);
  },
  victory() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 240, i * 120, 'triangle', 0.11));
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 260, i * 150, 'sine', 0.1));
  },

  /* --- 로봇 · 퍼즐 --- */
  step() {
    tone(220, 50, 0, 'square', 0.05);
  },
  turn() {
    tone(380, 60, 0, 'triangle', 0.06);
  },
  bump() {
    tone(120, 140, 0, 'square', 0.09);
    noise(90, 0.07, 600);
  },
  goal() {
    [660, 880, 1100].forEach((f, i) => tone(f, 150, i * 90, 'triangle', 0.1));
    noise(200, 0.06, 2400, 60);
  },
  fly() {
    sweep(300, 1200, 220, 0, 'sine', 0.06);
  },

  /* --- 해킹 --- */
  key() {
    tone(420, 30, 0, 'square', 0.035);
  },
  lockOpen() {
    tone(300, 60, 0, 'square', 0.07);
    tone(760, 90, 45, 'triangle', 0.07);
    tone(1180, 130, 110, 'sine', 0.08);
  },
  grant() {
    [523, 784, 1047, 1568].forEach((f, i) => tone(f, 180, i * 100, 'square', 0.07));
  },
  trace() {
    [0, 120, 240].forEach((d) => tone(880, 80, d, 'square', 0.06));
  },
};
