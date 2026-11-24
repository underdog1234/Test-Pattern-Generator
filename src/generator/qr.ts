import qrcode from "qrcode-generator";

/** A QR code for `text`, drawn black on white with the quiet margin scanners need, about `px` pixels square. */
export const qrCanvas = (text: string, px = 512): HTMLCanvasElement => {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#000000";
  for (let r = 0; r < n; r += 1) for (let col = 0; col < n; col += 1) if (qr.isDark(r, col)) g.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
};

/** The modules of the QR code as rows of booleans (for tests and non-canvas drawing). */
export const qrMatrix = (text: string): boolean[][] => {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
};
