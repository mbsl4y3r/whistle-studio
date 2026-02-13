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

function computeRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
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

function quantizeBeats(rawBeats: number[], gridBeat: number): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const raw of rawBeats) {
    const adjusted = raw + carry;
    const q = Math.max(gridBeat, Math.round(adjusted / gridBeat) * gridBeat);
    carry = adjusted - q;
    out.push(clamp(Number(q.toFixed(6)), gridBeat, Math.max(gridBeat, raw * 4)));
  }
  return out;
}

export async function analyzeAudioBuffer(buffer: AudioBuffer, options: AnalysisOptions): Promise<AnalyzeResult> {
  const mono = downmixToMono(buffer);
  const detector = PitchDetector.forFloat32Array(FRAME_SIZE);

  const frames: FrameData[] = [];
  const frameDuration = HOP_SIZE / buffer.sampleRate;

  for (let start = 0; start + FRAME_SIZE <= mono.length; start += HOP_SIZE) {
    const frame = mono.slice(start, start + FRAME_SIZE);
    const rms = computeRms(frame);
    const [pitch, clarity] = detector.findPitch(frame, buffer.sampleRate);

    const inRange = pitch >= options.minHz && pitch <= options.maxHz;
    const voiced = rms >= options.rmsThreshold && clarity >= options.clarityThreshold && inRange;

    frames.push({
      timeSec: start / buffer.sampleRate,
      durationSec: frameDuration,
      rms,
      clarity,
      isRest: !voiced,
      midiFloat: voiced ? freqToMidiFloat(pitch) : undefined
    });
  }

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

  const detected = detectKey(cleaned);
  const key = options.keyMode === "manual" ? options.key : detected.key;
  const scale = options.keyMode === "manual" ? options.scale : detected.scale;
  const preferFlats = chooseFlatKey(key);

  let warning = "";
  const activeRatio = frames.filter((f) => !f.isRest).length / Math.max(1, frames.length);
  if (activeRatio < 0.2) {
    warning = "Large portions look like silence or breath, try lowering RMS threshold.";
  } else if (activeRatio > 0.95) {
    warning = "Very dense voiced audio, if this is polyphonic audio transcription quality may be poor.";
  }

  let previousMidi: number | null = null;
  for (const seg of cleaned) {
    if (seg.isRest || seg.midiFloat == null) {
      seg.noteName = "REST";
      continue;
    }

    let midi = Math.round(seg.midiFloat);
    if (options.snapEnabled) {
      const candidate = nearestScaleMidi(seg.midiFloat, key, scale);
      const intervalJump = previousMidi == null ? 0 : Math.abs(candidate.midi - previousMidi);
      const rawJump = previousMidi == null ? 0 : Math.abs(midi - previousMidi);
      const guardBlocks = intervalJump > 12 && rawJump <= 7;

      if (candidate.cents <= options.snapToleranceCents && !guardBlocks) {
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

  const mergedMelody = melody.reduce<typeof melody>((acc, cur) => {
    const last = acc[acc.length - 1];
    if (last && last.note === cur.note) {
      last.beats = Number((last.beats + cur.beats).toFixed(6));
    } else {
      acc.push({ ...cur });
    }
    return acc;
  }, []);

  cleaned = cleaned.filter((s) => s.beats > 0);

  return {
    melody: mergedMelody,
    segments: cleaned,
    suggestedKey: detected.key,
    suggestedScale: detected.scale,
    warning
  };
}
