# Test Pattern Generator

Multi-Media Systems' browser-based test pattern generator for LED walls and screens.

**Live:** https://underdog1234.github.io/Test-Pattern-Generator/

## Starting point and playlists

- New configurations start as **Standard 1080p (16:9)**: one screen, 1920 × 1080. Other starting layouts are in **Configurations**; saved setups are never changed.
- **Output** has its own section: where the output goes (window, fullscreen), what it shows (bouncing logo, fit, status box) and sound. The bouncing logo is on by default; your toggles are remembered.
- The Playlist panel has three built-in playlists, built for the screens in the current setup: **Quick screen check**, **Colour & greyscale checks** and **Alignment & geometry** (`src/generator/presets.ts`).

## Smooth fullscreen playback

The live output draws from the browser's own frame timestamp (`src/generator/frameClock.ts`), not `Date.now()`, so movement steps evenly. While the fullscreen output is up the editor stops drawing its hidden preview and stops its 4 Hz refresh, screens are drawn straight onto the output canvas, the playlist / auto-cycle config is built once per step, and the LED pattern's static labels and outlines are drawn once into a layer.

## Receive (partner meter)

`receive.html` is a second page, linked as **Receive** in the generator's header. Run the AV Sync Flash and Beep pattern on a screen (Configurations → **AV sync check**), point a phone or laptop at it, and Receive uses its camera and microphone to measure how far the picture and the sound are apart, in milliseconds. **Pairing:** the generator's Output section has **Show QR code on output**. Scanning it opens Receive with a random session ID; the QR code disappears once the page opens, and the sender's output then shows the receiver's readings, the link delay, and whether both clocks are synced to world time. The two devices exchange only small status messages (clock accuracy, measured delays) through the free public relay ntfy.sh, on a topic named after that random ID. **Lock to world time** makes the flashes happen exactly on each second of real time, so Receive can also measure link delay; clocks are set from a network time server (`src/shared/worldClock.ts`), not trusted from the device.

Detection logic is in `src/receive/sync.ts`; the microphone runs in an AudioWorklet (`toneWorklet.ts`); the camera and mic engine is `engine.ts`.

## Bouncing Multi logo

Turn on **Bouncing logo** in the editor (live output only, never in downloads):

- Starts in a random brand colour.
- Every edge bounce runs the logo through the brand colour bands, then settles on a new random brand colour (never the same as before).
- A corner hit splits the logo into five full copies, one per brand colour, fanned out along its new direction; they spread apart and glide back into one logo in a new colour. It also launches a brand-colour firework show and a quick glitch (shake + red/green/blue split) over that screen only.

Logic lives in `src/generator/logoFx.ts`.

## Develop

```
npm ci
npm run dev
npm test
npm run build
```

Deploys to GitHub Pages from `main` via `.github/workflows/deploy-pages.yml`.
