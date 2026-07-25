# Agentic Research Vault Video

Remotion + TypeScript product introduction for the Agentic Research Vault operation center.

## Specifications

- Composition: `AgenticResearchVault`
- Duration: 90 seconds
- Canvas: 1920 x 1080
- Frame rate: 30 fps
- Copy and captions: Simplified Chinese
- Runtime assets: local only

## Commands

Use the bundled Node.js and pnpm runtime available to Codex, or a local Node.js installation:

```bash
pnpm install
pnpm lint
pnpm dev
pnpm still
pnpm render
```

The rendered MP4 is written to `out/agentic-research-vault.mp4`.

## Structure

- `src/scenes/`: nine storyboard scenes.
- `src/components/`: reusable motion, icon, layout, caption, and background components.
- `src/data/captions.ts`: timed Chinese caption data.
- `src/data/audioCues.ts`: soundtrack and sound-effect cue points.
- `public/assets/vault-core.png`: local generated scientific vault artwork.
- `public/audio/README.md`: optional soundtrack placeholder.

The composition intentionally renders without audio until local production audio is supplied.
