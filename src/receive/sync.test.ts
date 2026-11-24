import { describe, expect, it } from "vitest";
import { BEEP_HZ, CentroidCapture, Pairer, RiseDetector, describeOffset, goertzel, guessInterval, linkDelays, robustSummary, summarize, toCsv } from "./sync";

const tone = (freq: number, n: number, rate: number, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

describe("goertzel", () => {
  it("reads the amplitude of the wanted tone and little of another", () => {
    const rate = 48000;
    const s = tone(BEEP_HZ, 480, rate, 0.5); // 10 ms = a whole number of cycles
    expect(goertzel(s, BEEP_HZ, rate)).toBeCloseTo(0.5, 2);
    expect(goertzel(s, 2500, rate)).toBeLessThan(0.02);
    expect(goertzel(new Float32Array(480), BEEP_HZ, rate)).toBe(0);
  });
});

// Frames at `fps`, brightness `base` with flashes of `height` lasting `len` frames at the given times.
const brightness = (fps: number, seconds: number, flashesAt: number[], len = 2, base = 40, height = 120, noise = 0, drift = 0) => {
  const out: Array<[number, number]> = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  for (let i = 0; i < seconds * fps; i += 1) {
    const t = (i * 1000) / fps;
    const on = flashesAt.some((f) => t >= f - 1e-6 && t < f + (len * 1000) / fps - 1e-6);
    out.push([t, base + drift * (t / 1000) + (on ? height : 0) + noise * rnd()]);
  }
  return out;
};

describe("RiseDetector (flashes)", () => {
  const run = (frames: Array<[number, number]>, sens = 1) => {
    const d = new RiseDetector({ minRise: 10, holdoffMs: 250, sensitivity: () => sens });
    return frames.flatMap(([t, v]) => {
      const f = d.push(t, v);
      return f === null ? [] : [f];
    });
  };

  it("finds the first frame of every flash, once", () => {
    const flashes = [1000, 2000, 3000, 4000];
    const found = run(brightness(60, 5, flashes));
    expect(found).toHaveLength(4);
    found.forEach((t, i) => expect(Math.abs(t - flashes[i])).toBeLessThan(1000 / 60 + 1e-6));
  });

  it("copes with a single-frame flash at 30 fps and with camera noise", () => {
    const flashes = [1000, 2000, 3000];
    const found = run(brightness(30, 4, flashes, 1, 60, 70, 4));
    expect(found).toHaveLength(3);
  });

  it("ignores slow brightening (auto exposure, room lights) and noise alone", () => {
    expect(run(brightness(60, 8, [], 2, 40, 0, 3, 6))).toHaveLength(0);
  });

  it("is quieter when less sensitive, louder when more", () => {
    const frames = brightness(60, 4, [1000, 2000, 3000], 2, 40, 12);
    expect(run(frames, 0.5)).toHaveLength(0);
    expect(run(frames, 2).length).toBeGreaterThanOrEqual(3);
  });
});

// A camera: each frame's brightness is the share of its exposure (= the frame time) that the flash covers.
const cameraSees = (fps: number, phaseMs: number, flashStart: number, flashLen: number, base = 40, height = 120) => {
  const T = 1000 / fps;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 80; i += 1) {
    const f0 = phaseMs + i * T;
    const overlap = Math.max(0, Math.min(f0 + T, flashStart + flashLen) - Math.max(f0, flashStart));
    out.push([f0, base + height * (overlap / T)]);
  }
  return out;
};

describe("event centres vs first-over-threshold", () => {
  const run = (frames: Array<[number, number]>) => {
    const d = new RiseDetector({ minRise: 8, holdoffMs: 250 });
    const cap = new CentroidCapture({ keepMs: 400, preMs: 60, maxMs: 450, endFraction: 0.3, endQuiet: 2 });
    let onset: number | null = null;
    let centre: number | null = null;
    for (const [t, v] of frames) {
      cap.push(t, v);
      const f = d.push(t, v);
      if (f !== null) {
        onset = f;
        cap.start(f, d.baselineValue, d.threshold);
      }
      const c = cap.update(t, v);
      if (c !== null) centre = c;
    }
    return { onset, centre };
  };
  const sd = (a: number[]) => {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  };

  it("finds the middle of a 33 ms flash far more steadily than the first frame over the threshold, at 30 fps", () => {
    const flashStart = 1000;
    const errCentre: number[] = [];
    const errOnset: number[] = [];
    // The camera's frame grid lands differently against the flash each time.
    for (let phase = 0; phase < 33.3; phase += 1.7) {
      const { onset, centre } = run(cameraSees(30, phase, flashStart, 33.3));
      errCentre.push(centre! - (flashStart + 16.65 + 16.65)); // frame times are exposure starts: the middle of a frame is half a frame later
      errOnset.push(onset! - flashStart);
    }
    expect(sd(errOnset)).toBeGreaterThan(7); // rounding to the frame: spread over a whole frame
    expect(sd(errCentre)).toBeLessThan(4);
  });

  it("does not move when the flash is brighter", () => {
    const a = run(cameraSees(60, 3, 1000, 33.3, 40, 60)).centre!;
    const b = run(cameraSees(60, 3, 1000, 33.3, 40, 160)).centre!;
    expect(Math.abs(a - b)).toBeLessThan(2.5);
  });
});

describe("Pairer", () => {
  it("pairs a flash with its beep in either arrival order, once each", () => {
    const p = new Pairer(450);
    expect(p.addFlash(1000)).toBeNull();
    expect(p.addBeep(960)).toMatchObject({ offsetMs: 40 }); // beep first => video late
    expect(p.addBeep(2000)).toBeNull();
    expect(p.addFlash(2090)).toMatchObject({ offsetMs: 90 });
    expect(p.addFlash(3000)).toBeNull();
    expect(p.addBeep(3050)).toMatchObject({ offsetMs: -50 }); // flash first => audio late
    expect(p.waiting).toEqual({ flashes: 0, beeps: 0 });
  });
  it("does not pair events further apart than the window", () => {
    const p = new Pairer(450);
    p.addFlash(1000);
    expect(p.addBeep(1600)).toBeNull();
  });
});

describe("robust summary", () => {
  it("sets aside outliers and reports how many", () => {
    const s = robustSummary([40, 41, 39, 42, 40, 120, 38, 41, 40, -60])!;
    expect(s.rejected).toBe(2);
    expect(s.median).toBe(40);
    expect(s.sd).toBeLessThan(2);
    expect(s.stable).toBe(true);
    expect(robustSummary([])).toBeNull();
  });
});

describe("link delay", () => {
  it("reads the delay of the picture and of the sound from the world-time grid", () => {
    const secs = [10, 11, 12, 13, 14, 15].map((x) => x * 1000);
    const flashes = secs.map((x) => x + 83 + 16.5);
    const beeps = secs.map((x) => x + 61 + 16.5);
    const d = linkDelays(flashes, beeps, 33, 1000);
    d.videoMs.forEach((v) => expect(v).toBeCloseTo(83, 0));
    d.audioMs.forEach((v) => expect(v).toBeCloseTo(61, 0));
    expect(d.lockedVideo).toBeGreaterThan(0.99);
  });
  it("shows a sender that is not on world time as scattered", () => {
    expect(linkDelays([10120, 11460, 12710, 13240, 14890, 15530], [], 33, 1000).lockedVideo).toBeLessThan(0.7);
  });
  it("works out the sender's interval from the flash spacing", () => {
    expect(guessInterval([1000, 2010, 2990, 4005])).toBe(1000);
    expect(guessInterval([0, 4020, 7990, 12010])).toBe(4000);
    expect(guessInterval([5])).toBe(1000);
  });
});

describe("summary", () => {
  it("gives the median, spread and a stable flag", () => {
    const s = summarize([40, 42, 38, 41, 39, 40])!;
    expect(s.median).toBe(40);
    expect(s.sd).toBeLessThan(2);
    expect(s.stable).toBe(true);
    expect(summarize([10, 90, 20])!.stable).toBe(false);
    expect(summarize([])).toBeNull();
  });
  it("says it in words and as CSV", () => {
    expect(describeOffset(24.4)).toBe("Video 24 ms late");
    expect(describeOffset(-31)).toBe("Audio 31 ms late");
    expect(describeOffset(3)).toBe("In sync");
    expect(toCsv([{ flashAt: 1000, beepAt: 960, offsetMs: 40 }], 10).split("\n")[1]).toBe("1,1000.0,960.0,40.0,30.0");
  });
});
