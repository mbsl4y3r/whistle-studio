import { Arrangement, ArrangementTrack, MelodyStep } from "../types";
import { noteNameToMidi, midiToFreq } from "../music";

interface PlayOptions {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  vibratoHz?: number;
  vibratoCents?: number;
  formantHz?: number;
  formantQ?: number;
  highpassHz?: number;
  oscType?: OscillatorType;
  secondHarmonic?: number;
  noiseAmount?: number;
  lookAheadSec?: number;
}

export class WhistleSynth {
  private context: AudioContext;
  private master: GainNode;
  private timer: number | null = null;
  private cursorTime = 0;
  private index = 0;
  private sequence: MelodyStep[] = [];
  private bpm = 120;
  private activeNodes: AudioNode[] = [];

  constructor() {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio is not supported.");
    this.context = new Ctx();
    this.master = this.context.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.context.destination);
  }

  async unlock(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  setVolume(value: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  getVolume(): number {
    return this.master.gain.value;
  }

  stop(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    for (const node of this.activeNodes) {
      if ("stop" in node && typeof node.stop === "function") {
        try {
          node.stop();
        } catch {
          // ignored
        }
      }
      try {
        node.disconnect();
      } catch {
        // ignored
      }
    }
    this.activeNodes = [];
  }

  playMelody(melody: MelodyStep[], bpm: number, options: PlayOptions = {}): void {
    this.stop();
    this.sequence = melody;
    this.index = 0;
    this.bpm = bpm;
    this.cursorTime = this.context.currentTime + 0.05;

    const lookAheadSec = options.lookAheadSec ?? 3;
    const scheduler = () => {
      const until = this.context.currentTime + lookAheadSec;
      while (this.index < this.sequence.length && this.cursorTime < until) {
        const step = this.sequence[this.index];
        const durationSec = (60 / this.bpm) * step.beats;

        if (step.note !== "REST") {
          const midi = noteNameToMidi(step.note);
          if (midi != null) {
            this.scheduleVoice(midiToFreq(midi), this.cursorTime, durationSec, options);
          }
        }

        this.cursorTime += durationSec;
        this.index += 1;
      }

      if (this.index >= this.sequence.length && this.context.currentTime > this.cursorTime + 0.1) {
        this.stop();
      }
    };

    scheduler();
    this.timer = window.setInterval(scheduler, 100);
  }

  playArrangement(arrangement: Arrangement): void {
    this.stop();
    const startAt = this.context.currentTime + 0.05;
    for (const track of arrangement.tracks) {
      this.scheduleTrack(track, arrangement.bpm, startAt);
    }
  }

  private scheduleTrack(track: ArrangementTrack, bpm: number, startAt: number): void {
    let t = startAt;
    const options = trackPresetToPlayOptions(track.tonePreset);
    for (const step of track.steps) {
      const durationSec = (60 / bpm) * step.beats;
      if (step.note !== "REST") {
        const midi = noteNameToMidi(step.note);
        if (midi != null) {
          this.scheduleVoice(midiToFreq(midi), t, durationSec, options);
        }
      }
      t += durationSec;
    }
  }

  private scheduleVoice(freq: number, start: number, duration: number, options: PlayOptions): void {
    const attack = options.attack ?? 0.006;
    const decay = options.decay ?? 0.06;
    const sustain = options.sustain ?? 0.5;
    const release = options.release ?? 0.07;
    const vibratoHz = options.vibratoHz ?? 5.5;
    const vibratoCents = options.vibratoCents ?? 14;
    const baseFormant = options.formantHz ?? 2200;
    const formantQ = options.formantQ ?? 7;
    const highpassHz = options.highpassHz ?? 320;
    const noiseAmount = options.noiseAmount ?? 0;
    const secondHarmonic = options.secondHarmonic ?? 0;
    const oscType = options.oscType ?? "sine";

    const osc = this.context.createOscillator();
    osc.type = oscType;
    osc.frequency.value = freq;

    const osc2 = this.context.createOscillator();
    osc2.type = oscType;
    osc2.frequency.value = freq * 2;
    const osc2Gain = this.context.createGain();
    osc2Gain.gain.value = secondHarmonic;

    const highpass = this.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = highpassHz;
    highpass.Q.value = 0.7;

    const formant = this.context.createBiquadFilter();
    formant.type = "bandpass";
    // Track note register so low notes are not filtered out.
    formant.frequency.value = Math.max(900, Math.min(3200, Math.max(baseFormant * 0.55, freq * 4.8)));
    formant.Q.value = formantQ;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(1, start + attack);
    gain.gain.linearRampToValueAtTime(sustain, start + attack + decay);

    const releaseStart = Math.max(start + attack + decay, start + duration - release);
    gain.gain.setValueAtTime(sustain, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, start + duration);

    const lfo = this.context.createOscillator();
    lfo.frequency.value = vibratoHz;
    const lfoGain = this.context.createGain();
    lfoGain.gain.value = vibratoCents;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);

    const noise = this.context.createBufferSource();
    const noiseGain = this.context.createGain();
    if (noiseAmount > 0) {
      const noiseBuffer = this.context.createBuffer(1, Math.max(1, Math.floor(this.context.sampleRate * 0.03)), this.context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i += 1) noiseData[i] = (Math.random() * 2 - 1) * noiseAmount;
      noise.buffer = noiseBuffer;
      noiseGain.gain.setValueAtTime(1, start);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
      noise.connect(noiseGain);
      noiseGain.connect(highpass);
    }

    osc.connect(highpass);
    osc2.connect(osc2Gain);
    osc2Gain.connect(highpass);
    highpass.connect(formant);
    formant.connect(gain);
    gain.connect(this.master);

    osc.start(start);
    osc2.start(start);
    lfo.start(start);
    if (noiseAmount > 0) noise.start(start);
    osc.stop(start + duration + 0.05);
    osc2.stop(start + duration + 0.05);
    lfo.stop(start + duration + 0.05);
    if (noiseAmount > 0) noise.stop(start + 0.04);

    this.activeNodes.push(osc, osc2, osc2Gain, lfo, lfoGain, gain, highpass, formant, noise, noiseGain);
  }
}

export type SynthTonePreset = "whistle" | "nes" | "gba" | "organ" | "piano" | "guitar";

function trackPresetToPlayOptions(preset: ArrangementTrack["tonePreset"]): PlayOptions {
  switch (preset) {
    case "pulse_lead":
      return { oscType: "square", attack: 0.002, decay: 0.04, sustain: 0.4, release: 0.03, vibratoHz: 5, vibratoCents: 4, highpassHz: 180, formantHz: 1600, formantQ: 3, secondHarmonic: 0.06, noiseAmount: 0 };
    case "warm_square":
      return { oscType: "square", attack: 0.005, decay: 0.06, sustain: 0.45, release: 0.08, vibratoHz: 4.5, vibratoCents: 5, highpassHz: 140, formantHz: 1450, formantQ: 3.2, secondHarmonic: 0.12, noiseAmount: 0 };
    case "soft_saw":
      return { oscType: "sawtooth", attack: 0.01, decay: 0.09, sustain: 0.35, release: 0.12, vibratoHz: 4.2, vibratoCents: 3, highpassHz: 120, formantHz: 1200, formantQ: 2.8, secondHarmonic: 0.16, noiseAmount: 0 };
    case "fm_bell":
      return { oscType: "triangle", attack: 0.001, decay: 0.12, sustain: 0.1, release: 0.1, vibratoHz: 6, vibratoCents: 2, highpassHz: 230, formantHz: 2300, formantQ: 5, secondHarmonic: 0.35, noiseAmount: 0 };
    case "bass_pick":
      return { oscType: "triangle", attack: 0.002, decay: 0.09, sustain: 0.3, release: 0.08, vibratoHz: 3.5, vibratoCents: 1, highpassHz: 70, formantHz: 950, formantQ: 2.2, secondHarmonic: 0.18, noiseAmount: 0 };
    case "snes_pad":
      return { oscType: "sine", attack: 0.03, decay: 0.12, sustain: 0.72, release: 0.18, vibratoHz: 4.2, vibratoCents: 2.5, highpassHz: 90, formantHz: 1100, formantQ: 2, secondHarmonic: 0.1, noiseAmount: 0 };
    case "noise_kit":
      return { oscType: "triangle", attack: 0.001, decay: 0.04, sustain: 0.05, release: 0.03, vibratoHz: 1, vibratoCents: 0, highpassHz: 300, formantHz: 2400, formantQ: 1.5, secondHarmonic: 0.1, noiseAmount: 0.06 };
    default:
      return toneOptions("nes");
  }
}

function toneOptions(tone: SynthTonePreset): Required<Pick<PlayOptions, "attack" | "decay" | "sustain" | "release" | "vibratoHz" | "vibratoCents" | "formantHz" | "formantQ" | "highpassHz" | "oscType" | "secondHarmonic" | "noiseAmount">> {
  switch (tone) {
    case "nes":
      return { oscType: "square", attack: 0.002, decay: 0.04, sustain: 0.45, release: 0.03, vibratoHz: 5, vibratoCents: 6, highpassHz: 180, formantHz: 1800, formantQ: 4, secondHarmonic: 0.12, noiseAmount: 0 };
    case "gba":
      return { oscType: "triangle", attack: 0.003, decay: 0.05, sustain: 0.4, release: 0.04, vibratoHz: 5.2, vibratoCents: 8, highpassHz: 220, formantHz: 1900, formantQ: 5, secondHarmonic: 0.2, noiseAmount: 0.01 };
    case "organ":
      return { oscType: "sine", attack: 0.01, decay: 0.06, sustain: 0.75, release: 0.12, vibratoHz: 4.8, vibratoCents: 4, highpassHz: 140, formantHz: 1300, formantQ: 3, secondHarmonic: 0.18, noiseAmount: 0 };
    case "piano":
      return { oscType: "triangle", attack: 0.002, decay: 0.09, sustain: 0.2, release: 0.08, vibratoHz: 5.2, vibratoCents: 3, highpassHz: 260, formantHz: 2200, formantQ: 4, secondHarmonic: 0.28, noiseAmount: 0.015 };
    case "guitar":
      return { oscType: "sawtooth", attack: 0.002, decay: 0.08, sustain: 0.25, release: 0.09, vibratoHz: 5, vibratoCents: 2, highpassHz: 300, formantHz: 2400, formantQ: 3.2, secondHarmonic: 0.34, noiseAmount: 0.02 };
    case "whistle":
    default:
      return { oscType: "sine", attack: 0.006, decay: 0.06, sustain: 0.5, release: 0.07, vibratoHz: 5.5, vibratoCents: 14, highpassHz: 320, formantHz: 2200, formantQ: 7, secondHarmonic: 0.08, noiseAmount: 0.01 };
  }
}

function writeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function renderMelodyToWavBlob(
  melody: MelodyStep[],
  bpm: number,
  tone: SynthTonePreset
): Promise<Blob> {
  const opt = toneOptions(tone);
  const beats = melody.reduce((acc, s) => acc + s.beats, 0);
  const totalSec = Math.max(0.5, (60 / bpm) * beats + 0.3);
  const sampleRate = 44100;
  const frameCount = Math.ceil(totalSec * sampleRate);
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);

  const master = offline.createGain();
  master.gain.value = 0.45;
  master.connect(offline.destination);

  let t = 0.05;
  for (const step of melody) {
    const dur = Math.max(0.01, (60 / bpm) * step.beats);
    if (step.note === "REST") {
      t += dur;
      continue;
    }
    const midi = noteNameToMidi(step.note);
    if (midi == null) {
      t += dur;
      continue;
    }
    const freq = midiToFreq(midi);
    const osc = offline.createOscillator();
    osc.type = opt.oscType;
    osc.frequency.value = freq;
    const osc2 = offline.createOscillator();
    osc2.type = opt.oscType;
    osc2.frequency.value = freq * 2;
    const osc2Gain = offline.createGain();
    osc2Gain.gain.value = opt.secondHarmonic;

    const highpass = offline.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = opt.highpassHz;
    highpass.Q.value = 0.7;

    const formant = offline.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.value = Math.max(900, Math.min(3200, Math.max(opt.formantHz * 0.55, freq * 4.8)));
    formant.Q.value = opt.formantQ;

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + opt.attack);
    gain.gain.linearRampToValueAtTime(opt.sustain, t + opt.attack + opt.decay);
    const relStart = Math.max(t + opt.attack + opt.decay, t + dur - opt.release);
    gain.gain.setValueAtTime(opt.sustain, relStart);
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);

    const lfo = offline.createOscillator();
    lfo.frequency.value = opt.vibratoHz;
    const lfoGain = offline.createGain();
    lfoGain.gain.value = opt.vibratoCents;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);

    if (opt.noiseAmount > 0) {
      const noise = offline.createBufferSource();
      const noiseBuffer = offline.createBuffer(1, Math.max(1, Math.floor(sampleRate * 0.03)), sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * opt.noiseAmount;
      noise.buffer = noiseBuffer;
      const noiseGain = offline.createGain();
      noiseGain.gain.setValueAtTime(1, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      noise.connect(noiseGain);
      noiseGain.connect(highpass);
      noise.start(t);
      noise.stop(t + 0.04);
    }

    osc.connect(highpass);
    osc2.connect(osc2Gain);
    osc2Gain.connect(highpass);
    highpass.connect(formant);
    formant.connect(gain);
    gain.connect(master);

    osc.start(t);
    osc2.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);

    t += dur;
  }

  const rendered = await offline.startRendering();
  return writeWavMono(rendered.getChannelData(0), rendered.sampleRate);
}

export async function renderArrangementToWavBlob(arrangement: Arrangement): Promise<Blob> {
  const sampleRate = 44100;
  let beats = 0;
  for (const t of arrangement.tracks) {
    const total = t.steps.reduce((acc, s) => acc + s.beats, 0);
    if (total > beats) beats = total;
  }
  const totalSec = Math.max(0.5, (60 / arrangement.bpm) * beats + 0.3);
  const frameCount = Math.ceil(totalSec * sampleRate);
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const master = offline.createGain();
  master.gain.value = 0.48;
  master.connect(offline.destination);

  for (const t of arrangement.tracks) {
    let cursor = 0.05;
    const opt = trackPresetToPlayOptions(t.tonePreset);
    for (const step of t.steps) {
      const dur = Math.max(0.01, (60 / arrangement.bpm) * step.beats);
      if (step.note !== "REST") {
        const midi = noteNameToMidi(step.note);
        if (midi != null) {
          const freq = midiToFreq(midi);
          const osc = offline.createOscillator();
          osc.type = opt.oscType ?? "sine";
          osc.frequency.value = freq;
          const gain = offline.createGain();
          gain.gain.setValueAtTime(0.0001, cursor);
          gain.gain.linearRampToValueAtTime(1, cursor + (opt.attack ?? 0.01));
          gain.gain.linearRampToValueAtTime(opt.sustain ?? 0.4, cursor + (opt.attack ?? 0.01) + (opt.decay ?? 0.08));
          const relStart = Math.max(cursor + (opt.attack ?? 0.01) + (opt.decay ?? 0.08), cursor + dur - (opt.release ?? 0.05));
          gain.gain.setValueAtTime(opt.sustain ?? 0.4, relStart);
          gain.gain.linearRampToValueAtTime(0.0001, cursor + dur);

          osc.connect(gain);
          gain.connect(master);
          osc.start(cursor);
          osc.stop(cursor + dur + 0.05);
        }
      }
      cursor += dur;
    }
  }

  const rendered = await offline.startRendering();
  return writeWavMono(rendered.getChannelData(0), rendered.sampleRate);
}
