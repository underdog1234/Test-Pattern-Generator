// The Help walkthrough: steps through the main panels one at a time. Each step opens the panel if it is folded,
// scrolls it into view, dims the rest of the page and shows a short tip with Back, Next and Close.
import { useEffect, useLayoutEffect, useState } from "react";
import { SmallButton, openPanel } from "./controls";

export type TourStep = {
  id: string;
  /** Value of the data-panel attribute to highlight. */
  panel: string;
  /** Panels to open first, outermost first (a panel inside a closed one needs its parent open). */
  open: string[];
  title: string;
  tip: string;
};

export const TOUR_STEPS: TourStep[] = [
  { id: "configuration", panel: "configuration", open: [], title: "Configuration", tip: "Load an example preset or continue with a custom setup." },
  { id: "canvas", panel: "canvas", open: ["canvas"], title: "Main Canvas", tip: "Set the overall output resolution in pixels." },
  { id: "screens", panel: "screens", open: ["screens"], title: "Sub-screens", tip: "Add and position any sub-screens you need within the canvas." },
  { id: "patterns", panel: "inspector-patterns", open: ["inspector", "inspector-patterns"], title: "Test Patterns", tip: "Select a test pattern and check it in the preview." },
  { id: "playlist", panel: "playlist", open: ["playlist"], title: "Playlist", tip: "Add test patterns and arrange them in playback order." },
  { id: "output", panel: "output", open: ["output"], title: "Output Display", tip: "Open the output window and move it to the display you want to test." },
];

type Box = { x: number; y: number; w: number; h: number };

export default function Walkthrough({ onClose, onStep }: { onClose: () => void; onStep?: (step: TourStep) => void }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  // Get the panel ready, then bring it into view.
  useEffect(() => {
    onStep?.(step);
    if (step.open.length) openPanel(...step.open);
    const id = window.setTimeout(() => {
      document.querySelector(`[data-panel="${step.panel}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Follow the panel while the page scrolls or the panel changes size.
  useLayoutEffect(() => {
    let raf = 0;
    const track = () => {
      const el = document.querySelector(`[data-panel="${step.panel}"]`);
      const r = el?.getBoundingClientRect();
      setBox((old) => {
        if (!r) return old ? null : old;
        const next = { x: r.left, y: r.top, w: r.width, h: r.height };
        return old && Math.abs(old.x - next.x) < 0.5 && Math.abs(old.y - next.y) < 0.5 && Math.abs(old.w - next.w) < 0.5 && Math.abs(old.h - next.h) < 0.5 ? old : next;
      });
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [step.panel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pad = 6;
  const below = !box || box.y + box.h / 2 < window.innerHeight / 2; // the card goes on the side with more room
  return (
    <>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-xl border-2 border-yellow-300"
          style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, boxShadow: "0 0 0 9999px rgba(2,6,23,0.62)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-slate-950/60" />
      )}
      <div
        role="dialog"
        aria-label={`Walkthrough, step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}`}
        className={`fixed left-1/2 z-[70] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-yellow-300/70 bg-slate-900 p-4 text-white shadow-2xl ${below ? "bottom-4" : "top-20"}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-yellow-300">
            Step {index + 1} of {TOUR_STEPS.length}
          </span>
          <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={onClose} aria-label="Close the walkthrough">
            ✕
          </button>
        </div>
        <div className="text-base font-bold">{step.title}</div>
        <p className="mt-1 text-sm text-slate-200">{step.tip}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <SmallButton onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            ← Back
          </SmallButton>
          <SmallButton onClick={onClose}>Close</SmallButton>
          <SmallButton tone="primary" onClick={() => (last ? onClose() : setIndex((i) => i + 1))}>
            {last ? "Done" : "Next →"}
          </SmallButton>
        </div>
      </div>
    </>
  );
}
