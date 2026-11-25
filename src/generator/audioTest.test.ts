import { describe, expect, it } from "vitest";
import { AUDIO_STEPS, AUDIO_TEST_SECONDS, audioPlan, audioStepKey, audioTestBeeps, audioTestMoment, enabledSeconds } from "./audioTest";
import { MUSIC_SECONDS, PAN, SWEEP, clipData, musicBeat, panPosition, pinkNoise, sweepHz } from "./clips";
import { LIPSYNC_CREDIT, LIPSYNC_LEAD, LIPSYNC_MIN_LOOP, LIPSYNC_SECONDS, lipSyncBeeps } from "./lipSync";
import { PATTERN_BY_ID, resolveSettings } from "./patterns";
import { monoBeeps, renderBeepSamples } from "./audio";
import { LAYOUT_PRESETS } from "./model";

const settings = (id: string) => resolveSettings(PATTERN_BY_ID.get(id)!, {});

const plan = (over: Record<string, number | string | boolean> = {}, loop = AUDIO_TEST_SECONDS) => audioPlan({ ...settings("audio-test"), ...over }, loop);
const off = (...ids: string[]) => Object.fromEntries(ids.map((id) => [audioStepKey(id), false]));

describe("audio test timeline", () => {
  it("walks left, right, both, left-to-right, in phase, out of phase, music, sweep with whole sounds inside each step", () => {
    expect(AUDIO_STEPS.map((s) => s.id)).toEqual(["left", "right", "centre", "pan", "in-phase", "out-of-phase", "music", "sweep"]);
    AUDIO_STEPS.forEach((st) => st.events.forEach((e) => expect(e.at + e.dur).toBeLessThanOrEqual(st.seconds + 1e-9)));
    expect(AUDIO_TEST_SECONDS).toBe(54);
    expect(AUDIO_STEPS.find((s) => s.id === "music")!.title).toBe("MUSIC TEST");
  });

  it("sends left sounds to the left speaker only and right sounds to the right only", () => {
    const beeps = audioTestBeeps(settings("audio-test"), AUDIO_TEST_SECONDS);
    const left = beeps.filter((b) => b.at < 4);
    const right = beeps.filter((b) => b.at >= 4 && b.at < 8);
    expect(left.length).toBeGreaterThan(3);
    expect(left.every((b) => b.route === "L")).toBe(true);
    expect(right.every((b) => b.route === "R")).toBe(true);
    expect(beeps.filter((b) => b.at >= 8 && b.at < 12).every((b) => b.route === "LR")).toBe(true);
  });

  it("uses the phase-inverted noise only in the out-of-phase step", () => {
    const beeps = audioTestBeeps(settings("audio-test"), AUDIO_TEST_SECONDS);
    expect(beeps.filter((b) => b.clip === "noise-in-phase").map((b) => b.at)).toEqual([21 + 2.2]);
    expect(beeps.filter((b) => b.clip === "noise-out-of-phase").map((b) => b.at)).toEqual([26 + 2.2]);
  });

  it("leaves out the voice when switched off, and leaves out sounds that do not fit a short loop", () => {
    expect(audioTestBeeps({ ...settings("audio-test"), voice: false }, AUDIO_TEST_SECONDS).some((b) => b.clip?.startsWith("speech"))).toBe(false);
    const short = audioTestBeeps(settings("audio-test"), 10);
    expect(short.every((b) => b.at + b.duration <= 10 + 1e-6)).toBe(true);
    expect(short.some((b) => b.clip === "sub-music")).toBe(false);
  });

  it("knows which step and which pulse the clock is in", () => {
    const p = plan();
    expect(audioTestMoment(p, 0.5).stepIndex).toBe(0);
    expect(audioTestMoment(p, 4.2).stepIndex).toBe(1);
    expect(audioTestMoment(p, 2.0).pulse).toBe(0);
    expect(audioTestMoment(p, 2.7).pulse).toBe(1);
    expect(audioTestMoment(plan({}, 120), 56).stepIndex).toBe(0); // the second run
    expect(audioTestMoment(plan({}, 100), 99).stepIndex).toBe(-1); // waiting for the loop to restart
  });

  it("is registered, and the audio layout's loop runs the full list once", () => {
    expect(PATTERN_BY_ID.get("audio-test")!.minLoopSeconds).toBe(AUDIO_TEST_SECONDS);
    expect(LAYOUT_PRESETS.find((p) => p.id === "audio-tests")!.build().loopSeconds).toBe(AUDIO_TEST_SECONDS);
    expect(LAYOUT_PRESETS.find((p) => p.id === "lip-sync")!.build().loopSeconds).toBeGreaterThanOrEqual(PATTERN_BY_ID.get("lip-sync")!.minLoopSeconds!);
  });

  it("keeps clips and one-sided sounds out of exports, which are mono", () => {
    const all = audioTestBeeps(settings("audio-test"), AUDIO_TEST_SECONDS);
    expect(monoBeeps(all).every((b) => !b.clip && b.route === "LR")).toBe(true);
    expect(renderBeepSamples(all, AUDIO_TEST_SECONDS, AUDIO_TEST_SECONDS).some((v) => v !== 0)).toBe(true); // the "both" pulses
  });
});

describe("ticking tests on and off", () => {
  it("starts with every test on", () => {
    const p = plan();
    expect(p.steps).toHaveLength(AUDIO_STEPS.length);
    expect(p.total).toBe(AUDIO_TEST_SECONDS);
    expect(enabledSeconds(settings("audio-test"))).toBe(AUDIO_TEST_SECONDS);
  });

  it("skips an unticked test: no sound, and the steps after it move up", () => {
    const s = { ...settings("audio-test"), ...off("right", "pan") };
    const p = audioPlan(s, 100);
    expect(p.steps.map((x) => x.id)).toEqual(["left", "centre", "in-phase", "out-of-phase", "music", "sweep"]);
    const beeps = audioTestBeeps(s, enabledSeconds(s));
    expect(beeps.some((b) => b.clip === "speech-right" || b.clip === "pan-sweep")).toBe(false);
    expect(beeps.find((b) => b.clip === "speech-centre")!.at).toBeCloseTo(4 + 0.15);
    expect(enabledSeconds(s)).toBe(AUDIO_TEST_SECONDS - 4 - 9);
  });

  it("runs the whole ticked list once before it repeats", () => {
    const s = { ...settings("audio-test"), ...off("music", "sweep", "in-phase", "out-of-phase", "pan") };
    const total = enabledSeconds(s); // left, right, both = 12 s
    const p = audioPlan(s, total * 2);
    expect(p.copies).toBe(2);
    const beeps = audioTestBeeps(s, total * 2);
    expect(beeps.filter((b) => b.clip === "speech-left").map((b) => b.at)).toEqual([0.15, total + 0.15]);
    expect(audioTestMoment(p, total + 0.5).stepIndex).toBe(0);
  });

  it("stops and goes idle when every test is unticked", () => {
    const s = { ...settings("audio-test"), ...off(...AUDIO_STEPS.map((x) => x.id)) };
    const p = audioPlan(s, 60);
    expect(p.steps).toHaveLength(0);
    expect(audioTestBeeps(s, 60)).toEqual([]);
    expect(audioTestMoment(p, 5).stepIndex).toBe(-1);
  });
});

describe("holding a test", () => {
  it("shows only the held test, even if its tick is off, and repeats it evenly across the loop", () => {
    const s = { ...settings("audio-test"), ...off("music"), hold: "music" };
    const p = audioPlan(s, 54);
    expect(p.held).toBe(true);
    expect(p.steps.map((x) => x.id)).toEqual(["music"]);
    expect(p.copies).toBe(5);
    expect(p.period).toBeCloseTo(54 / 5);
    const music = audioTestBeeps(s, 54).filter((b) => b.clip === "sub-music");
    expect(music).toHaveLength(5);
    expect(music[1].at - music[0].at).toBeCloseTo(p.period);
    expect(audioTestMoment(p, 0.5).stepIndex).toBe(0);
    expect(audioTestMoment(p, p.period + 0.5).stepIndex).toBe(0);
  });

  it("plays a held test from its own start, so it begins the moment the loop restarts", () => {
    const s = { ...settings("audio-test"), hold: "right" };
    const p = audioPlan(s, 40);
    expect(audioTestBeeps(s, 40)[0]).toMatchObject({ at: 0.15, clip: "speech-right", route: "R" });
    expect(audioTestMoment(p, 2.0).pulse).toBe(0);
  });
});

describe("the left-to-right sweep", () => {
  it("runs from all left to all right, with steady loudness", () => {
    const c = clipData("pan-sweep")!;
    const n = c.channels[0].length;
    const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((acc, v) => acc + v * v, 0) / (b - a));
    const w = Math.round(c.rate * 0.3);
    const at = (t: number) => Math.round(c.rate * t);
    expect(rms(c.channels[0], at(0.1), at(0.1) + w)).toBeGreaterThan(rms(c.channels[1], at(0.1), at(0.1) + w) * 5);
    expect(rms(c.channels[1], n - at(0.1) - w, n - at(0.1))).toBeGreaterThan(rms(c.channels[0], n - at(0.1) - w, n - at(0.1)) * 5);
    const mid = Math.round(n / 2);
    const ratio = rms(c.channels[0], mid, mid + w) / rms(c.channels[1], mid, mid + w);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);
    expect(panPosition(0)).toBe(0);
    expect(panPosition(PAN.seconds)).toBe(1);
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

  it("rises from 20 Hz to 20 kHz by equal ratios, covering the whole range of hearing", () => {
    expect(SWEEP.from).toBe(20);
    expect(SWEEP.to).toBe(20000);
    expect(sweepHz(0)).toBeCloseTo(20);
    expect(sweepHz(SWEEP.seconds)).toBeCloseTo(20000);
    expect(sweepHz(SWEEP.seconds / 2)).toBeCloseTo(Math.sqrt(20 * 20000), 3);
    const c = clipData("sub-sweep")!;
    expect(c.rate).toBeGreaterThanOrEqual(44100);
    // Upward zero crossings in the first second are about the average frequency over that second (20 Hz rising to about 40 Hz).
    let crossings = 0;
    for (let i = 1; i < c.rate; i += 1) if (c.channels[0][i - 1] < 0 && c.channels[0][i] >= 0) crossings += 1;
    expect(crossings).toBeGreaterThan(22);
    expect(crossings).toBeLessThan(45);
    // The last half second is far higher: many thousands of crossings per second.
    let late = 0;
    const end = c.channels[0].length;
    for (let i = end - c.rate / 2; i < end; i += 1) if (c.channels[0][i - 1] < 0 && c.channels[0][i] >= 0) late += 1;
    expect(late * 2).toBeGreaterThan(10000);
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
  it("plays the clip once, a moment after the loop starts, only if the whole clip fits", () => {
    const s = settings("lip-sync");
    const b = lipSyncBeeps(s, LIPSYNC_MIN_LOOP);
    expect(b).toHaveLength(1);
    expect(b[0].at).toBe(LIPSYNC_LEAD);
    expect(b[0].clip).toBe("lipsync-video");
    expect(b[0].duration).toBeCloseTo(LIPSYNC_SECONDS, 2);
    expect(lipSyncBeeps(s, 24)).toEqual([]);
  });

  it("credits the clip's author and licence", () => {
    expect(LIPSYNC_CREDIT.line).toBe("Sarah Valentine Actors Accent Coach, CC BY 3.0, via Wikimedia Commons.");
    expect(LIPSYNC_CREDIT.licenseUrl).toBe("https://creativecommons.org/licenses/by/3.0");
  });
});
