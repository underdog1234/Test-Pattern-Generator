import { describe, expect, it } from "vitest";
import { measureWorldClock, type ClockEnv } from "./worldClock";

// A pretend network: this device's clock is `skew` ms ahead of the world, and each request takes `rtt` ms.
const fake = (skew: number, rtt: number, jitter = 0): ClockEnv => {
  let perf = 123456.7;
  const epochOrigin = 1_795_000_000_000 + skew; // Date.now() at perf == 0, on the (wrong) device clock
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const world = () => epochOrigin + perf - skew; // true time now
  return {
    perfNow: () => perf,
    epochOrigin,
    sleep: async (ms) => void (perf += ms),
    fetchSeconds: async () => {
      const out = rtt / 2 + jitter * rnd();
      perf += out; // the request travels; the server stamps its second as the request arrives
      const secs = Math.floor(world() / 1000);
      perf += rtt / 2 + jitter * rnd();
      return secs;
    },
  };
};

describe("world clock", () => {
  it.each([
    ["ahead by 0.74 s", 740],
    ["behind by 0.31 s", -310],
    ["ahead by 2.2 s", 2200],
    ["right on", 0],
  ])("finds a device clock that is %s, to within its stated uncertainty", async (_n, skew) => {
    const fix = await measureWorldClock(fake(skew, 24, 6));
    expect(Math.abs(fix.offsetMs - -skew)).toBeLessThanOrEqual(fix.uncertaintyMs + 1);
    expect(fix.uncertaintyMs).toBeLessThan(40);
    expect(fix.probes).toBeLessThanOrEqual(9);
  });

  it("copes with a slow, noisy network by saying so in the uncertainty", async () => {
    const fix = await measureWorldClock(fake(500, 160, 90));
    expect(Math.abs(fix.offsetMs - -500)).toBeLessThanOrEqual(fix.uncertaintyMs + 1);
  });
});
