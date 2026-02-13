# Whistle Studio Change Log

## 2026-02-13 (Current Working State)

### Implemented
- Built the app as a Vite + TypeScript browser tool for melody extraction and export.
- Added capture/import flows for microphone and audio files.
- Added analysis pipeline with:
  - monophonic mode
  - full mix assist mode
  - key suggestion
  - optional snap-to-key
  - rhythm quantization
- Added synth playback controls and tone options.
- Added IndexedDB project/folder/file storage and trash flow.
- Added export flows for JSON, JS module, and MIDI.
- Added Help panel improvements and copy tooling.
- Added dark mode improvements and UI consistency updates.
- Added `Debug Copy` button in Help to copy:
  - current settings
  - segment text
  - melody JSON

### Full Mix Analysis Refinements
- Added lead-focused preprocessing path for dense audio.
- Added adaptive voicing recovery for low-energy sections.
- Added gap fill behavior for fragmented full-mix extraction.
- Added full-mix contour scoring and pitch-path stabilization.
- Added octave normalization and jump suppression in full-mix output.
- Added adaptive post-pass:
  - short-note deglitching
  - jumpiness-aware smoothing
  - reduced aggressive snap behavior on short/weak segments

### Current Quality Snapshot
- For dense polyphonic tracks, quality is improved but still inconsistent.
- For cleaner vocal-centered material, output is significantly closer and often usable.
- Best recent user result was around 60%+ perceived quality for synth playback on a duo vocal hymn.

### MIDI Export Note
- MIDI export is currently reverted to the simpler baseline behavior (no forced GM program mapping).
- This was intentionally rolled back after testing showed the newer mapping sounded worse in the user's playback chain.

### Known Gaps
- Full-mix extraction can still produce phantom notes and occasional contour errors.
- Track-dependent tuning is still needed for hardest polyphonic material.
- In-app synth and external MIDI player rendering remain inherently different.

### Suggested Next Refinement Steps
1. Add confidence-weighted note acceptance for full-mix segments before quantization.
2. Add phrase-level contour constraints (anti-stall + anti-zigzag guards).
3. Add optional "light snap on high-confidence notes only" mode.
4. Add per-source heuristics for cleaner auto-detect defaults without extra UI complexity.

### Branch Context
- Active branch during this session: `codex/whistle-studio-v1`.
- Remote: `origin https://github.com/mbsl4y3r/whistle-studio.git`.
- `test-audio/` is local testing material and should not be committed.
