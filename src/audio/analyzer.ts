import { PitchDetector } from "pitchy";
import { AnalysisOptions, AnalyzeResult, ScaleType, Segment } from "../types";
import {
  chooseFlatKey,
  clamp,
  freqToMidiFloat,
  getScalePitchClasses,
  gridToBeats,
  midiToNoteName
} from "../music";

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

interface FrameData {
  timeSec: number;
  durationSec: number;
  rms: number;
  clarity: number;
  isRest: boolean;
  pitchHz?: number;
  midiFloat?: number;
}

function rotate<T>(arr: T[], shift: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += 1) out.push(arr[(i + shift) % arr.length]);
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[m - 1] + sorted[m]) / 2;
  return sorted[m];
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      sum += buffer.getChannelData(c)[i];
    }
    out[i] = sum / buffer.numberOfChannels;
  }
  return out;
}

function buildLeadFocusSignal(input: Float32Array, sampleRate: number): Float32Array {
  // Lightweight emphasis for lead/melody over bass-heavy mix content.
  const out = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * 140); // ~140 Hz high-pass.
  const alpha = rc / (rc + dt);
  let yPrev = 0;
  let xPrev = input[0] ?? 0;

  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    const hp = alpha * (yPrev + x - xPrev);
    xPrev = x;
    yPrev = hp;
    // Soft clip to suppress transients that destabilize pitch.
    out[i] = Math.tanh(hp * 2.2);
  }
  return out;
}

function computeRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function activeRatio(frames: FrameData[]): number {
  return frames.filter((f) => !f.isRest).length / Math.max(1, frames.length);
}

function applyAdaptiveVoicing(frames: FrameData[], options: AnalysisOptions): { rms: number; clarity: number; used: boolean } {
  const rmsValues = frames.map((f) => f.rms);
  const adaptiveRmsBase = options.analysisMode === "full_mix" ? percentile(rmsValues, 0.28) * 0.75 : percentile(rmsValues, 0.35) * 0.9;
  const adaptiveRms = Math.max(0.001, Math.min(options.rmsThreshold, adaptiveRmsBase));
  const maxAdaptiveClarity = options.analysisMode === "full_mix" ? 0.2 : 0.45;
  const adaptiveClarity = Math.max(0.22, Math.min(options.clarityThreshold, maxAdaptiveClarity));

  let changed = false;
  for (const frame of frames) {
    const inRange = frame.pitchHz != null && frame.pitchHz >= options.minHz && frame.pitchHz <= options.maxHz;
    const voiced = frame.rms >= adaptiveRms && frame.clarity >= adaptiveClarity && inRange;
    const nextMidi = voiced && frame.pitchHz != null ? freqToMidiFloat(frame.pitchHz) : undefined;
    if (frame.isRest !== !voiced || frame.midiFloat !== nextMidi) {
      changed = true;
      frame.isRest = !voiced;
      frame.midiFloat = nextMidi;
    }
  }

  return { rms: adaptiveRms, clarity: adaptiveClarity, used: changed };
}

function fillShortRestGaps(frames: FrameData[], maxGapFrames: number, maxJumpSemitones = 2): boolean {
  let changed = false;
  let i = 0;
  while (i < frames.length) {
    if (!frames[i].isRest) {
      i += 1;
      continue;
    }

    const start = i;
    while (i < frames.length && frames[i].isRest) i += 1;
    const end = i - 1;
    const gapLen = end - start + 1;

    const left = start - 1;
    const right = end + 1;
    if (gapLen > maxGapFrames || left < 0 || right >= frames.length) continue;
    if (frames[left].isRest || frames[right].isRest) continue;
    if (frames[left].midiFloat == null || frames[right].midiFloat == null) continue;

    const jump = Math.abs(frames[right].midiFloat - frames[left].midiFloat);
    if (jump > maxJumpSemitones) continue;

    for (let g = 0; g < gapLen; g += 1) {
      const ratio = (g + 1) / (gapLen + 1);
      frames[start + g].isRest = false;
      frames[start + g].midiFloat = frames[left].midiFloat + (frames[right].midiFloat - frames[left].midiFloat) * ratio;
      changed = true;
    }
  }
  return changed;
}

function promotePitchToLeadRange(freq: number, minHz: number, maxHz: number): number {
  if (!Number.isFinite(freq) || freq <= 0) return freq;
  const targetMin = Math.max(minHz, 180);
  let out = freq;
  while (out < targetMin && out * 2 <= maxHz * 1.25) out *= 2;
  while (out > maxHz && out / 2 >= targetMin) out /= 2;
  return out;
}

function detectKey(segments: Segment[]): { key: string; scale: ScaleType } {
  const histogram = new Array(12).fill(0) as number[];
  for (const seg of segments) {
    if (seg.isRest || seg.midi == null) continue;
    histogram[((seg.midi % 12) + 12) % 12] += seg.durationSec;
  }

  let bestScore = -Infinity;
  let bestKey = "C";
  let bestScale: ScaleType = "major";

  const keyNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

  for (let root = 0; root < 12; root += 1) {
    const majorScore = histogram.reduce((acc, v, idx) => acc + v * rotate(MAJOR_PROFILE, root)[idx], 0);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = keyNames[root];
      bestScale = "major";
    }

    const minorScore = histogram.reduce((acc, v, idx) => acc + v * rotate(MINOR_PROFILE, root)[idx], 0);
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = keyNames[root];
      bestScale = "minor";
    }
  }

  return { key: bestKey, scale: bestScale };
}

function nearestScaleMidi(midiFloat: number, key: string, scale: ScaleType): { midi: number; cents: number } {
  const pcs = getScalePitchClasses(key, scale);
  const center = Math.round(midiFloat);
  let bestMidi = center;
  let bestDiff = Infinity;

  for (let m = center - 3; m <= center + 3; m += 1) {
    const pc = ((m % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    const cents = Math.abs((midiFloat - m) * 100);
    if (cents < bestDiff) {
      bestDiff = cents;
      bestMidi = m;
    }
  }

  return { midi: bestMidi, cents: bestDiff };
}

function mergeTinySegments(segments: Segment[], minNoteMs: number): Segment[] {
  const minSec = minNoteMs / 1000;
  if (segments.length < 3) return segments;
  const out: Segment[] = [segments[0]];

  for (let i = 1; i < segments.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = segments[i];
    const next = segments[i + 1];

    const canMergeRestGap =
      !cur.isRest &&
      cur.durationSec < minSec &&
      !prev.isRest &&
      !next.isRest &&
      prev.midi != null &&
      next.midi != null &&
      prev.midi === next.midi;

    const canMergeNoteGap =
      cur.isRest && cur.durationSec < minSec && !prev.isRest && !next.isRest && prev.midi === next.midi;

    if (canMergeRestGap || canMergeNoteGap) {
      prev.durationSec += cur.durationSec + next.durationSec;
      prev.beats = 0;
      segments[i + 1] = { ...next, durationSec: 0 };
      continue;
    }

    out.push(cur);
  }

  out.push(segments[segments.length - 1]);
  return out.filter((s) => s.durationSec > 0);
}

function absorbShortSegments(segments: Segment[], minNoteMs: number): Segment[] {
  const minSec = minNoteMs / 1000;
  if (segments.length < 2) return segments;
  const out: Segment[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const cur = segments[i];
    const next = i + 1 < segments.length ? segments[i + 1] : undefined;
    const isShort = cur.durationSec < minSec;

    if (!isShort) {
      out.push({ ...cur });
      continue;
    }

    if (out.length > 0) {
      out[out.length - 1].durationSec += cur.durationSec;
      continue;
    }

    if (next) {
      next.startSec = cur.startSec;
      next.durationSec += cur.durationSec;
      continue;
    }

    out.push({ ...cur });
  }

  // Coalesce same-type neighbors after absorbing tiny fragments.
  const merged: Segment[] = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(seg);
      continue;
    }
    if (last.isRest === seg.isRest && (seg.isRest || last.midi === seg.midi)) {
      last.durationSec += seg.durationSec;
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

function quantizeBeats(rawBeats: number[], gridBeat: number): number[] {
  const out: number[] = [];
  let carry = 0;
  const minBeat = Math.max(0.0625, gridBeat / 4);
  for (const raw of rawBeats) {
    const adjusted = raw + carry;
    const snapped = Math.round(adjusted / gridBeat) * gridBeat;
    const q = snapped <= 0 ? minBeat : snapped;
    carry = adjusted - q;
    out.push(clamp(Number(q.toFixed(6)), minBeat, Math.max(minBeat, raw * 4)));
  }
  return out;
}

function tameRestsForFullMix(melody: Array<{ note: string; beats: number }>): Array<{ note: string; beats: number }> {
  const out: Array<{ note: string; beats: number }> = [];
  const maxRestBeats = 1.5;
  for (const step of melody) {
    if (step.note !== "REST") {
      out.push(step);
      continue;
    }
    let remaining = step.beats;
    while (remaining > 0) {
      const chunk = Math.min(remaining, maxRestBeats);
      out.push({ note: "REST", beats: Number(chunk.toFixed(6)) });
      remaining -= chunk;
    }
  }
  if (out.length > 0 && out[0].note === "REST") {
    out[0].beats = Math.min(out[0].beats, 1);
  }
  return out;
}

export interface SuggestedAnalysisSettings {
  bpm: number;
  grid: "quarter" | "eighth" | "sixteenth";
  triplets: boolean;
  analysisMode: "monophonic" | "full_mix";
  rmsThreshold: number;
  clarityThreshold: number;
  minHz: number;
  maxHz: number;
  minNoteMs: number;
}

export interface PredominantAnalysis {
  backend: "essentia-melodia" | "pitchy";
  hopSeconds: number;
  pitchHz: number[];
  pitchConfidence: number[];
  bpm?: number;
  bpmConfidence?: number;
  key?: string;
  scale?: "major" | "minor";
  keyStrength?: number;
}

function estimateTempoFromEnvelope(mono: Float32Array, sampleRate: number): number {
  const window = 1024;
  const hop = 512;
  const env: number[] = [];
  for (let i = 0; i + window <= mono.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + window; j += 1) sum += mono[j] * mono[j];
    env.push(Math.sqrt(sum / window));
  }
  if (env.length < 8) return 120;

  const flux: number[] = [];
  for (let i = 1; i < env.length; i += 1) flux.push(Math.max(0, env[i] - env[i - 1]));

  const frameSec = hop / sampleRate;
  let bestBpm = 120;
  let bestScore = -Infinity;
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = Math.round((60 / bpm) / frameSec);
    if (lag <= 1 || lag >= flux.length) continue;
    let score = 0;
    for (let i = lag; i < flux.length; i += 1) score += flux[i] * flux[i - lag];
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return bestBpm;
}

function estimateTripletFeel(mono: Float32Array, sampleRate: number, bpm: number): boolean {
  const window = 1024;
  const hop = 512;
  const env: number[] = [];
  for (let i = 0; i + window <= mono.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + window; j += 1) sum += mono[j] * mono[j];
    env.push(Math.sqrt(sum / window));
  }
  if (env.length < 16) return false;

  const flux: number[] = [];
  for (let i = 1; i < env.length; i += 1) flux.push(Math.max(0, env[i] - env[i - 1]));
  if (!flux.length) return false;

  const peak = percentile(flux, 0.9);
  const onsets: number[] = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] >= peak && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
      onsets.push((i * hop) / sampleRate);
    }
  }
  if (onsets.length < 8) return false;

  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const dt = onsets[i] - onsets[i - 1];
    if (dt > 0.04 && dt < 1.5) intervals.push(dt);
  }
  if (intervals.length < 6) return false;

  const beatSec = 60 / Math.max(40, bpm);
  const dupleDivisions = [1, 2, 4, 8];
  const tripletDivisions = [3, 6, 12];
  const quantError = (division: number, valueSec: number): number => {
    const unit = beatSec / division;
    const units = valueSec / unit;
    return Math.abs(units - Math.round(units));
  };

  const dupleError = median(intervals.map((v) => Math.min(...dupleDivisions.map((d) => quantError(d, v)))));
  const tripletError = median(intervals.map((v) => Math.min(...tripletDivisions.map((d) => quantError(d, v)))));

  return tripletError + 0.03 < dupleError;
}

function buildFramesFromPredominant(p: PredominantAnalysis, options: AnalysisOptions): FrameData[] {
  const frames: FrameData[] = [];
  let prevMidi: number | null = null;
  for (let i = 0; i < p.pitchHz.length; i += 1) {
    let hz = p.pitchHz[i] ?? 0;
    const conf = p.pitchConfidence[i] ?? 0;
    const inRange = hz >= options.minHz && hz <= options.maxHz;
    let voiced = hz > 0 && conf >= Math.max(0.08, options.clarityThreshold * 0.5) && inRange;
    let midiFloat: number | undefined;
    if (voiced) {
      midiFloat = freqToMidiFloat(hz);
      if (prevMidi != null) {
        while (midiFloat - prevMidi > 7) midiFloat -= 12;
        while (prevMidi - midiFloat > 7) midiFloat += 12;
      }
      prevMidi = midiFloat;
    } else {
      hz = 0;
    }
    frames.push({
      timeSec: i * p.hopSeconds,
      durationSec: p.hopSeconds,
      rms: voiced ? Math.max(0.01, conf) : 0,
      clarity: conf,
      isRest: !voiced,
      pitchHz: hz,
      midiFloat
    });
  }
  // Bridge short unvoiced gaps.
  fillShortRestGaps(frames, Math.round(0.22 / Math.max(1e-6, p.hopSeconds)), 2.5);
  return frames;
}

function goertzelPower(frame: Float32Array, sampleRate: number, freqHz: number): number {
  if (!Number.isFinite(freqHz) || freqHz <= 0 || freqHz >= sampleRate / 2) return 0;
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < frame.length; i += 1) {
    s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function estimateFullMixPitchHz(
  frame: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
  prevMidiFloat?: number
): { pitchHz?: number; confidence: number } {
  const minMidi = Math.max(36, Math.floor(freqToMidiFloat(Math.max(60, minHz))));
  const maxMidi = Math.min(108, Math.ceil(freqToMidiFloat(Math.min(maxHz, sampleRate / 2 - 40))));
  if (maxMidi <= minMidi) return { confidence: 0 };

  let bestMidi = minMidi;
  let bestScore = -Infinity;
  let secondScore = -Infinity;

  const logMin = Math.log(Math.max(80, minHz));
  const logRange = Math.max(1e-6, Math.log(Math.max(minHz + 1, maxHz)) - logMin);
  const prev = prevMidiFloat ?? (minMidi + maxMidi) * 0.5;

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const f1 = 440 * 2 ** ((midi - 69) / 12);
    const f2 = f1 * 2;
    const f3 = f1 * 3;

    const p1 = goertzelPower(frame, sampleRate, f1);
    const p2 = goertzelPower(frame, sampleRate, f2);
    const p3 = goertzelPower(frame, sampleRate, f3);
    let score = p1 + 0.55 * p2 + 0.3 * p3;

    // Prefer upper-mid range for melody in dense mixes.
    const logNorm = Math.max(0, Math.min(1, (Math.log(f1) - logMin) / logRange));
    score *= 0.8 + 0.45 * logNorm;

    // Continuity penalty, but keep enough freedom for real motion.
    const jump = Math.abs(midi - prev);
    score *= 0.55 + 0.45 * Math.exp(-jump / 8);

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestMidi = midi;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!Number.isFinite(bestScore) || bestScore <= 0) return { confidence: 0 };
  const conf = Number(Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore)));
  return { pitchHz: 440 * 2 ** ((bestMidi - 69) / 12), confidence: conf };
}

function normalizeFullMixMidi(midi: number, prevMidi: number | null, minHz: number, maxHz: number): number {
  const minMidi = Math.round(freqToMidiFloat(Math.max(80, minHz)));
  const maxMidi = Math.round(freqToMidiFloat(Math.min(2600, maxHz)));
  let best = midi;

  // Fold octaves into an expected melodic zone.
  while (best > maxMidi) best -= 12;
  while (best < minMidi) best += 12;

  if (prevMidi != null) {
    // Pick octave nearest previous pitch to avoid zippering between harmonics.
    let nearest = best;
    let bestDiff = Math.abs(best - prevMidi);
    for (let shift = -24; shift <= 24; shift += 12) {
      const candidate = best + shift;
      if (candidate < minMidi || candidate > maxMidi) continue;
      const diff = Math.abs(candidate - prevMidi);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = candidate;
      }
    }
    best = nearest;

    // Clamp extreme frame-to-frame jumps in full mix.
    const maxJump = 7;
    const jump = best - prevMidi;
    if (Math.abs(jump) > maxJump) {
      best = prevMidi + Math.sign(jump) * maxJump;
    }
  }

  return clamp(best, minMidi, maxMidi);
}

function getNonRestMidis(segments: Segment[]): number[] {
  return segments.filter((s) => !s.isRest && s.midi != null).map((s) => s.midi!);
}

function estimateJumpiness(segments: Segment[]): number {
  const notes = getNonRestMidis(segments);
  if (notes.length < 4) return 0;
  const jumps: number[] = [];
  for (let i = 1; i < notes.length; i += 1) jumps.push(Math.abs(notes[i] - notes[i - 1]));
  return percentile(jumps, 0.7);
}

function smoothFullMixPitchPath(segments: Segment[], strength: "light" | "medium"): Segment[] {
  const out = segments.map((s) => ({ ...s }));
  const noteIdx = out
    .map((s, i) => ({ s, i }))
    .filter((v) => !v.s.isRest && v.s.midi != null)
    .map((v) => v.i);
  if (noteIdx.length < 5) return out;

  const halfWindow = strength === "medium" ? 2 : 1;
  const values = noteIdx.map((idx) => out[idx].midi!);
  const smoothed: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const windowVals: number[] = [];
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(values.length - 1, i + halfWindow); j += 1) {
      windowVals.push(values[j]);
    }
    smoothed.push(Math.round(median(windowVals)));
  }

  for (let i = 0; i < noteIdx.length; i += 1) {
    const idx = noteIdx[i];
    out[idx].midi = smoothed[i];
    out[idx].noteName = midiToNoteName(smoothed[i], false);
  }
  return out;
}

function deglitchFullMix(segments: Segment[], minNoteMs: number): Segment[] {
  const out = segments.map((s) => ({ ...s }));
  const shortSec = Math.max(0.05, (minNoteMs / 1000) * 0.95);
  if (out.length < 3) return out;

  for (let i = 1; i < out.length - 1; i += 1) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (cur.isRest || cur.midi == null || prev.isRest || next.isRest || prev.midi == null || next.midi == null) continue;
    if (cur.durationSec > shortSec) continue;

    const flankSimilar = Math.abs(prev.midi - next.midi) <= 2;
    const curOutlier = Math.abs(cur.midi - prev.midi) >= 4 && Math.abs(cur.midi - next.midi) >= 4;
    if (flankSimilar && curOutlier) {
      cur.midi = Math.round((prev.midi + next.midi) / 2);
      cur.noteName = midiToNoteName(cur.midi, false);
    }
  }

  return out;
}

export async function suggestAnalysisSettings(
  buffer: AudioBuffer,
  options: AnalysisOptions,
  predominant?: PredominantAnalysis
): Promise<SuggestedAnalysisSettings> {
  const monoRaw = downmixToMono(buffer);
  const monoLead = buildLeadFocusSignal(monoRaw, buffer.sampleRate);
  const mono = options.analysisMode === "full_mix" ? monoLead : monoRaw;
  const detector = PitchDetector.forFloat32Array(FRAME_SIZE);

  const rmsValues: number[] = [];
  const clarityValues: number[] = [];
  const pitches: number[] = [];
  let broadVoicedFrames = 0;
  let prevMixMidi: number | undefined;

  for (let start = 0; start + FRAME_SIZE <= mono.length; start += HOP_SIZE) {
    const frame = mono.slice(start, start + FRAME_SIZE);
    const rms = computeRms(frame);
    const [pitchLead, clarityLead] = detector.findPitch(frame, buffer.sampleRate);
    let pitch = pitchLead;
    let clarity = clarityLead;
    if (options.analysisMode === "full_mix") {
      const fullMix = estimateFullMixPitchHz(frame, buffer.sampleRate, 120, 2400, prevMixMidi);
      if (fullMix.pitchHz != null) {
        pitch = fullMix.pitchHz;
        clarity = Math.max(clarityLead * 0.35, fullMix.confidence);
        prevMixMidi = freqToMidiFloat(fullMix.pitchHz);
      } else {
        const rawFrame = monoRaw.slice(start, start + FRAME_SIZE);
        const [pitchRaw, clarityRaw] = detector.findPitch(rawFrame, buffer.sampleRate);
        const leadCandidate = promotePitchToLeadRange(pitchLead, 140, 2400);
        const rawCandidate = promotePitchToLeadRange(pitchRaw, 140, 2400);
        const leadScore = clarityLead + Math.min(0.25, Math.max(0, (leadCandidate - 180) / 1800));
        const rawScore = clarityRaw + Math.min(0.25, Math.max(0, (rawCandidate - 180) / 1800));
        if (rawScore > leadScore) {
          pitch = rawCandidate;
          clarity = clarityRaw;
        } else {
          pitch = leadCandidate;
        }
      }
    }
    rmsValues.push(rms);
    clarityValues.push(clarity);
    if (pitch >= 60 && pitch <= 3000) pitches.push(pitch);
    if (pitch >= 80 && pitch <= 2500 && clarity > 0.25 && rms > 0.0015) broadVoicedFrames += 1;
  }

  const rmsThreshold = clamp(percentile(rmsValues, 0.32) * 0.85, 0.002, 0.04);
  const clarityThreshold = clamp(percentile(clarityValues, 0.45), 0.30, 0.75);

  let minHz = options.minHz;
  let maxHz = options.maxHz;
  if (pitches.length > 20) {
    minHz = clamp(percentile(pitches, 0.08) * 0.9, 70, 1200);
    maxHz = clamp(percentile(pitches, 0.92) * 1.1, 300, 3000);
    if (maxHz - minHz < 180) maxHz = Math.min(3000, minHz + 180);
  }

  const minNoteMs = pitches.length > 500 ? 200 : 140;
  let bpm = predominant?.bpm && Number.isFinite(predominant.bpm) ? predominant.bpm : estimateTempoFromEnvelope(mono, buffer.sampleRate);
  if (bpm < 55) bpm *= 2;
  if (bpm > 210) bpm /= 2;
  bpm = Math.max(60, Math.min(200, Math.round(bpm)));
  const pitchCoverage = broadVoicedFrames / Math.max(1, rmsValues.length);
  const analysisMode = pitchCoverage < 0.45 || clarityThreshold < 0.42 ? "full_mix" : "monophonic";
  const triplets = estimateTripletFeel(mono, buffer.sampleRate, bpm);
  const grid = triplets ? (bpm >= 140 ? "eighth" : "quarter") : bpm >= 150 ? "sixteenth" : bpm >= 95 ? "eighth" : "quarter";

  let tunedRms = rmsThreshold;
  let tunedClarity = clarityThreshold;
  let tunedMinHz = Math.round(minHz);
  let tunedMaxHz = Math.round(maxHz);
  let tunedMinNoteMs = minNoteMs;

  if (analysisMode === "full_mix") {
    // In dense mixes, prefer permissive thresholds and a wider lead range.
    tunedRms = clamp(rmsThreshold, 0.0015, 0.01);
    tunedClarity = clamp(clarityThreshold, 0.12, 0.32);
    // Bias away from bass fundamentals, try to follow lead vocal/mid content.
    tunedMinHz = Math.max(110, Math.min(420, tunedMinHz));
    tunedMaxHz = Math.max(2200, tunedMaxHz);
    if (tunedMaxHz - tunedMinHz < 800) tunedMaxHz = tunedMinHz + 800;
    tunedMinNoteMs = Math.max(70, Math.min(140, minNoteMs));
  } else {
    tunedRms = clamp(rmsThreshold, 0.003, 0.03);
    tunedClarity = clamp(clarityThreshold, 0.35, 0.72);
    tunedMinHz = Math.max(80, Math.min(220, tunedMinHz));
    tunedMaxHz = Math.max(700, tunedMaxHz);
  }

  return {
    bpm,
    grid,
    triplets,
    analysisMode,
    rmsThreshold: Number(tunedRms.toFixed(3)),
    clarityThreshold: Number(tunedClarity.toFixed(2)),
    minHz: tunedMinHz,
    maxHz: tunedMaxHz,
    minNoteMs: tunedMinNoteMs
  };
}

export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  options: AnalysisOptions,
  predominant?: PredominantAnalysis
): Promise<AnalyzeResult> {
  const monoRaw = downmixToMono(buffer);
  const monoLead = buildLeadFocusSignal(monoRaw, buffer.sampleRate);
  const mono = options.analysisMode === "full_mix" ? monoLead : monoRaw;
  const detector = PitchDetector.forFloat32Array(FRAME_SIZE);

  const frames: FrameData[] = [];
  const frameDuration = HOP_SIZE / buffer.sampleRate;
  let prevMixMidi: number | undefined;
  if (options.analysisMode === "full_mix" && predominant && predominant.pitchHz.length > 0) {
    frames.push(...buildFramesFromPredominant(predominant, options));
  } else {
    for (let start = 0; start + FRAME_SIZE <= mono.length; start += HOP_SIZE) {
      const frame = mono.slice(start, start + FRAME_SIZE);
      const rms = computeRms(frame);
      let [pitch, clarity] = detector.findPitch(frame, buffer.sampleRate);
      if (options.analysisMode === "full_mix") {
        const fullMix = estimateFullMixPitchHz(frame, buffer.sampleRate, options.minHz, options.maxHz, prevMixMidi);
        if (fullMix.pitchHz != null) {
          pitch = fullMix.pitchHz;
          clarity = Math.max(clarity * 0.35, fullMix.confidence);
          prevMixMidi = freqToMidiFloat(fullMix.pitchHz);
        } else {
          const rawFrame = monoRaw.slice(start, start + FRAME_SIZE);
          const [pitchRaw, clarityRaw] = detector.findPitch(rawFrame, buffer.sampleRate);
          const leadPitch = promotePitchToLeadRange(pitch, options.minHz, options.maxHz);
          const rawPitch = promotePitchToLeadRange(pitchRaw, options.minHz, options.maxHz);
          const leadScore = clarity + Math.min(0.25, Math.max(0, (leadPitch - 180) / 1800));
          const rawScore = clarityRaw + Math.min(0.25, Math.max(0, (rawPitch - 180) / 1800));
          if (rawScore > leadScore) {
            pitch = rawPitch;
            clarity = clarityRaw;
          } else {
            pitch = leadPitch;
          }
        }
      }

      const inRange = pitch >= options.minHz && pitch <= options.maxHz;
      const voiced =
        options.analysisMode === "full_mix"
          ? rms >= options.rmsThreshold * 0.15 && clarity >= Math.max(0.05, options.clarityThreshold * 0.25) && inRange
          : rms >= options.rmsThreshold && clarity >= options.clarityThreshold && inRange;

      frames.push({
        timeSec: start / buffer.sampleRate,
        durationSec: frameDuration,
        rms,
        clarity,
        pitchHz: pitch,
        isRest: !voiced,
        midiFloat: voiced ? freqToMidiFloat(pitch) : undefined
      });
    }
  }

  const initialVoicedRatio = activeRatio(frames);
  let usedAdaptive = false;
  let adaptiveInfo: { rms: number; clarity: number } | null = null;
  const adaptiveTrigger = options.analysisMode === "full_mix" ? 0.22 : 0.2;
  if (initialVoicedRatio < adaptiveTrigger) {
    const result = applyAdaptiveVoicing(frames, options);
    usedAdaptive = result.used;
    adaptiveInfo = { rms: result.rms, clarity: result.clarity };
  }

  const gapFrames = options.analysisMode === "full_mix" ? 120 : 2;
  const gapFillTrigger = options.analysisMode === "full_mix" ? 0.55 : 0.22;
  const gapJump = options.analysisMode === "full_mix" ? 7 : 2;
  const gapFilled = initialVoicedRatio < gapFillTrigger ? fillShortRestGaps(frames, gapFrames, gapJump) : false;

  const smoothedMidi: Array<number | undefined> = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].isRest || frames[i].midiFloat == null) {
      smoothedMidi.push(undefined);
      continue;
    }
    const windowValues: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(frames.length - 1, i + 2); j += 1) {
      const candidate = frames[j].midiFloat;
      if (!frames[j].isRest && candidate != null) windowValues.push(candidate);
    }
    smoothedMidi.push(median(windowValues));
  }

  const segments: Segment[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const midiFloat = smoothedMidi[i];
    const midi = midiFloat == null ? undefined : Math.round(midiFloat);
    const isRest = f.isRest || midi == null;

    const last = segments[segments.length - 1];
    if (!last) {
      segments.push({
        isRest,
        startSec: f.timeSec,
        durationSec: f.durationSec,
        beats: 0,
        midi,
        midiFloat,
        noteName: isRest ? "REST" : midiToNoteName(midi, false)
      });
      continue;
    }

    if (last.isRest === isRest && (isRest || last.midi === midi)) {
      last.durationSec += f.durationSec;
      if (!isRest && midiFloat != null && last.midiFloat != null) {
        last.midiFloat = (last.midiFloat + midiFloat) / 2;
      }
    } else {
      segments.push({
        isRest,
        startSec: f.timeSec,
        durationSec: f.durationSec,
        beats: 0,
        midi,
        midiFloat,
        noteName: isRest ? "REST" : midiToNoteName(midi!, false)
      });
    }
  }

  let cleaned = mergeTinySegments(segments, options.minNoteMs);
  cleaned = absorbShortSegments(cleaned, options.minNoteMs);

  if (options.analysisMode === "full_mix") {
    cleaned = deglitchFullMix(cleaned, options.minNoteMs);
    const jumpiness = estimateJumpiness(cleaned);
    const strength = jumpiness >= 6 ? "medium" : "light";
    cleaned = smoothFullMixPitchPath(cleaned, strength);
  }

  const detected = detectKey(cleaned);
  const key = options.keyMode === "manual" ? options.key : detected.key;
  const scale = options.keyMode === "manual" ? options.scale : detected.scale;
  const preferFlats = chooseFlatKey(key);

  let warning = "";
  const voicedRatio = activeRatio(frames);
  const lowVoicedCutoff = options.analysisMode === "full_mix" ? 0.1 : 0.2;
  if (voicedRatio < lowVoicedCutoff) {
    warning =
      options.analysisMode === "full_mix"
        ? "Pitch extraction is sparse in this dense mix, try raising minHz, lowering clarity, or switching grid/triplets."
        : "Large portions look like silence or breath, source may be too noisy or not monophonic.";
  } else if (voicedRatio > 0.95) {
    warning = "Very dense voiced audio, if this is polyphonic audio transcription quality may be poor.";
  } else if (usedAdaptive || gapFilled) {
    const adaptiveMsg = adaptiveInfo ? ` Adaptive thresholds used (RMS ${adaptiveInfo.rms.toFixed(3)}, clarity ${adaptiveInfo.clarity.toFixed(2)}).` : "";
    warning = `Recovered low-energy passages by filling short gaps.${adaptiveMsg}`;
  }

  let previousMidi: number | null = null;
  for (const seg of cleaned) {
    if (seg.isRest || seg.midiFloat == null) {
      seg.noteName = "REST";
      continue;
    }

    let midi = Math.round(seg.midiFloat);
    if (options.analysisMode === "full_mix") {
      midi = normalizeFullMixMidi(midi, previousMidi, options.minHz, options.maxHz);
    }
    if (options.snapEnabled) {
      const candidate = nearestScaleMidi(seg.midiFloat, key, scale);
      const intervalJump = previousMidi == null ? 0 : Math.abs(candidate.midi - previousMidi);
      const rawJump = previousMidi == null ? 0 : Math.abs(midi - previousMidi);
      const guardBlocks = intervalJump > 12 && rawJump <= 7;
      const shortOrWeak = options.analysisMode === "full_mix" && seg.durationSec < Math.max(0.12, options.minNoteMs / 1000);

      if (candidate.cents <= options.snapToleranceCents && !guardBlocks && !shortOrWeak) {
        midi = candidate.midi;
      }
    }

    seg.midi = midi;
    seg.noteName = midiToNoteName(midi, preferFlats);
    previousMidi = midi;
  }

  const secPerBeat = 60 / options.bpm;
  const rawBeats = cleaned.map((s) => s.durationSec / secPerBeat);
  const quantized = quantizeBeats(rawBeats, gridToBeats(options.grid, options.triplets));

  for (let i = 0; i < cleaned.length; i += 1) {
    cleaned[i].beats = quantized[i];
  }

  const melody = cleaned.map((s) => ({
    note: s.isRest ? "REST" : s.noteName,
    beats: s.beats
  }));

  let mergedMelody = melody.reduce<typeof melody>((acc, cur) => {
    const last = acc[acc.length - 1];
    if (last && last.note === cur.note) {
      last.beats = Number((last.beats + cur.beats).toFixed(6));
    } else {
      acc.push({ ...cur });
    }
    return acc;
  }, []);

  if (options.analysisMode === "full_mix") {
    mergedMelody = tameRestsForFullMix(mergedMelody);
  }

  cleaned = cleaned.filter((s) => s.beats > 0);

  return {
    melody: mergedMelody,
    segments: cleaned,
    suggestedKey: detected.key,
    suggestedScale: detected.scale,
    warning,
    debug: {
      backend: predominant?.backend ?? "pitchy",
      bpm: predominant?.bpm,
      bpmConfidence: predominant?.bpmConfidence,
      keyStrength: predominant?.keyStrength,
      voicedPercent: Number((voicedRatio * 100).toFixed(1)),
      restRatio: Number((1 - voicedRatio).toFixed(3)),
      midiMin: getNonRestMidis(cleaned).length ? Math.min(...getNonRestMidis(cleaned)) : undefined,
      midiMedian: getNonRestMidis(cleaned).length ? Math.round(median(getNonRestMidis(cleaned))) : undefined,
      midiMax: getNonRestMidis(cleaned).length ? Math.max(...getNonRestMidis(cleaned)) : undefined
    }
  };
}
