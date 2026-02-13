const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function freqToMidiFloat(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToNoteName(midi: number, preferFlats = false): string {
  const idx = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const note = preferFlats ? NOTE_NAMES_FLAT[idx] : NOTE_NAMES_SHARP[idx];
  return `${note}${octave}`;
}

export function noteNameToMidi(note: string): number | null {
  const m = note.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const [, letter, accidental, octStr] = m;
  const octave = Number(octStr);
  const base = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
  }[letter as "C"];
  let pc = base;
  if (accidental === "#") pc += 1;
  if (accidental === "b") pc -= 1;
  pc = (pc + 12) % 12;
  return (octave + 1) * 12 + pc;
}

export function keyToPitchClass(key: string): number {
  const idxSharp = NOTE_NAMES_SHARP.indexOf(key);
  if (idxSharp >= 0) return idxSharp;
  const idxFlat = NOTE_NAMES_FLAT.indexOf(key);
  return idxFlat >= 0 ? idxFlat : 0;
}

export function getScalePitchClasses(key: string, scale: "major" | "minor"): number[] {
  const root = keyToPitchClass(key);
  const intervals = scale === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  return intervals.map((n) => (n + root) % 12);
}

export function gridToBeats(grid: "quarter" | "eighth" | "sixteenth", triplets: boolean): number {
  const base = grid === "quarter" ? 1 : grid === "eighth" ? 0.5 : 0.25;
  return triplets ? base * (2 / 3) : base;
}

export function sanitizeConstName(input: string): string {
  const noExt = input.replace(/\.[^.]+$/, "");
  const cleaned = noExt.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
  const start = cleaned.match(/^[A-Za-z_]/) ? cleaned : `melody_${cleaned}`;
  return start || "melody_data";
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function chooseFlatKey(key: string): boolean {
  return ["F", "Bb", "Eb", "Ab", "Db", "Gb"].includes(key);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
