// The time an animation frame should show.
//
// Reading Date.now() inside the frame callback gives a time that is rounded to
// whole milliseconds and depends on exactly when the callback happened to run,
// so on a 75 Hz display (13.33 ms) successive frames step by 12, 13 or 14 ms
// and the movement judders. The browser hands every callback the frame's own
// timestamp instead - it advances in even steps, with no rounding - so the
// animation time is derived from that and lined up with the wall clock, which
// is what keeps separate windows (and the playlist) in step with each other.

let offset = Date.now() - performance.now();
let checkedAt = 0;

/** Wall-clock milliseconds (like Date.now()) for the frame with `frameTs`, the timestamp requestAnimationFrame passes in. */
export const frameEpochMs = (frameTs: number): number => {
  // Re-sync about once a second so a changed system clock is followed, but ignore the
  // 1 ms rounding noise so it does not put the judder back.
  if (frameTs - checkedAt > 1000) {
    checkedAt = frameTs;
    const o = Date.now() - performance.now();
    if (Math.abs(o - offset) > 5) offset = o;
  }
  return offset + frameTs;
};
