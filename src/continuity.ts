import { getScalePitchClasses, keyToPitchClass, midiToNoteName, noteNameToMidi } from "./music";
import { Arrangement, ArrangementTrack, GridType, MelodyStep, ScaleType } from "./types";

export interface ContinuityOptions {
  mode: "seamless" | "natural";
  intensity: number; // 0..100
  bpm: number;
  grid: GridType;
  triplets: boolean;
  key: string;
  scale: ScaleType;
}

export interface ContinuityStats {
  restsRemoved: number;
  restsShortened: number;
  fillsInserted: number;
}

function gridBeat(grid: GridType, triplets: boolean): number {
  const base = grid === "quarter" ? 1 : grid === "eighth" ? 0.5 : 0.25;
  return triplets ? base * (2 / 3) : base;
}

function quantizeToGrid(beats: number, unit: number): number {
  const q = Math.max(unit, Math.round(beats / unit) * unit);
  return Number(q.toFixed(6));
}

function mergeAdjacent(steps: MelodyStep[]): MelodyStep[] {
  const out: MelodyStep[] = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    if (last && last.note === step.note) {
      last.beats = Number((last.beats + step.beats).toFixed(6));
      continue;
    }
    out.push({ ...step });
  }
  return out.filter((s) => s.beats > 0);
}

function intensityToBridgeMs(intensity: number): number {
  return Math.round(160 + (Math.max(0, Math.min(100, intensity)) / 100) * 160);
}

function intensityToMaxLeadRestBeats(intensity: number): number {
  return Number((0.75 + (Math.max(0, Math.min(100, intensity)) / 100) * 0.75).toFixed(2));
}

function chooseContinuationPitch(prev: MelodyStep, next: MelodyStep): string {
  const pm = noteNameToMidi(prev.note);
  const nm = noteNameToMidi(next.note);
  if (pm == null || nm == null) return prev.note;
  if (Math.abs(pm - nm) <= 2) {
    return next.beats > prev.beats ? next.note : prev.note;
  }
  return prev.note;
}

export function applyContinuityToMelody(
  melody: MelodyStep[],
  bpm: number,
  grid: GridType,
  opts: { mode: "seamless" | "natural"; intensity: number; triplets: boolean; stats?: ContinuityStats }
): MelodyStep[] {
  if (opts.mode === "natural") return melody.map((m) => ({ ...m }));
  const stats = opts.stats;
  const unit = gridBeat(grid, opts.triplets);
  const maxBridgeMs = intensityToBridgeMs(opts.intensity);
  const maxLeadRestBeats = intensityToMaxLeadRestBeats(opts.intensity);
  const secPerBeat = 60 / Math.max(30, bpm);

  const out: MelodyStep[] = melody.map((m) => ({ ...m }));
  for (let i = 0; i < out.length; i += 1) {
    const cur = out[i];
    if (cur.note !== "REST") continue;
    const curMs = cur.beats * secPerBeat * 1000;
    const prev = i > 0 ? out[i - 1] : undefined;
    const next = i + 1 < out.length ? out[i + 1] : undefined;

    if (prev && next && prev.note !== "REST" && next.note !== "REST" && curMs <= maxBridgeMs) {
      const contPitch = chooseContinuationPitch(prev, next);
      if (prev.note === next.note) {
        prev.beats = quantizeToGrid(prev.beats + cur.beats + next.beats, unit);
        out.splice(i, 2);
      } else {
        prev.note = contPitch;
        prev.beats = quantizeToGrid(prev.beats + cur.beats, unit);
        out.splice(i, 1);
      }
      stats && (stats.restsRemoved += 1);
      i = Math.max(-1, i - 2);
      continue;
    }

    if (!prev || !next) {
      const clamped = Math.min(cur.beats, 0.5);
      if (clamped < cur.beats) {
        cur.beats = quantizeToGrid(clamped, unit);
        stats && (stats.restsShortened += 1);
      }
    }
  }

  const clamped = mergeAdjacent(out).flatMap((step, idx, arr) => {
    if (step.note !== "REST" || step.beats <= maxLeadRestBeats) return [step];
    const keep = quantizeToGrid(maxLeadRestBeats, unit);
    const leftover = quantizeToGrid(step.beats - keep, unit);
    const prev = idx > 0 ? arr[idx - 1] : undefined;
    if (!prev || prev.note === "REST") {
      return [{ ...step, beats: keep }];
    }
    stats && (stats.restsShortened += 1);
    stats && (stats.fillsInserted += 1);
    return [{ ...step, beats: keep }, { note: prev.note, beats: leftover, velocity: 56 }];
  });

  return mergeAdjacent(clamped).map((s) => ({ ...s, beats: quantizeToGrid(s.beats, unit) }));
}

function fillTrackRests(
  track: ArrangementTrack,
  opts: ContinuityOptions,
  makeFill: (beats: number) => MelodyStep[]
): { steps: MelodyStep[]; fills: number } {
  if (opts.mode === "natural") return { steps: track.steps.map((s) => ({ ...s })), fills: 0 };
  const unit = gridBeat(opts.grid, opts.triplets);
  const out: MelodyStep[] = [];
  let fills = 0;
  for (const step of track.steps) {
    if (step.note !== "REST") {
      out.push({ ...step, beats: quantizeToGrid(step.beats, unit) });
      continue;
    }
    const filled = makeFill(step.beats).map((s) => ({ ...s, beats: quantizeToGrid(s.beats, unit) }));
    out.push(...filled);
    fills += 1;
  }
  return { steps: mergeAdjacent(out), fills };
}

function harmonyFill(beats: number, key: string, scale: ScaleType, density: 0.5 | 0.25): MelodyStep[] {
  const pcs = getScalePitchClasses(key, scale);
  const rootPc = pcs[0] ?? keyToPitchClass(key);
  const triad = [rootPc, (rootPc + 7) % 12, (rootPc + (scale === "major" ? 4 : 3)) % 12, (rootPc + 7) % 12];
  const out: MelodyStep[] = [];
  let remain = beats;
  let idx = 0;
  while (remain > 0) {
    const b = Math.min(density, remain);
    const midi = 72 + triad[idx % triad.length];
    out.push({ note: midiToNoteName(midi, false), beats: b, velocity: 62 });
    remain = Number((remain - b).toFixed(6));
    idx += 1;
  }
  return out;
}

function bassFill(beats: number, key: string, scale: ScaleType): MelodyStep[] {
  const pcs = getScalePitchClasses(key, scale);
  const rootPc = pcs[0] ?? keyToPitchClass(key);
  const rootMidi = 36 + rootPc;
  return [{ note: midiToNoteName(rootMidi, false), beats, velocity: 72 }];
}

function drumFill(beats: number, density: 0.5 | 0.25): MelodyStep[] {
  const out: MelodyStep[] = [];
  let remain = beats;
  let cursor = 0;
  while (remain > 0) {
    const b = Math.min(density, remain);
    const pos = cursor % 4;
    const note = pos === 0 || pos === 2 ? "C2" : pos === 1 || pos === 3 ? "D2" : "F#2";
    out.push({ note, beats: b, velocity: note === "F#2" ? 54 : 86 });
    remain = Number((remain - b).toFixed(6));
    cursor += b;
  }
  return out;
}

export function applyContinuityToArrangement(arr: Arrangement, opts: ContinuityOptions): Arrangement {
  return applyContinuityToArrangementWithStats(arr, opts).arrangement;
}

export function applyContinuityToArrangementWithStats(
  arr: Arrangement,
  opts: ContinuityOptions
): { arrangement: Arrangement; stats: ContinuityStats } {
  const stats: ContinuityStats = { restsRemoved: 0, restsShortened: 0, fillsInserted: 0 };
  if (opts.mode === "natural") return { arrangement: { ...arr, tracks: arr.tracks.map((t) => ({ ...t, steps: t.steps.map((s) => ({ ...s })) })) }, stats };

  const density: 0.5 | 0.25 = opts.intensity >= 70 ? 0.25 : 0.5;
  const nextTracks: ArrangementTrack[] = [];
  for (const track of arr.tracks) {
    if (track.role === "lead") {
      nextTracks.push({
        ...track,
        steps: applyContinuityToMelody(track.steps, arr.bpm, opts.grid, {
          mode: opts.mode,
          intensity: opts.intensity,
          triplets: opts.triplets,
          stats
        })
      });
      continue;
    }
    if (track.role === "harmony") {
      const f = fillTrackRests(track, opts, (beats) => harmonyFill(beats, arr.key, arr.scale, density));
      stats.fillsInserted += f.fills;
      nextTracks.push({ ...track, steps: f.steps });
      continue;
    }
    if (track.role === "bass") {
      const f = fillTrackRests(track, opts, (beats) => bassFill(beats, arr.key, arr.scale));
      stats.fillsInserted += f.fills;
      nextTracks.push({ ...track, steps: f.steps });
      continue;
    }
    if (track.role === "drums") {
      const f = fillTrackRests(track, opts, (beats) => drumFill(beats, density));
      stats.fillsInserted += f.fills;
      nextTracks.push({ ...track, steps: f.steps });
      continue;
    }
    nextTracks.push({ ...track, steps: track.steps.map((s) => ({ ...s })) });
  }

  return { arrangement: { ...arr, tracks: nextTracks }, stats };
}
