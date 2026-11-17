/**
 * 짝맞추기 게임 효과음 — 오디오 파일 없이 WebAudio 오실레이터로만 만듭니다.
 * 아이패드·아이폰은 첫 제스처(카드 터치) 안에서 AudioContext 를 열어야 소리가 납니다.
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
  flip() {
    tone(520, 70, 0, 'triangle', 0.08);
  },
  match(combo = 1) {
    const base = 620 + Math.min(combo - 1, 4) * 80;
    tone(base, 110, 0, 'sine', 0.12);
    tone(base * 1.5, 140, 90, 'sine', 0.1);
  },
  miss() {
    tone(240, 150, 0, 'sawtooth', 0.07);
    tone(180, 180, 110, 'sawtooth', 0.06);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 200, i * 110, 'sine', 0.12));
  },
  reward() {
    [880, 1175].forEach((f, i) => tone(f, 140, i * 90, 'triangle', 0.1));
  },
};
