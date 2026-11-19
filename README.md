# Test Pattern Generator

Multi-Media Systems' browser-based test pattern generator for LED walls and screens.

**Live:** https://underdog1234.github.io/Test-Pattern-Generator/

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
