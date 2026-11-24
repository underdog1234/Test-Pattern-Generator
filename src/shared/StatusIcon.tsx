// Small status marks shared by the sender and the receiver: a tick, a warning,
// a spinner or a cross. Always paired with words (and an accessible label on the
// row they sit in), never colour alone.

export type StatusKind = "ok" | "warn" | "wait" | "off";

const COLOUR: Record<StatusKind, string> = { ok: "text-emerald-300", warn: "text-amber-300", wait: "text-sky-300", off: "text-slate-400" };

export function StatusIcon({ kind, size = 16 }: { kind: StatusKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${COLOUR[kind]} ${kind === "wait" ? "animate-spin" : ""}`}>
      {kind === "ok" ? (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.3l2.2 2.2L11 6" />
        </>
      ) : kind === "warn" ? (
        <>
          <path d="M8 2l6.5 11.5h-13z" />
          <path d="M8 6.5v3M8 11.5v.1" />
        </>
      ) : kind === "wait" ? (
        <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
        </>
      )}
    </svg>
  );
}

/** One line of status: a mark, a short text and the full wording for screen readers and hover. */
export function StatusLine({ kind, text, label, strong }: { kind: StatusKind; text: string; label: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" role="status" aria-label={label} title={label}>
      <StatusIcon kind={kind} />
      <span className={strong ? "font-semibold" : ""}>{text}</span>
    </div>
  );
}
