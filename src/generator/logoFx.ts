// ---------------------------------------------------------------------------
// The bouncing Multi logo (live output only - never in a download).
//
// * The wordmark is drawn as vector paths (the approved primary logo), so it
//   stays sharp at any output resolution and can be filled with any colour.
// * It starts in a random brand colour. Each time it bounces off an edge it
//   runs briefly through the brand colour bands (the stacked purple / blue /
//   deep red / yellow / red look from the brand reference), then settles on a
//   NEW random brand colour - never the one it had before the bounce.
// * Hitting a corner instead splits the logo into five full copies, one per
//   brand colour, fanned out along the direction it is now travelling. They
//   keep moving along the bounce path, spread apart, then glide back together
//   into a single logo in a new random brand colour. It changes the colour
//   once, sets off a brand-colour firework show, and fires one quick glitch
//   (shake + RGB split) over that whole screen - see `glitchAt` / glitch.ts.
//
// Position is a pure function of wall-clock time (as before), so the logo
// keeps moving while the pattern is paused. Everything else (colour, effects)
// is small per-screen state advanced by `LogoFx.update`.
// ---------------------------------------------------------------------------

/** Brand palette in the order the reference stacks it, top to bottom. */
export const BRAND_COLOURS = ["#CEC9FF", "#5298FE", "#60153B", "#F3F4A8", "#FF6354"] as const;

const LOGO_VIEW_W = 826.35;
const LOGO_VIEW_H = 231.62;
/** Width / height of the primary logo. */
export const LOGO_ASPECT = LOGO_VIEW_W / LOGO_VIEW_H;

// "MULTI" - Multi_Logo_*.svg (primary logo), all five letters as one path.
export const LOGO_PATH_D =
  "M749.92 .53h76.12v224.66h-76.12z" +
  "M570.5 59.47L614.65 59.47L614.65 225.19L688.75 225.19L688.75 59.47L732.9 59.47L732.9 .53L570.5 .53Z" +
  "M533.13 .53L458.35 .53L458.35 225.19L596.46 225.19L596.46 166.24L533.13 166.24Z" +
  "M118.38 86.75L59.78 .53L.5 .53L.5 225.19L72.24 225.19L72.24 144.35L118.38 211.71L164.19 144.35L164.19 225.19L235.94 225.19L235.94 .53L176.66 .53Z" +
  "M368.2,145.17c0,11.69-9.48,21.17-21.17,21.17s-21.17-9.48-21.17-21.17V.53h-72.01v142.9c0,14.83,2.14,27.75,6.41,38.75,4.5,11.01,10.79,20.11,18.87,27.3,8.08,7.19,17.86,12.58,29.32,16.18,11.46,3.6,24.26,5.39,38.42,5.39s26.96-1.79,38.42-5.39c11.46-3.6,21.24-8.99,29.32-16.18,8.31-7.19,14.6-16.29,18.87-27.3,4.5-11.01,6.74-23.93,6.74-38.75V.53h-72.02v144.65Z";

// --- motion ---------------------------------------------------------------------

/** One axis of the DVD-screensaver ping-pong: position plus how many walls it has hit. */
export const bounceAxis = (u: number, range: number): { pos: number; count: number } => {
  if (range <= 0) return { pos: 0, count: 0 };
  const period = range * 2;
  const m = ((u % period) + period) % period;
  return { pos: m <= range ? m : period - m, count: Math.max(0, Math.floor(u / range)) };
};

/** A random brand colour index that is never `prev`. */
export const nextColour = (prev: number, rand: () => number = Math.random): number => {
  const n = BRAND_COLOURS.length;
  return (prev + 1 + Math.floor(rand() * (n - 1))) % n;
};

// --- fireworks ------------------------------------------------------------------

type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; colour: number; drag: number; gravity: number; tail: number };
type Rocket = { launchAt: number; dur: number; x0: number; y0: number; x1: number; y1: number; kind: BurstKind; colour: number };
type BurstKind = "peony" | "ring" | "willow" | "double";

const MAX_SPARKS = 1600;
const ease = (p: number) => 1 - (1 - p) * (1 - p);
const pickColour = (rand: () => number) => {
  // Deep red is the hardest to see on a dark pattern, so it appears less often.
  const bag = [0, 0, 1, 1, 2, 3, 3, 4, 4];
  return bag[Math.floor(rand() * bag.length)];
};

export type Glitch = {
  amount: number;
  shakeX: number;
  shakeY: number;
  red: { x: number; y: number };
  green: { x: number; y: number };
  blue: { x: number; y: number };
};

/** Cheap deterministic noise in [0, 1). */
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// --- per-screen state -----------------------------------------------------------

const BOUNCE_SECONDS = 1.0;
const CORNER_SECONDS = 1.6;
const GLITCH_SECONDS = 0.6;
/** Gap between neighbouring copies at full spread, as a fraction of the logo width. */
const SPLIT_STEP = 0.2;
const smooth = (x: number) => x * x * (3 - 2 * x);
/** If the page stalls longer than this between frames, resync instead of replaying events. */
const MAX_STEP = 0.5;

export class LogoFx {
  /** Settled colour (index into BRAND_COLOURS). */
  colour: number;
  // Position / size from the latest update, in the area's own pixels.
  x = 0;
  y = 0;
  w = 0;
  h = 0;

  private from = 0;
  private tStart = -Infinity;
  private tDur = BOUNCE_SECONDS;
  private spread = 1;
  /** True for a corner hit (split copies); false for an edge hit (colour bands). */
  private split = false;
  /** Unit vector of the logo's travel direction just after the latest bounce. */
  private dirX = 1;
  private dirY = 0;
  private glitchStart = -Infinity;
  private last: { t: number; cx: number; cy: number } | null = null;
  private areaW = 0;
  private areaH = 0;

  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private shock: { t: number; x: number; y: number; colour: number } | null = null;
  private cornerAt = -Infinity;
  private lastFx = 0;

  /** Counters the tests (and curious people) can read. */
  bounces = 0;
  corners = 0;

  constructor(private rand: () => number = Math.random) {
    this.colour = Math.floor(rand() * BRAND_COLOURS.length);
    this.from = this.colour;
  }

  /**
   * Advance to wall-clock time `t` (seconds) for an area of areaW x areaH
   * pixels. `seed` offsets the path so several screens don't move in lockstep.
   */
  update(t: number, areaW: number, areaH: number, seed: number) {
    const lw = Math.max(32, Math.round(Math.min(areaW * 0.24, areaH * 0.6)));
    const lh = lw / LOGO_ASPECT;
    this.w = lw;
    this.h = lh;
    this.areaW = areaW;
    this.areaH = areaH;
    const rx = Math.max(0, areaW - lw);
    const ry = Math.max(0, areaH - lh);
    const ax = bounceAxis((t + seed * 3.7) * Math.max(20, rx / 9), rx);
    const ay = bounceAxis((t + seed * 2.3) * Math.max(20, ry / 7), ry);
    this.x = ax.pos;
    this.y = ay.pos;
    // Which way each axis is travelling now (+1 while the position is rising).
    const fwd = (u: number, range: number) => (range > 0 && (((u % (range * 2)) + range * 2) % (range * 2)) < range ? 1 : -1);
    const vx = fwd((t + seed * 3.7) * Math.max(20, rx / 9), rx) * Math.max(20, rx / 9);
    const vy = fwd((t + seed * 2.3) * Math.max(20, ry / 7), ry) * Math.max(20, ry / 7);

    const prev = this.last;
    this.last = { t, cx: ax.count, cy: ay.count };
    if (!prev || t < prev.t || t - prev.t > MAX_STEP) {
      // First frame, or time jumped (hidden tab, clock change): no replayed bounces.
      this.sparks.length = 0;
      this.rockets.length = 0;
      this.lastFx = t;
      return;
    }
    const hitX = ax.count > prev.cx;
    const hitY = ay.count > prev.cy;
    if (hitX || hitY) {
      const tol = Math.max(lw, lh) * 0.1;
      const near = (v: number, range: number) => Math.min(v, range - v) <= tol;
      const corner = (hitX && hitY) || (hitX && near(ay.pos, ry)) || (hitY && near(ax.pos, rx));
      this.bounces += 1;
      // The split fans out along the direction the logo leaves in.
      const len = Math.hypot(vx, vy) || 1;
      this.dirX = vx / len;
      this.dirY = vy / len;
      if (corner) this.onCorner(t);
      else this.recolour(t, false);
    }
    this.stepFireworks(t);
  }

  private recolour(t: number, big: boolean) {
    this.from = this.colour;
    this.colour = nextColour(this.colour, this.rand);
    this.tStart = t;
    this.spread = big ? 1.35 : 1;
    this.split = big;
    this.tDur = big ? CORNER_SECONDS : BOUNCE_SECONDS;
  }

  private onCorner(t: number) {
    this.corners += 1;
    this.recolour(t, true);
    this.cornerAt = t;
    this.glitchStart = t;
    const left = this.x + this.w / 2 < this.areaW / 2;
    const top = this.y + this.h / 2 < this.areaH / 2;
    const cx = left ? 0 : this.areaW;
    const cy = top ? 0 : this.areaH;
    this.shock = { t, x: cx, y: cy, colour: this.colour };
    this.burst(cx, cy, "peony", 1.4);
    this.burst(cx, cy, "ring", 1.2);
    // Then a volley of rockets from the bottom edge, one after another.
    const { areaW: W, areaH: H } = this;
    const volley = 9;
    for (let i = 0; i < volley; i++) {
      const kinds: BurstKind[] = ["peony", "ring", "willow", "double"];
      const x = W * (0.08 + 0.84 * this.rand());
      this.rockets.push({
        launchAt: t + 0.2 + i * 0.26 + this.rand() * 0.1,
        dur: 0.5 + this.rand() * 0.25,
        x0: x + (this.rand() - 0.5) * W * 0.05,
        y0: H,
        x1: x,
        y1: H * (0.15 + 0.4 * this.rand()),
        kind: kinds[Math.floor(this.rand() * kinds.length)],
        colour: pickColour(this.rand),
      });
    }
  }

  private burst(x: number, y: number, kind: BurstKind, power = 1) {
    const S = Math.min(this.areaW, this.areaH);
    const c1 = pickColour(this.rand);
    const c2 = (c1 + 1 + Math.floor(this.rand() * 4)) % BRAND_COLOURS.length;
    const add = (n: number, speed: number, spread: number, life: number, size: number, drag: number, gravity: number, tail: number, colour: (i: number) => number, ring = false) => {
      for (let i = 0; i < n; i++) {
        const a = ring ? (i / n) * Math.PI * 2 : this.rand() * Math.PI * 2;
        const v = ring ? speed : speed * (1 - spread + spread * Math.sqrt(this.rand()));
        this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: life * (0.75 + this.rand() * 0.5), size, colour: colour(i), drag, gravity, tail });
      }
    };
    const px = Math.max(1.5, S * 0.006) * power;
    switch (kind) {
      case "peony":
        add(Math.round(90 * power), S * 0.5 * power, 0.7, 1.5, px, 1.6, S * 0.14, 0.05, (i) => (i % 3 === 0 ? c2 : c1));
        break;
      case "ring":
        add(56, S * 0.42 * power, 0, 1.4, px, 1.5, S * 0.1, 0.05, (i) => (i % 2 ? c1 : c2), true);
        add(28, S * 0.22 * power, 0, 1.2, px * 0.8, 1.5, S * 0.1, 0.05, () => c2, true);
        break;
      case "willow":
        add(70, S * 0.34 * power, 0.6, 2.8, px * 0.8, 1.9, S * 0.26, 0.11, () => c1);
        break;
      case "double":
        add(60, S * 0.46 * power, 0.25, 1.5, px, 1.6, S * 0.13, 0.05, () => c1);
        add(40, S * 0.24 * power, 0.25, 1.3, px * 0.9, 1.6, S * 0.13, 0.05, () => c2);
        // A little glitter in every brand colour.
        add(36, S * 0.5 * power, 0.9, 1.1, px * 0.6, 1.4, S * 0.15, 0.03, (i) => i % BRAND_COLOURS.length);
        break;
    }
    if (this.sparks.length > MAX_SPARKS) this.sparks.splice(0, this.sparks.length - MAX_SPARKS);
  }

  private stepFireworks(t: number) {
    const dt = Math.min(0.05, Math.max(0, t - this.lastFx));
    this.lastFx = t;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (t - r.launchAt >= r.dur) {
        this.rockets.splice(i, 1);
        this.burst(r.x1, r.y1, r.kind);
      }
    }
    for (const s of this.sparks) {
      s.age += dt;
      const k = Math.exp(-s.drag * dt);
      s.vx *= k;
      s.vy = s.vy * k + s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    if (this.shock && t - this.shock.t > 0.9) this.shock = null;
  }

  /** True while any firework is still on screen. */
  get celebrating() {
    return this.sparks.length > 0 || this.rockets.length > 0 || this.shock !== null;
  }

  /**
   * The one-off glitch for a corner hit, or null when none is running.
   * `amount` runs 1 -> 0; shake and the red/green/blue offsets are in pixels
   * (jittering a few times a second, easing back to zero so it snaps into line).
   */
  glitchAt(t: number): Glitch | null {
    const p = (t - this.glitchStart) / GLITCH_SECONDS;
    if (p < 0 || p >= 1) return null;
    const amount = (1 - p) * (1 - p);
    const S = Math.min(this.areaW, this.areaH);
    const step = Math.floor(t * 30);
    const r = (k: number) => hash01(step * 7 + k) * 2 - 1;
    const split = S * 0.03 * amount;
    const shake = S * 0.014 * amount;
    return {
      amount,
      shakeX: r(1) * shake,
      shakeY: r(2) * shake * 0.6,
      red: { x: -split * (0.6 + 0.4 * r(3)), y: split * 0.2 * r(4) },
      green: { x: split * 0.15 * r(5), y: split * 0.15 * r(6) },
      blue: { x: split * (0.6 + 0.4 * r(7)), y: split * 0.2 * r(8) },
    };
  }

  /** Edge hit: the logo as a strip of colour bands scrolling from the old colour to the new one. */
  private bandsAt(t: number): { solid: string } | { strip: number[]; offset: number } {
    const p = (t - this.tStart) / this.tDur;
    if (p >= 1) return { solid: BRAND_COLOURS[this.colour] };
    const n = BRAND_COLOURS.length;
    const strip: number[] = [];
    for (let i = 0; i < n; i++) strip.push(this.from);
    for (let i = 0; i < n; i++) strip.push(i);
    for (let i = 0; i < n; i++) strip.push(this.colour);
    // Ease in and out so the stacked brand bands are on screen for a beat.
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return { strip, offset: e * (strip.length - n) };
  }

  /** Copies of the logo for time t: offsets along the travel direction, back to front. */
  private copiesAt(t: number): { colour: number; dx: number; dy: number }[] {
    const p = (t - this.tStart) / this.tDur;
    if (p >= 1) return [{ colour: this.colour, dx: 0, dy: 0 }];
    const n = BRAND_COLOURS.length;
    const env = smooth(Math.sin(Math.PI * Math.max(0, p)));
    const gap = this.w * SPLIT_STEP * this.spread * env;
    const copies = BRAND_COLOURS.map((_, k) => ({ colour: k, dx: this.dirX * (k - (n - 1) / 2) * gap, dy: this.dirY * (k - (n - 1) / 2) * gap }));
    // The colour shown on top starts as the old one and ends as the new one,
    // so the logo is the right colour at both ends of the split.
    const top = p < 0.5 ? this.from : this.colour;
    return copies.sort((a, b) => Number(a.colour === top) - Number(b.colour === top));
  }

  /** Draws logo + fireworks inside `area` (already positioned by the caller's translate/clip). */
  draw(ctx: CanvasRenderingContext2D, path: Path2D, t: number) {
    ctx.save();
    // Corner pulse: the logo swells briefly when it lands in a corner.
    const pulse = t - this.cornerAt;
    const grow = pulse >= 0 && pulse < 0.5 ? 1 + 0.14 * Math.sin((pulse / 0.5) * Math.PI) : 1;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(grow, grow);
    ctx.translate(-this.w / 2, -this.h / 2);
    ctx.scale(this.w / LOGO_VIEW_W, this.h / LOGO_VIEW_H);
    const bands = this.split ? null : this.bandsAt(t);
    if (bands && "strip" in bands) {
      ctx.clip(path);
      const n = BRAND_COLOURS.length;
      const bh = LOGO_VIEW_H / n;
      const first = Math.max(0, Math.floor(bands.offset));
      for (let i = first; i < Math.min(bands.strip.length, first + n + 2); i++) {
        ctx.fillStyle = BRAND_COLOURS[bands.strip[i]];
        ctx.fillRect(-2, (i - bands.offset) * bh - 0.5, LOGO_VIEW_W + 4, bh + 1);
      }
    } else if (bands) {
      ctx.fillStyle = bands.solid;
      ctx.fill(path);
    } else {
      for (const c of this.copiesAt(t)) {
        ctx.save();
        ctx.translate(c.dx * (LOGO_VIEW_W / this.w), c.dy * (LOGO_VIEW_W / this.w));
        ctx.fillStyle = BRAND_COLOURS[c.colour];
        ctx.fill(path);
        ctx.restore();
      }
    }
    ctx.restore();
    if (this.celebrating) this.drawFireworks(ctx, t);
  }

  private drawFireworks(ctx: CanvasRenderingContext2D, t: number) {
    const S = Math.min(this.areaW, this.areaH);
    ctx.save();
    ctx.lineCap = "round";
    const since = t - this.cornerAt;
    if (since >= 0 && since < 0.3) {
      ctx.globalAlpha = 0.35 * (1 - since / 0.3);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, this.areaW, this.areaH);
    }
    if (this.shock) {
      const p = (t - this.shock.t) / 0.9;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = BRAND_COLOURS[this.shock.colour];
      ctx.lineWidth = Math.max(2, S * 0.014 * (1 - p));
      ctx.beginPath();
      ctx.arc(this.shock.x, this.shock.y, S * 0.9 * ease(p), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const r of this.rockets) {
      const p = (t - r.launchAt) / r.dur;
      if (p < 0) continue;
      const e = ease(Math.min(1, p));
      const e0 = ease(Math.max(0, p - 0.12));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = BRAND_COLOURS[r.colour];
      ctx.lineWidth = Math.max(2, S * 0.007);
      ctx.beginPath();
      ctx.moveTo(r.x0 + (r.x1 - r.x0) * e0, r.y0 + (r.y1 - r.y0) * e0);
      ctx.lineTo(r.x0 + (r.x1 - r.x0) * e, r.y0 + (r.y1 - r.y0) * e);
      ctx.stroke();
    }
    for (const s of this.sparks) {
      const life = 1 - s.age / s.life;
      ctx.globalAlpha = Math.max(0, Math.min(1, life * 1.4));
      ctx.strokeStyle = BRAND_COLOURS[s.colour];
      ctx.lineWidth = Math.max(1, s.size * (0.4 + 0.6 * life));
      ctx.beginPath();
      ctx.moveTo(s.x - s.vx * s.tail, s.y - s.vy * s.tail);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
