// ---------------------------------------------------------------------------
// Pairing: the sender (this generator) and a Receive page on another device
// talk to each other so each can show what the other is seeing.
//
// There is no server of ours, so they meet on a free public message relay
// (ntfy.sh): both sides join a topic named after a random session ID that is
// carried in the QR code. Only small status messages go through it - clock
// accuracy and the measured delays - never video or sound. Anyone who
// learned the session ID could read them, so the ID is long and random and
// lives only for the session.
// ---------------------------------------------------------------------------

import { describeOffset } from "../receive/sync";

export const RELAY = "https://ntfy.sh";
/** The relay address (a test can point this somewhere else with globalThis.__TPG_RELAY). */
const relayUrl = (): string => (globalThis as { __TPG_RELAY?: string }).__TPG_RELAY ?? RELAY;

export type ClockSummary = { offsetMs: number; uncertaintyMs: number };

export type SenderStatus = { role: "sender"; at: number; clock: ClockSummary | null };

export type ReceiverStatus = {
  role: "receiver";
  at: number;
  /** The camera is running and measuring. */
  running: boolean;
  clock: ClockSummary | null;
  /** Picture-versus-sound reading: median ms (positive = video late), spread, how many readings. */
  av: { medianMs: number; sdMs: number; n: number; stable: boolean } | null;
  /** Delay of the picture and of the sound from the sender, ms; null until measured. */
  link: { videoMs: number | null; audioMs: number | null; locked: boolean } | null;
  fps: number;
};

export type PairMessage = SenderStatus | ReceiverStatus;

/** What the sending screen needs to draw: the QR while waiting, the status once the receiver is there. */
export type PairingView = {
  url: string;
  /** The receiver has opened the page. */
  joined: boolean;
  /** Our own clock, as the sender knows it. */
  senderClock: ClockSummary | null;
  receiver: ReceiverStatus | null;
  /** When the receiver was last heard from (Date.now()), or null. */
  receiverSeenAt: number | null;
  /** The connection QR code is on show (it goes after two minutes, when the receiver connects, or when closed). */
  qrOpen: boolean;
  /** When the QR code goes by itself (Date.now()), or null. */
  qrUntil: number | null;
  /** The relay is turning our messages away (rate limit); they are retried. */
  relayLimited?: boolean;
  /** The two devices are talking directly (no relay needed). */
  direct?: boolean;
  /** The relay stream is open. */
  relayUp?: boolean;
};

/** How long the connection QR code stays up. */
export const QR_SHOW_MS = 120000;

export const newSessionId = (): string => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0").slice(-2)).join("").slice(0, 14);
};

/** The Receive page's address for a session, next to whichever page this is. */
export const receiveUrl = (sessionId: string, base: string = typeof location !== "undefined" ? location.href : "https://example.invalid/"): string => {
  const u = new URL("receive.html", base);
  u.search = "";
  u.hash = "";
  u.searchParams.set("s", sessionId);
  return u.toString();
};

export const sessionFromUrl = (search: string): string | null => {
  const s = new URLSearchParams(search).get("s");
  return s && /^[a-z0-9]{8,32}$/.test(s) ? s : null;
};

type Signal = { kind: "offer" | "answer"; id: string; sdp: string };

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** ntfy takes messages up to 4 KB: keep the SDP lean (UDP candidates only, a handful of them). */
const compactSdp = (sdp: string): string => {
  let kept = 0;
  return sdp
    .split(/\r?\n/)
    .filter((l) => {
      if (!l.startsWith("a=candidate:")) return true;
      if (!/ udp /i.test(l) || kept >= 6) return false;
      kept += 1;
      return true;
    })
    .join("\r\n");
};

const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = setTimeout(resolve, 3000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });

/**
 * The link between the two devices. The relay (ntfy.sh) is only used to introduce them: they swap a few small
 * WebRTC messages through it, then talk directly (a data channel), which has no message limits. Until the direct
 * link is up - or if it never comes up (strict networks) - status messages go through the relay, slowly, because
 * the free relay allows only a small number of messages a day.
 */
export class PairLink {
  private es: EventSource | null = null;
  private lastSent = 0;
  private pending: PairMessage | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffUntil = 0;
  private esOpen = false;
  private lastMsg: PairMessage | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private offerId = "";
  private offers = 0;
  private reofferTimer: ReturnType<typeof setTimeout> | null = null;
  private answerTimer: ReturnType<typeof setTimeout> | null = null;
  private waitingOffer: Signal | null = null;
  private answeredId = "";
  private stopped = false;
  /** True while the relay stream or the direct link is open. */
  up = false;
  /** True while the direct link is open. */
  direct = false;

  constructor(
    private readonly sessionId: string,
    private readonly role: PairMessage["role"],
    private readonly onMessage: (m: PairMessage) => void,
    private readonly onUp?: (up: boolean) => void,
    private readonly minGapMs = 2500,
    private readonly onLimited?: (limited: boolean) => void,
    private readonly onDirect?: (direct: boolean) => void,
  ) {}

  private get topic() {
    return `tpg-${this.sessionId}`;
  }

  start() {
    this.stop();
    this.stopped = false;
    const es = new EventSource(`${relayUrl()}/${this.topic}/sse?since=10m`);
    this.es = es;
    es.onopen = () => {
      this.esOpen = true;
      this.refreshUp();
    };
    es.onerror = () => {
      this.esOpen = false; // EventSource reconnects by itself
      this.refreshUp();
    };
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const outer = JSON.parse(e.data) as { event?: string; message?: string };
        if (outer.event && outer.event !== "message") return;
        const m = JSON.parse(outer.message ?? "") as PairMessage & { signal?: Signal };
        if (!m || (m.role !== "sender" && m.role !== "receiver") || m.role === this.role) return;
        if (m.signal) void this.onSignal(m.signal);
        else this.onMessage(m);
      } catch {
        // Not one of ours; ignore.
      }
    };
    if (this.role === "sender" && typeof RTCPeerConnection !== "undefined") void this.makeOffer();
  }

  private refreshUp() {
    const up = this.esOpen || this.direct;
    if (this.up === up) return;
    this.up = up;
    this.onUp?.(up);
  }

  // --- the direct link ------------------------------------------------------------

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => {
      this.direct = true;
      this.onDirect?.(true);
      this.onLimited?.(false);
      this.refreshUp();
      if (this.lastMsg) this.send(this.lastMsg);
    };
    dc.onclose = () => {
      if (this.dc !== dc) return;
      this.direct = false;
      this.onDirect?.(false);
      this.refreshUp();
      if (this.role === "sender" && !this.stopped) this.scheduleOffer(3000);
    };
    dc.onmessage = (e: MessageEvent<string>) => {
      try {
        const m = JSON.parse(e.data) as PairMessage;
        if (m && (m.role === "sender" || m.role === "receiver") && m.role !== this.role) this.onMessage(m);
      } catch {
        // ignore
      }
    };
  }

  private closePeer() {
    const pc = this.pc;
    this.pc = null;
    this.dc = null;
    try {
      pc?.close();
    } catch {
      // already closed
    }
  }

  private scheduleOffer(ms: number) {
    if (this.reofferTimer) clearTimeout(this.reofferTimer);
    this.reofferTimer = setTimeout(() => void this.makeOffer(), ms);
  }

  /** Sender: make an offer and post it; if nobody answers, offer again (a fresh offer each time, newest wins). */
  private async makeOffer() {
    if (this.stopped || this.direct || typeof RTCPeerConnection === "undefined") return;
    this.closePeer();
    this.offers += 1;
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      this.bindChannel(pc.createDataChannel("tpg"));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      if (this.stopped || this.pc !== pc || !pc.localDescription) return;
      this.offerId = `${Date.now().toString(36)}${this.offers}`;
      void this.post({ role: this.role, signal: { kind: "offer", id: this.offerId, sdp: compactSdp(pc.localDescription.sdp) } });
    } catch {
      // No WebRTC here; the relay carries everything.
    }
    // Keep offering for a while in case the other side opens late.
    if (this.offers < 12) this.scheduleOffer(this.offers < 3 ? 25000 : 60000);
  }

  private async onSignal(sig: Signal) {
    if (this.stopped || this.direct || typeof RTCPeerConnection === "undefined") return;
    if (this.role === "sender") {
      if (sig.kind !== "answer" || sig.id !== this.offerId || !this.pc || this.pc.signalingState !== "have-local-offer") return;
      try {
        await this.pc.setRemoteDescription({ type: "answer", sdp: sig.sdp });
      } catch {
        // stale answer
      }
      return;
    }
    if (sig.kind !== "offer" || sig.id === this.answeredId) return;
    // Offers may arrive in a burst (the relay replays recent ones): answer only the newest.
    this.waitingOffer = sig;
    if (this.answerTimer) clearTimeout(this.answerTimer);
    this.answerTimer = setTimeout(() => void this.answer(), 400);
  }

  private async answer() {
    const sig = this.waitingOffer;
    this.waitingOffer = null;
    if (!sig || this.stopped || this.direct) return;
    this.answeredId = sig.id;
    try {
      this.closePeer();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      pc.ondatachannel = (e) => this.bindChannel(e.channel);
      await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (this.stopped || this.pc !== pc || !pc.localDescription) return;
      void this.post({ role: this.role, signal: { kind: "answer", id: sig.id, sdp: compactSdp(pc.localDescription.sdp) } });
    } catch {
      // Falls back to the relay.
    }
  }

  /** A small, important message (a WebRTC introduction): tried a few times if the relay turns it away. */
  private async post(body: object, tries = 4) {
    for (let i = 0; i < tries && !this.stopped && !this.direct; i += 1) {
      try {
        const res = await fetch(`${relayUrl()}/${this.topic}`, { method: "POST", body: JSON.stringify(body) });
        if (res.status !== 429) return;
        this.onLimited?.(true);
      } catch {
        // offline: try again
      }
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  // --- status messages ----------------------------------------------------------------

  /**
   * Send a status. Over the direct link it goes at once. Through the relay (free, and limited to a few messages a
   * day) bursts are merged and only the newest goes out, no more often than the gap allows.
   */
  send(msg: PairMessage, now = Date.now()) {
    this.lastMsg = msg;
    if (this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(JSON.stringify(msg));
        return;
      } catch {
        // fall through to the relay
      }
    }
    this.pending = msg;
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + this.minGapMs - now, this.backoffUntil - now);
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  private async flush() {
    this.timer = null;
    const msg = this.pending;
    this.pending = null;
    if (!msg || this.direct) return;
    this.lastSent = Date.now();
    try {
      const res = await fetch(`${relayUrl()}/${this.topic}`, { method: "POST", body: JSON.stringify(msg) });
      if (res.status === 429) {
        // Turned away: wait as long as the relay asks (at least 15 s), then send this again unless something newer is queued.
        const asked = Number(res.headers?.get?.("Retry-After")) || 0;
        this.backoffUntil = Date.now() + Math.max(15000, asked * 1000);
        if (!this.pending) this.pending = msg;
        if (!this.timer) this.timer = setTimeout(() => void this.flush(), Math.max(0, this.backoffUntil - Date.now()));
        this.onLimited?.(true);
      } else this.onLimited?.(false);
    } catch {
      // Offline for a moment; the next status goes out when there is one.
    }
  }

  stop() {
    this.stopped = true;
    this.es?.close();
    this.es = null;
    this.esOpen = false;
    for (const t of [this.timer, this.reofferTimer, this.answerTimer]) if (t) clearTimeout(t);
    this.timer = this.reofferTimer = this.answerTimer = null;
    this.pending = null;
    this.closePeer();
    this.direct = false;
    this.offers = 0;
    this.refreshUp();
  }
}

// --- wording shared by both screens ------------------------------------------------------

export type ClockLine = { ok: boolean; text: string };

/** "Clocks lined up" status from both clocks. */
export const clocksLinedUp = (a: ClockSummary | null, b: ClockSummary | null): ClockLine => {
  if (a && b) return { ok: true, text: `Clocks lined up to world time (within ±${Math.round(a.uncertaintyMs + b.uncertaintyMs)} ms of each other)` };
  if (!a && !b) return { ok: false, text: "Neither clock is synced to world time yet" };
  return { ok: false, text: a ? "Waiting for the other device's clock" : "This device's clock is not synced yet" };
};

export const clockText = (c: ClockSummary | null): string =>
  c ? `synced ±${Math.round(c.uncertaintyMs)} ms (device clock ${Math.abs(Math.round(c.offsetMs)) < 2 ? "is right" : `${c.offsetMs > 0 ? "behind" : "ahead"} by ${Math.abs(Math.round(c.offsetMs))} ms`})` : "not synced";

/** The lines the sending screen shows once a receiver is paired. */
export const overlayLines = (v: PairingView, now: number = Date.now()): Array<{ text: string; tone: "ok" | "warn" | "info" }> => {
  const r = v.receiver;
  const lines: Array<{ text: string; tone: "ok" | "warn" | "info" }> = [];
  if (!v.joined) return [{ text: "Waiting for the receiver…", tone: "info" }];
  const age = v.receiverSeenAt === null ? null : now - v.receiverSeenAt;
  if (age !== null && age > 20000) lines.push({ text: `Receiver quiet for ${Math.round(age / 1000)} s`, tone: "warn" });
  if (r?.av) lines.push({ text: `Sound vs picture: ${describeOffset(r.av.medianMs)}  (${r.av.medianMs > 0 ? "+" : ""}${Math.round(r.av.medianMs)} ms, ±${Math.round(r.av.sdMs)}, ${r.av.n} readings)`, tone: r.av.stable ? "ok" : "info" });
  else lines.push({ text: r?.running ? "Measuring… keep the camera on this screen" : "Receiver is open - waiting for its camera", tone: "info" });
  if (r?.link && r.link.locked && r.link.videoMs !== null && r.link.audioMs !== null) lines.push({ text: `Link delay: picture ${Math.round(r.link.videoMs)} ms · sound ${Math.round(r.link.audioMs)} ms`, tone: "ok" });
  const l = clocksLinedUp(v.senderClock, r?.clock ?? null);
  lines.push({ text: `This clock: ${clockText(v.senderClock)}`, tone: v.senderClock ? "ok" : "warn" });
  lines.push({ text: `Receiver clock: ${r?.clock ? clockText(r.clock) : "not synced"}`, tone: r?.clock ? "ok" : "warn" });
  lines.push({ text: l.text, tone: l.ok ? "ok" : "warn" });
  return lines;
};

// --- the short status the sender shows (top right of the output and in the admin panel) -------------

export type StatusRow = { kind: "ok" | "warn" | "wait" | "off"; text: string; label: string };

/** A few short rows, each with a mark and the full wording for screen readers. */
export const statusRows = (v: PairingView, now: number = Date.now()): StatusRow[] => {
  const r = v.receiver;
  const rows: StatusRow[] = [];
  const age = v.receiverSeenAt === null ? null : now - v.receiverSeenAt;
  if (v.relayLimited && !v.direct) rows.push({ kind: "warn", text: "Relay busy, retrying", label: "The message relay is busy and turned our message away. Retrying shortly" });
  else if (v.relayUp === false && !v.direct) rows.push({ kind: "warn", text: "Relay offline", label: "Not connected to the message relay. Check the network" });
  if (!v.joined) rows.push({ kind: "wait", text: "Waiting for receiver", label: "Waiting for the receiver to connect" });
  else if (age !== null && age > 20000) rows.push({ kind: "warn", text: `Receiver quiet ${Math.round(age / 1000)} s`, label: `The receiver has not reported for ${Math.round(age / 1000)} seconds` });
  else rows.push({ kind: "ok", text: "Receiver connected", label: "The receiver is connected" });
  if (v.joined) {
    if (r?.av) {
      const ms = Math.round(r.av.medianMs);
      rows.push({ kind: r.av.stable ? "ok" : "wait", text: `A/V ${ms > 0 ? "+" : ""}${ms} ms`, label: `Sound versus picture: ${describeOffset(r.av.medianMs)}, ${ms} milliseconds, ${r.av.n} readings` });
    } else rows.push({ kind: "wait", text: r?.running ? "Measuring…" : "Receiver camera off", label: r?.running ? "The receiver is measuring" : "Waiting for the receiver's camera" });
    if (r?.link && r.link.locked && r.link.videoMs !== null && r.link.audioMs !== null)
      rows.push({ kind: "ok", text: `Delay ${Math.round(r.link.videoMs)} / ${Math.round(r.link.audioMs)} ms`, label: `Link delay: picture ${Math.round(r.link.videoMs)} milliseconds, sound ${Math.round(r.link.audioMs)} milliseconds` });
  }
  const mine = v.senderClock;
  const theirs = r?.clock ?? null;
  rows.push(mine ? { kind: "ok", text: `Sender clock ±${Math.round(mine.uncertaintyMs)} ms`, label: `Sender clock synced to world time within ${Math.round(mine.uncertaintyMs)} milliseconds` } : { kind: "wait", text: "Syncing sender clock", label: "Syncing the sender clock to world time" });
  if (v.joined) rows.push(theirs ? { kind: "ok", text: `Receiver clock ±${Math.round(theirs.uncertaintyMs)} ms`, label: `Receiver clock synced to world time within ${Math.round(theirs.uncertaintyMs)} milliseconds` } : { kind: "wait", text: "Syncing receiver clock", label: "Waiting for the receiver clock to sync" });
  return rows;
};
