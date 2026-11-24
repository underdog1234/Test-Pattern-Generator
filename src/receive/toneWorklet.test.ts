import { afterEach, describe, expect, it } from "vitest";
import { TONE_WINDOW, toneWorkletBody } from "./toneWorklet";

const g = globalThis as any;

// Run the worklet module against a stand-in for the audio thread.
const load = () => {
  let Registered: any = null;
  g.AudioWorkletProcessor = class {
    port = { postMessage: (_: unknown) => {} };
  };
  g.registerProcessor = (_name: string, cls: unknown) => (Registered = cls);
  g.sampleRate = 48000;
  g.currentTime = 0;
  toneWorkletBody();
  const node = new Registered({ processorOptions: { freq: 1000, windowSamples: TONE_WINDOW } });
  const posted: Array<{ end: number; mag: number; rms: number }> = [];
  node.port.postMessage = (m: any) => posted.push(m);
  return { node, posted };
};

afterEach(() => {
  delete g.AudioWorkletProcessor;
  delete g.registerProcessor;
  delete g.sampleRate;
  delete g.currentTime;
});

describe("tone meter worklet", () => {
  it("stays quiet for silence and reports the 1 kHz tone with the time its window ends", () => {
    const { node, posted } = load();
    const rate = 48000;
    const startSample = 128 * 12; // the beep begins here
    for (let b = 0; b < 40; b += 1) {
      const block = new Float32Array(128);
      for (let i = 0; i < 128; i += 1) {
        const n = b * 128 + i;
        block[i] = n >= startSample ? 0.5 * Math.sin((2 * Math.PI * 1000 * n) / rate) : 0;
      }
      g.currentTime = (b * 128) / rate;
      expect(node.process([[block]])).toBe(true);
    }
    expect(posted.length).toBeGreaterThan(30);
    const before = posted.filter((p) => p.end < startSample / rate);
    const after = posted.filter((p) => p.end > (startSample + 512) / rate);
    expect(Math.max(...before.map((p) => p.mag))).toBeLessThan(0.01);
    expect(Math.min(...after.map((p) => p.mag))).toBeGreaterThan(0.4);
    // `end` is the time the window finishes: the last block ends at 40 * 128 samples.
    expect(posted[posted.length - 1].end).toBeCloseTo((40 * 128) / rate, 6);
  });

  it("ignores a different pitch", () => {
    const { node, posted } = load();
    for (let b = 0; b < 12; b += 1) {
      const block = Float32Array.from({ length: 128 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 3000 * (b * 128 + i)) / 48000));
      g.currentTime = (b * 128) / 48000;
      node.process([[block]]);
    }
    expect(Math.max(...posted.map((p) => p.mag))).toBeLessThan(0.1);
  });
});
