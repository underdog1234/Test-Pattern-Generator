// ---------------------------------------------------------------------------
// Audio tests: a guided walk through the speakers - left, right, both, in
// phase, out of phase, then the low end (music with bass, and a sub sweep).
// The voice says what is being tested while the screen shows it, and the same
// timeline drives both, so what you see is always what you should be hearing.
// ---------------------------------------------------------------------------

import { MUSIC_SECONDS, SWEEP, musicBeat, sweepHz } from "./clips";
import type { Beep, PatternDef } from "./patterns";
import { FONT, clamp01, fitText, roundRect, wrapLines } from "./textKit";

type Side = "L" | "R";

type StepEvent = {
  /** Seconds after the step starts. */
  at: number;
  dur: number;
  /** The speakers it plays through, and whether the right one is upside down. */
  sides: Side[];
  inverted?: boolean;
  kind: "voice" | "pulse" | "noise" | "music" | "sweep";
  beep: Omit<Beep, "at" | "gain">;
};

export type AudioStep = {
  id: string;
  short: string;
  title: string;
  detail: string;
  seconds: number;
  events: StepEvent[];
};

const voice = (clip: string, dur: number, sides: Side[], route: Beep["route"]): StepEvent => ({
  at: 0.15, dur, sides, kind: "voice", beep: { freq: 0, duration: dur, clip, route },
});
const pulses = (sides: Side[], route: Beep["route"]): StepEvent[] =>
  [1.9, 2.5, 3.1].map((at) => ({ at, dur: 0.3, sides, kind: "pulse" as const, beep: { freq: 440, duration: 0.3, route } }));

export const AUDIO_STEPS: AudioStep[] = [
  {
    id: "left", short: "Left", title: "LEFT SPEAKER", seconds: 4,
    detail: "The voice and the three pulses should come from the LEFT speaker only. Nothing from the right.",
    events: [voice("speech-left", 1.4, ["L"], "L"), ...pulses(["L"], "L")],
  },
  {
    id: "right", short: "Right", title: "RIGHT SPEAKER", seconds: 4,
    detail: "The voice and the three pulses should come from the RIGHT speaker only. Nothing from the left.",
    events: [voice("speech-right", 1.4, ["R"], "R"), ...pulses(["R"], "R")],
  },
  {
    id: "centre", short: "Both", title: "BOTH SPEAKERS", seconds: 4,
    detail: "Both speakers together. The sound should sit exactly in the middle, equally loud on each side.",
    events: [voice("speech-centre", 1.5, ["L", "R"], "LR"), ...pulses(["L", "R"], "LR")],
  },
  {
    id: "in-phase", short: "In phase", title: "IN PHASE", seconds: 5,
    detail: "The same noise in both speakers. It should sound solid and focused in the middle, with full bass.",
    events: [
      voice("speech-in-phase", 1.65, ["L", "R"], "LR"),
      { at: 2.2, dur: 2.5, sides: ["L", "R"], kind: "noise", beep: { freq: 0, duration: 2.5, clip: "noise-in-phase" } },
    ],
  },
  {
    id: "out-of-phase", short: "Out of phase", title: "OUT OF PHASE", seconds: 5,
    detail: "The right speaker is upside down. It should sound wide, hollow and thin with little bass. If the in-phase test sounded like this, a speaker is wired backwards.",
    events: [
      voice("speech-out-of-phase", 1.8, ["L", "R"], "LR"),
      { at: 2.2, dur: 2.5, sides: ["L", "R"], inverted: true, kind: "noise", beep: { freq: 0, duration: 2.5, clip: "noise-out-of-phase" } },
    ],
  },
  {
    id: "sub", short: "Sub bass", title: "SUB BASS", seconds: 10,
    detail: "Music with a deep kick and bass line. You should feel the low end, not just hear it. If it sounds thin, check the subwoofer.",
    events: [
      voice("speech-sub", 1.8, ["L", "R"], "LR"),
      { at: 2, dur: MUSIC_SECONDS, sides: ["L", "R"], kind: "music", beep: { freq: 0, duration: MUSIC_SECONDS, clip: "sub-music" } },
    ],
  },
  {
    id: "sweep", short: "Sweep", title: "SUB SWEEP", seconds: 5,
    detail: "A slow tone rising from 20 Hz to 120 Hz. Note where it first becomes audible and where it gets loudest; gaps or rattles point to the room or the speaker.",
    events: [{ at: 0.5, dur: SWEEP.seconds, sides: ["L", "R"], kind: "sweep", beep: { freq: 0, duration: SWEEP.seconds, clip: "sub-sweep" } }],
  },
];

export const AUDIO_TEST_SECONDS = AUDIO_STEPS.reduce((n, s) => n + s.seconds, 0);

const STARTS = AUDIO_STEPS.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + AUDIO_STEPS[i - 1].seconds], []);

/** How loud each kind of sound is played, relative to the volume setting. */
const LEVEL: Record<StepEvent["kind"], number> = { voice: 1, pulse: 0.5, noise: 0.9, music: 0.9, sweep: 0.35 };

/** The sounds of the whole test, placed on the loop. Only whole sounds that fit before the loop restarts are used. */
export const audioTestBeeps: NonNullable<PatternDef["beeps"]> = (s, loopSeconds) => {
  const volume = Math.max(0.05, Math.min(1, Number(s.volume) / 100));
  const voiceOn = Boolean(s.voice);
  const out: Beep[] = [];
  const copies = Math.max(1, Math.floor(loopSeconds / AUDIO_TEST_SECONDS));
  for (let k = 0; k < copies; k += 1) {
    AUDIO_STEPS.forEach((step, i) => {
      step.events.forEach((e) => {
        if (e.kind === "voice" && !voiceOn) return;
        const at = k * AUDIO_TEST_SECONDS + STARTS[i] + e.at;
        if (at + e.dur > loopSeconds + 1e-6) return;
        out.push({ ...e.beep, at, gain: volume * LEVEL[e.kind] });
      });
    });
  }
  return out;
};

export type AudioTestMoment = {
  stepIndex: number;
  /** Seconds into the step. */
  local: number;
  /** The events playing right now. */
  live: StepEvent[];
  /** Which pulse (0-based) is sounding, or -1. */
  pulse: number;
  /** All pulses of this step that have started. */
  pulsesDone: number;
};

/** Where the loop is in the test; stepIndex is -1 after the last whole run, while waiting for the loop to restart. */
export const audioTestMoment = (loopTime: number, loopSeconds: number): AudioTestMoment => {
  const copies = Math.max(1, Math.floor(loopSeconds / AUDIO_TEST_SECONDS));
  if (loopTime >= copies * AUDIO_TEST_SECONDS) return { stepIndex: -1, local: 0, live: [], pulse: -1, pulsesDone: 0 };
  const t = loopTime % AUDIO_TEST_SECONDS;
  let i = AUDIO_STEPS.length - 1;
  while (i > 0 && t < STARTS[i]) i -= 1;
  const local = t - STARTS[i];
  const live = AUDIO_STEPS[i].events.filter((e) => local >= e.at && local < e.at + e.dur);
  const ps = AUDIO_STEPS[i].events.filter((e) => e.kind === "pulse");
  const pulse = ps.findIndex((e) => local >= e.at && local < e.at + e.dur);
  return { stepIndex: i, local, live, pulse, pulsesDone: ps.filter((e) => local >= e.at).length };
};

// --- drawing ----------------------------------------------------------------

const COL = { bg: "#0b1020", panel: "#151b2e", edge: "#2a3350", text: "#e2e8f0", dim: "#94a3b8", blue: "#5298FE", red: "#FF6354", yellow: "#F3F4A8", purple: "#CEC9FF" };

const speaker = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, colour: string, lit: number, inverted: boolean) => {
  ctx.save();
  roundRect(ctx, x, y, w, h, w * 0.08);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.lineWidth = Math.max(2, w * 0.012);
  ctx.strokeStyle = lit > 0 ? colour : COL.edge;
  ctx.stroke();
  if (lit > 0) {
    ctx.globalAlpha = 0.18 * lit;
    ctx.fillStyle = colour;
    roundRect(ctx, x, y, w, h, w * 0.08);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Two cones, the big one lit when the speaker is sounding.
  const cx = x + w / 2;
  const rBig = Math.min(w, h) * 0.3;
  const cyBig = y + h * 0.58;
  const rSmall = rBig * 0.4;
  const cySmall = y + h * 0.2;
  [[cySmall, rSmall], [cyBig, rBig]].forEach(([cy, r], i) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0a0e1a";
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.strokeStyle = lit > 0 ? colour : "#475569";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * (i ? 0.38 : 0.34) * (1 + 0.12 * lit), 0, Math.PI * 2);
    ctx.fillStyle = lit > 0 ? colour : "#334155";
    ctx.fill();
  });
  fitText(ctx, label, w * 0.8, h * 0.11);
  ctx.fillStyle = lit > 0 ? COL.text : COL.dim;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, cx, y + h * 0.95);
  if (inverted) {
    ctx.fillStyle = colour;
    ctx.font = `bold ${Math.round(h * 0.16)}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText("−", x + w * 0.85, y + h * 0.14);
  }
  ctx.restore();
};

const scope = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, inverted: boolean) => {
  ctx.save();
  roundRect(ctx, x, y, w, h, h * 0.06);
  ctx.fillStyle = "#070b16";
  ctx.fill();
  ctx.clip();
  ctx.lineWidth = Math.max(2, h * 0.025);
  const draw = (colour: string, sign: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 160; i += 1) {
      const px = x + (i / 160) * w;
      const v = Math.sin((i / 160) * Math.PI * 6 - t * 5) * sign;
      const py = y + h / 2 - v * h * 0.34;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
  };
  draw(COL.blue, 1);
  draw(COL.red, inverted ? -1 : 1);
  ctx.restore();
};

export const drawAudioTest: PatternDef["draw"] = (ctx, w, h, s, info) => {
  const m = audioTestMoment(info.loopTime, info.loopSeconds);
  const step = m.stepIndex >= 0 ? AUDIO_STEPS[m.stepIndex] : null;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "alphabetic";

  // The main label.
  ctx.textAlign = "center";
  fitText(ctx, "AUDIO TESTS", w * 0.7, h * 0.1);
  ctx.fillStyle = COL.yellow;
  ctx.fillText("AUDIO TESTS", w / 2, h * 0.115);
  const sub = step ? `Step ${m.stepIndex + 1} of ${AUDIO_STEPS.length}  ·  ${Math.max(0, Math.ceil(step.seconds - m.local))} s` : "Starting again…";
  fitText(ctx, sub, w * 0.6, h * 0.04, "normal");
  ctx.fillStyle = COL.dim;
  ctx.fillText(sub, w / 2, h * 0.17);

  const top = h * 0.21;
  const boxH = h * 0.4;
  const boxW = Math.min(w * 0.22, boxH * 0.85);
  const live = (side: Side) => {
    if (!step) return 0;
    const sounding = m.live.some((e) => e.sides.includes(side));
    const stepUses = step.events.some((e) => e.sides.includes(side));
    return sounding ? 1 : stepUses ? 0.0001 : 0;
  };
  const inverted = m.live.some((e) => e.inverted);
  speaker(ctx, w * 0.05, top, boxW, boxH, "LEFT", COL.blue, live("L"), false);
  speaker(ctx, w * 0.95 - boxW, top, boxW, boxH, "RIGHT", COL.red, live("R"), inverted);

  // Centre: the name of the test and what shows it.
  const midX = w * 0.05 + boxW + w * 0.03;
  const midW = w * 0.9 - boxW * 2 - w * 0.06;
  ctx.textAlign = "center";
  if (step) {
    fitText(ctx, step.title, midW, boxH * 0.26);
    ctx.fillStyle = COL.text;
    ctx.fillText(step.title, w / 2, top + boxH * 0.26);
    const vx = midX;
    const vy = top + boxH * 0.4;
    const vw = midW;
    const vh = boxH * 0.6;
    if (step.id === "left" || step.id === "right" || step.id === "centre") {
      const colours = step.id === "left" ? [COL.blue] : step.id === "right" ? [COL.red] : [COL.blue, COL.red];
      const r = Math.min(vh * 0.2, vw * 0.07);
      for (let i = 0; i < 3; i += 1) {
        const lit = m.pulse === i;
        const cx = w / 2 + (i - 1) * r * 3.4;
        const cy = vy + vh * 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = lit ? COL.yellow : i < m.pulsesDone ? "#475569" : "#1e293b";
        ctx.fill();
        if (lit) {
          ctx.lineWidth = r * 0.25;
          ctx.strokeStyle = colours[0];
          ctx.stroke();
        }
      }
    } else if (step.id === "in-phase" || step.id === "out-of-phase") {
      scope(ctx, vx, vy, vw, vh, info.loopTime, step.id === "out-of-phase");
      fitText(ctx, step.id === "in-phase" ? "Left and right move together" : "Right is the mirror image of left", vw, vh * 0.17, "normal");
      ctx.fillStyle = COL.dim;
      ctx.textBaseline = "top";
      ctx.fillText(step.id === "in-phase" ? "Left and right move together" : "Right is the mirror image of left", w / 2, vy + vh + h * 0.006);
      ctx.textBaseline = "alphabetic";
    } else if (step.id === "sub") {
      // A level bar that kicks with the beat of the music.
      const music = step.events.find((e) => e.kind === "music")!;
      const tm = m.local - music.at;
      const playing = tm >= 0 && tm < MUSIC_SECONDS;
      const env = playing ? Math.exp(-(tm % musicBeat) * 7) : 0;
      const bw = vw * 0.8;
      const bh = vh * 0.34;
      const bx = w / 2 - bw / 2;
      const by = vy + vh * 0.2;
      roundRect(ctx, bx, by, bw, bh, bh * 0.3);
      ctx.fillStyle = "#070b16";
      ctx.fill();
      roundRect(ctx, bx, by, Math.max(bh * 0.6, bw * (0.15 + 0.85 * env)), bh, bh * 0.3);
      ctx.fillStyle = COL.purple;
      ctx.fill();
      fitText(ctx, "KICK + BASS  ·  30 to 100 Hz", vw, vh * 0.2, "normal");
      ctx.fillStyle = COL.dim;
      ctx.fillText("KICK + BASS  ·  30 to 100 Hz", w / 2, by + bh + vh * 0.28);
    } else if (step.id === "sweep") {
      const sweep = step.events[0];
      const ts = m.local - sweep.at;
      const on = ts >= 0 && ts < SWEEP.seconds;
      const hz = on ? sweepHz(ts) : 0;
      fitText(ctx, "000 Hz", vw * 0.6, vh * 0.55);
      ctx.fillStyle = on ? COL.yellow : COL.dim;
      ctx.fillText(on ? `${Math.round(hz)} Hz` : "—", w / 2, vy + vh * 0.5);
      const bw = vw * 0.84;
      const bx = w / 2 - bw / 2;
      const by = vy + vh * 0.72;
      ctx.fillStyle = "#070b16";
      roundRect(ctx, bx, by, bw, vh * 0.1, vh * 0.05);
      ctx.fill();
      if (on) {
        ctx.fillStyle = COL.purple;
        ctx.beginPath();
        ctx.arc(bx + bw * clamp01(ts / SWEEP.seconds), by + vh * 0.05, vh * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      fitText(ctx, "20 Hz", bw * 0.2, vh * 0.12, "normal");
      ctx.fillStyle = COL.dim;
      ctx.textAlign = "left";
      ctx.fillText("20 Hz", bx, by + vh * 0.28);
      ctx.textAlign = "right";
      ctx.fillText("120 Hz", bx + bw, by + vh * 0.28);
      ctx.textAlign = "center";
    }
  }

  // What to listen for.
  const textTop = top + boxH + h * 0.05;
  const textPx = Math.max(12, Math.round(Math.min(h * 0.046, w * 0.026)));
  ctx.font = `${textPx}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillStyle = COL.text;
  const lines = step ? wrapLines(ctx, step.detail, w * 0.8) : ["The test starts again with the left speaker."];
  lines.forEach((l, i) => ctx.fillText(l, w / 2, textTop + textPx * 1.25 * (i + 1)));

  // The steps along the bottom.
  const chipsY = h * 0.88;
  const chipH = h * 0.07;
  const gap = w * 0.008;
  const chipW = (w * 0.9 - gap * (AUDIO_STEPS.length - 1)) / AUDIO_STEPS.length;
  AUDIO_STEPS.forEach((st, i) => {
    const x = w * 0.05 + i * (chipW + gap);
    const active = i === m.stepIndex;
    roundRect(ctx, x, chipsY, chipW, chipH, chipH * 0.3);
    ctx.fillStyle = active ? "#26304f" : COL.panel;
    ctx.fill();
    if (active) {
      ctx.save();
      roundRect(ctx, x, chipsY, chipW, chipH, chipH * 0.3);
      ctx.clip();
      ctx.fillStyle = COL.purple;
      ctx.fillRect(x, chipsY + chipH * 0.82, chipW * clamp01(m.local / st.seconds), chipH * 0.18);
      ctx.restore();
    }
    fitText(ctx, st.short, chipW * 0.9, chipH * 0.42);
    ctx.fillStyle = active ? COL.text : COL.dim;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(st.short, x + chipW / 2, chipsY + chipH * 0.42);
  });
  ctx.textBaseline = "alphabetic";
  const foot = "Turn sound on in the Output section · tests stereo left and right, phase and bass";
  fitText(ctx, foot, w * 0.9, h * 0.026, "normal");
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "center";
  ctx.fillText(foot, w / 2, h * 0.985);
  void s;
};
