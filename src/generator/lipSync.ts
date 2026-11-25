// ---------------------------------------------------------------------------
// Lip sync: a real person speaking, to check the sound and the picture line up.
// The clip is "Can I get some water in my water bottle in 26 different accents" by Sarah Valentine Actors Accent
// Coach (CC BY 3.0, via Wikimedia Commons). Its sound is decoded and played by the generator's own audio engine, in
// step with the pattern clock like every other sound here; the picture is the clip's video, held to the same clock.
// ---------------------------------------------------------------------------

import { LIPSYNC_CLIP, decodeMediaBytes, mediaUrl } from "./clips";
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
/** How long a jump takes to land, so the next jump aims that far ahead and does not arrive late. */
let seekLead = 0.25;
let seekStart = 0;
let stuckSince = 0;
let stuck = false;
/** Download progress (0-1) and any problem, shown on the picture while it loads. */
let loadFrac = 0;
let loadProblem = "";

/** Download the whole clip (with progress), then hand it to the video element and to the audio decoder. */
const download = async (v: HTMLVideoElement) => {
  try {
    const res = await fetch(mediaUrl(VIDEO.file));
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const total = Number(res.headers.get("Content-Length")) || 13775484;
    const parts: Uint8Array[] = [];
    let got = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        loadFrac = Math.min(1, got / total);
      }
    } else {
      parts.push(new Uint8Array(await res.arrayBuffer()));
    }
    const blob = new Blob(parts as BlobPart[], { type: "video/webm" });
    loadProblem = "";
    v.src = URL.createObjectURL(blob);
    v.load();
    // The sound is decoded a moment later, so it does not hold up the first picture.
    setTimeout(() => void blob.arrayBuffer().then((bytes) => decodeMediaBytes(LIPSYNC_CLIP, bytes)), 1500);
  } catch (e) {
    loadProblem = `Could not download the video (${e instanceof Error ? e.message : "network problem"}). Trying again…`;
    setTimeout(() => void download(v), 5000);
  }
};

const getVideo = (): HTMLVideoElement | null => {
  if (typeof document === "undefined") return null;
  if (!video) {
    const v = document.createElement("video");
    video = v;
    v.muted = true; // the sound comes from the audio engine, not from this element
    v.playsInline = true;
    v.preload = "auto";
    v.addEventListener("error", () => {
      loadProblem = `This browser could not play the video${v.error?.message ? ` (${v.error.message})` : ""}. Try Chrome or Edge.`;
    });
    v.addEventListener("seeked", () => {
      if (seekStart) seekLead = Math.max(0.1, Math.min(1.5, ((performance.now() - seekStart) / 1000) * 1.3));
      seekStart = 0;
    });
    // If the browser would not start it by itself, any click on the page does.
    window.addEventListener("pointerdown", () => void v.play().catch(() => undefined), true);
    void download(v);
  }
  return video;
};

const jump = (v: HTMLVideoElement, to: number) => {
  if (v.seeking) return;
  seekStart = performance.now();
  v.currentTime = Math.max(0, Math.min(LIPSYNC_SECONDS - 0.05, to));
};

/** Keep the video on the pattern clock: let it run, nudge its speed for small drift, jump (aiming ahead) for large. */
const follow = (v: HTMLVideoElement, T: number) => {
  const now = performance.now();
  if (T !== lastT) {
    lastT = T;
    lastWall = now;
  }
  const still = now - lastWall > 150; // the clock has stopped (paused)
  const inside = T >= 0 && T <= LIPSYNC_SECONDS;
  if (v.readyState < 1) return;
  if (!inside || still) {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - Math.max(0, T)) > 0.04) jump(v, Math.max(0, T));
    stuck = false;
    return;
  }
  if (v.paused && !v.seeking) void v.play().catch(() => undefined);
  const drift = v.currentTime - T; // positive: the video is ahead
  if (Math.abs(drift) > 0.5) {
    jump(v, T + seekLead);
    v.playbackRate = 1;
  } else v.playbackRate = Math.abs(drift) > 0.04 ? (drift > 0 ? 0.9 : 1.1) : 1;
  // Tell the person if the browser is refusing to play it.
  if (v.paused && !v.seeking) {
    if (!stuckSince) stuckSince = now;
    stuck = now - stuckSince > 1500;
  } else {
    stuckSince = 0;
    stuck = false;
  }
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
  if (ready && v) {
    ctx.drawImage(v, vx, vy, vw, vh);
    if (stuck) {
      ctx.fillStyle = "rgba(2,6,23,0.75)";
      ctx.fillRect(vx, vy + vh * 0.44, vw, vh * 0.12);
      ctx.fillStyle = C.yellow;
      ctx.textAlign = "center";
      fitText(ctx, "Click this window to start the video", vw * 0.9, vh * 0.035, "bold");
      ctx.fillText("Click this window to start the video", vx + vw / 2, vy + vh * 0.51);
    }
  } else {
    ctx.fillStyle = C.dim;
    ctx.textAlign = "center";
    const msg = loadProblem || `Loading the video… ${Math.round(loadFrac * 100)}%`;
    fitText(ctx, "Loading the video… 100%", vw * 0.8, vh * 0.04, "normal");
    const lines = wrapLines(ctx, msg, vw * 0.8);
    lines.forEach((l, i) => ctx.fillText(l, vx + vw / 2, vy + vh / 2 + i * vh * 0.05));
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
