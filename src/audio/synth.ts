import { MelodyStep } from "../types";
import { noteNameToMidi, midiToFreq } from "../music";

interface PlayOptions {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  vibratoHz?: number;
  vibratoCents?: number;
  formantHz?: number;
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
    this.master.gain.value = 0.28;
    this.master.connect(this.context.destination);
  }

  async unlock(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
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

  private scheduleVoice(freq: number, start: number, duration: number, options: PlayOptions): void {
    const attack = options.attack ?? 0.01;
    const decay = options.decay ?? 0.08;
    const sustain = options.sustain ?? 0.7;
    const release = options.release ?? 0.1;
    const vibratoHz = options.vibratoHz ?? 5.5;
    const vibratoCents = options.vibratoCents ?? 11;
    const formantHz = options.formantHz ?? 2200;

    const osc = this.context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const formant = this.context.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.value = formantHz;
    formant.Q.value = 8;

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

    osc.connect(formant);
    formant.connect(gain);
    gain.connect(this.master);

    osc.start(start);
    lfo.start(start);
    osc.stop(start + duration + 0.05);
    lfo.stop(start + duration + 0.05);

    this.activeNodes.push(osc, lfo, lfoGain, gain, formant);
  }
}
