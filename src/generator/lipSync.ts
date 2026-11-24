// ---------------------------------------------------------------------------
// Lip sync: an illustrated (not real) face speaks a short passage while its
// lips follow the voice. The mouth shapes come from the text-to-speech run
// that made the audio, so the lips and the sound start together by
// construction; any gap you see or hear is the display or audio chain.
// The words are the opening of the Gettysburg Address (public domain) after
// two lines made up for lip reading: plenty of p, b and m, where the lips
// must close, and f and v, where the lip meets the teeth.
// ---------------------------------------------------------------------------

import { LIPSYNC_SECONDS, LIPSYNC_TEXT, LIPSYNC_VISEMES, LIPSYNC_WORDS } from "./lipsyncData";
import type { Beep, PatternDef } from "./patterns";
import { FONT, fitText, roundRect, smoothstep, wrapLines } from "./textKit";

export const LIPSYNC_LEAD = 0.5;
export const LIPSYNC_MIN_LOOP = Math.ceil(LIPSYNC_LEAD + LIPSYNC_SECONDS + 1.5);

export type Mouth = {
  /** How far the mouth is open, 0..1. */
  open: number;
  /** Pulled wide (smile / "ee") 0..1. */
  wide: number;
  /** Pursed round ("oo", "w") 0..1. */
  round: number;
  /** 0 none, 1 tongue up behind the teeth, 2 tongue between the teeth. */
  tongue: number;
  /** Lower lip tucked under the top teeth (f, v). */
  bite: number;
};

const M = (open: number, wide: number, round: number, tongue = 0, bite = 0): Mouth => ({ open, wide, round, tongue, bite });

/** Mouth shape for each SAPI viseme (0-21). */
export const VISEME_MOUTH: Mouth[] = [
  M(0, 0.1, 0), // 0 silence
  M(0.55, 0.3, 0), // 1 ae ax ah
  M(0.9, 0.1, 0), // 2 aa
  M(0.65, 0, 0.6), // 3 ao
  M(0.45, 0.4, 0), // 4 ey eh uh
  M(0.3, 0, 0.45), // 5 er
  M(0.22, 0.9, 0), // 6 y iy ih ix
  M(0.2, 0, 1), // 7 w uw
  M(0.5, 0, 0.85), // 8 ow
  M(0.75, 0, 0.4), // 9 aw
  M(0.5, 0, 0.65), // 10 oy
  M(0.75, 0.3, 0), // 11 ay
  M(0.35, 0.2, 0), // 12 h
  M(0.25, 0, 0.5), // 13 r
  M(0.35, 0.4, 0, 1), // 14 l
  M(0.1, 0.8, 0), // 15 s z
  M(0.2, 0, 0.65), // 16 sh ch jh zh
  M(0.15, 0.4, 0, 2), // 17 th dh
  M(0.12, 0.4, 0, 0, 1), // 18 f v
  M(0.25, 0.4, 0, 1), // 19 d t n
  M(0.35, 0.2, 0), // 20 k g ng
  M(0, 0, 0), // 21 p b m
];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The mouth `t` seconds into the speech. A pure function of time, so a recording repeats exactly. */
export const mouthAt = (t: number): Mouth => {
  const v = LIPSYNC_VISEMES;
  if (t < 0 || t > LIPSYNC_SECONDS + 0.2) return VISEME_MOUTH[0];
  let lo = 0;
  let hi = v.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  const cur = VISEME_MOUTH[v[lo][2]] ?? VISEME_MOUTH[0];
  const prev = lo > 0 ? VISEME_MOUTH[v[lo - 1][2]] ?? VISEME_MOUTH[0] : VISEME_MOUTH[0];
  const end = lo + 1 < v.length ? v[lo + 1][0] : v[lo][0] + v[lo][1];
  // A shape is reached quickly, so a closed "p" still shows closed at 60 frames a second.
  const blend = Math.min(0.045, (end - v[lo][0]) * 0.7);
  const k = blend > 0 ? smoothstep((t - v[lo][0]) / blend) : 1;
  return {
    open: lerp(prev.open, cur.open, k),
    wide: lerp(prev.wide, cur.wide, k),
    round: lerp(prev.round, cur.round, k),
    tongue: k > 0.5 ? cur.tongue : prev.tongue,
    bite: lerp(prev.bite, cur.bite, k),
  };
};

export const lipSyncBeeps: NonNullable<PatternDef["beeps"]> = (s, loopSeconds) => {
  if (loopSeconds < LIPSYNC_LEAD + LIPSYNC_SECONDS + 1e-6) return []; // the whole speech has to fit in the loop
  return [{ at: LIPSYNC_LEAD, freq: 0, duration: LIPSYNC_SECONDS, clip: "speech-lipsync", route: "LR", gain: Math.max(0.05, Math.min(1, Number(s.volume) / 100)) }];
};

// --- the face ----------------------------------------------------------------

const C = { bg: "#0b1020", skin: "#f1c3a0", skinShade: "#e2a47f", hair: "#3a2a22", shirt: "#5298FE", lip: "#cf4a68", mouth: "#4a0f1d", tongue: "#e0707a", teeth: "#fffdf5", iris: "#4a3426", yellow: "#F3F4A8", dim: "#94a3b8", text: "#e2e8f0" };

const SENTENCES = (() => {
  const out: Array<{ from: number; to: number }> = [];
  const re = /[^.]+\.?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(LIPSYNC_TEXT))) out.push({ from: m.index, to: m.index + m[0].length });
  return out;
})();

const drawMouth = (ctx: CanvasRenderingContext2D, mx: number, my: number, hwBase: number, ry: number, p: Mouth) => {
  const hw = hwBase * (1 + 0.3 * p.wide - 0.42 * p.round);
  const H = ry * 0.34 * p.open;
  const lipT = ry * 0.034 * (1 + 0.3 * p.round);
  const lift = ry * 0.025 * p.wide;
  const inner = new Path2D();
  inner.moveTo(mx - hw, my - lift);
  inner.bezierCurveTo(mx - hw * 0.45, my - H * 0.45 - lift, mx + hw * 0.45, my - H * 0.45 - lift, mx + hw, my - lift);
  inner.bezierCurveTo(mx + hw * 0.55, my + H * 0.95, mx - hw * 0.55, my + H * 0.95, mx - hw, my - lift);
  inner.closePath();
  const top = my - H * 0.34 - lift;
  const bottom = my + H * 0.7;

  if (H > 0.8) {
    ctx.fillStyle = C.mouth;
    ctx.fill(inner);
    ctx.save();
    ctx.clip(inner);
    // Tongue.
    const tongueY = p.tongue === 1 ? top + (bottom - top) * 0.42 : bottom - (bottom - top) * 0.2;
    ctx.fillStyle = C.tongue;
    ctx.beginPath();
    ctx.ellipse(mx, tongueY + (bottom - top) * 0.25, hw * 0.55, (bottom - top) * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    // Upper teeth hang from the top lip; lower teeth show when the mouth is wide and open.
    ctx.fillStyle = C.teeth;
    const th = Math.min((bottom - top) * 0.42, ry * 0.075);
    ctx.fillRect(mx - hw * 0.82, top - 2, hw * 1.64, th + 2);
    if (p.open > 0.45) ctx.fillRect(mx - hw * 0.7, bottom - ry * 0.05 - 1, hw * 1.4, ry * 0.08);
    ctx.strokeStyle = "rgba(120,90,70,0.35)";
    ctx.lineWidth = Math.max(1, ry * 0.004);
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(mx + (i * hw * 0.82) / 3.2, top);
      ctx.lineTo(mx + (i * hw * 0.82) / 3.2, top + th);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Lips: a thick stroke along the opening, so they close up into one line when the mouth shuts.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = C.lip;
  ctx.lineWidth = lipT * 2;
  ctx.stroke(inner);
  // Fuller lower lip: the bottom edge again, a little thicker.
  ctx.beginPath();
  ctx.moveTo(mx + hw * 0.8, my - lift);
  ctx.bezierCurveTo(mx + hw * 0.55, my + H * 0.95, mx - hw * 0.55, my + H * 0.95, mx - hw * 0.8, my - lift);
  ctx.lineWidth = lipT * 2.7;
  ctx.stroke();
  if (H <= 0.8) {
    // Closed: the crease between the lips.
    ctx.strokeStyle = "#7a1f35";
    ctx.lineWidth = Math.max(1.5, lipT * 0.28);
    ctx.beginPath();
    ctx.moveTo(mx - hw, my - lift);
    ctx.quadraticCurveTo(mx, my + lipT * 0.15 - lift * 0.4, mx + hw, my - lift);
    ctx.stroke();
  }
  if (p.bite > 0.3) {
    // f / v: the top teeth rest on the lower lip.
    ctx.fillStyle = C.teeth;
    roundRect(ctx, mx - hw * 0.6, my - lipT * 0.4, hw * 1.2, lipT * 1.5, lipT * 0.4);
    ctx.fill();
  }
  if (p.tongue === 2 && H > 0.8) {
    // th: the tongue tip shows between the teeth.
    ctx.fillStyle = C.tongue;
    roundRect(ctx, mx - hw * 0.34, bottom - lipT * 0.4 - ry * 0.03, hw * 0.68, ry * 0.07, ry * 0.03);
    ctx.fill();
  }
};

const drawFace = (ctx: CanvasRenderingContext2D, cx: number, cy: number, ry: number, t: number, speech: number, mouth: Mouth) => {
  const rx = ry * 0.82;
  const bob = Math.sin(t * 1.7) * ry * 0.006;
  cy += bob;
  // Shoulders and neck.
  ctx.fillStyle = C.shirt;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 1.38, rx * 1.55, ry * 0.62, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = C.skinShade;
  ctx.fillRect(cx - rx * 0.28, cy + ry * 0.78, rx * 0.56, ry * 0.4);
  // Hair behind the head.
  ctx.fillStyle = C.hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.05, rx * 1.1, ry * 1.04, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ears.
  ctx.fillStyle = C.skinShade;
  [-1, 1].forEach((d) => {
    ctx.beginPath();
    ctx.ellipse(cx + d * rx * 0.98, cy + ry * 0.02, rx * 0.1, ry * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  // Head.
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Fringe.
  ctx.fillStyle = C.hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.62, rx * 1.02, ry * 0.42, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.98, cy - ry * 0.62);
  ctx.quadraticCurveTo(cx - rx * 0.2, cy - ry * 0.28, cx + rx * 0.6, cy - ry * 0.6);
  ctx.lineTo(cx + rx * 1.02, cy - ry * 0.62);
  ctx.lineTo(cx, cy - ry * 0.85);
  ctx.closePath();
  ctx.fill();
  // Cheeks.
  ctx.fillStyle = "rgba(255,120,120,0.22)";
  [-1, 1].forEach((d) => {
    ctx.beginPath();
    ctx.ellipse(cx + d * rx * 0.55, cy + ry * 0.3, rx * 0.17, ry * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  // Eyes and brows. The brows lift a little on the stressed, open sounds.
  const k = t % 3.3;
  const blink = k < 0.14 ? Math.sin((Math.PI * k) / 0.14) : 0;
  [-1, 1].forEach((d) => {
    const ex = cx + d * rx * 0.4;
    const ey = cy - ry * 0.1;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(ex, ey, rx * 0.15, ry * 0.075 * (1 - 0.92 * blink), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.iris;
    ctx.beginPath();
    ctx.ellipse(ex + Math.sin(t * 0.6) * rx * 0.02, ey, rx * 0.075, ry * 0.07 * (1 - 0.92 * blink), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.hair;
    ctx.lineWidth = Math.max(2, ry * 0.025);
    ctx.lineCap = "round";
    const by = cy - ry * (0.28 + 0.03 * mouth.open * speech);
    ctx.beginPath();
    ctx.moveTo(ex - rx * 0.17, by + ry * 0.015);
    ctx.quadraticCurveTo(ex, by - ry * 0.035, ex + rx * 0.17, by + ry * 0.015);
    ctx.stroke();
  });
  // Nose.
  ctx.strokeStyle = "#c98c68";
  ctx.lineWidth = Math.max(2, ry * 0.014);
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.05, cy + ry * 0.0);
  ctx.quadraticCurveTo(cx - rx * 0.1, cy + ry * 0.16, cx - rx * 0.13, cy + ry * 0.2);
  ctx.quadraticCurveTo(cx, cy + ry * 0.25, cx + rx * 0.13, cy + ry * 0.2);
  ctx.stroke();
  drawMouth(ctx, cx, cy + ry * 0.47, rx * 0.4, ry, mouth);
};

export const drawLipSync: PatternDef["draw"] = (ctx, w, h, s, info) => {
  const t = info.loopTime;
  const T = t - LIPSYNC_LEAD;
  const speaking = T >= 0 && T <= LIPSYNC_SECONDS;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  fitText(ctx, "LIP SYNC", w * 0.5, h * 0.085);
  ctx.fillStyle = C.yellow;
  ctx.fillText("LIP SYNC", w / 2, h * 0.095);
  const hint = speaking ? "Watch the lips and listen: do they land together?" : t < LIPSYNC_LEAD ? "Get ready…" : "Starting again…";
  fitText(ctx, hint, w * 0.8, h * 0.036, "normal");
  ctx.fillStyle = C.dim;
  ctx.fillText(hint, w / 2, h * 0.145);

  const ry = Math.min(h * 0.3, w * 0.28);
  const faceCy = h * 0.165 + ry * 1.02;
  drawFace(ctx, w / 2, faceCy, ry, t, speaking ? 1 : 0, mouthAt(T));

  // The words, with the one being spoken lit up.
  if (s.subtitles) {
    const idx = speaking ? LIPSYNC_WORDS.reduce((a, wd, i) => (wd[0] <= T ? i : a), -1) : -1;
    const cur = idx >= 0 ? LIPSYNC_WORDS[idx] : null;
    const sentence = cur ? SENTENCES.find((q) => cur[1] >= q.from && cur[1] < q.to) ?? SENTENCES[0] : SENTENCES[0];
    const text = LIPSYNC_TEXT.slice(sentence.from, sentence.to).trim();
    const offset = LIPSYNC_TEXT.indexOf(text, sentence.from);
    const px = Math.max(12, Math.round(Math.min(h * 0.042, w * 0.03)));
    ctx.font = `bold ${px}px ${FONT}`;
    const lines = wrapLines(ctx, text, w * 0.86);
    const boxH = px * 1.35 * lines.length + px * 0.8;
    const y0 = h * 0.97 - boxH;
    roundRect(ctx, w * 0.05, y0, w * 0.9, boxH, px * 0.4);
    ctx.fillStyle = "rgba(2,6,23,0.7)";
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let pos = offset;
    lines.forEach((line, li) => {
      const lw = ctx.measureText(line).width;
      let x = (w - lw) / 2;
      const y = y0 + px * 0.4 + li * px * 1.35;
      line.split(/(\s+)/).forEach((token) => {
        const start = LIPSYNC_TEXT.indexOf(token, pos);
        const isWord = token.trim().length > 0;
        const lit = isWord && cur !== null && start === cur[1];
        ctx.fillStyle = lit ? C.yellow : speaking && cur && start < cur[1] ? "#cbd5e1" : isWord ? "#7d8aa3" : C.text;
        ctx.fillText(token, x, y);
        x += ctx.measureText(token).width;
        if (start >= 0) pos = start + token.length;
      });
    });
  }
};
