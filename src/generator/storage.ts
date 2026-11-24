// ---------------------------------------------------------------------------
// Persistence and the link to the output window.
//
// The working setup is autosaved; named setups and named resolution presets
// are kept in this browser too, and any setup can go to and from a JSON file.
// The output window gets the whole state once through localStorage (it may
// open before any message could reach it) and every change after that over a
// BroadcastChannel.
// ---------------------------------------------------------------------------

import type { PairingView } from "../shared/pairing";
import { AUTO_CYCLE_IDS } from "./patterns";
import { applyAutoCycle, applyPlaylistStep, normalizeConfig, normalizePresets, playlistStepAt, type GeneratorConfig, type ResolutionPreset } from "./model";

const AUTOSAVE_KEY = "testPatternGenerator:config:v1";
const SAVED_KEY = "testPatternGenerator:saved:v1";
const PRESETS_KEY = "testPatternGenerator:presets:v1";
const OUTPUT_KEY = "testPatternGenerator:output:v1";
/** Written by the LED Cabling Planner when it opens the generator: its open project, as a saved file would hold it. */
const PLANNER_KEY = "testPatternGenerator:plannerProject:v1";
export const OUTPUT_CHANNEL = "testPatternGenerator:output";

const read = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const loadAutosave = (): GeneratorConfig | null => {
  const raw = read(AUTOSAVE_KEY);
  return raw ? normalizeConfig(raw) : null;
};

export const saveAutosave = (config: GeneratorConfig) => write(AUTOSAVE_KEY, config);

export type PlannerHandoff = { sentAt: string; project: unknown };

/** The project the planner last opened the generator with, if any. */
export const readPlannerHandoff = (): PlannerHandoff | null => {
  const raw = read(PLANNER_KEY) as Partial<PlannerHandoff> | null;
  if (!raw || !raw.project || typeof raw.project !== "object") return null;
  return { sentAt: typeof raw.sentAt === "string" ? raw.sentAt : "", project: raw.project };
};

export type SavedConfig = { name: string; savedAt: string; config: GeneratorConfig };

export const loadSavedConfigs = (): SavedConfig[] => {
  const raw = read(SAVED_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const e = entry as Record<string, unknown>;
    if (!e || typeof e.name !== "string") return [];
    return [{ name: e.name, savedAt: typeof e.savedAt === "string" ? e.savedAt : "", config: normalizeConfig(e.config) }];
  });
};

export const storeSavedConfigs = (list: SavedConfig[]) => write(SAVED_KEY, list);

export const loadCustomPresets = (): ResolutionPreset[] => normalizePresets(read(PRESETS_KEY));
export const storeCustomPresets = (list: ResolutionPreset[]) => write(PRESETS_KEY, list);

/** The clock both windows run patterns and playlists from. Wall-clock based, so separate windows agree. */
export type Playback = {
  playing: boolean;
  /** Date.now() when `anchorTime` was current. */
  anchor: number;
  /** Pattern clock, seconds, at `anchor`. */
  anchorTime: number;
  playlist: { active: boolean; loop: boolean; startTime: number };
  /**
   * Locked to world time: while playing, the pattern clock is the real time of day (seconds since 1970, corrected by
   * `offsetMs` from a time server), so a flash that happens "on the second" really happens on the second - on every
   * device that is locked, and for the Receive page to measure link delay against.
   */
  world?: { offsetMs: number; uncertaintyMs: number } | null;
};

export const defaultPlayback = (): Playback => ({ playing: true, anchor: Date.now(), anchorTime: 0, playlist: { active: false, loop: true, startTime: 0 } });

export const playbackTime = (p: Playback, now = Date.now()): number => {
  if (!p.playing) return p.anchorTime;
  if (p.world) return (now + p.world.offsetMs) / 1000;
  return p.anchorTime + (now - p.anchor) / 1000;
};

/**
 * How the output shows itself - live only, never part of a download. Set from
 * the editor's playback bar; an output window's own keys ask the editor to
 * change it, so both always agree.
 */
export type OutputDisplay = {
  /** Bouncing logo inside every sub-screen. */
  logo: boolean;
  /** Scale the output to the display instead of 1:1. */
  fit: boolean;
  /** The resolution / 1:1 status box. */
  status: boolean;
  /** Beeps from the separate output window. */
  beeps: boolean;
  /** Milliseconds the beeps are moved by, everywhere. */
  beepOffsetMs: number;
};

export const defaultDisplay = (): OutputDisplay => ({ logo: true, fit: false, status: true, beeps: false, beepOffsetMs: 0 });

const DISPLAY_KEY = "testPatternGenerator:display:v1";

/** The output toggles the user last chose in this browser, so a choice outlives a reload. Nothing saved = the defaults. */
export const loadDisplayPrefs = (): Partial<OutputDisplay> => {
  const raw = read(DISPLAY_KEY) as Record<string, unknown> | null;
  const out: Partial<OutputDisplay> = {};
  if (raw && typeof raw === "object") {
    for (const k of ["logo", "fit", "status", "beeps"] as const) if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  }
  return out;
};

export const saveDisplayPrefs = (d: OutputDisplay) => write(DISPLAY_KEY, { logo: d.logo, fit: d.fit, status: d.status, beeps: d.beeps });

export type OutputState = { config: GeneratorConfig; playback: Playback; display: OutputDisplay; /** QR code and receiver status, while a receiver is being paired. */ pairing?: PairingView | null };

/** What an output window sends back: a change to the display settings. */
export type OutputRequest = { type: "display"; patch: Partial<OutputDisplay> } | { type: "status"; fullscreen: boolean; oneToOne: boolean };

export const publishOutputState = (state: OutputState, channel: BroadcastChannel | null) => {
  write(OUTPUT_KEY, state);
  try {
    channel?.postMessage(state);
  } catch {
    // The output window simply keeps showing the last state it had.
  }
};

export const readOutputState = (): OutputState | null => {
  const raw = read(OUTPUT_KEY) as { config?: unknown; playback?: Playback; display?: Partial<OutputDisplay>; pairing?: PairingView | null } | null;
  if (!raw || !raw.config) return null;
  return { config: normalizeConfig(raw.config), playback: raw.playback ?? defaultPlayback(), display: { ...defaultDisplay(), ...(raw.display ?? {}) }, pairing: raw.pairing ?? null };
};

export const openChannel = (): BroadcastChannel | null => {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(OUTPUT_CHANNEL);
  } catch {
    return null;
  }
};

/**
 * The config as it should be shown at `now`: the editor's own, with the
 * current playlist step laid over it, or failing that every screen's place in
 * the auto cycle.
 */
// effectiveConfig is asked for on every frame (and on every editor refresh), but
// only changes when the playlist step or auto-cycle step does - so remember the
// last result per config instead of rebuilding every screen sixty times a second.
const effectiveMemo = new WeakMap<GeneratorConfig, { key: string; result: GeneratorConfig }>();
const memoised = (config: GeneratorConfig, key: string, build: () => GeneratorConfig): GeneratorConfig => {
  const hit = effectiveMemo.get(config);
  if (hit && hit.key === key) return hit.result;
  const result = build();
  effectiveMemo.set(config, { key, result });
  return result;
};

export const effectiveConfig = (config: GeneratorConfig, playback: Playback, now = Date.now()): { config: GeneratorConfig; stepIndex: number | null; cycleStep: number | null } => {
  const time = playbackTime(playback, now);
  if (playback.playlist.active && config.playlist.length) {
    const at = playlistStepAt(config.playlist, time - playback.playlist.startTime, playback.playlist.loop);
    if (at) {
      const step = config.playlist[at.index];
      return { config: memoised(config, `p${at.index}:${step.id}`, () => applyPlaylistStep(config, step)), stepIndex: at.index, cycleStep: null };
    }
  }
  if (!config.autoCycle.enabled) return { config, stepIndex: null, cycleStep: null };
  const cycleStep = Math.floor(Math.max(0, time) / Math.max(1, config.autoCycle.seconds));
  return { config: memoised(config, `c${cycleStep}`, () => applyAutoCycle(config, AUTO_CYCLE_IDS, time)), stepIndex: null, cycleStep };
};
