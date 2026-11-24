// The output itself: the whole canvas, or one sub-screen, at its native
// resolution and nothing else. Used for the separate output window (opened
// with ?output=1, kept in step with the editor over a BroadcastChannel) and
// for the editor's own fullscreen output. Like the LED planner's Moving Test
// Pattern window it never silently scales: one canvas pixel lands on one
// display pixel, and anything else is reported on screen.
import { useEffect, useRef, useState } from "react";
import { computePixelMappingStatus, watchDevicePixelRatio } from "../testPattern/pixelMapping";
import { frameEpochMs } from "./frameClock";
import { overlayLines, type PairingView } from "../shared/pairing";
import { applyGlitch } from "./glitch";
import { LOGO_PATH_D, LogoFx } from "./logoFx";
import { qrCanvas } from "./qr";
import { defaultDisplay, effectiveConfig, openChannel, playbackTime, readOutputState, type OutputDisplay, type OutputRequest, type OutputState } from "./storage";
import type { GeneratorConfig, Rect } from "./model";
import { renderComposite, renderScreen, loadLedModule } from "./render";
import { useSyncSound } from "./useSyncSound";

type Props = {
  /** Inline (fullscreen inside the editor): the editor's live state. Omit in the separate window. */
  stateRef?: React.MutableRefObject<OutputState>;
  /** null = the whole canvas. */
  screenId: string | null;
  onClose?: () => void;
  /** Inline only: change the display settings (the separate window asks over the channel instead). */
  onDisplay?: (patch: Partial<OutputDisplay>) => void;
};

// The logo's vector path, built once. Each screen keeps its own LogoFx (colour,
// fireworks), so every screen bounces and celebrates independently.
const LOGO_PATH = typeof Path2D !== "undefined" ? new Path2D(LOGO_PATH_D) : null;

// Wall-clock based, so the logo keeps moving while the pattern is paused.
const drawLogo = (ctx: CanvasRenderingContext2D, fx: LogoFx, area: Rect, t: number, seed: number) => {
  if (!LOGO_PATH || area.w < 40 || area.h < 24) return;
  fx.update(t, area.w, area.h, seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.translate(area.x, area.y);
  fx.draw(ctx, LOGO_PATH, t);
  ctx.restore();
  // Corner hit: one quick shake + RGB split over this screen only (logo included).
  const glitch = fx.glitchAt(t);
  if (glitch) applyGlitch(ctx, area, glitch);
};

/** Where the logo bounces: inside every visible sub-screen on the canvas, or the one screen being shown. */
const computeLogoAreas = (config: GeneratorConfig, screenId: string | null): Array<{ rect: Rect; seed: number }> => {
  if (screenId) {
    const s = config.screens.find((x) => x.id === screenId);
    return s ? [{ rect: { x: 0, y: 0, w: s.w, h: s.h }, seed: 0 }] : [];
  }
  const { w, h } = config.canvas;
  return config.screens.flatMap((s, i) => {
    if (!s.visible) return [];
    const x0 = Math.max(0, s.x);
    const y0 = Math.max(0, s.y);
    const x1 = Math.min(w, s.x + s.w);
    const y1 = Math.min(h, s.y + s.h);
    return x1 > x0 && y1 > y0 ? [{ rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, seed: i }] : [];
  });
};

// The areas only change when the config does, so work them out once per config, not every frame.
const areasCache = new WeakMap<GeneratorConfig, Map<string, Array<{ rect: Rect; seed: number }>>>();
const logoAreas = (config: GeneratorConfig, screenId: string | null) => {
  let byScreen = areasCache.get(config);
  if (!byScreen) areasCache.set(config, (byScreen = new Map()));
  const key = screenId ?? "";
  let areas = byScreen.get(key);
  if (!areas) byScreen.set(key, (areas = computeLogoAreas(config, screenId)));
  return areas;
};

const TONE_COLOURS = { ok: "#86efac", warn: "#fcd34d", info: "#e2e8f0" } as const;

/** The QR code while waiting for a receiver; then the receiver's readings and both clocks' status. */
const drawPairing = (ctx: CanvasRenderingContext2D, W: number, H: number, v: PairingView, qr: HTMLCanvasElement | null, now: number) => {
  const u = Math.min(W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!v.joined && qr) {
    const q = Math.round(u * 0.4);
    const pad = Math.round(u * 0.03);
    const font = Math.max(14, Math.round(u * 0.032));
    const boxW = q + pad * 2;
    const boxH = q + pad * 2 + font * 3.4;
    const x = Math.round((W - boxW) / 2);
    const y = Math.round((H - boxH) / 2);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${font}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Scan to open Receive", W / 2, y + pad * 0.7);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, x + pad, y + pad + font * 1.3, q, q);
    ctx.font = `${Math.round(font * 0.8)}px Arial, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(v.senderClock ? `This clock: synced to world time ±${Math.round(v.senderClock.uncertaintyMs)} ms · waiting for the receiver…` : "Syncing this clock to world time…", W / 2, y + pad + font * 1.3 + q + pad * 0.4);
  } else if (v.joined) {
    const lines = overlayLines(v, now);
    const font = Math.max(13, Math.round(u * 0.024));
    const lh = Math.round(font * 1.45);
    ctx.font = `bold ${font}px Arial, sans-serif`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + font * 1.6;
    const h = lines.length * lh + font;
    const x = Math.round(u * 0.02);
    const y = H - h - Math.round(u * 0.02);
    ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => {
      ctx.fillStyle = TONE_COLOURS[l.tone];
      ctx.fillText(l.text, x + font * 0.8, y + font * 0.5 + i * lh);
    });
  }
  ctx.restore();
};

export default function OutputView({ stateRef, screenId, onClose, onDisplay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ownState = useRef<OutputState | null>(stateRef ? null : readOutputState());
  const [, setVersion] = useState(0);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement != null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const logoFxRef = useRef(new Map<string, LogoFx>());
  const qrRef = useRef<{ url: string; canvas: HTMLCanvasElement } | null>(null);

  const current = () => (stateRef ? stateRef.current : ownState.current);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const display: OutputDisplay = current()?.display ?? defaultDisplay();
  const { fit, logo, status: statusVisible } = display;
  /** Display changes always go through the editor, so its buttons stay in step. */
  const changeDisplay = (patch: Partial<OutputDisplay>) => {
    if (onDisplay) onDisplay(patch);
    else channelRef.current?.postMessage({ type: "display", patch } satisfies OutputRequest);
  };
  const changeRef = useRef(changeDisplay);
  changeRef.current = changeDisplay;
  const displayRef = useRef(display);
  displayRef.current = display;

  // Inline output shares the editor's sound setting; a separate window has
  // its own, off to begin with so the two windows don't both beep.
  const sound = useSyncSound(
    (frameTs) => {
      const s = current();
      if (!s) return null;
      const now = frameEpochMs(frameTs);
      const { config } = effectiveConfig(s.config, s.playback, now);
      const screens = screenId ? config.screens.filter((x) => x.id === screenId) : config.screens;
      return { config, screens, time: playbackTime(s.playback, now), playing: s.playback.playing };
    },
    "testPatternGenerator:sound:editor",
    true,
    // The separate window beeps when the editor's "Beeps in output window" is on.
    stateRef ? undefined : { enabled: display.beeps, offsetMs: display.beepOffsetMs, onEnabled: (v) => changeDisplay({ beeps: v }) },
  );
  const soundRef = useRef(sound);
  soundRef.current = sound;

  // Separate window: follow the editor, and tell it whether this window is
  // fullscreen and 1:1 (the editor shows a warning when it isn't).
  useEffect(() => {
    if (stateRef) return;
    const channel = openChannel();
    if (!channel) return;
    channelRef.current = channel;
    channel.onmessage = (e) => {
      const data = e.data as OutputState | OutputRequest;
      if ("type" in data) return;
      ownState.current = { ...data, display: { ...defaultDisplay(), ...(data.display ?? {}) } };
      setVersion((v) => v + 1);
    };
    const id = window.setInterval(() => {
      channel.postMessage({ type: "status", fullscreen: document.fullscreenElement != null, oneToOne: oneToOneRef.current } satisfies OutputRequest);
    }, 1000);
    return () => {
      window.clearInterval(id);
      channelRef.current = null;
      channel.close();
    };
  }, [stateRef]);
  const oneToOneRef = useRef(true);

  const state = current();
  const target = state ? (screenId ? state.config.screens.find((s) => s.id === screenId) ?? null : null) : null;
  const outW = state ? (target ? target.w : state.config.canvas.w) : 0;
  const outH = state ? (target ? target.h : state.config.canvas.h) : 0;
  const hasLed = !!state?.config.screens.some((s) => s.ledLayout);

  useEffect(() => {
    if (hasLed) void loadLedModule();
  }, [hasLed]);

  useEffect(() => {
    if (!stateRef) document.title = target ? `Output - ${target.name}` : `Output - ${state?.config.name ?? "Test Pattern Generator"}`;
  }, [stateRef, target, state?.config.name]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !outW || !outH) return;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    const cache = new Map<string, HTMLCanvasElement>();
    logoFxRef.current.clear();
    let raf = 0;
    const tick = (frameTs: number) => {
      raf = requestAnimationFrame(tick);
      const s = current();
      if (!s) return;
      // The frame's own timestamp, not Date.now() sampled whenever this callback ran: steady steps, no rounding.
      const now = frameEpochMs(frameTs);
      const { config } = effectiveConfig(s.config, s.playback, now);
      const time = playbackTime(s.playback, now);
      if (screenId) {
        const screen = config.screens.find((x) => x.id === screenId);
        if (!screen) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        renderScreen(ctx, screen, time, { loopSeconds: config.loopSeconds, canvas: { w: config.canvas.w, h: config.canvas.h } });
      } else {
        renderComposite(ctx, config, time, cache, 1, true);
      }
      if (displayRef.current.logo) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const { rect, seed } of logoAreas(config, screenId)) {
          // One LogoFx per screen, rebuilt if the screen's size changes.
          const key = `${seed}:${rect.w}x${rect.h}`;
          let fx = logoFxRef.current.get(key);
          if (!fx) {
            fx = new LogoFx();
            logoFxRef.current.set(key, fx);
          }
          drawLogo(ctx, fx, rect, now / 1000, seed);
        }
      }
      if (s.pairing) {
        if (qrRef.current?.url !== s.pairing.url) qrRef.current = { url: s.pairing.url, canvas: qrCanvas(s.pairing.url, 640) };
        drawPairing(ctx, outW, outH, s.pairing, qrRef.current.canvas, Date.now());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outW, outH, screenId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !outW) return;
    if (fit) {
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.objectFit = "contain";
    } else {
      canvas.style.width = `${outW / dpr}px`;
      canvas.style.height = `${outH / dpr}px`;
      canvas.style.objectFit = "";
    }
  }, [outW, outH, dpr, fit]);

  useEffect(() => watchDevicePixelRatio(setDpr), []);

  // Inline in the editor, leaving fullscreen (Esc, or the browser's own
  // control) is leaving the output.
  useEffect(() => {
    if (!onClose) return;
    let was = document.fullscreenElement != null;
    const onChange = () => {
      const is = document.fullscreenElement != null;
      if (was && !is) onClose();
      was = is;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [onClose]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [outW, outH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "h") changeRef.current({ status: !displayRef.current.status });
      if (k === "f") document.documentElement.requestFullscreen?.().catch(() => {});
      if (k === "l") changeRef.current({ logo: !displayRef.current.logo });
      if (k === " ") e.preventDefault();
      if (k === "s") soundRef.current.setEnabled(!soundRef.current.enabled);
      if (e.key === "Escape" && onClose) {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!state || (screenId && !target)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950 p-6 text-center text-slate-300">
        <div>
          <div className="mb-2">{screenId ? "That sub-screen no longer exists in the editor." : "No generator state found for this window."}</div>
          <div className="text-sm text-slate-500">Open the output from the Test Pattern Generator&apos;s Output menu.</div>
        </div>
      </div>
    );
  }

  const mapping = computePixelMappingStatus(outW, outH, box.w, box.h, dpr);
  const displayW = Math.round((window.screen?.width ?? 0) * dpr);
  const displayH = Math.round((window.screen?.height ?? 0) * dpr);
  const scaled = mapping === "scaled";
  oneToOneRef.current = !scaled && !fit;
  const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-black"
      style={{ background: fit ? "#000" : state.config.canvas.background }}
      onClick={() => {
        if (!statusVisible) changeDisplay({ status: true });
      }}
    >
      <canvas ref={canvasRef} className="absolute left-0 top-0 block" />
      {statusVisible ? (
        <div
          className="fixed left-3 top-3 z-10 max-w-xs cursor-pointer space-y-2 font-mono text-xs"
          onClick={(e) => {
            e.stopPropagation();
            changeDisplay({ status: false });
          }}
        >
          {scaled ? (
            <div className={`rounded-lg border-2 px-3 py-2 font-sans text-sm font-bold shadow-lg ${fit ? "border-sky-500 bg-sky-950/90 text-sky-200" : "border-red-500 bg-red-950/90 text-red-200"}`}>
              {fit ? "Scaled to fit output" : "⚠ OUTPUT IS NOT BEING DISPLAYED 1:1"}
            </div>
          ) : null}
          <div className="space-y-1 rounded-lg border border-slate-600 bg-slate-950/85 px-3 py-2 text-slate-200 shadow-lg">
            <Row label="Output:" value={target ? target.name : `${state.config.name} (full canvas)`} />
            <Row label="Output Resolution:" value={`${outW} x ${outH}`} />
            <Row label="Display Resolution:" value={displayW && displayH ? `${displayW} x ${displayH} (approx.)` : "Unknown"} />
            <Row label="Device Pixel Ratio:" value={dpr.toFixed(2)} />
            <Row label="Fullscreen:" value={isFullscreen ? "Yes" : "No"} />
            {sound.enabled && sound.blocked && sound.active ? <Row label="Sound:" value="Click to allow" warn /> : null}
            <Row label="Browser -> Output:" value={fit ? "Scaled (fit)" : scaled ? "Scaled" : "1:1"} warn={scaled && !fit} />
            <div className="flex flex-wrap gap-1 pt-1 font-sans">
              <button type="button" className="rounded border border-slate-500 bg-slate-800 px-2 py-0.5 text-white" onClick={(e) => { e.stopPropagation(); changeDisplay({ fit: !fit }); }}>
                {fit ? "Native 1:1" : "Fit to output"}
              </button>
              <button type="button" className="rounded border border-slate-500 bg-slate-800 px-2 py-0.5 text-white" onClick={(e) => { e.stopPropagation(); changeDisplay({ logo: !logo }); }}>
                {logo ? "Hide logo" : "Bouncing logo"}
              </button>
              <button type="button" className="rounded border border-slate-500 bg-slate-800 px-2 py-0.5 text-white" onClick={(e) => { e.stopPropagation(); sound.setEnabled(!sound.enabled); }}>
                {sound.enabled ? "🔊 Sound on" : "🔇 Sound off"}
              </button>
              {onClose ? (
                <button type="button" className="rounded border border-slate-500 bg-slate-800 px-2 py-0.5 text-white" onClick={(e) => { e.stopPropagation(); document.exitFullscreen?.().catch(() => {}); onClose(); }}>
                  Close output
                </button>
              ) : null}
            </div>
            <div className="pt-1 text-[10px] text-slate-500">Click to hide · H toggles · F fullscreen · L logo (live only, never exported) · S sound{onClose ? " · Esc closes" : ""}</div>
          </div>
        </div>
      ) : null}
      {!isFullscreen ? (
        <button
          type="button"
          className="fixed left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border-2 border-amber-400 bg-amber-500/90 px-5 py-2 text-sm font-bold text-black shadow-lg hover:bg-amber-400"
          onClick={(e) => {
            e.stopPropagation();
            enterFullscreen();
          }}
        >
          ⚠ NOT FULLSCREEN - click here to go fullscreen
        </button>
      ) : null}
    </div>
  );
}

const Row = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div className="flex justify-between gap-4">
    <span className="text-slate-400">{label}</span>
    <span className={warn ? "font-semibold text-red-300" : "font-semibold text-white"}>{value}</span>
  </div>
);
