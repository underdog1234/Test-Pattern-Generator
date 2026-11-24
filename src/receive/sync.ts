// ---------------------------------------------------------------------------
// The measuring half of A/V sync: given what a camera saw and a microphone
// heard, how far apart were the flash and the beep?
//
// All times are milliseconds on one clock (performance.now()). Everything here
// is plain data in, plain data out, so it can be tested without a camera.
// ---------------------------------------------------------------------------

/** The sender's beep pitch (the AV Sync pattern's fixed tone). */
export const BEEP_HZ = 1000;

// --- tone: Goertzel ------------------------------------------------------------

/** Amplitude of `freq` in `samples` (a sine of amplitude A reads about A). */
export const goertzel = (samples: ArrayLike<number>, freq: number, rate: number): number => {
  const n = samples.length;
  if (!n) return 0;
  const w = (2 * Math.PI * freq) / rate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / n;
};

// --- flash detector --------------------------------------------------------------

export type DetectorTuning = {
  /** 0.5 (picky) .. 3 (eager). Scales how big a change counts as an event. */
  sensitivity: number;
};

type Armed = { t: number; value: number };

/**
 * Finds sudden rises in a signal (screen brightness, or tone level): the start
 * of a flash or a beep. It follows a slow baseline so room light, auto exposure
 * and background noise drift away, learns how noisy the signal is, and ignores
 * anything that is not clearly above that noise. After an event it waits
 * `holdoffMs` so one flash is one event.
 */
export class RiseDetector {
  private baseline: number | null = null;
  private noise: number;
  private last: Armed | null = null;
  private busyUntil = -Infinity;
  private inEvent = false;
  /** The latest threshold (for drawing a meter). */
  threshold = 0;

  constructor(
    private readonly opts: { minRise: number; holdoffMs: number; baselineMs?: number; sensitivity?: () => number },
  ) {
    this.noise = opts.minRise / 4;
  }

  /** Feed one sample. Returns the time of the first sample of a new event, else null. */
  push(t: number, value: number): number | null {
    const sens = Math.max(0.1, this.opts.sensitivity?.() ?? 1);
    if (this.baseline === null) {
      this.baseline = value;
      this.last = { t, value };
      return null;
    }
    const dt = Math.max(0, t - (this.last?.t ?? t));
    const rise = value - this.baseline;
    // Trigger when well above both an absolute floor and the learned noise.
    this.threshold = Math.max(this.opts.minRise, this.noise * 6) / sens;
    let fired: number | null = null;
    if (!this.inEvent && t >= this.busyUntil && rise > this.threshold) {
      this.inEvent = true;
      this.busyUntil = t + this.opts.holdoffMs;
      fired = t;
    } else if (this.inEvent && rise < this.threshold * 0.5 && t >= this.busyUntil) {
      this.inEvent = false;
    }
    if (!this.inEvent) {
      // Follow the quiet signal: baseline with a time constant, noise from the deviations.
      const tau = this.opts.baselineMs ?? 1500;
      const a = 1 - Math.exp(-dt / tau);
      this.noise += (Math.abs(value - this.baseline) - this.noise) * a;
      this.baseline += (value - this.baseline) * a;
    }
    this.last = { t, value };
    return fired;
  }

  get level(): number {
    return this.baseline === null ? 0 : (this.last?.value ?? 0) - this.baseline;
  }
}

// --- pairing ----------------------------------------------------------------------

export type Pair = {
  /** When the flash was seen. */
  flashAt: number;
  /** When the beep was heard. */
  beepAt: number;
  /** Video minus audio, ms. Positive = the picture arrived after the sound (video late). */
  offsetMs: number;
};

/**
 * Matches each flash with the nearest beep (and the other way round) within
 * `windowMs`, once, in any arrival order. A flash and a beep a long way apart
 * are not a pair.
 */
export class Pairer {
  private flashes: number[] = [];
  private beeps: number[] = [];

  constructor(private readonly windowMs = 450) {}

  addFlash(t: number): Pair | null {
    const i = this.nearest(this.beeps, t);
    if (i < 0) {
      this.flashes.push(t);
      this.trim(this.flashes, t);
      return null;
    }
    const beepAt = this.beeps.splice(i, 1)[0];
    return { flashAt: t, beepAt, offsetMs: t - beepAt };
  }

  addBeep(t: number): Pair | null {
    const i = this.nearest(this.flashes, t);
    if (i < 0) {
      this.beeps.push(t);
      this.trim(this.beeps, t);
      return null;
    }
    const flashAt = this.flashes.splice(i, 1)[0];
    return { flashAt, beepAt: t, offsetMs: flashAt - t };
  }

  /** How many flashes / beeps are still waiting for a partner. */
  get waiting() {
    return { flashes: this.flashes.length, beeps: this.beeps.length };
  }

  private nearest(list: number[], t: number): number {
    let best = -1;
    let bestD = this.windowMs;
    list.forEach((x, i) => {
      const d = Math.abs(x - t);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  private trim(list: number[], now: number) {
    while (list.length && now - list[0] > this.windowMs * 3) list.shift();
  }
}

// --- statistics ---------------------------------------------------------------------

export type Summary = { n: number; median: number; mean: number; sd: number; min: number; max: number; stable: boolean };

export const summarize = (values: number[]): Summary | null => {
  const n = values.length;
  if (!n) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, median, mean, sd, min: sorted[0], max: sorted[n - 1], stable: n >= 5 && sd <= 12 };
};

/** "Video 24 ms late", "Audio 40 ms late", "In sync". */
export const describeOffset = (ms: number, tolerance = 8): string => {
  const r = Math.round(ms);
  if (Math.abs(r) <= tolerance) return "In sync";
  return r > 0 ? `Video ${r} ms late` : `Audio ${-r} ms late`;
};

export const toCsv = (pairs: Pair[], compensationMs: number): string =>
  ["n,flash_ms,beep_ms,offset_ms_raw,offset_ms_compensated", ...pairs.map((p, i) => `${i + 1},${p.flashAt.toFixed(1)},${p.beepAt.toFixed(1)},${p.offsetMs.toFixed(1)},${(p.offsetMs - compensationMs).toFixed(1)}`)].join("\n");

/**
 * When a tone really began, from the readings taken as it came in. A reading is
 * the tone's strength over the last `windowMs`, so it ramps up as the tone
 * enters that window: half strength means half the window is tone. `readings`
 * are [time the window ended, strength], oldest first, from just before the
 * trigger to a little after it.
 */
export const refineOnset = (readings: Array<[number, number]>, windowMs: number): number | null => {
  if (!readings.length) return null;
  const peak = Math.max(...readings.map((r) => r[1]));
  if (peak <= 0) return null;
  const half = readings.find((r) => r[1] >= peak * 0.5);
  return half ? half[0] - windowMs * 0.5 : null;
};
