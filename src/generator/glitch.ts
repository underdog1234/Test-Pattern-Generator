import type { Glitch } from "./logoFx";

type Scratch = { a: HTMLCanvasElement; b: HTMLCanvasElement };
let scratch: Scratch | null = null;

const getScratch = (w: number, h: number): Scratch => {
  if (!scratch) scratch = { a: document.createElement("canvas"), b: document.createElement("canvas") };
  for (const c of [scratch.a, scratch.b]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  return scratch;
};

/**
 * Shakes one screen's rectangle and splits its red, green and blue channels
 * apart, in place on the output canvas. Nothing outside `rect` is touched, so
 * other screens (and the page's controls, which are not on this canvas) stay
 * steady. `ctx` must have an identity transform.
 */
export const applyGlitch = (ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, g: Glitch) => {
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  if (w < 2 || h < 2) return;
  const { a, b } = getScratch(w, h);
  const ac = a.getContext("2d")!;
  const bc = b.getContext("2d")!;
  // Grab what the screen looks like right now.
  ac.globalCompositeOperation = "copy";
  ac.drawImage(ctx.canvas, rect.x, rect.y, w, h, 0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, w, h);
  ctx.clip();
  ctx.fillStyle = "#000000";
  ctx.fillRect(rect.x, rect.y, w, h);
  ctx.globalCompositeOperation = "lighter";
  const channels: Array<[string, { x: number; y: number }]> = [
    ["#ff0000", g.red],
    ["#00ff00", g.green],
    ["#0000ff", g.blue],
  ];
  for (const [colour, off] of channels) {
    // Keep just this channel of the screen, then add it back at its own offset.
    bc.globalCompositeOperation = "copy";
    bc.drawImage(a, 0, 0);
    bc.globalCompositeOperation = "multiply";
    bc.fillStyle = colour;
    bc.fillRect(0, 0, w, h);
    ctx.drawImage(b, rect.x + g.shakeX + off.x, rect.y + g.shakeY + off.y);
  }
  ctx.restore();
};
