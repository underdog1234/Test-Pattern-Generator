// Everything that controls the output, in one place: where it goes (a window,
// fullscreen), what it shows (logo, fit, status box) and its sound.

import type { GeneratorConfig } from "./model";
import { Check, NumField, Panel, SelectField, SmallButton } from "./controls";
import { overlayLines, type PairingView } from "../shared/pairing";
import type { OutputDisplay } from "./storage";
import type { useSyncSound } from "./useSyncSound";

type Props = {
  config: GeneratorConfig;
  target: string;
  onTarget: (v: string) => void;
  onOpenWindow: () => void;
  onFullscreen: () => void;
  display: OutputDisplay;
  onDisplay: (patch: Partial<OutputDisplay>) => void;
  windowStatus: { fullscreen: boolean; oneToOne: boolean } | null;
  sound: ReturnType<typeof useSyncSound>;
  /** Locked to world time, if it is (see Playback.world). */
  world: { offsetMs: number; uncertaintyMs: number } | null;
  worldSync: { busy: boolean; progress: number; failed: boolean };
  onLockWorld: () => void;
  onUnlockWorld: () => void;
  pairing: PairingView | null;
  onStartPairing: () => void;
  onStopPairing: () => void;
};

const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</span>
    {children}
  </div>
);

export default function OutputPanel({ config, target, onTarget, onOpenWindow, onFullscreen, display, onDisplay, windowStatus, sound, world, worldSync, onLockWorld, onUnlockWorld, pairing, onStartPairing, onStopPairing }: Props) {
  return (
    <Panel title="Output">
      <Group label="Send to">
        <div className="w-56">
          <SelectField value={target} onChange={onTarget}>
            <option value="__canvas">Entire canvas</option>
            {config.screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} only
              </option>
            ))}
          </SelectField>
        </div>
        <SmallButton onClick={onOpenWindow} title="Open the output in its own window, on any display">
          Open output window
        </SmallButton>
        <SmallButton onClick={onFullscreen} title="Show the output full screen on this display (Esc closes it)">
          ⛶ Fullscreen here
        </SmallButton>
        {windowStatus ? (
          windowStatus.fullscreen ? (
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">Output window is fullscreen{windowStatus.oneToOne ? " and 1:1" : ""}</span>
          ) : (
            <span className="rounded border border-amber-400/70 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200" title="Browsers only allow fullscreen from a click in that window: click the yellow banner on the output display">
              ⚠ Output window is not fullscreen - click the banner on that display
            </span>
          )
        ) : null}
      </Group>
      <Group label="On the output">
        <SmallButton active={display.logo} onClick={() => onDisplay({ logo: !display.logo })} title="A logo bouncing round inside every sub-screen, on the live output only - never in a download">
          Bouncing logo
        </SmallButton>
        <SmallButton active={display.fit} onClick={() => onDisplay({ fit: !display.fit })} title="Scale the output to fill the display instead of showing it 1:1">
          Fit to display
        </SmallButton>
        <SmallButton active={display.status} onClick={() => onDisplay({ status: !display.status })} title="The box in the corner of the output with its resolution and 1:1 check">
          Status box
        </SmallButton>
      </Group>
      <Group label="Time lock">
        {world ? (
          <>
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200" title={`This computer's clock is ${Math.round(Math.abs(world.offsetMs))} ms ${world.offsetMs > 0 ? "behind" : "ahead of"} world time, and is corrected for`}>
              Locked to world time (±{Math.round(world.uncertaintyMs)} ms)
            </span>
            <SmallButton onClick={onUnlockWorld}>Unlock</SmallButton>
          </>
        ) : (
          <SmallButton onClick={onLockWorld} disabled={worldSync.busy} title="Make the flashes and beeps happen exactly on each second of real time, so a Receive page elsewhere can measure how long the picture and sound take to arrive. Takes about 10 seconds.">
            {worldSync.busy ? `Syncing clock… ${Math.round(worldSync.progress * 100)}%` : "Lock to world time"}
          </SmallButton>
        )}
        {worldSync.failed ? <span className="text-xs text-amber-300">Couldn't reach the time server.</span> : null}
        <span className="text-xs text-slate-500">For the Receive page's link-delay reading.</span>
      </Group>
      <Group label="Pair a receiver">
        {pairing ? (
          <>
            <span className={`rounded px-2 py-0.5 text-xs ${pairing.joined ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-700/60 text-slate-200"}`}>{pairing.joined ? "Receiver connected" : "Waiting for the receiver to scan the QR code on the output…"}</span>
            <SmallButton onClick={onStopPairing}>Stop pairing</SmallButton>
          </>
        ) : (
          <SmallButton onClick={onStartPairing} title="Shows a QR code on the output. Scan it with a phone to open the Receive page; the QR code goes away once it opens, and the receiver's readings and both clocks' status appear on the output instead.">
            Show QR code on output
          </SmallButton>
        )}
        <span className="text-xs text-slate-500">Open the output window or fullscreen to see it.</span>
      </Group>
      {pairing ? (
        <div className="space-y-0.5 rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-xs">
          {(pairing.joined ? overlayLines(pairing) : [{ text: `This clock: ${pairing.senderClock ? `synced to world time ±${Math.round(pairing.senderClock.uncertaintyMs)} ms` : "syncing to world time…"}`, tone: pairing.senderClock ? ("ok" as const) : ("info" as const) }]).map((l, i) => (
            <div key={i} className={l.tone === "ok" ? "text-emerald-200" : l.tone === "warn" ? "text-amber-200" : "text-slate-300"}>{l.text}</div>
          ))}
        </div>
      ) : null}
      <Group label="Sound">
        <Check checked={sound.enabled} onChange={sound.setEnabled} title="Play the timecode and AV sync beeps from this window, in step with the flashes">
          🔊 Beeps here
        </Check>
        <Check checked={display.beeps} onChange={(v) => onDisplay({ beeps: v })} title="Play the beeps from the separate output window instead (or as well)">
          🔊 Beeps in output window
        </Check>
        <label className="flex items-center gap-1 text-xs text-slate-400" title="Moves every beep later (positive) or earlier (negative) by this many milliseconds, to line the sound up with a display or processor that shows the picture late">
          Beep delay
          <NumField className="w-20" value={sound.offsetMs} min={-1000} max={1000} onCommit={sound.setOffsetMs} />
          ms
        </label>
        {sound.enabled && sound.blocked && sound.active ? <span className="text-xs text-amber-300">Click anywhere to allow sound</span> : null}
      </Group>
    </Panel>
  );
}
