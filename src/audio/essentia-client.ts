export interface MelodiaResult {
  backend: "essentia-melodia" | "pitchy";
  hopSeconds: number;
  pitchHz: number[];
  pitchConfidence: number[];
  bpm?: number;
  bpmConfidence?: number;
  key?: string;
  scale?: "major" | "minor";
  keyStrength?: number;
  error?: string;
}

type WorkerResponse = MelodiaResult & {
  id: string;
  ok: boolean;
};

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
  return worker;
}

export async function analyzeWithEssentia(signal: Float32Array, sampleRate: number, minHz: number, maxHz: number): Promise<MelodiaResult> {
  const w = getWorker();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise<MelodiaResult>((resolve) => {
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (!event.data || event.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      resolve({
        backend: event.data.backend,
        hopSeconds: event.data.hopSeconds,
        pitchHz: event.data.pitchHz,
        pitchConfidence: event.data.pitchConfidence,
        bpm: event.data.bpm,
        bpmConfidence: event.data.bpmConfidence,
        key: event.data.key,
        scale: event.data.scale,
        keyStrength: event.data.keyStrength,
        error: event.data.ok ? undefined : event.data.error
      });
    };

    w.addEventListener("message", onMessage);
    w.postMessage({
      id,
      signal,
      sampleRate,
      minHz,
      maxHz
    });
  });
}
