# Whistle Studio

Whistle Studio is a browser-based melody capture tool for Mogojik workflows. It records or imports monophonic audio, detects pitch, converts it to a Mogojik-compatible melody array, and exports JSON, JS, and MIDI.

## Quick start

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

LAN dev server:

```bash
npm run dev:lan
```

## Secure context and microphone

Browser microphone access requires a secure context.

- Local: `http://localhost` works for desktop development.
- iPhone Safari: use the GitHub Pages HTTPS deployment URL.

## GitHub Pages setup

1. Push this repo to GitHub.
2. In GitHub repo settings, open **Pages**.
3. Under **Build and deployment**, set source to **GitHub Actions**.
4. Push to `main` to trigger `.github/workflows/deploy-pages.yml`.

Expected Pages URL pattern:

`https://<your-user>.github.io/whistle-studio/`

For this repository:

`https://mbsl4y3r.github.io/whistle-studio/`

## How to use

1. Create or select a project in the left panel.
2. Record audio or upload an audio file.
3. Click **Analyze** to generate note segments and melody.
4. Adjust settings in the right panel:
   - BPM, grid, optional triplets
   - RMS and clarity thresholds for rest detection
   - key mode (auto/manual), key and scale
   - snap to key and cents tolerance
5. Preview generated JSON in the bottom panel.
6. Use **Export All** to download:
   - `<project>.melody.json`
   - `<project>.melody.js`
   - `<project>.mid`

## Virtual filesystem and persistence

All app data uses IndexedDB:

- `folders` store for folder hierarchy with soft delete.
- `projects` store for melody settings, melody, segments, raw audio blob, and metadata.
- Trash supports restore and permanent delete via **Empty Trash**.

## Output format

Melody output matches Mogojik playback shape:

```ts
Array<{ note: "C4" | "D#5" | "Bb3" | "REST"; beats: number }>
```

## Known limitations

- Monophonic sources are recommended.
- Chords or full-song mixes are likely to transcribe poorly.
- Tempo is not auto-detected in v1, BPM is user controlled.
- Some browsers may limit recording MIME types, fallback WAV capture is included.
