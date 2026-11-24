import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

describe("qr", () => {
  it("makes a square code with the three finder squares in the corners", () => {
    const m = qrMatrix("https://underdog1234.github.io/Test-Pattern-Generator/receive.html?s=abcdefghijklmn");
    expect(m.length).toBeGreaterThanOrEqual(29);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    const n = m.length;
    // A finder pattern: a dark 7x7 ring, light inside it, dark 3x3 centre - top-left, top-right, bottom-left.
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[r0][c0]).toBe(true);
      expect(m[r0 + 1][c0 + 1]).toBe(false);
      expect(m[r0 + 3][c0 + 3]).toBe(true);
    }
    expect(m[n - 1][n - 1] || m[n - 2][n - 2] || m[n - 3][n - 3]).toBeDefined();
  });
});
