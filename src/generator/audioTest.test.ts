import { describe, expect, it } from "vitest";
import { AUDIO_STEPS, AUDIO_TEST_SECONDS, audioTestBeeps, audioTestMoment } from "./audioTest";
import { MUSIC_SECONDS, SWEEP, clipData, musicBeat, pinkNoise, sweepHz } from "./clips";
import { LIPSYNC_SECONDS, LIPSYNC_VISEMES, LIPSYNC_WORDS } from "./lipsyncData";
import { LIPSYNC_LEAD, VISEME_MOUTH, lipSyncBeeps, mouthAt } from "./lipSync";
import { PATTERN_BY_ID, resolveSettings } from "./patterns";
import { monoBeeps, renderBeepSamples } from "./audio";
import { LAYOUT_PRESETS } from "./model";

const settings = (id: string) => resolveSettings(PATTERN_BY_ID.get(id)!, {});

describe("audio test timeline", () => {
  it("walks left, right, both, in phase, out of phase, sub, sweep with whole sounds inside each step", () => {
    expect(AUDIO_STEPS.map((s) => s.id)).toEqual(["left", "right", "centre", "in-phase", "out-of-phase", "sub", "sweep"]);
    AUDIO_STEPS.forEach((st) => st.events.forEach((e) => expect(e.at + e.dur).toBeLessThanOrEqual(st.seconds + 1e-9)));
    expect(AUDIO_TEST_SECONDS).toBe(37);
  });

  it("sends left sounds to the left speaker only and right sounds to the right only", () => {
    const beeps = audioTestBeeps(settings("audio-test"), 40);
    const left = beeps.filter((b) => b.at < 4);
    const right = beeps.filter((b) => b.at >= 4 && b.at < 8);
    expect(left.length).toBeGreaterThan(3);
    expect(left.every((b) => b.route === "L")).toBe(true);
    expect(right.every((b) => b.route === "R")).toBe(true);
    expect(beeps.filter((b) => b.at >= 8 && b.at < 12).every((b) => b.route === "LR")).toBe(true);
  });

  it("uses the phase-inverted noise only in the out-of-phase step", () => {
    const beeps = audioTestBeeps(settings("audio-test"), 40);
    expect(beeps.filter((b) => b.clip === "noise-in-phase").map((b) => b.at)).toEqual([14.2]);
    expect(beeps.filter((b) => b.clip === "noise-out-of-phase").map((b) => b.at)).toEqual([19.2]);
  });

  it("leaves out the voice when switched off, and leaves out sounds that do not fit a short loop", () => {
    expect(audioTestBeeps({ ...settings("audio-test"), voice: false }, 40).some((b) => b.clip?.startsWith("speech"))).toBe(false);
    const short = audioTestBeeps(settings("audio-test"), 10);
    expect(short.every((b) => b.at + b.duration <= 10 + 1e-6)).toBe(true);
    expect(short.some((b) => b.clip === "sub-music")).toBe(false);
  });

  it("knows which step and which pulse the clock is in", () => {
    expect(audioTestMoment(0.5, 40).stepIndex).toBe(0);
    expect(audioTestMoment(4.2, 40).stepIndex).toBe(1);
    expect(audioTestMoment(2.0, 40).pulse).toBe(0);
    expect(audioTestMoment(2.7, 40).pulse).toBe(1);
    expect(audioTestMoment(38, 40).stepIndex).toBe(-1);
    expect(audioTestMoment(38, 80).stepIndex).toBe(0); // the second run
  });

  it("is registered, and start layouts are offered", () => {
    expect(PATTERN_BY_ID.get("audio-test")!.minLoopSeconds).toBe(37);
    expect(LAYOUT_PRESETS.find((p) => p.id === "audio-tests")!.build().loopSeconds).toBeGreaterThanOrEqual(37);
    expect(LAYOUT_PRESETS.find((p) => p.id === "lip-sync")!.build().loopSeconds).toBeGreaterThanOrEqual(PATTERN_BY_ID.get("lip-sync")!.minLoopSeconds!);
  });

  it("keeps clips and one-sided sounds out of exports, which are mono", () => {
    const all = audioTestBeeps(settings("audio-test"), 40);
    expect(monoBeeps(all).every((b) => !b.clip && b.route === "LR")).toBe(true);
    expect(renderBeepSamples(all, 40, 40).some((v) => v !== 0)).toBe(true); // the "both" pulses
  });
});

describe("clips", () => {
  it("makes the out-of-phase noise the exact mirror of the in-phase noise, so the two cancel in mono", () => {
    const a = clipData("noise-in-phase")!;
    const b = clipData("noise-out-of-phase")!;
    expect([...a.channels[0].slice(1000, 1010)]).toEqual([...a.channels[1].slice(1000, 1010)]);
    expect(b.channels[1][5000]).toBe(-b.channels[0][5000]);
    expect(b.channels[0][5000]).toBe(a.channels[0][5000]);
  });

  it("rises from 20 to 120 Hz by equal ratios", () => {
    expect(sweepHz(0)).toBeCloseTo(20);
    expect(sweepHz(SWEEP.seconds)).toBeCloseTo(120);
    expect(sweepHz(SWEEP.seconds / 2)).toBeCloseTo(Math.sqrt(20 * 120), 3);
    const c = clipData("sub-sweep")!;
    // Upward zero crossings in the first second are about the average frequency over that second.
    let crossings = 0;
    for (let i = 1; i < c.rate; i += 1) if (c.channels[0][i - 1] < 0 && c.channels[0][i] >= 0) crossings += 1;
    expect(crossings).toBeGreaterThan(20);
    expect(crossings).toBeLessThan(45);
  });

  it("has a music loop with real low end, no clipping, and the right length", () => {
    const m = clipData("sub-music")!;
    expect(m.channels[0].length / m.rate).toBeCloseTo(MUSIC_SECONDS, 2);
    expect(musicBeat * 4 * 4).toBeCloseTo(MUSIC_SECONDS, 6);
    let peak = 0;
    m.channels.forEach((c) => c.forEach((v) => (peak = Math.max(peak, Math.abs(v)))));
    expect(peak).toBeLessThanOrEqual(0.91);
    expect(peak).toBeGreaterThan(0.8);
    // Most of the power is below 150 Hz: a one-pole low pass keeps it.
    let lp = 0;
    let low = 0;
    let all = 0;
    const a = 1 - Math.exp((-2 * Math.PI * 150) / m.rate);
    m.channels[0].forEach((v) => {
      lp += a * (v - lp);
      low += lp * lp;
      all += v * v;
    });
    expect(low / all).toBeGreaterThan(0.5);
  });

  it("makes the same noise every time", () => {
    expect(pinkNoise(0.1, 3)).toEqual(pinkNoise(0.1, 3));
    expect(pinkNoise(0.1, 3)).not.toEqual(pinkNoise(0.1, 4));
  });
});

describe("lip sync", () => {
  it("closes the lips on p, b and m, opens wide on aa, and purses on oo", () => {
    const at = (v: number) => LIPSYNC_VISEMES.find((x) => x[2] === v && x[1] > 0.06)!;
    const p = at(21);
    expect(mouthAt(p[0] + p[1] * 0.8).open).toBeLessThan(0.12);
    const aa = at(2);
    expect(mouthAt(aa[0] + aa[1] * 0.9).open).toBeGreaterThan(0.5);
    const oo = at(7);
    expect(mouthAt(oo[0] + oo[1] * 0.9).round).toBeGreaterThan(0.5);
    expect(VISEME_MOUTH).toHaveLength(22);
  });

  it("is closed before and after the speech, and the speech data is in order", () => {
    expect(mouthAt(-1).open).toBe(0);
    expect(mouthAt(LIPSYNC_SECONDS + 5).open).toBe(0);
    LIPSYNC_VISEMES.slice(1).forEach((v, i) => expect(v[0]).toBeGreaterThanOrEqual(LIPSYNC_VISEMES[i][0]));
    LIPSYNC_WORDS.slice(1).forEach((w, i) => expect(w[0]).toBeGreaterThanOrEqual(LIPSYNC_WORDS[i][0]));
    expect(LIPSYNC_WORDS.length).toBe(50);
  });

  it("plays the speech once, a moment after the loop starts, only if it fits", () => {
    const s = settings("lip-sync");
    const b = lipSyncBeeps(s, 24);
    expect(b).toHaveLength(1);
    expect(b[0].at).toBe(LIPSYNC_LEAD);
    expect(b[0].clip).toBe("speech-lipsync");
    expect(lipSyncBeeps(s, 10)).toEqual([]);
  });
});
