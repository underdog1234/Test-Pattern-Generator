import { afterEach, describe, expect, it, vi } from "vitest";
import { PairLink, clocksLinedUp, newSessionId, overlayLines, receiveUrl, sessionFromUrl, type PairMessage, type PairingView } from "./pairing";

describe("session ids and urls", () => {
  it("makes long random ids that survive a round trip through the QR address", () => {
    const a = newSessionId();
    expect(a).toMatch(/^[a-z0-9]{14}$/);
    expect(newSessionId()).not.toBe(a);
    const url = receiveUrl(a, "https://underdog1234.github.io/Test-Pattern-Generator/?output=1#x");
    expect(url).toBe(`https://underdog1234.github.io/Test-Pattern-Generator/receive.html?s=${a}`);
    expect(sessionFromUrl(new URL(url).search)).toBe(a);
    expect(sessionFromUrl("?s=../../x")).toBeNull();
    expect(sessionFromUrl("")).toBeNull();
  });
});

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

describe("PairLink", () => {
  const original = { es: (globalThis as any).EventSource, fetch: globalThis.fetch };
  afterEach(() => {
    (globalThis as any).EventSource = original.es;
    globalThis.fetch = original.fetch;
    vi.useRealTimers();
  });

  it("hears the other side but not itself, and reports when the relay is up", () => {
    (globalThis as any).EventSource = FakeEventSource;
    const got: PairMessage[] = [];
    const ups: boolean[] = [];
    const link = new PairLink("abc123def456gh", "sender", (m) => got.push(m), (u) => ups.push(u));
    link.start();
    const es = FakeEventSource.last!;
    expect(es.url).toBe("https://ntfy.sh/tpg-abc123def456gh/sse");
    es.onopen!();
    const wrap = (m: object) => ({ data: JSON.stringify({ event: "message", message: JSON.stringify(m) }) });
    es.onmessage!(wrap({ role: "sender", at: 1, clock: null })); // its own echo
    es.onmessage!(wrap({ role: "receiver", at: 2, running: true, clock: null, av: null, link: null, fps: 60 }));
    es.onmessage!({ data: JSON.stringify({ event: "open" }) });
    es.onmessage!({ data: "garbage" });
    expect(got.map((m) => m.role)).toEqual(["receiver"]);
    expect(ups).toEqual([true]);
    link.stop();
    expect(es.closed).toBe(true);
  });

  it("merges a burst of statuses into one request with the newest content, and keeps a gap between requests", async () => {
    vi.useFakeTimers();
    const posts: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      posts.push(String(init?.body));
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;
    const link = new PairLink("abc123def456gh", "receiver", () => {}, undefined, 2500);
    const st = (n: number): PairMessage => ({ role: "receiver", at: n, running: true, clock: null, av: null, link: null, fps: 60 });
    link.send(st(1), 100_000);
    link.send(st(2), 100_000);
    link.send(st(3), 100_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]).at).toBe(3);
    link.send(st(4), Date.now());
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts).toHaveLength(1); // still inside the gap
    await vi.advanceTimersByTimeAsync(2000);
    expect(posts).toHaveLength(2);
  });
});

describe("what the sending screen says", () => {
  const view = (over: Partial<PairingView> = {}): PairingView => ({
    url: "u",
    joined: true,
    senderClock: { offsetMs: 743, uncertaintyMs: 9 },
    receiver: { role: "receiver", at: 1, running: true, clock: { offsetMs: -40, uncertaintyMs: 14 }, av: { medianMs: 24, sdMs: 3, n: 12, stable: true }, link: { videoMs: 83, audioMs: 61, locked: true }, fps: 60 },
    receiverSeenAt: 98_500,
    ...over,
  });

  it("shows the delay, the link delay and that both clocks are lined up", () => {
    const text = overlayLines(view(), 100_000).map((l) => l.text).join("\n");
    expect(text).toContain("Video 24 ms late");
    expect(text).toContain("picture 83 ms · sound 61 ms");
    expect(text).toContain("This clock: synced ±9 ms (device clock behind by 743 ms)");
    expect(text).toContain("Receiver clock: synced ±14 ms");
    expect(text).toContain("Clocks lined up to world time (within ±23 ms");
  });
  it("says so when a clock is missing, and waits while nobody has joined", () => {
    expect(clocksLinedUp({ offsetMs: 0, uncertaintyMs: 5 }, null).ok).toBe(false);
    expect(overlayLines(view({ joined: false }))).toEqual([{ text: "Waiting for the receiver…", tone: "info" }]);
    expect(overlayLines(view({ receiverSeenAt: 55_000 }), 100_000)[0].text).toContain("Receiver quiet for 45 s");
  });
});
