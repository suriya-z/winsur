// 8-bit style synthesized sounds (no asset downloads required)
// Custom packs: drop .wav/.mp3 into %USERPROFILE%\.winsur\sounds\

export type SoundEvent =
  | "done"
  | "permission"
  | "question"
  | "plan"
  | "error"
  | "send"
  | "jump";

let ctx: AudioContext | null = null;
let enabled = true;
let volume = 0.35;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function setSoundVolume(v: number) {
  volume = Math.max(0, Math.min(1, v / 100));
}

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Simple square-wave blip sequence */
function blip(freqs: number[], dur = 0.07, type: OscillatorType = "square") {
  if (!enabled) return;
  try {
    const c = ac();
    const now = c.currentTime;
    freqs.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(volume * 0.25, now + i * dur + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * dur + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(now + i * dur);
      o.stop(now + i * dur + dur + 0.02);
    });
  } catch {
    /* ignore autoplay policy */
  }
}

async function tryCustom(_name: string): Promise<boolean> {
  // Optional: user places files via settings path documented in UI
  // Browser/Electron file:// from userData not always allowed — use generated only for reliability
  return false;
}

export function playSound(ev: SoundEvent) {
  if (!enabled) return;
  void tryCustom(ev).then((ok) => {
    if (ok) return;
    switch (ev) {
      case "done":
        blip([523, 659, 784], 0.08); // C E G
        break;
      case "permission":
        blip([392, 392, 330], 0.1);
        break;
      case "question":
        blip([440, 554], 0.09);
        break;
      case "plan":
        blip([349, 440, 523, 440], 0.07);
        break;
      case "error":
        blip([200, 150], 0.12, "sawtooth");
        break;
      case "send":
        blip([660, 880], 0.05);
        break;
      case "jump":
        blip([300, 600], 0.05);
        break;
      default:
        blip([440], 0.06);
    }
  });
}
