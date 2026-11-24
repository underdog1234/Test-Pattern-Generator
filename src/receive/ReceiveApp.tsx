// Receive: point this device's camera and microphone at a screen running the
// AV Sync Flash and Beep pattern, and read off how far the picture and the
// sound are apart.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumField, Panel, SelectField, SmallButton } from "../generator/controls";
import { MeasureEngine, type Meters, type Roi } from "./engine";
import { Pairer, describeOffset, summarize, toCsv, type Pair } from "./sync";

const STORE = "testPatternGenerator:receive:v1";
type Prefs = { videoSensitivity: number; toneSensitivity: number; compensationMs: number; window: number; fps: string; roi: Roi; videoId: string; audioId: string };
const DEFAULT_PREFS: Prefs = { videoSensitivity: 1, toneSensitivity: 1, compensationMs: 0, window: 10, fps: "60", roi: { x: 0, y: 0, w: 1, h: 1 }, videoId: "", audioId: "" };

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
  const [tick, setTick] = useState(0);

  const pairer = useRef(new Pairer(450));
  const engine = useRef<MeasureEngine | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

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
            onPair(pairer.current.addFlash(t));
          },
          onBeep: (t) => {
            setCounts((c) => ({ ...c, beeps: c.beeps + 1 }));
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
      await refreshDevices();
      try {
        wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        wake.current = null;
      }
    } catch (e) {
      setError(explain(e));
      setRunning(false);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    await engine.current?.stop();
    await wake.current?.release().catch(() => {});
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
    pairer.current = new Pairer(450);
    setStartedAt(Date.now());
  };

  // --- results ---------------------------------------------------------------------

  const adjusted = useMemo(() => pairs.map((p) => p.offsetMs - prefs.compensationMs), [pairs, prefs.compensationMs]);
  const recent = adjusted.slice(-Math.max(3, prefs.window));
  const sum = summarize(recent);
  const fpsNum = Number(prefs.fps) || 60;
  const frameMs = meters && meters.fps > 5 ? 1000 / meters.fps : 0;

  const hint = useMemo(() => {
    void tick;
    if (!running) return null;
    const secs = (Date.now() - startedAt) / 1000;
    if (secs < 4) return { tone: "info", text: "Listening and watching… the sender flashes and beeps once a second." };
    if (counts.flashes === 0 && counts.beeps === 0) return { tone: "warn", text: "Nothing yet. Check the sender is running the AV Sync Flash and Beep pattern in fullscreen with sound on, and that this camera can see the screen." };
    if (counts.flashes > 0 && counts.beeps === 0) return { tone: "warn", text: "Seeing the flash but not hearing the beep. Turn the sender's volume up, tick “Beeps here” on the sender, move the microphone closer, or raise the sound sensitivity." };
    if (counts.beeps > 0 && counts.flashes === 0) return { tone: "warn", text: "Hearing the beep but not seeing the flash. Fill the view with the screen (or drag a box around it), dim the room, or raise the picture sensitivity." };
    if (counts.flashes + counts.beeps >= 8 && pairs.length === 0) return { tone: "warn", text: "Both are detected but never close together. Is the sender's flash interval longer than a second, or is the sound coming from a different device with a big delay?" };
    if (sum && !sum.stable && sum.n >= 5) return { tone: "warn", text: "Readings are jumping around. Hold the device steady, keep the screen filling the view, and cut background noise. The spread is shown below." };
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

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
        <div>
          <div className="text-base font-bold text-white">Receive</div>
          <div className="text-[11px] text-slate-400">A/V sync meter · partner to the Test Pattern Generator</div>
        </div>
        <a className="ml-auto text-xs text-sky-300 hover:underline" href="./">← Sender: Test Pattern Generator</a>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          {!running ? (
            <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-4">
              <div className="text-lg font-bold">Measure how far sound and picture are apart</div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
                <li>On the sender, open the <a className="text-sky-300 underline" href="./">Test Pattern Generator</a>, choose <b>Configurations → AV sync check</b>, tick <b>Beeps here</b> and press <b>Fullscreen here</b>.</li>
                <li>On this device, press Start and allow the camera and microphone.</li>
                <li>Aim the camera at the screen so it fills the view, near enough to hear the speaker. Readings appear after a few flashes.</li>
              </ol>
              <SmallButton tone="primary" onClick={() => void start()} disabled={starting}>
                {starting ? "Starting…" : "Start camera & microphone"}
              </SmallButton>
              {error ? (
                <div className="space-y-1 rounded-lg border border-amber-400/70 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <div className="font-semibold">{error.title}</div>
                  <ul className="list-disc space-y-1 pl-5 text-amber-200">
                    {error.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="text-xs text-slate-500">Nothing is recorded or uploaded. The video and sound are only analysed on this device, live.</div>
            </div>
          ) : null}

          <div className={running ? "" : "hidden"}>
            <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black">
              <div ref={stage} className="relative touch-none">
                <div className="absolute inset-0 z-10 cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
                  <div className="pointer-events-none absolute border-2 border-amber-300" style={{ left: `${boxShown.x * 100}%`, top: `${boxShown.y * 100}%`, width: `${boxShown.w * 100}%`, height: `${boxShown.h * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{wholeFrame ? "Watching the whole picture. Drag a box over the screen to ignore the rest of the room." : "Watching the boxed area only."}</span>
              {!wholeFrame ? <SmallButton onClick={() => patch({ roi: { x: 0, y: 0, w: 1, h: 1 } })}>Watch whole picture</SmallButton> : null}
            </div>
            {meters ? (
              <div className="mt-2 grid gap-2 rounded-xl border border-slate-700 bg-slate-900/70 p-3 sm:grid-cols-2">
                {bar(meters.video.level, meters.video.threshold, Math.max(40, meters.video.threshold * 3), "Picture change", counts.flashes > 0)}
                {bar(meters.tone.level, meters.tone.threshold, Math.max(0.2, meters.tone.threshold * 3), "1 kHz beep", counts.beeps > 0)}
                <div className="text-[11px] text-slate-400 sm:col-span-2">
                  Camera {meters.width}×{meters.height} at {f1(meters.fps)} fps · flashes seen {counts.flashes} · beeps heard {counts.beeps} · frame times from the {meters.frameClock === "camera" ? "camera" : "page (less exact)"}
                  {meters.micLatencyMs ? ` · mic delay ${f1(meters.micLatencyMs)} ms taken off` : ""}
                </div>
              </div>
            ) : null}
            {hint ? (
              <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${hint.tone === "warn" ? "border-amber-400/70 bg-amber-500/10 text-amber-100" : hint.tone === "ok" ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100" : "border-slate-700 bg-slate-900/70 text-slate-300"}`}>{hint.text}</div>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Result{paused ? " (paused)" : ""}</div>
            {sum ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-5xl font-bold tabular-nums">{sum.median > 0 ? "+" : ""}{Math.round(sum.median)}</span>
                  <span className="text-xl text-slate-400">ms</span>
                </div>
                <div className="text-lg font-semibold text-sky-200">{describeOffset(sum.median)}</div>
                <div className="mt-1 text-sm text-slate-400">
                  ≈ {(sum.median / (1000 / fpsNum)).toFixed(1)} frames at {fpsNum} fps · median of the last {sum.n}
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    ["Average", sum.mean],
                    ["Spread (SD)", sum.sd],
                    ["Lowest", sum.min],
                    ["Highest", sum.max],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-md bg-slate-800/70 p-1.5">
                      <dt className="text-slate-400">{k as string}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{f1(v as number)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2 text-xs text-slate-500">
                  Positive = the picture arrived after the sound (video late). Negative = the sound arrived after the picture (audio late).
                  {frameMs ? ` One camera frame is ${f1(frameMs)} ms, so each reading is good to about ±${f1(frameMs / 2)} ms; the median of several is better.` : ""}
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm text-slate-400">{running ? "Waiting for the first flash and beep to arrive together…" : "Start the camera to begin."}</div>
            )}
            <canvas ref={chart} className="mt-3 h-28 w-full rounded-md bg-slate-950/60" />
            <div className="mt-2 flex flex-wrap gap-2">
              <SmallButton onClick={reset} disabled={!running && !pairs.length}>Reset</SmallButton>
              <SmallButton active={paused} onClick={() => setPaused((p) => !p)} disabled={!running}>{paused ? "Resume" : "Pause"}</SmallButton>
              <SmallButton onClick={() => void copyCsv()} disabled={!pairs.length}>Copy results (CSV)</SmallButton>
              {running ? <SmallButton tone="danger" onClick={() => void stop()}>Stop camera</SmallButton> : null}
            </div>
          </div>

          <Panel title="Settings" defaultOpen={false}>
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
              <span className="text-slate-500">Raise it if flashes are missed (a dim or distant screen). Lower it if room light or movement triggers false flashes.</span>
            </label>
            <label className="block text-xs text-slate-300">
              Sound sensitivity: {prefs.toneSensitivity.toFixed(1)}
              <input type="range" className="mt-1 w-full accent-sky-500" min={0.5} max={3} step={0.1} value={prefs.toneSensitivity} onChange={(e) => patch({ toneSensitivity: Number(e.target.value) })} />
              <span className="text-slate-500">Raise it if beeps are missed (quiet speaker). Lower it in a noisy room.</span>
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <NumField label="Delay to take off (ms)" value={prefs.compensationMs} integer={false} step={1} min={-500} max={500} onCommit={(v) => patch({ compensationMs: v })} title="Subtracted from every reading, to cancel a known delay in this device's camera or microphone" />
              <NumField label="Readings averaged" value={prefs.window} integer min={3} max={100} onCommit={(v) => patch({ window: v })} />
              <SelectField label="Show frames at" value={prefs.fps} onChange={(v) => patch({ fps: v })}>
                {["24", "25", "30", "50", "60"].map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </SelectField>
            </div>
            <div className="text-xs text-slate-500">
              A phone camera and microphone each add a small delay of their own, which no web page can see. For a reference, measure a source you know is in sync (or the same screen through a known-good path) and put the reading under “Delay to take off”.
            </div>
          </Panel>

          {pairs.length ? (
            <Panel title={`Readings (${pairs.length})`} defaultOpen={false}>
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
        </section>
      </main>
    </div>
  );
}
