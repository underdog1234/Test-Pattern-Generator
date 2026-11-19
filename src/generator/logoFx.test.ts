import { describe, expect, it } from "vitest";
import { BRAND_COLOURS, LogoFx, bounceAxis, nextColour } from "./logoFx";

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("bounceAxis", () => {
  it("reflects off both walls and counts them", () => {
    expect(bounceAxis(0, 100)).toEqual({ pos: 0, count: 0 });
    expect(bounceAxis(150, 100)).toEqual({ pos: 50, count: 1 });
    expect(bounceAxis(250, 100)).toEqual({ pos: 50, count: 2 });
    expect(bounceAxis(100, 0)).toEqual({ pos: 0, count: 0 });
  });
});

describe("nextColour", () => {
  it("never repeats the previous colour", () => {
    const r = seeded(1);
    for (let prev = 0; prev < BRAND_COLOURS.length; prev++) for (let i = 0; i < 200; i++) expect(nextColour(prev, r)).not.toBe(prev);
  });
});

const run = (fx: LogoFx, seconds: number, seed = 0) => {
  const log: { t: number; before: number; after: number; corners: number }[] = [];
  let colour = fx.colour;
  let corners = 0;
  for (let t = 0; t <= seconds; t += 1 / 60) {
    fx.update(t, 1920, 1080, seed);
    if (fx.colour !== colour || fx.corners !== corners) log.push({ t, before: colour, after: fx.colour, corners: fx.corners });
    colour = fx.colour;
    corners = fx.corners;
  }
  return log;
};

describe("LogoFx", () => {
  it("changes to a different colour on every bounce, and only then", () => {
    const fx = new LogoFx(seeded(7));
    const log = run(fx, 130);
    expect(fx.bounces).toBeGreaterThan(10);
    expect(log.length).toBe(fx.bounces);
    log.forEach((e) => expect(e.after).not.toBe(e.before));
  });

  it("treats a corner hit as one colour change plus fireworks", () => {
    const fx = new LogoFx(seeded(3));
    const log = run(fx, 65); // seed 0 reaches a corner at t = 63 s
    const corner = log.filter((e, i) => e.corners > (log[i - 1]?.corners ?? 0));
    expect(corner).toHaveLength(1);
    expect(corner[0].t).toBeGreaterThan(62);
    expect(corner[0].after).not.toBe(corner[0].before);
    expect(fx.celebrating).toBe(true);
  });

  it("does not replay bounces after a long stall", () => {
    const fx = new LogoFx(seeded(5));
    fx.update(0, 1920, 1080, 0);
    fx.update(500, 1920, 1080, 0);
    expect(fx.bounces).toBe(0);
  });
});

describe("split and glitch", () => {
  it("fires the glitch once per corner hit, never for edge hits", () => {
    const fx = new LogoFx(seeded(11));
    let glitchFrames = 0;
    let glitchStarts = 0;
    let prev = false;
    for (let t = 0; t <= 140; t += 1 / 60) {
      fx.update(t, 1920, 1080, 0);
      const on = fx.glitchAt(t) !== null;
      if (on) glitchFrames++;
      if (on && !prev) glitchStarts++;
      prev = on;
    }
    expect(fx.corners).toBeGreaterThanOrEqual(2); // t = 63 and 126
    expect(glitchStarts).toBe(fx.corners);
    expect(fx.bounces).toBeGreaterThan(fx.corners);
    expect(glitchFrames).toBeGreaterThan(0);
    // The glitch is brief: well under a second per corner.
    expect(glitchFrames / 60 / fx.corners).toBeLessThan(0.7);
  });

  it("eases the glitch back to zero offset", () => {
    const fx = new LogoFx(seeded(2));
    let t = 0;
    while (fx.corners === 0 && t < 100) fx.update((t += 1 / 60), 1920, 1080, 0);
    const late = fx.glitchAt(t + 0.55);
    expect(late).not.toBeNull();
    expect(Math.abs(late!.red.x)).toBeLessThan(2);
    expect(fx.glitchAt(t + 0.7)).toBeNull();
  });
});
