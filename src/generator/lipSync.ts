// ---------------------------------------------------------------------------
// Lip sync: a real person speaking, to check the sound and the picture line up.
// The clip is "Can I get some water in my water bottle in 26 different accents" by Sarah Valentine Actors Accent
// Coach (CC BY 3.0, via Wikimedia Commons). Its sound is decoded and played by the generator's own audio engine, in
// step with the pattern clock like every other sound here; the picture is the clip's video, held to the same clock.
// ---------------------------------------------------------------------------

import { LIPSYNC_CLIP, loadMediaClip, mediaUrl } from "./clips";
import type { PatternDef } from "./patterns";
import { FONT, fitText, roundRect, wrapLines } from "./textKit";

/** The picture and sound start this long after the loop does. */
export const LIPSYNC_LEAD = 0.5;
export const LIPSYNC_SECONDS = 101.72;
export const LIPSYNC_MIN_LOOP = Math.ceil(LIPSYNC_LEAD + LIPSYNC_SECONDS + 1.5);
const VIDEO = { file: "video/accents.webm", w: 720, h: 1280 };

/** Credit shown with the clip (CC BY 3.0 asks for it). */
export const LIPSYNC_CREDIT = {
  title: "Can I get some water in my water bottle in 26 different accents",
  fileUrl: "https://commons.wikimedia.org/wiki/File:Can_I_get_some_water_in_my_water_bottle_in_26_different_accents.webm",
  artist: "Sarah Valentine Actors Accent Coach",
  license: "CC BY 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by/3.0",
  line: "Sarah Valentine Actors Accent Coach, CC BY 3.0, via Wikimedia Commons.",
};

export const lipSyncBeeps: NonNullable<PatternDef["beeps"]> = (s, loopSeconds) => {
  if (loopSeconds < LIPSYNC_LEAD + LIPSYNC_SECONDS - 1e-6) return []; // the whole clip has to fit in the loop
  return [{ at: LIPSYNC_LEAD, freq: 0, duration: LIPSYNC_SECONDS, clip: LIPSYNC_CLIP, route: "LR", gain: Math.max(0.05, Math.min(1, Number(s.volume) / 100)) }];
};

// --- the picture ---------------------------------------------------------------

let video: HTMLVideoElement | null = null;
let lastT = NaN;
let lastWall = 0;

const getVideo = (): HTMLVideoElement | null => {
  if (typeof document === "undefined") return null;
  if (!video) {
    video = document.createElement("video");
    video.muted = true; // the sound comes from the audio engine, not from this element
    video.playsInline = true;
    video.preload = "auto";
    video.src = mediaUrl(VIDEO.file);
    video.load();
    void loadMediaClip(LIPSYNC_CLIP); // decode the sound now so it is ready when sound is switched on
  }
  return video;
};

/** Keep the video on the pattern clock: let it run, nudge its speed for small drift, jump for large. */
const follow = (v: HTMLVideoElement, T: number) => {
  const now = performance.now();
  if (T !== lastT) {
    lastT = T;
    lastWall = now;
  }
  const still = now - lastWall > 150; // the clock has stopped (paused)
  const inside = T >= 0 && T <= LIPSYNC_SECONDS;
  const target = Math.max(0, Math.min(LIPSYNC_SECONDS - 0.05, T));
  if (v.readyState < 1) return;
  if (!inside || still) {
    if (!v.paused) v.pause();
    if (!v.seeking && Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    return;
  }
  if (v.paused && !v.seeking) void v.play().catch(() => undefined);
  const drift = v.currentTime - T; // positive: the video is ahead
  if (Math.abs(drift) > 0.3) {
    if (!v.seeking) v.currentTime = T;
    v.playbackRate = 1;
  } else v.playbackRate = Math.abs(drift) > 0.03 ? (drift > 0 ? 0.96 : 1.04) : 1;
};

const C = { bg: "#0b1020", yellow: "#F3F4A8", dim: "#94a3b8", text: "#e2e8f0" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const drawLipSync: PatternDef["draw"] = (ctx, w, h, _s, info) => {
  const t = info.loopTime;
  const T = t - LIPSYNC_LEAD;
  const v = getVideo();
  if (v) follow(v, T);
  const playing = T >= 0 && T <= LIPSYNC_SECONDS;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // The player: 9:16, as filmed. Beside the text on a wide screen, above it on a tall one.
  const wide = w >= h;
  const margin = Math.min(w, h) * 0.04;
  const boxH = wide ? h - margin * 2 : h * 0.62;
  const boxW = boxH * (VIDEO.w / VIDEO.h);
  const vw = Math.min(boxW, w - margin * 2);
  const vh = vw * (VIDEO.h / VIDEO.w);
  const vx = wide ? margin + (w * 0.5 - margin - vw) / 2 + w * 0.02 : (w - vw) / 2;
  const vy = wide ? (h - vh) / 2 : margin;
  roundRect(ctx, vx - 4, vy - 4, vw + 8, vh + 8, Math.min(w, h) * 0.012);
  ctx.fillStyle = "#000";
  ctx.fill();
  const ready = !!v && v.readyState >= 2;
  if (ready && v) ctx.drawImage(v, vx, vy, vw, vh);
  else {
    ctx.fillStyle = C.dim;
    ctx.textAlign = "center";
    fitText(ctx, "Loading the video…", vw * 0.8, vh * 0.04, "normal");
    ctx.fillText("Loading the video…", vx + vw / 2, vy + vh / 2);
  }

  // The words beside (or under) it.
  const tx = wide ? vx + vw + w * 0.04 : margin;
  const tw = wide ? w - tx - margin : w - margin * 2;
  let y = wide ? vy + h * 0.04 : vy + vh + h * 0.06;
  ctx.textAlign = "left";
  const line = (text: string, size: number, color: string, weight: "bold" | "normal" = "bold", gap = 1.35) => {
    const px = Math.max(11, Math.round(size));
    ctx.font = `${weight} ${px}px ${FONT}`;
    wrapLines(ctx, text, tw).forEach((l) => {
      ctx.fillStyle = color;
      ctx.fillText(l, tx, y + px);
      y += px * gap;
    });
    y += px * 0.35;
  };
  const unit = Math.min(w * (wide ? 0.4 : 1), h) / 20;
  line("LIP SYNC", unit * 1.6, C.yellow);
  line(playing ? "Watch the lips and listen: do they land together?" : T < 0 ? "Get ready…" : "Starting again…", unit * 0.8, C.dim, "normal");
  line(playing ? `${clock(Math.max(0, T))} / ${clock(LIPSYNC_SECONDS)}` : `0:00 / ${clock(LIPSYNC_SECONDS)}`, unit * 0.9, C.text);
  y += unit * 0.6;
  // The credit sits right beside the player.
  line(LIPSYNC_CREDIT.title, unit * 0.62, C.text, "bold", 1.3);
  line(LIPSYNC_CREDIT.line, unit * 0.58, C.dim, "normal", 1.3);
  line("commons.wikimedia.org · creativecommons.org/licenses/by/3.0", unit * 0.5, C.dim, "normal", 1.3);
};
