// ---------------------------------------------------------------------------
// World time.
//
// A device's own clock is often wrong by far more than the delays being
// measured - one test machine was 0.74 s out - so link delay is measured against
// time from the network instead. Cloudflare's trace page replies with the
// server's whole second and allows any website to read it. One reply only says
// "the true time is within this second", but the moment the second ticks over
// is exact, so the clock is found by bisection: ask for the time just where the
// next tick should land by our best guess, and each answer (before or after the
// tick) halves what is left unknown. After ~8 questions the clock is known to
// about the network round trip.
// ---------------------------------------------------------------------------

export type ClockFix = {
  /** World time minus this device's clock (Date.now()), in ms. Add it to Date.now() to get world time. */
  offsetMs: number;
  /** The true offset is within this many ms of `offsetMs`. */
  uncertaintyMs: number;
  /** When this was measured (Date.now()). */
  at: number;
  probes: number;
};

export type ClockEnv = {
  /** performance.now() */
  perfNow: () => number;
  /** Date.now() at performance.now() == 0 (performance.timeOrigin) */
  epochOrigin: number;
  sleep: (ms: number) => Promise<void>;
  /** The server's current whole second since 1970. */
  fetchSeconds: () => Promise<number>;
};

export const TIME_URL = "https://www.cloudflare.com/cdn-cgi/trace";

export const browserClockEnv = (): ClockEnv => ({
  perfNow: () => performance.now(),
  epochOrigin: performance.timeOrigin,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetchSeconds: async () => {
    const res = await fetch(`${TIME_URL}?_=${Math.random().toString(36).slice(2)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Time server answered ${res.status}`);
    const m = /(?:^|\n)ts=(\d+)/.exec(await res.text());
    if (!m) throw new Error("Time server reply not understood");
    return Number(m[1]);
  },
});

export const measureWorldClock = async (env: ClockEnv = browserClockEnv(), opts: { maxProbes?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<ClockFix> => {
  const total = opts.maxProbes ?? 9;
  const local = (perf: number) => env.epochOrigin + perf;
  let lo = -Infinity;
  let hi = Infinity;
  let rtt = 60;
  let probes = 0;

  const probe = async (boundaryMs: number | null) => {
    const t0 = env.perfNow();
    const secs = await env.fetchSeconds();
    const t1 = env.perfNow();
    rtt = Math.max(2, t1 - t0);
    probes += 1;
    opts.onProgress?.(probes, total);
    if (boundaryMs === null) {
      // First probe: the true time is somewhere in that second.
      lo = secs * 1000 - local(t1);
      hi = (secs + 1) * 1000 - local(t0);
    } else if (secs * 1000 >= boundaryMs) {
      lo = Math.max(lo, boundaryMs - local(t1)); // the tick had already happened
    } else {
      hi = Math.min(hi, boundaryMs - local(t0)); // the tick had not
    }
  };

  await probe(null);
  while (probes < total && hi - lo > Math.max(6, rtt)) {
    const mid = (lo + hi) / 2;
    // The next whole second (by our best guess) that is at least 0.6 s away.
    const boundary = Math.ceil((local(env.perfNow()) + mid + 600) / 1000) * 1000;
    // Send so the reply is made right at that tick: half the round trip before it.
    const sendAt = boundary - mid - rtt / 2;
    const wait = sendAt - local(env.perfNow());
    if (wait > 0) await env.sleep(wait);
    await probe(boundary);
    if (lo > hi) {
      // The network jittered more than the gap: settle for the middle with a wide margin.
      const m = (lo + hi) / 2;
      lo = m - 25;
      hi = m + 25;
      break;
    }
  }
  return { offsetMs: (lo + hi) / 2, uncertaintyMs: Math.max(1, (hi - lo) / 2), at: Date.now(), probes };
};
