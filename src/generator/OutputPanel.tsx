// Everything that controls the output, in one place: where it goes (a window,
// fullscreen), what it shows (logo, fit, status box) and its sound.

import type { GeneratorConfig } from "./model";
import { Check, NumField, Panel, SelectField, SmallButton } from "./controls";
import { statusRows, type PairingView } from "../shared/pairing";
import { StatusLine } from "../shared/StatusIcon";
import QrCard from "./QrCard";
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
  onCloseQr: () => void;
  onShowQr: () => void;
};

const Group = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <div className={`min-w-0 space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export default function OutputPanel({ config, target, onTarget, onOpenWindow, onFullscreen, display, onDisplay, windowStatus, sound, world, worldSync, onLockWorld, onUnlockWorld, pairing, onStartPairing, onStopPairing, onCloseQr, onShowQr }: Props) {
  return (
    <Panel id="output" defaultOpen title="Output Display">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <Group label="Send to">
        <div className="w-full">
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
          <SmallButton onClick={onLockWorld} disabled={worldSync.busy} title="Make the flashes and beeps happen exactly on each second of real time, so an AV Sync Test receiver elsewhere can measure how long the picture and sound take to arrive. Takes about 10 seconds.">
            {worldSync.busy ? `Syncing clock… ${Math.round(worldSync.progress * 100)}%` : "Lock to world time"}
          </SmallButton>
        )}
        {worldSync.failed ? <span className="text-xs text-amber-300">Couldn't reach the time server.</span> : null}
        <span className="text-xs text-slate-500">For the AV Sync Test link delay.</span>
      </Group>
      <Group label="AV Sync Test" wide>
        {pairing ? (
          <>
            <SmallButton onClick={onStopPairing}>Stop AV Sync Test</SmallButton>
            {!pairing.joined && !pairing.qrOpen ? <SmallButton onClick={onShowQr}>Show QR code</SmallButton> : null}
          </>
        ) : (
          <SmallButton tone="primary" onClick={onStartPairing} title="Starts an AV Sync Test session: the connection QR code appears on the output and here straight away. Scan it with a phone to open the receiver.">
            Start AV Sync Test
          </SmallButton>
        )}
        <span className="text-xs text-slate-500">{pairing ? "Status shows top right of the output." : "Shows the QR code for the receiver automatically."}</span>
        {pairing ? (
          <div className="flex w-full flex-wrap items-start gap-3">
            {pairing.qrOpen && !pairing.joined ? <QrCard url={pairing.url} until={pairing.qrUntil} onClose={onCloseQr} compact /> : null}
            <div className="min-w-0 flex-1 space-y-1 rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-200">
              {statusRows(pairing).map((r, i) => (
                <StatusLine key={i} kind={r.kind} text={r.text} label={r.label} />
              ))}
              {pairing.receiver?.av && pairing.receiver.av.stable && Math.abs(pairing.receiver.av.medianMs) > 8 ? (
                <SmallButton
                  tone="primary"
                  onClick={() => sound.setOffsetMs(Math.max(-1000, Math.min(1000, Math.round(sound.offsetMs + pairing.receiver!.av!.medianMs))))}
                  title="The receiver measured the sound against the picture. This moves the sound by that amount (added to the current Sound delay) so they line up; measure again to check."
                >
                  Correct sound by {pairing.receiver.av.medianMs > 0 ? "+" : ""}{Math.round(pairing.receiver.av.medianMs)} ms
                </SmallButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </Group>
      <Group label="Sound" wide>
        <Check checked={sound.enabled} onChange={sound.setEnabled} title="Play the sound of the pattern (sync beeps, audio tests, lip sync voice) from this window, in step with the picture">
          🔊 Sound here
        </Check>
        <Check checked={display.beeps} onChange={(v) => onDisplay({ beeps: v })} title="Play the sound from the separate output window instead (or as well)">
          🔊 Sound in output window
        </Check>
        <label className="flex items-center gap-1 text-xs text-slate-400" title="Moves every beep later (positive) or earlier (negative) by this many milliseconds, to line the sound up with a display or processor that shows the picture late">
          Sound delay
          <NumField className="w-20" value={sound.offsetMs} min={-1000} max={1000} onCommit={sound.setOffsetMs} />
          ms
        </label>
        {sound.enabled && sound.blocked && sound.active ? <span className="text-xs text-amber-300">Click anywhere to allow sound</span> : null}
      </Group>
      </div>
    </Panel>
  );
}
