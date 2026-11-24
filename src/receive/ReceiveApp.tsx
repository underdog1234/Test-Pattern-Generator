// AV Sync Test receiver: point this device's camera and microphone at a screen
// running the AV Sync Test pattern, and read off how far the picture and the
// sound are apart. Built for a phone held in one hand: the readings and the
// connection status come first, the camera preview is a small thumbnail.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumField, Panel, SelectField, SmallButton } from "../generator/controls";
import { MeasureEngine, type Meters, type Roi } from "./engine";
import { measureWorldClock, type ClockFix } from "../shared/worldClock";
import { PairLink, clocksLinedUp, sessionFromUrl, type ReceiverStatus, type SenderStatus } from "../shared/pairing";
import { StatusIcon, StatusLine, type StatusKind } from "../shared/StatusIcon";
import { Pairer, describeOffset, guessInterval, linkDelays, robustSummary, toCsv, type Pair } from "./sync";

const STORE = "testPatternGenerator:receive:v1";
type Prefs = { videoSensitivity: number; toneSensitivity: number; compensationMs: number; window: number; fps: string; roi: Roi; videoId: string; audioId: string; eventMs: number };
const DEFAULT_PREFS: Prefs = { videoSensitivity: 1, toneSensitivity: 1, compensationMs: 0, window: 20, fps: "60", roi: { x: 0, y: 0, w: 1, h: 1 }, videoId: "", audioId: "", eventMs: 33 };

const loadPrefs = (): Prefs => {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(STORE) || "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
};

/** What went wrong, in words a person can act on. */
const explain = (e: unknown): { title: string; steps: string[] } => {
  const name = e instanceof DOMException ? e.name : "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return { title: "This page can't use the camera here", steps: ["Camera and microphone only work on a secure (https) page. Open the https address of this site.", "In an in-app browser (Instagram, Teams, etc.) open the link in Safari or Chrome instead."] };
  if (name === "NotAllowedError" || name === "SecurityError")
    return { title: "Camera or microphone access was blocked", steps: ["Click the camera icon in the address bar (or the lock icon) and allow both Camera and Microphone for this site, then press Start again.", "On iPhone: Settings → Safari → Camera / Microphone → Allow (or Ask).", "If another app (Zoom, Teams) is using the camera, close it."] };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return { title: "No camera or microphone found", steps: ["This measurement needs both a camera and a microphone.", "Check they are plugged in and not disabled, then press Start again. You can pick a specific one under Devices."] };
  if (name === "NotReadableError" || name === "AbortError")
    return { title: "The camera or microphone is busy", steps: ["Another app or browser tab is using it. Close that and press Start again."] };
  return { title: "Couldn't start", steps: [e instanceof Error ? e.message : String(e)] };
};

const f1 = (n: number) => n.toFixed(1);

export default function ReceiveApp() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {
      // Not remembered; nothing depends on it.
    }
  }, [prefs]);
  const patch = (p: Partial<Prefs>) => setPrefs((x) => ({ ...x, ...p }));

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ title: string; steps: string[] } | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [counts, setCounts] = useState({ flashes: 0, beeps: 0 });
  const [meters, setMeters] = useState<Meters | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] });
  const [startedAt, setStartedAt] = useState(0);
  // The middle of every flash and beep, on this page's clock (performance.now), for the link-delay reading.
  const [events, setEvents] = useState<{ flashes: number[]; beeps: number[] }>({ flashes: [], beeps: [] });
  const [clock, setClock] = useState<{ fix: ClockFix | null; state: "idle" | "syncing" | "failed"; progress: number }>({ fix: null, state: "idle", progress: 0 });
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [tick, setTick] = useState(0);
  const [bigPreview, setBigPreview] = useState(false);
  const [awake, setAwake] = useState(false);

  // Pairing: opened from the sender's QR code, this page reports what it measures and hears how the sender's clock stands.
  const session = useMemo(() => sessionFromUrl(location.search), []);
  const [sender, setSender] = useState<{ status: SenderStatus; seenAt: number } | null>(null);
  const [relayUp, setRelayUp] = useState(false);
  const pairLink = useRef<PairLink | null>(null);
  const statusRef = useRef<ReceiverStatus | null>(null);

  const pairer = useRef(new Pairer(450));
  const engine = useRef<MeasureEngine | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  const onPair = useCallback((p: Pair | null) => {
    if (p && !pausedRef.current) setPairs((list) => [...list.slice(-199), p]);
  }, []);

  const getEngine = () => {
    if (!engine.current) {
      engine.current = new MeasureEngine(
        { videoSensitivity: prefs.videoSensitivity, toneSensitivity: prefs.toneSensitivity, roi: prefs.roi },
        {
          onFlash: (t) => {
            setCounts((c) => ({ ...c, flashes: c.flashes + 1 }));
            setEvents((e) => ({ ...e, flashes: [...e.flashes.slice(-59), t] }));
            onPair(pairer.current.addFlash(t));
          },
          onBeep: (t) => {
            setCounts((c) => ({ ...c, beeps: c.beeps + 1 }));
            setEvents((e) => ({ ...e, beeps: [...e.beeps.slice(-59), t] }));
            onPair(pairer.current.addBeep(t));
          },
        },
      );
    }
    return engine.current;
  };

  // The engine reads its settings live.
  useEffect(() => {
    if (engine.current) engine.current.config = { videoSensitivity: prefs.videoSensitivity, toneSensitivity: prefs.toneSensitivity, roi: prefs.roi };
  }, [prefs.videoSensitivity, prefs.toneSensitivity, prefs.roi]);

  useEffect(() => {
    if (!session) return;
    const link = new PairLink(session, "receiver", (m) => m.role === "sender" && setSender({ status: m, seenAt: Date.now() }), setRelayUp);
    pairLink.current = link;
    link.start();
    // Opening the page is what tells the sender to take its QR code down.
    link.send({ role: "receiver", at: Date.now(), running: false, clock: null, av: null, link: null, fps: 0 });
    const id = window.setInterval(() => statusRef.current && link.send({ ...statusRef.current, at: Date.now() }), 3000);
    return () => {
      window.clearInterval(id);
      link.stop();
    };
  }, [session]);

  // Keep this device's clock in step with the sender's (both are set against world time): once the page opens,
  // when the link to the sender comes up for the first time, and again every time it comes back after dropping.
  const wasUp = useRef(false);
  const syncing = useRef(false);
  useEffect(() => {
    if (!session) return;
    if (relayUp && !wasUp.current) void syncClock();
    wasUp.current = relayUp;
  }, [relayUp, session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const again = () => void syncClock();
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Opened from a QR code: do not wait for the camera, sync straight away.
    if (session) void syncClock();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the screen awake while the test is running, and take the hold again if the page was hidden and comes back.
  useEffect(() => {
    if (!running) {
      setAwake(false);
      return;
    }
    type Lock = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };
    const api = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<Lock> } }).wakeLock;
    let lock: Lock | null = null;
    let cancelled = false;
    const take = async () => {
      if (!api || document.visibilityState !== "visible") return;
      try {
        const l = await api.request("screen");
        if (cancelled) {
          void l.release().catch(() => {});
          return;
        }
        lock = l;
        setAwake(true);
        l.addEventListener?.("release", () => setAwake(false));
      } catch {
        setAwake(false);
      }
    };
    void take();
    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
      setAwake(false);
    };
  }, [running]);

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ video: all.filter((d) => d.kind === "videoinput"), audio: all.filter((d) => d.kind === "audioinput") });
    } catch {
      // The pickers just stay empty.
    }
  };

  const start = async (videoId = prefs.videoId, audioId = prefs.audioId) => {
    setStarting(true);
    setError(null);
    try {
      const eng = getEngine();
      await eng.start({ videoId: videoId || undefined, audioId: audioId || undefined });
      if (stage.current && !stage.current.contains(eng.video)) {
        eng.video.className = "block w-full select-none";
        stage.current.prepend(eng.video);
      }
      pairer.current = new Pairer(450);
      setRunning(true);
      setStartedAt(Date.now());
      setEvents({ flashes: [], beeps: [] });
      if (!clockRef.current.fix) void syncClock();
      await refreshDevices();
    } catch (e) {
      setError(explain(e));
      setRunning(false);
    } finally {
      setStarting(false);
    }
  };

  const syncClock = async () => {
    if (syncing.current) return;
    syncing.current = true;
    setClock((c) => ({ ...c, state: "syncing", progress: 0 }));
    try {
      const fix = await measureWorldClock(undefined, { onProgress: (n, total) => setClock((c) => ({ ...c, progress: n / total })) });
      setClock({ fix, state: "idle", progress: 1 });
    } catch {
      setClock((c) => ({ ...c, state: "failed" }));
    } finally {
      syncing.current = false;
    }
  };

  const stop = async () => {
    await engine.current?.stop();
    setRunning(false);
  };
  useEffect(() => () => void engine.current?.stop(), []);

  // Meters and the "what is wrong" hint refresh ten times a second.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (engine.current) setMeters({ ...engine.current.meters });
      setTick((n) => n + 1);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  const reset = () => {
    setPairs([]);
    setCounts({ flashes: 0, beeps: 0 });
    setEvents({ flashes: [], beeps: [] });
    pairer.current = new Pairer(450);
    setStartedAt(Date.now());
  };

  // --- results ---------------------------------------------------------------------

  const adjusted = useMemo(() => pairs.map((p) => p.offsetMs - prefs.compensationMs), [pairs, prefs.compensationMs]);
  const recent = adjusted.slice(-Math.max(3, prefs.window));
  const sum = robustSummary(recent);
  const fpsNum = Number(prefs.fps) || 60;
  const frameMs = meters && meters.fps > 5 ? 1000 / meters.fps : 0;

  // Link delay: world-time latency of the picture and of the sound against the sender's whole-second grid.
  const link = useMemo(() => {
    if (!clock.fix || events.flashes.length < 3) return null;
    const toWorld = (t: number) => performance.timeOrigin + t + clock.fix!.offsetMs;
    const flashW = events.flashes.map(toWorld);
    const beepW = events.beeps.map(toWorld);
    const interval = guessInterval(flashW);
    const d = linkDelays(flashW, beepW, prefs.eventMs, interval);
    const keep = Math.max(3, prefs.window);
    return { ...d, video: robustSummary(d.videoMs.slice(-keep)), audio: robustSummary(d.audioMs.slice(-keep)) };
  }, [events, clock.fix, prefs.eventMs, prefs.window]);

  statusRef.current = {
    role: "receiver",
    at: 0,
    running,
    clock: clock.fix ? { offsetMs: clock.fix.offsetMs, uncertaintyMs: clock.fix.uncertaintyMs } : null,
    av: sum ? { medianMs: sum.median, sdMs: sum.sd, n: sum.n, stable: sum.stable } : null,
    link: link ? { videoMs: link.video?.median ?? null, audioMs: link.audio?.median ?? null, locked: link.lockedVideo > 0.8 || link.lockedAudio > 0.8 } : null,
    fps: meters?.fps ?? 0,
  };
  const senderClock = sender?.status.clock ?? null;
  const myClock = clock.fix ? { offsetMs: clock.fix.offsetMs, uncertaintyMs: clock.fix.uncertaintyMs } : null;
  const lined = clocksLinedUp(senderClock, myClock);

  const hint = useMemo(() => {
    void tick;
    if (!running) return null;
    const secs = (Date.now() - startedAt) / 1000;
    if (secs < 4) return { tone: "info", text: "Listening and watching…" };
    if (counts.flashes === 0 && counts.beeps === 0) return { tone: "warn", text: "Nothing yet. Point the camera at the screen and check the sender is running with sound on." };
    if (counts.flashes > 0 && counts.beeps === 0) return { tone: "warn", text: "Seeing flashes, hearing no beeps. Turn the sender's sound up or move closer." };
    if (counts.beeps > 0 && counts.flashes === 0) return { tone: "warn", text: "Hearing beeps, seeing no flashes. Fill the view with the screen." };
    if (counts.flashes + counts.beeps >= 8 && pairs.length === 0) return { tone: "warn", text: "Flashes and beeps are never close together. Check the sender's flash interval." };
    if (meters && meters.fps > 5 && meters.fps < 45 && sum && sum.n >= 3) return { tone: "info", text: `Camera at ${meters.fps.toFixed(0)} fps. Trust the median of many readings.` };
    if (sum && !sum.stable && sum.n >= 5) return { tone: "warn", text: "Readings are jumping. Hold steady and fill the view with the screen." };
    if (sum?.stable) return { tone: "ok", text: "Steady reading." };
    return { tone: "info", text: "Collecting readings…" };
  }, [tick, running, startedAt, counts, pairs.length, sum]);

  // --- aim box -----------------------------------------------------------------------

  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const norm = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    const p = norm(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = norm(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w > 0.05 && h > 0.05) patch({ roi: { x, y, w, h } });
    setDrag(null);
  };
  const boxShown = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : prefs.roi;
  const wholeFrame = prefs.roi.w >= 0.999 && prefs.roi.h >= 0.999;

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(pairs, prefs.compensationMs));
    } catch {
      window.prompt("Copy the results:", toCsv(pairs, prefs.compensationMs));
    }
  };

  // --- strip chart -----------------------------------------------------------------------

  const chart = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const data = adjusted.slice(-40);
    const span = Math.max(50, ...data.map((v) => Math.abs(v)), 1) * 1.15;
    const y = (v: number) => h / 2 - (v / span) * (h / 2 - 6);
    g.strokeStyle = "#334155";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y(0));
    g.lineTo(w, y(0));
    g.stroke();
    g.fillStyle = "#64748b";
    g.font = "10px system-ui";
    g.fillText(`+${Math.round(span)} ms (video late)`, 4, 11);
    g.fillText(`−${Math.round(span)} ms (audio late)`, 4, h - 3);
    if (data.length) {
      g.strokeStyle = "#38bdf8";
      g.fillStyle = "#38bdf8";
      g.beginPath();
      data.forEach((v, i) => {
        const x = data.length === 1 ? w / 2 : 8 + (i / (data.length - 1)) * (w - 16);
        if (i) g.lineTo(x, y(v));
        else g.moveTo(x, y(v));
      });
      g.stroke();
      data.forEach((v, i) => {
        const x = data.length === 1 ? w / 2 : 8 + (i / (data.length - 1)) * (w - 16);
        g.beginPath();
        g.arc(x, y(v), 2.5, 0, Math.PI * 2);
        g.fill();
      });
    }
  }, [adjusted, running]);

  const bar = (value: number, threshold: number, max: number, label: string, hit: boolean) => (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span className={hit ? "text-emerald-300" : ""}>{hit ? "seen" : ""}</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-sky-500 transition-[width] duration-75" style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-amber-300" style={{ left: `${Math.min(100, (threshold / max) * 100)}%` }} title="Counts as an event above this line" />
      </div>
    </div>
  );

  // --- status, in short words with marks ---------------------------------------------------------

  const pairKind: StatusKind = !session ? "off" : sender ? "ok" : relayUp ? "wait" : "warn";
  const statusLines: Array<{ kind: StatusKind; text: string; label: string }> = [
    !session
      ? { kind: "off", text: "Not paired", label: "Not paired with a sender. Scan the QR code on the sender to pair." }
      : sender
        ? { kind: "ok", text: "Sender connected", label: "Connected to the sender" }
        : { kind: pairKind, text: relayUp ? "Connecting…" : "Offline", label: relayUp ? "Connecting to the sender" : "Not connected. Waiting for the network" },
    clock.state === "syncing"
      ? { kind: "wait", text: `Syncing clock ${Math.round(clock.progress * 100)}%`, label: `Syncing this device's clock to world time, ${Math.round(clock.progress * 100)} percent` }
      : myClock
        ? { kind: "ok", text: `Clock ±${Math.round(myClock.uncertaintyMs)} ms`, label: `This device's clock is synced to world time within ${Math.round(myClock.uncertaintyMs)} milliseconds` }
        : { kind: clock.state === "failed" ? "warn" : "off", text: clock.state === "failed" ? "Clock sync failed" : "Clock not synced", label: clock.state === "failed" ? "Could not reach the time server to sync the clock" : "The clock is not synced yet" },
    ...(session
      ? [lined.ok ? { kind: "ok" as const, text: "Clocks aligned", label: lined.text } : { kind: "wait" as const, text: senderClock ? "Aligning clocks" : "Waiting for sender clock", label: lined.text }]
      : []),
    running ? { kind: "ok", text: "Camera on", label: "Camera and microphone are on" } : { kind: "off", text: "Camera off", label: "Camera and microphone are off" },
    ...(running ? [awake ? { kind: "ok" as const, text: "Screen awake", label: "The screen is being kept awake" } : { kind: "warn" as const, text: "Screen may sleep", label: "This browser cannot keep the screen awake. Keep touching it, or turn off auto-lock" }] : []),
  ];

  const shown = sum ? `${sum.median > 0 ? "+" : ""}${Math.round(sum.median)}` : "-";

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-white">AV Sync Test</div>
          <div className="text-[11px] text-slate-400">Receiver</div>
        </div>
        <a className="ml-auto shrink-0 text-xs text-sky-300 hover:underline" href="./" aria-label="Back to the sender, the Test Pattern Generator">← Sender</a>
      </header>

      <main className="mx-auto max-w-xl space-y-3 p-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs" aria-label="Connection status">
          {statusLines.map((l) => (
            <StatusLine key={l.text.replace(/\d+/g, "")} kind={l.kind} text={l.text} label={l.label} />
          ))}
        </div>

        {!running ? (
          <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-4">
            <div className="text-lg font-bold">Picture vs sound</div>
            <button type="button" className="w-full rounded-lg border border-sky-500/60 bg-sky-600 px-4 py-3 text-base font-semibold text-white hover:bg-sky-500 disabled:opacity-50" onClick={() => void start()} disabled={starting}>
              {starting ? "Starting…" : "Start camera & microphone"}
            </button>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>On the sender, press <b>Start AV Sync Test</b> and scan its QR code.</li>
              <li>Press the button above and allow the camera and microphone.</li>
              <li>Point the camera at the screen, close enough to hear the speaker.</li>
            </ol>
            {error ? (
              <div className="space-y-1 rounded-lg border border-amber-400/70 bg-amber-500/10 p-3 text-sm text-amber-100" role="alert">
                <div className="font-semibold">{error.title}</div>
                <ul className="list-disc space-y-1 pl-5 text-amber-200">
                  {error.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="text-xs text-slate-500">Nothing is recorded or uploaded. Video and sound are analysed on this device only.</div>
          </div>
        ) : null}

        <div className={running ? `flex gap-3 ${bigPreview ? "flex-col" : "flex-row items-start"}` : "hidden"}>
          <div className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900/80 p-3" aria-live="polite">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sound vs picture{paused ? " (paused)" : ""}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-5xl font-bold tabular-nums" aria-label={sum ? `${shown} milliseconds` : "No reading yet"}>{shown}</span>
              <span className="text-lg text-slate-400">ms</span>
            </div>
            <div className="text-base font-semibold text-sky-200">{sum ? describeOffset(sum.median) : "Measuring…"}</div>
            {sum ? (
              <div className="mt-0.5 text-xs text-slate-400">
                ≈ {(sum.median / (1000 / fpsNum)).toFixed(1)} frames · ±{f1(sum.sd)} spread · {sum.n} readings
              </div>
            ) : null}
            {link && (link.lockedVideo > 0.8 || link.lockedAudio > 0.8) && link.video && link.audio ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-200">
                <StatusIcon kind="ok" />
                <span>Delay: picture {Math.round(link.video.median)} ms · sound {Math.round(link.audio.median)} ms</span>
              </div>
            ) : null}
          </div>

          <div className={bigPreview ? "w-full" : "w-28 shrink-0 sm:w-36"}>
            <div className="relative overflow-hidden rounded-lg border border-slate-700 bg-black">
              <div ref={stage} className="relative touch-none">
                <div className="absolute inset-0 z-10 cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
                  <div className="pointer-events-none absolute border-2 border-amber-300" style={{ left: `${boxShown.x * 100}%`, top: `${boxShown.y * 100}%`, width: `${boxShown.w * 100}%`, height: `${boxShown.h * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <SmallButton onClick={() => setBigPreview((v) => !v)} title="Make the camera preview bigger to aim it, or smaller to see the readings" className="px-1.5">
                {bigPreview ? "▾ Smaller" : "▴ Bigger"}
              </SmallButton>
              {!wholeFrame ? <SmallButton onClick={() => patch({ roi: { x: 0, y: 0, w: 1, h: 1 } })} title="Watch the whole camera picture again" className="px-1.5">Whole view</SmallButton> : null}
            </div>
            {bigPreview ? <div className="mt-0.5 text-[11px] text-slate-400">{wholeFrame ? "Drag a box over the screen to ignore the rest of the room." : "Watching the boxed area only."}</div> : null}
          </div>
        </div>

        {running && hint ? (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${hint.tone === "warn" ? "border-amber-400/70 bg-amber-500/10 text-amber-100" : hint.tone === "ok" ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100" : "border-slate-700 bg-slate-900/70 text-slate-300"}`} role="status">
            <StatusIcon kind={hint.tone === "warn" ? "warn" : hint.tone === "ok" ? "ok" : "wait"} />
            <span>{hint.text}</span>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
          <canvas ref={chart} className="h-20 w-full rounded-md bg-slate-950/60" aria-label="Chart of recent readings" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SmallButton onClick={reset} disabled={!running && !pairs.length}>Reset</SmallButton>
            <SmallButton active={paused} onClick={() => setPaused((p) => !p)} disabled={!running}>{paused ? "Resume" : "Pause"}</SmallButton>
            <SmallButton onClick={() => void copyCsv()} disabled={!pairs.length}>Copy CSV</SmallButton>
            <SmallButton onClick={() => void syncClock()} disabled={clock.state === "syncing"} title="Sync this device's clock to world time again">Sync clock</SmallButton>
            {running ? <SmallButton tone="danger" onClick={() => void stop()}>Stop</SmallButton> : null}
          </div>
        </div>

        <Panel id="rx-details" title="Details" level="sub">
          {meters ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {bar(meters.video.level, meters.video.threshold, Math.max(40, meters.video.threshold * 3), "Picture change", counts.flashes > 0)}
              {bar(meters.tone.level, meters.tone.threshold, Math.max(0.2, meters.tone.threshold * 3), "1 kHz beep", counts.beeps > 0)}
              <div className="text-[11px] text-slate-400 sm:col-span-2">
                Camera {meters.width}×{meters.height} at {f1(meters.fps)} fps · {counts.flashes} flashes · {counts.beeps} beeps
                {meters.micLatencyMs ? ` · mic delay ${f1(meters.micLatencyMs)} ms removed` : ""}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">Start the camera to see the meters.</div>
          )}
          {sum ? (
            <dl className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                ["Average", sum.mean],
                ["Spread", sum.sd],
                ["Lowest", sum.min],
                ["Highest", sum.max],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-md bg-slate-800/70 p-1.5">
                  <dt className="text-slate-400">{k as string}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{f1(v as number)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="text-xs text-slate-500">
            + means the picture arrived after the sound. − means the sound arrived after the picture.
            {frameMs ? ` One camera frame is ${f1(frameMs)} ms, so each reading is good to about ±${f1(frameMs / 2)} ms.` : ""}
          </div>
        </Panel>

        <Panel id="rx-link" title="Link delay" level="sub">
          {link && (link.lockedVideo > 0.8 || link.lockedAudio > 0.8) ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Picture", link.video?.median, link.video],
                ["Sound", link.audio?.median, link.audio],
                ["Difference", link.video && link.audio ? link.video.median - link.audio.median : undefined, null],
              ].map(([k, v, sm]) => (
                <div key={k as string} className="rounded-md bg-slate-800/70 p-2">
                  <div className="text-[11px] text-slate-400">{k as string}</div>
                  <div className="text-lg font-bold tabular-nums">{typeof v === "number" ? `${Math.round(v)} ms` : "-"}</div>
                  {sm ? <div className="text-[10px] text-slate-500">±{Math.round((sm as { sd: number }).sd)} · {(sm as { n: number }).n}</div> : <div className="text-[10px] text-slate-500">picture − sound</div>}
                </div>
              ))}
            </div>
          ) : link ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/70 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              <StatusIcon kind="warn" />
              <span>Flashes are not landing on whole seconds. On the sender, press <b>Lock to world time</b> and wait for a few flashes.</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">{running ? "Waiting for a few flashes…" : "Start the camera first."}</div>
          )}
          <div className="text-xs text-slate-400">
            How long the picture and sound take to get from the sender to here. This device's clock is kept in step with world time automatically
            {clock.fix ? `: it is ${Math.abs(Math.round(clock.fix.offsetMs))} ms ${clock.fix.offsetMs > 0 ? "behind" : "ahead"}, known to ±${Math.round(clock.fix.uncertaintyMs)} ms.` : "."}
          </div>
        </Panel>

        <Panel id="rx-settings" title="Settings" level="sub">
          <div className="grid gap-2 sm:grid-cols-2">
            <SelectField label="Camera" value={prefs.videoId} onChange={(v) => { patch({ videoId: v }); if (running) void start(v, prefs.audioId); }}>
              <option value="">Default (rear camera on a phone)</option>
              {devices.video.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
              ))}
            </SelectField>
            <SelectField label="Microphone" value={prefs.audioId} onChange={(v) => { patch({ audioId: v }); if (running) void start(prefs.videoId, v); }}>
              <option value="">Default</option>
              {devices.audio.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
              ))}
            </SelectField>
          </div>
          <label className="block text-xs text-slate-300">
            Picture sensitivity: {prefs.videoSensitivity.toFixed(1)}
            <input type="range" className="mt-1 w-full accent-sky-500" min={0.5} max={3} step={0.1} value={prefs.videoSensitivity} onChange={(e) => patch({ videoSensitivity: Number(e.target.value) })} />
            <span className="text-slate-500">Raise it if flashes are missed. Lower it if room light triggers false flashes.</span>
          </label>
          <label className="block text-xs text-slate-300">
            Sound sensitivity: {prefs.toneSensitivity.toFixed(1)}
            <input type="range" className="mt-1 w-full accent-sky-500" min={0.5} max={3} step={0.1} value={prefs.toneSensitivity} onChange={(e) => patch({ toneSensitivity: Number(e.target.value) })} />
            <span className="text-slate-500">Raise it if beeps are missed. Lower it in a noisy room.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Delay to take off (ms)" value={prefs.compensationMs} integer={false} step={1} min={-500} max={500} onCommit={(v) => patch({ compensationMs: v })} title="Subtracted from every reading, to cancel a known delay in this device's camera or microphone" />
            <NumField label="Readings averaged" value={prefs.window} integer min={3} max={100} onCommit={(v) => patch({ window: v })} />
            <NumField label="Sender flash length (ms)" value={prefs.eventMs} integer={false} step={1} min={1} max={500} onCommit={(v) => patch({ eventMs: v })} title="The sender's Flash length in frames divided by its frame rate (2 frames at 60 fps = 33 ms). Only used for link delay." />
            <SelectField label="Show frames at" value={prefs.fps} onChange={(v) => patch({ fps: v })}>
              {["24", "25", "30", "50", "60"].map((f) => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </SelectField>
          </div>
          <div className="text-xs text-slate-500">A phone's camera and microphone each add a small delay no web page can see. Measure a source you know is in sync and enter the result under “Delay to take off”.</div>
        </Panel>

        {pairs.length ? (
          <Panel id="rx-readings" title={`Readings (${pairs.length})`} level="sub">
            <div className="max-h-56 overflow-auto text-xs">
              <table className="w-full tabular-nums">
                <thead className="text-left text-slate-400">
                  <tr><th className="py-1">#</th><th>Offset (ms)</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  {[...adjusted].map((v, i) => [v, i] as const).reverse().slice(0, 40).map(([v, i]) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-0.5 text-slate-500">{i + 1}</td>
                      <td>{v > 0 ? "+" : ""}{f1(v)}</td>
                      <td className="text-slate-400">{describeOffset(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </main>
    </div>
  );
}
