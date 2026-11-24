// Built-in playlists. They only use patterns that already exist, and they are
// built for whatever screens the setup has right now (a playlist step is a
// pattern per screen id), so they work on any layout.

import { newId, type GeneratorConfig, type PatternSettings, type PlaylistStep } from "./model";

export type BuiltInPlaylist = {
  id: string;
  name: string;
  description: string;
  steps: Array<{ name: string; duration: number; pattern: string; settings?: PatternSettings }>;
};

export const BUILT_IN_PLAYLISTS: BuiltInPlaylist[] = [
  {
    id: "quick-check",
    name: "Quick screen check",
    description: "Which screen is which, colour bars, a grid for geometry, then motion.",
    steps: [
      { name: "Screen ID & resolution", duration: 6, pattern: "info" },
      { name: "SMPTE colour bars", duration: 6, pattern: "smpte" },
      { name: "Grid", duration: 6, pattern: "grid" },
      { name: "Moving bar", duration: 6, pattern: "moving-bar" },
    ],
  },
  {
    id: "colour-greyscale",
    name: "Colour & greyscale checks",
    description: "Colour bars, colour patches, greyscale steps and ramps, then white, colour fields and black.",
    steps: [
      { name: "EBU colour bars", duration: 6, pattern: "ebu" },
      { name: "Colour patches", duration: 8, pattern: "colour-checker" },
      { name: "Greyscale steps", duration: 8, pattern: "grey-steps" },
      { name: "Gradient ramps", duration: 8, pattern: "gradient" },
      { name: "White field", duration: 5, pattern: "solid" },
      { name: "Colour field cycle", duration: 10, pattern: "colour-cycle" },
      { name: "Black", duration: 5, pattern: "blank" },
    ],
  },
  {
    id: "alignment-geometry",
    name: "Alignment & geometry",
    description: "Grid, circles and safe areas, checkerboard, pixel structure and zone plate for lining up and spotting distortion.",
    steps: [
      { name: "Grid", duration: 8, pattern: "grid" },
      { name: "Circles, safe areas & aspect", duration: 8, pattern: "geometry" },
      { name: "Checkerboard", duration: 8, pattern: "checker" },
      { name: "Pixel structure", duration: 8, pattern: "pixel" },
      { name: "Zone plate", duration: 8, pattern: "zone-plate" },
    ],
  },
];

export const playlistLength = (p: BuiltInPlaylist) => p.steps.reduce((sum, s) => sum + s.duration, 0);

/**
 * The steps for `playlist` on the screens in `config`. Screens that show an
 * imported LED planner layout are left alone, so they keep their own pattern.
 */
export const buildBuiltInPlaylist = (config: GeneratorConfig, playlist: BuiltInPlaylist): PlaylistStep[] => {
  const screens = config.screens.filter((s) => !s.ledLayout);
  if (!screens.length) return [];
  return playlist.steps.map((step) => ({
    id: newId(),
    name: step.name,
    duration: step.duration,
    assignments: Object.fromEntries(screens.map((s) => [s.id, { pattern: step.pattern, settings: { ...(step.settings ?? {}) } }])),
  }));
};
