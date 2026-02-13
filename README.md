# Whistle Studio

Whistle Studio converts recorded or uploaded audio into retro game music assets.

- Input: mic recording or uploaded audio (`audio/*`)
- Analysis: monophonic mode plus full-mix predominant melody extraction (Essentia Melodia backend, lazy loaded)
- Output: melody + SNES-lite/NES arrangement for game use

## Quick Start

```bash
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

LAN dev server:

```bash
npm run dev:lan
```

## Mic and HTTPS

- `localhost` works for local desktop mic use.
- iPhone Safari mic requires HTTPS, use GitHub Pages deployment.

GitHub Pages URL pattern:

`https://<user>.github.io/whistle-studio/`

For this repo:

`https://mbsl4y3r.github.io/whistle-studio/`

## Workflow

1. Create/select a project.
2. Record or upload audio.
3. Click `Analyze`.
4. Tune settings or use `Auto Detect Settings`.
5. Choose `Output`:
   - `Auto Arrange` (default)
   - `Lead only`
6. Choose `Style`:
   - `SNES-lite` (default)
   - `NES`
7. Export with `Export All` or `Export WAV`.

## Exports

`Export All` writes:

- `<name>.melody.json`
- `<name>.melody.js`
- `<name>.mid` (now includes Program Change, default square lead)
- `<name>.arrangement.json`
- `<name>.arrangement.js`
- `<name>.arrangement.mid`
- `<name>.arrangement.wav`

`Export WAV` writes:

- `<name>.arrangement.wav`

## MIDI Notes

- Melody MIDI now emits Program Change at tick 0.
- Program used for lead is GM Lead 1 (Square), value `80` in MIDI byte form.
- Arrangement MIDI uses role-based channels (`lead`, `harmony`, `bass`, `drums` on ch 10 / index 9).

## Local Test Audio

Use `test-audio/` for local files. It is gitignored and will not be committed.

## Persistence

All data is in IndexedDB:

- folders
- projects
- files
- trash/restore/empty-trash workflow

## Notes

- Best recognizability is from clear lead lines.
- Dense polyphonic material can still produce imperfect melodies.
- Essentia.js is used for full-mix predominant melody extraction and is loaded on first analysis.
