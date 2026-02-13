import { Arrangement, ChiptuneArrangement, MelodyStep } from "./types";
import { noteNameToMidi, sanitizeConstName } from "./music";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function u16BE(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32BE(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function vlq(value: number): number[] {
  let buffer = value & 0x7f;
  const out: number[] = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    out.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return out;
}

export function exportMelodyJson(projectName: string, bpm: number, melody: MelodyStep[]): void {
  const payload = {
    projectName,
    bpm,
    exportedAt: new Date().toISOString(),
    melody
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${projectName}.melody.json`);
}

export function exportMelodyJs(projectName: string, melody: MelodyStep[]): void {
  const constName = sanitizeConstName(projectName);
  const body = `export const ${constName} = ${JSON.stringify(melody, null, 2)};\n\nexport default ${constName};\n`;
  const blob = new Blob([body], { type: "text/javascript" });
  downloadBlob(blob, `${projectName}.melody.js`);
}

export function exportMelodyMidi(projectName: string, melody: MelodyStep[], bpm: number): void {
  const ppq = 480;
  const tempoMicro = Math.round(60000000 / bpm);

  const track: number[] = [];
  track.push(...vlq(0), 0xff, 0x51, 0x03, (tempoMicro >> 16) & 0xff, (tempoMicro >> 8) & 0xff, tempoMicro & 0xff);
  // Program Change: GM Lead 1 (square), zero-based program value 80.
  track.push(...vlq(0), 0xc0, 80);

  let restTicks = 0;
  for (const step of melody) {
    const ticks = Math.max(1, Math.round(step.beats * ppq));
    if (step.note === "REST") {
      restTicks += ticks;
      continue;
    }

    const midi = noteNameToMidi(step.note);
    if (midi == null) continue;

    track.push(...vlq(restTicks), 0x90, midi & 0x7f, 0x64);
    track.push(...vlq(ticks), 0x80, midi & 0x7f, 0x40);
    restTicks = 0;
  }

  track.push(...vlq(restTicks), 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    ...u32BE(6),
    ...u16BE(0),
    ...u16BE(1),
    ...u16BE(ppq)
  ];

  const trackChunk = [0x4d, 0x54, 0x72, 0x6b, ...u32BE(track.length), ...track];
  const bytes = new Uint8Array([...header, ...trackChunk]);

  downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${projectName}.mid`);
}

export function exportWavBlob(projectName: string, blob: Blob, suffix = ""): void {
  downloadBlob(blob, `${projectName}${suffix}.wav`);
}

export function exportChiptuneJson(projectName: string, arrangement: ChiptuneArrangement): void {
  const payload = {
    projectName,
    exportedAt: new Date().toISOString(),
    format: "chiptune-v1",
    arrangement
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${projectName}.chiptune.json`);
}

export function exportChiptuneJs(projectName: string, arrangement: ChiptuneArrangement): void {
  const constName = `${sanitizeConstName(projectName)}_chiptune`;
  const body = `export const ${constName} = ${JSON.stringify(arrangement, null, 2)};\n\nexport default ${constName};\n`;
  const blob = new Blob([body], { type: "text/javascript" });
  downloadBlob(blob, `${projectName}.chiptune.js`);
}

function buildTrackForMelody(melody: MelodyStep[], channel: number, velocity: number): number[] {
  const track: number[] = [];
  let restTicks = 0;

  for (const step of melody) {
    const ticks = Math.max(1, Math.round(step.beats * 480));
    if (step.note === "REST") {
      restTicks += ticks;
      continue;
    }
    const midi = noteNameToMidi(step.note);
    if (midi == null) continue;
    track.push(...vlq(restTicks), 0x90 | channel, midi & 0x7f, velocity & 0x7f);
    track.push(...vlq(ticks), 0x80 | channel, midi & 0x7f, 0x40);
    restTicks = 0;
  }

  track.push(...vlq(restTicks), 0xff, 0x2f, 0x00);
  return track;
}

export function exportChiptuneMidi(projectName: string, arrangement: ChiptuneArrangement): void {
  const ppq = arrangement.ppq || 480;
  const tempoMicro = Math.round(60000000 / arrangement.bpm);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    ...u32BE(6),
    ...u16BE(1),
    ...u16BE(arrangement.channels.length + 1),
    ...u16BE(ppq)
  ];

  const tempoTrackData = [
    ...vlq(0), 0xff, 0x51, 0x03, (tempoMicro >> 16) & 0xff, (tempoMicro >> 8) & 0xff, tempoMicro & 0xff,
    ...vlq(0), 0xff, 0x2f, 0x00
  ];
  const chunks: number[] = [...header, 0x4d, 0x54, 0x72, 0x6b, ...u32BE(tempoTrackData.length), ...tempoTrackData];

  const programForChannel = [80 - 1, 82 - 1, 81 - 1];
  const velocityForChannel = [96, 78, 72];

  arrangement.channels.forEach((channelData, idx) => {
    const channel = idx % 16;
    const track: number[] = [];
    track.push(...vlq(0), 0xc0 | channel, programForChannel[Math.min(idx, programForChannel.length - 1)] & 0x7f);
    track.push(...buildTrackForMelody(channelData.melody, channel, velocityForChannel[Math.min(idx, velocityForChannel.length - 1)]));
    chunks.push(0x4d, 0x54, 0x72, 0x6b, ...u32BE(track.length), ...track);
  });

  const bytes = new Uint8Array(chunks);
  downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${projectName}.chiptune.mid`);
}

export function exportArrangementJson(projectName: string, arrangement: Arrangement): void {
  const payload = {
    projectName,
    exportedAt: new Date().toISOString(),
    format: "arrangement-v1",
    arrangement
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${projectName}.arrangement.json`);
}

export function exportArrangementJs(projectName: string, arrangement: Arrangement): void {
  const constName = `${sanitizeConstName(projectName)}_arrangement`;
  const body = `export const ${constName} = ${JSON.stringify(arrangement, null, 2)};\n\nexport default ${constName};\n`;
  const blob = new Blob([body], { type: "text/javascript" });
  downloadBlob(blob, `${projectName}.arrangement.js`);
}

function programForTrack(track: Arrangement["tracks"][number]): number | undefined {
  if (track.role === "lead") return 80; // Lead 1 (square)
  if (track.role === "harmony") return track.midiProgram ?? 50;
  if (track.role === "bass") return track.midiProgram ?? 38;
  return undefined;
}

export function exportArrangementMidi(projectName: string, arrangement: Arrangement): void {
  const ppq = 480;
  const tempoMicro = Math.round(60000000 / arrangement.bpm);
  const track: number[] = [];
  track.push(...vlq(0), 0xff, 0x51, 0x03, (tempoMicro >> 16) & 0xff, (tempoMicro >> 8) & 0xff, tempoMicro & 0xff);

  for (const tr of arrangement.tracks) {
    const ch = tr.role === "drums" ? 9 : tr.midiChannel & 0x0f;
    const program = programForTrack(tr);
    if (program != null && ch !== 9) {
      track.push(...vlq(0), 0xc0 | ch, program & 0x7f);
    }
    if (typeof tr.pan === "number" && ch !== 9) {
      const pan = Math.max(0, Math.min(127, tr.pan + 64));
      track.push(...vlq(0), 0xb0 | ch, 10, pan);
    }
  }

  const restByChannel = new Map<number, number>();
  for (const tr of arrangement.tracks) {
    const ch = tr.role === "drums" ? 9 : tr.midiChannel & 0x0f;
    let rest = 0;
    for (const step of tr.steps) {
      const ticks = Math.max(1, Math.round(step.beats * ppq));
      if (step.note === "REST") {
        rest += ticks;
        continue;
      }
      const midi = noteNameToMidi(step.note);
      if (midi == null) continue;
      const velocity = Math.max(1, Math.min(127, step.velocity ?? 96));
      track.push(...vlq(rest), 0x90 | ch, midi & 0x7f, velocity);
      track.push(...vlq(ticks), 0x80 | ch, midi & 0x7f, 0x40);
      rest = 0;
    }
    restByChannel.set(ch, (restByChannel.get(ch) ?? 0) + rest);
  }

  const trailing = [...restByChannel.values()].reduce((a, b) => Math.max(a, b), 0);
  track.push(...vlq(trailing), 0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, ...u32BE(6), ...u16BE(0), ...u16BE(1), ...u16BE(ppq)];
  const trackChunk = [0x4d, 0x54, 0x72, 0x6b, ...u32BE(track.length), ...track];
  const bytes = new Uint8Array([...header, ...trackChunk]);
  downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${projectName}.arrangement.mid`);
}
