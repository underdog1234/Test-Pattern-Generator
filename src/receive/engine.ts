// Camera + microphone -> flash and beep times, on one clock (performance.now()).

import { BEEP_HZ, RiseDetector, refineOnset } from "./sync";
import { TONE_WINDOW, TONE_WORKLET_NAME, toneWorkletUrl } from "./toneWorklet";

export type Roi = { x: number; y: number; w: number; h: number };

export type EngineConfig = {
  videoSensitivity: number;
  toneSensitivity: number;
  roi: Roi;
};

export type EngineHandlers = {
  /** A flash began (video frame time). */
  onFlash: (t: number) => void;
  /** A beep began (mapped to the same clock, device input latency already taken off). */
  onBeep: (t: number) => void;
};

export type Meters = {
  /** Brightness change of the watched area, 0..255 scale, and the level that counts as a flash. */
  video: { level: number; threshold: number };
  /** Strength of the 1 kHz tone, 0..1, and the level that counts as a beep. */
  tone: { level: number; threshold: number };
  fps: number;
  width: number;
  height: number;
  /** What the device says its microphone delays sound by, ms (0 = unknown). */
  micLatencyMs: number;
  /** Whether frame times come from the camera itself (best) or from when the page got the frame. */
  frameClock: "camera" | "page";
  audioRate: number;
};

const SAMPLE = { w: 32, h: 18 };

export class MeasureEngine {
  readonly video = document.createElement("video");
  config: EngineConfig;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private canvas = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private flash: RiseDetector;
  private tone: RiseDetector;
  private alive = false;
  private frameTimes: number[] = [];
  private lastMeters: Meters = {
    video: { level: 0, threshold: 0 },
    tone: { level: 0, threshold: 0 },
    fps: 0,
    width: 0,
    height: 0,
    micLatencyMs: 0,
    frameClock: "page",
    audioRate: 0,
  };
  // context time -> performance.now: the smallest (arrival - context time) seen recently is the truest.
  private clockOffsets: Array<[number, number]> = [];
  private history: Array<[number, number]> = [];
  private pendingBeep: { fireEnd: number } | null = null;
  private handlers: EngineHandlers;

  constructor(config: EngineConfig, handlers: EngineHandlers) {
    this.config = config;
    this.handlers = handlers;
    this.canvas.width = SAMPLE.w;
    this.canvas.height = SAMPLE.h;
    this.g = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.flash = new RiseDetector({ minRise: 8, holdoffMs: 250, sensitivity: () => this.config.videoSensitivity });
    this.tone = new RiseDetector({ minRise: 0.03, holdoffMs: 250, baselineMs: 1000, sensitivity: () => this.config.toneSensitivity });
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get meters(): Meters {
    const m = this.lastMeters;
    m.video = { level: this.flash.level, threshold: this.flash.threshold };
    m.tone = { level: this.tone.level, threshold: this.tone.threshold };
    return m;
  }

  /** Open the camera and microphone and start measuring. Throws the browser's own error on failure. */
  async start(opts: { videoId?: string; audioId?: string } = {}): Promise<void> {
    await this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(opts.videoId ? { deviceId: { exact: opts.videoId } } : { facingMode: { ideal: "environment" } }),
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      },
      // Any processing would smear or hide the beep.
      audio: { ...(opts.audioId ? { deviceId: { exact: opts.audioId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    this.alive = true;
    this.video.srcObject = stream;
    await this.video.play();
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    const vs = vt?.getSettings?.() ?? {};
    const as = (at?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
    this.lastMeters.width = vs.width ?? this.video.videoWidth;
    this.lastMeters.height = vs.height ?? this.video.videoHeight;
    this.lastMeters.micLatencyMs = typeof as.latency === "number" ? as.latency * 1000 : 0;
    this.startVideoLoop();
    await this.startAudio(stream);
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node?.disconnect();
    this.node = null;
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.video.srcObject = null;
    this.frameTimes = [];
    this.clockOffsets = [];
    this.history = [];
    this.pendingBeep = null;
    this.flash = new RiseDetector({ minRise: 8, holdoffMs: 250, sensitivity: () => this.config.videoSensitivity });
    this.tone = new RiseDetector({ minRise: 0.03, holdoffMs: 250, baselineMs: 1000, sensitivity: () => this.config.toneSensitivity });
  }

  // --- picture ------------------------------------------------------------------

  private startVideoLoop() {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; expectedDisplayTime?: number }) => void) => number;
    };
    const onFrame = (now: number, meta?: { captureTime?: number }) => {
      if (!this.alive) return;
      // The camera's own capture time when the browser knows it; otherwise when we got the frame.
      const hasCapture = typeof meta?.captureTime === "number";
      const t = hasCapture ? (meta!.captureTime as number) : now;
      this.lastMeters.frameClock = hasCapture ? "camera" : "page";
      this.sampleFrame(t);
      this.frameTimes.push(now);
      while (this.frameTimes.length > 2 && now - this.frameTimes[0] > 2000) this.frameTimes.shift();
      if (this.frameTimes.length > 1) this.lastMeters.fps = ((this.frameTimes.length - 1) * 1000) / (now - this.frameTimes[0]);
      schedule();
    };
    const schedule = () => {
      if (!this.alive) return;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((now, meta) => onFrame(now, meta));
      else requestAnimationFrame((now) => onFrame(now));
    };
    schedule();
  }

  private sampleFrame(t: number) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    const r = this.config.roi;
    this.g.drawImage(this.video, r.x * vw, r.y * vh, Math.max(1, r.w * vw), Math.max(1, r.h * vh), 0, 0, SAMPLE.w, SAMPLE.h);
    const px = this.g.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const luma = sum / (px.length / 4);
    const fired = this.flash.push(t, luma);
    if (fired !== null) this.handlers.onFlash(fired);
  }

  // --- sound ----------------------------------------------------------------------

  private async startAudio(stream: MediaStream) {
    if (!stream.getAudioTracks().length) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.lastMeters.audioRate = ctx.sampleRate;
    await ctx.audioWorklet.addModule(toneWorkletUrl());
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, TONE_WORKLET_NAME, { processorOptions: { freq: BEEP_HZ, windowSamples: TONE_WINDOW } });
    this.node = node;
    node.port.onmessage = (e: MessageEvent<{ end: number; mag: number }>) => this.onToneReading(e.data.end, e.data.mag);
    // Connected through a silent gain so the browser keeps pulling audio through it.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
  }

  /** Context seconds -> performance.now ms, from the quickest messages seen in the last few seconds. */
  private toPerf(contextSeconds: number): number {
    return contextSeconds * 1000 + (this.clockOffsets.length ? Math.min(...this.clockOffsets.map((o) => o[1])) : 0);
  }

  private onToneReading(end: number, mag: number) {
    const arrival = performance.now();
    this.clockOffsets.push([arrival, arrival - end * 1000]);
    while (this.clockOffsets.length && arrival - this.clockOffsets[0][0] > 8000) this.clockOffsets.shift();
    const t = this.toPerf(end);
    this.history.push([t, mag]);
    if (this.history.length > 40) this.history.shift();
    const fired = this.tone.push(t, mag);
    if (fired !== null) this.pendingBeep = { fireEnd: fired };
    // A few readings after the trigger the peak is known: place the onset from the ramp.
    if (this.pendingBeep && t - this.pendingBeep.fireEnd >= 22) {
      const from = this.pendingBeep.fireEnd - 16;
      const readings = this.history.filter((h) => h[0] >= from);
      const windowMs = (TONE_WINDOW / (this.ctx?.sampleRate ?? 48000)) * 1000;
      const onset = refineOnset(readings, windowMs) ?? this.pendingBeep.fireEnd - windowMs / 2;
      this.pendingBeep = null;
      this.handlers.onBeep(onset - this.lastMeters.micLatencyMs);
    }
  }
}
