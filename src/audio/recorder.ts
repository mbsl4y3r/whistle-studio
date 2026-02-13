const MIME_PRIORITY = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_PRIORITY.find((m) => MediaRecorder.isTypeSupported(m));
}

function mergeBuffers(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
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

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  private fallbackContext: AudioContext | null = null;
  private fallbackSource: MediaStreamAudioSourceNode | null = null;
  private fallbackNode: ScriptProcessorNode | null = null;
  private fallbackBuffers: Float32Array[] = [];
  private fallbackPaused = false;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (typeof MediaRecorder !== "undefined") {
      const mime = pickMimeType();
      this.chunks = [];
      this.mediaRecorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(150);
      return;
    }

    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("AudioContext is not supported in this browser.");

    this.fallbackContext = new Ctx();
    this.fallbackSource = this.fallbackContext.createMediaStreamSource(this.stream);
    this.fallbackNode = this.fallbackContext.createScriptProcessor(4096, 1, 1);
    this.fallbackBuffers = [];
    this.fallbackPaused = false;

    this.fallbackNode.onaudioprocess = (event) => {
      if (this.fallbackPaused) return;
      const input = event.inputBuffer.getChannelData(0);
      this.fallbackBuffers.push(new Float32Array(input));
    };

    this.fallbackSource.connect(this.fallbackNode);
    this.fallbackNode.connect(this.fallbackContext.destination);
  }

  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
      return;
    }
    this.fallbackPaused = true;
  }

  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
      return;
    }
    this.fallbackPaused = false;
  }

  async stop(): Promise<Blob> {
    if (this.mediaRecorder) {
      const mr = this.mediaRecorder;
      if (mr.state !== "inactive") {
        await new Promise<void>((resolve) => {
          mr.onstop = () => resolve();
          mr.stop();
        });
      }
      const type = mr.mimeType || "audio/webm";
      const blob = new Blob(this.chunks, { type });
      this.cleanup();
      return blob;
    }

    if (!this.fallbackContext) throw new Error("Recorder was not started.");
    const data = mergeBuffers(this.fallbackBuffers);
    const blob = encodeWav(data, this.fallbackContext.sampleRate);
    this.cleanup();
    return blob;
  }

  private cleanup(): void {
    this.mediaRecorder = null;
    this.chunks = [];

    if (this.fallbackNode) this.fallbackNode.disconnect();
    if (this.fallbackSource) this.fallbackSource.disconnect();
    if (this.fallbackContext) void this.fallbackContext.close();
    this.fallbackNode = null;
    this.fallbackSource = null;
    this.fallbackContext = null;
    this.fallbackBuffers = [];

    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
    }
    this.stream = null;
  }
}
