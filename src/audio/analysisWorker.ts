import { PitchDetector } from "pitchy";

type WorkerRequest = {
  id: string;
  signal: Float32Array;
  sampleRate: number;
  minHz: number;
  maxHz: number;
};

type WorkerResponse = {
  id: string;
  ok: boolean;
  error?: string;
  backend: "essentia-melodia" | "pitchy";
  hopSeconds: number;
  pitchHz: number[];
  pitchConfidence: number[];
  bpm?: number;
  bpmConfidence?: number;
  key?: string;
  scale?: "major" | "minor";
  keyStrength?: number;
};

let essentiaCore: any | null = null;

async function ensureEssentia(): Promise<any | null> {
  if (essentiaCore) return essentiaCore;
  try {
    const wasmMod = await import("essentia.js/dist/essentia-wasm.es.js");
    const coreMod = await import("essentia.js/dist/essentia.js-core.es.js");
    const EssentiaCtor = (coreMod as any).default;
    const EssentiaWASM = (wasmMod as any).EssentiaWASM;
    if (!EssentiaCtor || !EssentiaWASM) return null;
    essentiaCore = new EssentiaCtor(EssentiaWASM, false);
    return essentiaCore;
  } catch {
    return null;
  }
}

function pitchyFallback(req: WorkerRequest): WorkerResponse {
  const frameSize = 2048;
  const hop = 512;
  const detector = PitchDetector.forFloat32Array(frameSize);
  const pitchHz: number[] = [];
  const pitchConfidence: number[] = [];

  for (let i = 0; i + frameSize <= req.signal.length; i += hop) {
    const frame = req.signal.slice(i, i + frameSize);
    const [hz, conf] = detector.findPitch(frame, req.sampleRate);
    if (hz >= req.minHz && hz <= req.maxHz) {
      pitchHz.push(hz);
      pitchConfidence.push(conf);
    } else {
      pitchHz.push(0);
      pitchConfidence.push(0);
    }
  }

  return {
    id: req.id,
    ok: true,
    backend: "pitchy",
    hopSeconds: hop / req.sampleRate,
    pitchHz,
    pitchConfidence
  };
}

async function run(req: WorkerRequest): Promise<WorkerResponse> {
  const essentia = await ensureEssentia();
  if (!essentia) return pitchyFallback(req);

  try {
    const pitchOut = essentia.PredominantPitchMelodia(
      req.signal,
      10, // binResolution
      3, // filterIterations
      2048, // frameSize
      true, // guessUnvoiced
      0.8, // harmonicWeight
      128, // hopSize
      1, // magnitudeCompression
      40, // magnitudeThreshold
      req.maxHz,
      80, // minDuration ms
      req.minHz,
      20, // numberHarmonics
      0.9, // peakDistributionThreshold
      27, // peakFrameThreshold
      27.5, // pitchContinuity
      55, // referenceFrequency
      req.sampleRate,
      100, // timeContinuity
      true, // voiceVibrato
      0.2 // voicingTolerance
    );

    const rhythmOut = essentia.RhythmExtractor2013(req.signal, 220, "multifeature", 50);
    const keyOut = essentia.KeyExtractor(req.signal, true, 4096, 2048, 12, req.maxHz, 60, req.minHz, 0.2, "bgate", req.sampleRate, 0.0001, 440, "cosine", "hann");

    const hz = Array.from((pitchOut.pitch as number[]) ?? []);
    const conf = Array.from((pitchOut.pitchConfidence as number[]) ?? []);
    const bpm = typeof rhythmOut.bpm === "number" ? rhythmOut.bpm : undefined;
    const bpmConfidence = typeof rhythmOut.confidence === "number" ? rhythmOut.confidence : undefined;
    const key = typeof keyOut.key === "string" ? keyOut.key : undefined;
    const scaleRaw = typeof keyOut.scale === "string" ? keyOut.scale.toLowerCase() : "";
    const scale: "major" | "minor" | undefined = scaleRaw.includes("minor") ? "minor" : scaleRaw.includes("major") ? "major" : undefined;
    const keyStrength = typeof keyOut.strength === "number" ? keyOut.strength : undefined;

    return {
      id: req.id,
      ok: true,
      backend: "essentia-melodia",
      hopSeconds: 128 / req.sampleRate,
      pitchHz: hz,
      pitchConfidence: conf,
      bpm,
      bpmConfidence,
      key,
      scale,
      keyStrength
    };
  } catch (error) {
    return {
      ...pitchyFallback(req),
      id: req.id,
      ok: false,
      error: (error as Error)?.message ?? "Essentia analysis failed"
    };
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const res = await run(req);
  (self as unknown as Worker).postMessage(res);
};
