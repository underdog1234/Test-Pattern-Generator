import { describe, expect, it } from "vitest";
import { BEEP_HZ, Pairer, RiseDetector, describeOffset, goertzel, refineOnset, summarize, toCsv } from "./sync";

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

describe("tone onset", () => {
  it("places the start half a window before the half-strength reading", () => {
    // Tone starts at t = 1000 ms; a 5 ms window ramps up as it enters.
    const win = 5;
    const readings: Array<[number, number]> = [];
    for (let t = 990; t <= 1030; t += 2.67) readings.push([t, Math.min(1, Math.max(0, (t - 1000) / win)) * 0.4]);
    const onset = refineOnset(readings, win)!;
    expect(Math.abs(onset - 1000)).toBeLessThan(3);
    expect(refineOnset([], win)).toBeNull();
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
