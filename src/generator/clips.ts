// ---------------------------------------------------------------------------
// Sound clips for the audio and lip sync tests.
//
// Everything here is made by this code or by a text-to-speech run (the voice
// announcements and the lip sync speech, in public/audio), so there is nothing
// to license. Synthesised clips are built on first use; the spoken ones are
// fetched and decoded when sound is first switched on.
// ---------------------------------------------------------------------------

export type ClipData = { rate: number; channels: Float32Array[] };

const RATE = 48000;

/** Small deterministic random numbers, so a clip is the same every time. */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const fade = (x: Float32Array, rate: number, seconds: number) => {
  const n = Math.min(Math.floor(x.length / 2), Math.round(seconds * rate));
  for (let i = 0; i < n; i += 1) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
};

const normalise = (chs: Float32Array[], peak: number) => {
  let m = 0;
  chs.forEach((c) => c.forEach((v) => (m = Math.max(m, Math.abs(v)))));
  if (m > 0) chs.forEach((c) => c.forEach((_, i) => (c[i] *= peak / m)));
};

/** Pink noise (equal energy per octave): what speakers and rooms are usually judged with. */
export const pinkNoise = (seconds: number, seed = 7, rate = RATE): Float32Array => {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i += 1) {
    const white = r() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  return out;
};

/** Pink noise, the same in both ears or with the right side upside down. */
const noisePair = (inverted: boolean): ClipData => {
  const l = pinkNoise(2.5);
  fade(l, RATE, 0.03);
  normalise([l], 0.8);
  const r = inverted ? l.map((v) => -v) : l.slice();
  return { rate: RATE, channels: [l, r] };
};

/** The frequency sweep covers the whole range of hearing. */
export const SWEEP = { from: 20, to: 20000, seconds: 10 };

/** The frequency of the sweep `t` seconds into its clip (exponential, so every octave takes the same time). */
export const sweepHz = (t: number): number => SWEEP.from * Math.pow(SWEEP.to / SWEEP.from, Math.max(0, Math.min(1, t / SWEEP.seconds)));

const sweepClip = (): ClipData => {
  const n = Math.round(SWEEP.seconds * RATE);
  const x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    phase += (2 * Math.PI * sweepHz(i / RATE)) / RATE;
    x[i] = Math.sin(phase);
  }
  fade(x, RATE, 0.08);
  normalise([x], 0.9);
  return { rate: RATE, channels: [x, x.slice()] };
};

/** The left-to-right stereo sweep: a pulsing tone that moves from the left speaker to the right. */
export const PAN = { seconds: 6, hz: 523.25 };

/** How far right the sound is, 0 (all left) to 1 (all right), `t` seconds into the clip. */
export const panPosition = (t: number): number => Math.max(0, Math.min(1, t / PAN.seconds));

const panClip = (): ClipData => {
  const n = Math.round(PAN.seconds * RATE);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const w = 2 * Math.PI * PAN.hz * t;
    // A tone with a few harmonics, pulsing five times a second so the ear can place it.
    const tone = Math.sin(w) + 0.4 * Math.sin(2 * w) + 0.2 * Math.sin(3 * w);
    const pulse = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 5 * t));
    const theta = panPosition(t) * (Math.PI / 2); // constant power: the loudness stays level while it moves
    const v = tone * pulse;
    l[i] = v * Math.cos(theta);
    r[i] = v * Math.sin(theta);
  }
  fade(l, RATE, 0.05);
  fade(r, RATE, 0.05);
  normalise([l, r], 0.9);
  return { rate: RATE, channels: [l, r] };
};

export const MUSIC = { bpm: 124, bars: 4 };
export const musicBeat = 60 / MUSIC.bpm;
export const MUSIC_SECONDS = musicBeat * 4 * MUSIC.bars;

/**
 * A short original loop with a real low end: four-on-the-floor kick, a sub bass line under an A minor chord
 * sequence, offbeat hats and a soft pad. Nothing sampled, so it is free to use anywhere.
 */
const musicClip = (): ClipData => {
  const n = Math.round(MUSIC_SECONDS * RATE);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const roots = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  const noise = rng(11);
  const bar = musicBeat * 4;
  let lpL = 0;
  let lpR = 0;
  let hatPrev = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const barIdx = Math.min(MUSIC.bars - 1, Math.floor(t / bar));
    const tb = t - barIdx * bar;
    const beatT = t % musicBeat;
    // Kick: a sine that falls from 120 Hz to 45 Hz.
    const kickEnv = Math.exp(-beatT * 7);
    const kick = Math.sin(2 * Math.PI * (45 * beatT + (75 / 28) * (1 - Math.exp(-beatT * 28)))) * kickEnv * (beatT < 0.5 ? 1 : 0);
    // Sub bass: eighth notes on the chord root, a little second harmonic so small speakers still hint at it.
    const eighth = musicBeat / 2;
    const e = tb % eighth;
    const bassEnv = Math.min(1, e / 0.006) * Math.exp(-e * 5);
    const f = roots[barIdx];
    const bass = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t)) * bassEnv;
    // Hat: noise through a first difference (a crude high pass) on the offbeats.
    const off = (t + eighth) % musicBeat;
    const hatEnv = off < 0.06 ? Math.exp(-off * 70) : 0;
    const w = noise() * 2 - 1;
    const hat = (w - hatPrev) * 0.5 * hatEnv;
    hatPrev = w;
    // Pad: the chord as saws, a hair sharp in one ear and flat in the other, low passed and swelling through each bar.
    let padL = 0;
    let padR = 0;
    chords[barIdx].forEach((c) => {
      padL += 2 * ((t * c * 0.997) % 1) - 1;
      padR += 2 * ((t * c * 1.003) % 1) - 1;
    });
    const swell = Math.min(1, tb / 0.4) * (0.6 + 0.4 * Math.sin((Math.PI * tb) / bar));
    lpL += 0.06 * (padL - lpL);
    lpR += 0.06 * (padR - lpR);
    const low = kick * 0.95 + bass * 0.8;
    l[i] = low + hat * 0.5 + lpL * swell * 0.22;
    r[i] = low + hat * 0.5 + lpR * swell * 0.22;
  }
  fade(l, RATE, 0.01);
  fade(r, RATE, 0.01);
  normalise([l, r], 0.9);
  return { rate: RATE, channels: [l, r] };
};

/** The spoken clips, in public/audio. */
export const SPEECH_CLIPS: Record<string, string> = {
  "speech-left": "left.wav",
  "speech-right": "right.wav",
  "speech-centre": "centre.wav",
  "speech-in-phase": "in-phase.wav",
  "speech-out-of-phase": "out-of-phase.wav",
  "speech-pan": "pan.wav",
  "speech-music": "music.wav",
  "speech-sweep": "sweep.wav",
  "speech-lipsync": "lipsync.wav",
};

const SYNTH: Record<string, () => ClipData> = {
  "noise-in-phase": () => noisePair(false),
  "noise-out-of-phase": () => noisePair(true),
  "sub-sweep": sweepClip,
  "pan-sweep": panClip,
  "sub-music": musicClip,
};

const cache = new Map<string, ClipData>();

/** The clip's samples, or null if it is spoken and has not been loaded yet. */
export const clipData = (id: string): ClipData | null => {
  const hit = cache.get(id);
  if (hit) return hit;
  const make = SYNTH[id];
  if (!make) return null;
  const made = make();
  cache.set(id, made);
  return made;
};

export const speechLoaded = () => Object.keys(SPEECH_CLIPS).every((id) => cache.has(id));

let loading: Promise<void> | null = null;

/** Fetch and decode the spoken clips (once). Safe to call as often as you like. */
export const loadSpeechClips = (ctx: BaseAudioContext): Promise<void> => {
  if (speechLoaded()) return Promise.resolve();
  if (loading) return loading;
  const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "./";
  loading = Promise.all(
    Object.entries(SPEECH_CLIPS).map(async ([id, file]) => {
      if (cache.has(id)) return;
      const res = await fetch(`${base}audio/${file}`);
      if (!res.ok) throw new Error(`${file}: ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      cache.set(id, { rate: buf.sampleRate, channels: [buf.getChannelData(0).slice()] });
    }),
  )
    .then(() => undefined)
    .catch(() => {
      loading = null; // try again next time sound is switched on
    });
  return loading;
};

export const hasClip = (id: string) => cache.has(id) || id in SYNTH;
