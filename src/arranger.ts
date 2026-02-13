import { getScalePitchClasses, midiToNoteName, noteNameToMidi } from "./music";
import { Arrangement, ArrangementTrack, MelodyStep, RetroStyle, ScaleType } from "./types";

function clampMidi(midi: number, min: number, max: number): number {
  let out = midi;
  while (out < min) out += 12;
  while (out > max) out -= 12;
  return Math.max(min, Math.min(max, out));
}

function nearestScale(midi: number, key: string, scale: ScaleType): number {
  const pcs = getScalePitchClasses(key, scale);
  let best = midi;
  let bestDiff = Infinity;
  for (let n = midi - 5; n <= midi + 5; n += 1) {
    const pc = ((n % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    const diff = Math.abs(n - midi);
    if (diff < bestDiff) {
      best = n;
      bestDiff = diff;
    }
  }
  return best;
}

function mergeAdjacent(steps: MelodyStep[]): MelodyStep[] {
  return steps.reduce<MelodyStep[]>((acc, step) => {
    const last = acc[acc.length - 1];
    if (last && last.note === step.note && (last.velocity ?? 100) === (step.velocity ?? 100)) {
      last.beats = Number((last.beats + step.beats).toFixed(6));
    } else {
      acc.push({ ...step });
    }
    return acc;
  }, []);
}

function simplifyLead(lead: MelodyStep[], key: string, scale: ScaleType): MelodyStep[] {
  const out: MelodyStep[] = [];
  let prevMidi: number | null = null;
  for (const s of lead) {
    if (s.note === "REST") {
      out.push({ note: "REST", beats: s.beats, velocity: 0 });
      continue;
    }
    const m = noteNameToMidi(s.note);
    if (m == null) continue;
    let target = nearestScale(clampMidi(m, 57, 88), key, scale);
    if (prevMidi != null) {
      const jump = target - prevMidi;
      if (Math.abs(jump) > 8) target = prevMidi + Math.sign(jump) * 8;
    }
    prevMidi = target;
    out.push({ note: midiToNoteName(target, false), beats: s.beats, velocity: 104 });
  }
  return mergeAdjacent(out);
}

function makeBass(lead: MelodyStep[], key: string, scale: ScaleType): MelodyStep[] {
  const out: MelodyStep[] = [];
  for (const s of lead) {
    if (s.note === "REST") {
      out.push({ note: "REST", beats: s.beats, velocity: 0 });
      continue;
    }
    const m = noteNameToMidi(s.note);
    if (m == null) continue;
    const bass = nearestScale(clampMidi(m - 24, 36, 55), key, scale);
    const chunks = Math.max(1, Math.round(s.beats));
    const beat = s.beats / chunks;
    for (let i = 0; i < chunks; i += 1) {
      out.push({ note: midiToNoteName(bass, false), beats: Number(beat.toFixed(6)), velocity: 84 });
    }
  }
  return mergeAdjacent(out);
}

function triadFromMelodyNote(midi: number, key: string, scale: ScaleType): [number, number, number] {
  const root = nearestScale(midi, key, scale);
  const third = scale === "major" ? 4 : 3;
  const fifth = 7;
  return [root, nearestScale(root + third, key, scale), nearestScale(root + fifth, key, scale)];
}

function makeHarmony(lead: MelodyStep[], key: string, scale: ScaleType, style: RetroStyle): MelodyStep[] {
  const out: MelodyStep[] = [];
  for (const s of lead) {
    if (s.note === "REST") {
      out.push({ note: "REST", beats: s.beats, velocity: 0 });
      continue;
    }
    const m = noteNameToMidi(s.note);
    if (m == null) continue;
    const [r, t, f] = triadFromMelodyNote(clampMidi(m, 55, 79), key, scale);
    if (style === "nes") {
      // Arp for NES-style limitations.
      const unit = 0.25;
      let remaining = s.beats;
      let idx = 0;
      const chord = [r, t, f];
      while (remaining > 0) {
        const b = Math.min(unit, remaining);
        out.push({ note: midiToNoteName(chord[idx % 3], false), beats: Number(b.toFixed(6)), velocity: 74 });
        remaining -= b;
        idx += 1;
      }
    } else {
      // SNES-lite uses longer sustaining harmony.
      out.push({ note: midiToNoteName(t, false), beats: Number((s.beats * 0.5).toFixed(6)), velocity: 70 });
      out.push({ note: midiToNoteName(f, false), beats: Number((s.beats * 0.5).toFixed(6)), velocity: 70 });
    }
  }
  return mergeAdjacent(out);
}

function makeDrumsFromLead(lead: MelodyStep[]): MelodyStep[] {
  const out: MelodyStep[] = [];
  const unit = 0.5;
  let beatCursor = 0;
  const totalBeats = lead.reduce((a, s) => a + s.beats, 0);
  while (beatCursor < totalBeats) {
    const beatInBar = beatCursor % 4;
    if (Math.abs(beatInBar - 0) < 1e-3 || Math.abs(beatInBar - 2) < 1e-3) {
      out.push({ note: "C2", beats: unit, velocity: 94 }); // Kick 36
    } else if (Math.abs(beatInBar - 1) < 1e-3 || Math.abs(beatInBar - 3) < 1e-3) {
      out.push({ note: "D2", beats: unit, velocity: 86 }); // Snare 38
    } else {
      out.push({ note: "F#2", beats: unit, velocity: 60 }); // Hat 42
    }
    beatCursor += unit;
  }
  return mergeAdjacent(out);
}

function track(role: ArrangementTrack["role"], name: string, tonePreset: ArrangementTrack["tonePreset"], midiChannel: number, midiProgram: number | undefined, steps: MelodyStep[], pan?: number): ArrangementTrack {
  return { role, name, tonePreset, midiChannel, midiProgram, steps, pan };
}

export function buildArrangement(input: {
  melody: MelodyStep[];
  bpm: number;
  key: string;
  scale: ScaleType;
  outputStyle?: "lead_only" | "auto_arrange";
  retroStyle?: RetroStyle;
}): Arrangement {
  const retroStyle = input.retroStyle ?? "snes_lite";
  const outputStyle = input.outputStyle ?? "auto_arrange";
  const lead = simplifyLead(input.melody, input.key, input.scale);
  const tracks: ArrangementTrack[] = [
    track("lead", "Lead", retroStyle === "nes" ? "pulse_lead" : "warm_square", 0, 80, lead, -6)
  ];

  if (outputStyle === "auto_arrange") {
    const bass = makeBass(lead, input.key, input.scale);
    const harmony = makeHarmony(lead, input.key, input.scale, retroStyle);
    const drums = makeDrumsFromLead(lead);
    tracks.push(
      track("bass", "Bass", "bass_pick", 2, 38, bass, -2),
      track("harmony", "Harmony", retroStyle === "nes" ? "pulse_lead" : "snes_pad", 1, retroStyle === "nes" ? 80 : 50, harmony, 10),
      track("drums", "Drums", "noise_kit", 9, undefined, drums, 0)
    );
  }

  return {
    bpm: input.bpm,
    key: input.key,
    scale: input.scale,
    tracks
  };
}
