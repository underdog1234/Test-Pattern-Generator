// The connection QR code for an AV Sync Test session: scan it with a phone to
// open the receiver. It closes by itself when its time is up, when the receiver
// connects, or straight away with the × button.

import { useEffect, useMemo, useState } from "react";
import { qrCanvas } from "./qr";

export default function QrCard({ url, until, onClose, compact = false }: { url: string; until: number | null; onClose: () => void; compact?: boolean }) {
  const src = useMemo(() => qrCanvas(url, 640).toDataURL("image/png"), [url]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const left = until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  const clock = left === null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className={`relative rounded-xl border border-slate-600 bg-slate-950 text-center text-white shadow-2xl ${compact ? "w-48 p-2" : "w-[min(80vmin,22rem)] p-4"}`} role="dialog" aria-label="Scan to connect the AV Sync Test receiver">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-500 bg-slate-800 text-base leading-none text-white hover:bg-slate-700"
        aria-label="Close the QR code"
        title="Close the QR code"
      >
        ×
      </button>
      <div className={`font-bold ${compact ? "pr-6 text-xs" : "pr-6 text-base"}`}>Scan to connect</div>
      <img src={src} alt="QR code that opens the AV Sync Test receiver on a phone" className="mx-auto mt-2 block w-full rounded bg-white" style={{ imageRendering: "pixelated" }} />
      <div className={`mt-1 text-slate-400 ${compact ? "text-[10px]" : "text-xs"}`}>{clock ? `Closes in ${clock}` : "Opens the AV Sync Test receiver"}</div>
    </div>
  );
}
