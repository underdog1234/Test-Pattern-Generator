import { describe, expect, it } from "vitest";
import { frameEpochMs } from "./frameClock";
import { defaultPlayback, effectiveConfig } from "./storage";
import { BUILT_IN_PLAYLISTS, buildBuiltInPlaylist } from "./presets";
import { fourScreenConfig } from "./model";

describe("frame clock", () => {
  it("steps by exactly the frame interval, with no rounding, so movement is even", () => {
    const frame = 1000 / 75;
    const base = 5000;
    const times = Array.from({ length: 200 }, (_, i) => frameEpochMs(base + i * frame));
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(frame, 2);
  });

  it("stays on the wall clock (so separate windows and playlists still agree)", () => {
    const ts = performance.now();
    expect(Math.abs(frameEpochMs(ts) - Date.now())).toBeLessThan(50);
  });
});

describe("effectiveConfig memo", () => {
  it("returns the very same config object for every frame of one auto-cycle step, and a new one for the next", () => {
    const config = fourScreenConfig();
    config.autoCycle = { enabled: true, seconds: 5, stagger: true };
    const p = defaultPlayback();
    p.anchor = 1_000_000;
    p.anchorTime = 0;
    const at = (secs: number) => effectiveConfig(config, p, p.anchor + secs * 1000).config;
    const first = at(0.1);
    expect(at(1)).toBe(first);
    expect(at(4.9)).toBe(first);
    const next = at(5.1);
    expect(next).not.toBe(first);
    expect(at(9)).toBe(next);
  });

  it("does the same for a playing playlist, and still shows the right step", () => {
    const config = fourScreenConfig();
    config.screens.forEach((s) => (s.ledLayout = null));
    config.playlist = buildBuiltInPlaylist(config, BUILT_IN_PLAYLISTS[0]); // 6 s steps
    const p = defaultPlayback();
    p.anchor = 2_000_000;
    p.anchorTime = 0;
    p.playlist = { active: true, loop: true, startTime: 0 };
    const at = (secs: number) => effectiveConfig(config, p, p.anchor + secs * 1000);
    const a = at(1);
    expect(a.stepIndex).toBe(0);
    expect(at(5.5).config).toBe(a.config);
    const b = at(7);
    expect(b.stepIndex).toBe(1);
    expect(b.config).not.toBe(a.config);
    expect(b.config.screens.every((s) => s.pattern === "smpte")).toBe(true);
    // The saved config itself is never changed.
    expect(config.screens[0].pattern).toBe("smpte");
    expect(config.screens[1].pattern).toBe("grid");
  });
});
