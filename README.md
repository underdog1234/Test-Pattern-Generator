# Test Pattern Generator

Multi-Media Systems' browser-based test pattern generator for LED walls and screens.

**Live:** https://underdog1234.github.io/Test-Pattern-Generator/

## Starting point and playlists

- New configurations start as **Standard 1080p (16:9)**: one screen, 1920 × 1080. Other starting layouts are in **Configurations**; saved setups are never changed.
- **Output** has its own section: where the output goes (window, fullscreen), what it shows (bouncing logo, fit, status box) and sound. The bouncing logo is on by default; your toggles are remembered.
- The Playlist panel has three built-in playlists, built for the screens in the current setup: **Quick screen check**, **Colour & greyscale checks** and **Alignment & geometry** (`src/generator/presets.ts`).

## Smooth fullscreen playback

The live output draws from the browser's own frame timestamp (`src/generator/frameClock.ts`), not `Date.now()`, so movement steps evenly. While the fullscreen output is up the editor stops drawing its hidden preview and stops its 4 Hz refresh, screens are drawn straight onto the output canvas, the playlist / auto-cycle config is built once per step, and the LED pattern's static labels and outlines are drawn once into a layer.

## AV Sync Test (sender and receiver)

`receive.html` is the AV Sync Test receiver, linked as **AV Sync Test** in the generator's header. On the sender, choose Configurations → **AV Sync Test**, tick **Sound here**, open the output, then press **Start AV Sync Test** in the Output section. The connection QR code appears at once on the output and in the admin panel; it closes after two minutes, when the receiver connects, or with its × button. Scan it with a phone: the receiver opens with a random session ID and uses its camera and microphone to measure how far the picture and the sound are apart, in milliseconds.

The receiver is laid out for a phone: connection status as short ticked lines, the reading in large type, and the camera preview as a small thumbnail (Bigger / Smaller to aim it). It keeps the screen awake while the camera is on (where the browser supports the Wake Lock API), and syncs its clock to world time on connection and again whenever the link comes back. The sender shows the receiver's status at the top right of the output, outside the test content (when the output is scaled to fit, it gets a strip of its own; at 1:1 it sits in the corner).

The two devices exchange only small status messages (clock accuracy, measured delays) through the free public relay ntfy.sh, on a topic named after that random ID. **Lock to world time** makes the flashes happen exactly on each second of real time, so the receiver can also measure link delay; clocks are set from a network time server (`src/shared/worldClock.ts`), not trusted from the device.

Detection logic is in `src/receive/sync.ts`; the microphone runs in an AudioWorklet (`toneWorklet.ts`); the camera and mic engine is `engine.ts`.

## Audio tests and lip sync

Both are in the **Audio** group of the pattern list, and each has a start layout in Configurations. Turn on **Sound here** (or **Sound in output window**) in the Output section; browsers only start sound after a click. Both need a long enough loop: the editor shows a warning with a one-click fix if the loop is too short.

- **Audio Tests** (54 s for the full list): a voice and on-screen label announce each test while it plays: left speaker only, right only, both, a left-to-right stereo sweep (a pulsing tone that pans smoothly across), in phase and out of phase (pink noise; the out-of-phase noise is an exact mirror, so it cancels if the speakers are summed to mono), a music test (music with a deep kick and bass line), then a frequency sweep from 20 Hz to 20 kHz with the frequency shown. It checks stereo channels, polarity and low end; it is not a surround (5.1) test. In the admin panel (Screen settings) every test has a tick box and a button: untick a test to skip it and hide it from the output (untick all and the output says so and the loop stops); click a test to restart the loop on it and hold it there until you click another or press **Restart loop**. The Audio tests layout sets the loop to one run through every test, and the loop follows the ticked tests as you change them.
- **Lip Sync** (about 21 s): an illustrated face (not a real person) says a passage while its lips follow the voice, with the words shown below. The mouth shapes come from the same text-to-speech run that made the audio (`src/generator/lipsyncData.ts`), and the passage includes p, b, m and f, v sounds where the lips visibly close or touch the teeth.

All sound is made by the app (synthesised noise, sweep and music) or is text-to-speech generated for this project (`public/audio`), so there are no third-party samples to license. The speech was made with the Microsoft David and Zira system voices; swap the WAV files in `public/audio` (and regenerate `lipsyncData.ts`) if you prefer another voice. Audio tests and lip sync are live-only: exports carry only plain sync beeps, because a video soundtrack here is mono.

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
