import { MelodyStep } from "./types";
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
