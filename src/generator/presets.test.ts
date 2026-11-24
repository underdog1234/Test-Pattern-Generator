import { describe, expect, it } from "vitest";
import { LAYOUT_PRESETS, applyPlaylistStep, defaultConfig, fourScreenConfig, makeScreen, normalizeConfig, playlistStepAt } from "./model";
import { PATTERN_BY_ID } from "./patterns";
import { BUILT_IN_PLAYLISTS, buildBuiltInPlaylist } from "./presets";
import { defaultDisplay } from "./storage";

describe("new configurations", () => {
  it("start as Standard 1080p: one 1920 x 1080 screen on a 1920 x 1080 canvas", () => {
    const c = defaultConfig();
    expect(c.canvas).toMatchObject({ w: 1920, h: 1080 });
    expect(c.screens).toHaveLength(1);
    expect(c.screens[0]).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(LAYOUT_PRESETS[0].name).toBe("Standard 1080p (16:9)");
    expect(LAYOUT_PRESETS[0].build().screens).toHaveLength(1);
  });

  it("show the bouncing logo by default", () => {
    expect(defaultDisplay().logo).toBe(true);
  });

  it("keep the old four-screen layout available", () => {
    const c = fourScreenConfig();
    expect(c.canvas).toMatchObject({ w: 3840, h: 2160 });
    expect(c.screens).toHaveLength(4);
  });
});

describe("saved configurations are preserved", () => {
  it("keeps a saved layout, playlist and canvas exactly as saved", () => {
    const saved = fourScreenConfig();
    saved.name = "Hall";
    saved.canvas.w = 5000;
    saved.playlist = buildBuiltInPlaylist(saved, BUILT_IN_PLAYLISTS[0]);
    const back = normalizeConfig(JSON.parse(JSON.stringify(saved)));
    expect(back.name).toBe("Hall");
    expect(back.canvas).toMatchObject({ w: 5000, h: 2160 });
    expect(back.screens.map((s) => [s.name, s.x, s.y, s.w, s.h, s.pattern])).toEqual(saved.screens.map((s) => [s.name, s.x, s.y, s.w, s.h, s.pattern]));
    expect(back.playlist.map((p) => p.name)).toEqual(saved.playlist.map((p) => p.name));
  });

  it("an old file with no canvas still gets the old 4K canvas, not the new default", () => {
    const back = normalizeConfig({ screens: [] });
    expect(back.canvas).toMatchObject({ w: 3840, h: 2160 });
    expect(back.screens).toHaveLength(0);
  });
});

describe("built-in playlists", () => {
  it("offers quick check, colour & greyscale, and alignment & geometry", () => {
    expect(BUILT_IN_PLAYLISTS.map((p) => p.name)).toEqual(["Quick screen check", "Colour & greyscale checks", "Alignment & geometry"]);
  });

  it("only use patterns that exist", () => {
    for (const p of BUILT_IN_PLAYLISTS) for (const s of p.steps) expect(PATTERN_BY_ID.has(s.pattern)).toBe(true);
  });

  it.each(BUILT_IN_PLAYLISTS.map((p) => [p.name, p] as const))("%s plays through every step on every screen", (_n, def) => {
    const config = fourScreenConfig();
    config.screens.forEach((s) => (s.ledLayout = null));
    const steps = buildBuiltInPlaylist(config, def);
    expect(steps).toHaveLength(def.steps.length);
    let elapsed = 0;
    steps.forEach((step, i) => {
      const at = playlistStepAt(steps, elapsed + 0.5, false);
      expect(at?.index).toBe(i);
      const shown = applyPlaylistStep({ ...config, playlist: steps }, steps[at!.index]);
      shown.screens.forEach((s) => expect(s.pattern).toBe(def.steps[i].pattern));
      elapsed += step.duration;
    });
    // And it loops back to the start.
    expect(playlistStepAt(steps, elapsed + 0.5, true)?.index).toBe(0);
  });

  it("leaves screens that show an imported LED layout alone, and does nothing with no screens", () => {
    const config = defaultConfig();
    const led = makeScreen(1, { ledLayout: { projectName: "p", surfaceName: "s", panelType: "MG9", panels: [], subScreen: null } as never });
    config.screens.push(led);
    const steps = buildBuiltInPlaylist(config, BUILT_IN_PLAYLISTS[0]);
    expect(Object.keys(steps[0].assignments)).toEqual([config.screens[0].id]);
    expect(buildBuiltInPlaylist({ ...config, screens: [] }, BUILT_IN_PLAYLISTS[0])).toEqual([]);
  });
});
