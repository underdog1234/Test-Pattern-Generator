// Small text helpers shared by the patterns that explain themselves on screen.

export const FONT = "Arial, Helvetica, sans-serif";

/** Set the largest bold font (up to maxPx) in which `text` fits `maxW`. Returns the size. */
export const fitText = (ctx: CanvasRenderingContext2D, text: string, maxW: number, maxPx: number, weight = "bold"): number => {
  let px = Math.max(6, Math.floor(maxPx));
  ctx.font = `${weight} ${px}px ${FONT}`;
  const width = ctx.measureText(text).width;
  if (width > maxW && width > 0) {
    px = Math.max(6, Math.floor((px * maxW) / width));
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  return px;
};

/** Break `text` into lines no wider than `maxW` with the context's current font. */
export const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
  const lines: string[] = [];
  let line = "";
  text.split(/\s+/).forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
};

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smoothstep = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
