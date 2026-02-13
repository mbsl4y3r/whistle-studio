export type ScaleType = "major" | "minor";
export type KeyMode = "auto" | "manual";
export type GridType = "quarter" | "eighth" | "sixteenth";
export type AnalysisMode = "monophonic" | "full_mix";
export type OutputStyle = "lead_only" | "auto_arrange";
export type RetroStyle = "snes_lite" | "nes";
export type ContinuityMode = "seamless" | "natural";

export interface MelodyStep {
  note: string;
  beats: number;
  velocity?: number;
}

export type ChipChannelName = "lead" | "bass" | "arp";

export interface ChipChannel {
  name: ChipChannelName;
  wave: "pulse" | "triangle" | "noise";
  melody: MelodyStep[];
}

export interface ChiptuneArrangement {
  version: 1;
  bpm: number;
  key: string;
  scale: ScaleType;
  ppq: number;
  channels: ChipChannel[];
}

export type TrackRole = "lead" | "harmony" | "bass" | "drums";

export interface ArrangementTrack {
  role: TrackRole;
  name: string;
  tonePreset: "pulse_lead" | "warm_square" | "soft_saw" | "fm_bell" | "bass_pick" | "snes_pad" | "noise_kit";
  midiChannel: number;
  midiProgram?: number;
  steps: MelodyStep[];
  pan?: number;
}

export interface Arrangement {
  bpm: number;
  key: string;
  scale: ScaleType;
  tracks: ArrangementTrack[];
}

export interface Segment {
  isRest: boolean;
  startSec: number;
  durationSec: number;
  beats: number;
  midi?: number;
  midiFloat?: number;
  noteName: string;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  bpm: number;
  grid: GridType;
  triplets: boolean;
  keyMode: KeyMode;
  key: string;
  scale: ScaleType;
  snapEnabled: boolean;
  snapToleranceCents: number;
  minNoteMs: number;
  rmsThreshold: number;
  clarityThreshold: number;
  minHz: number;
  maxHz: number;
  analysisMode: AnalysisMode;
  outputStyle?: OutputStyle;
  retroStyle?: RetroStyle;
  continuityMode?: ContinuityMode;
  continuityIntensity?: number;
  overrideAutoSettings?: boolean;
  overrideBpmKey?: boolean;
  melody: MelodyStep[];
  arrangement?: Arrangement;
  analysisDebug?: AnalyzeResult["debug"];
  segments: Segment[];
  rawAudioBlob?: Blob;
  sourceFileName?: string;
  exportBaseName?: string;
}

export interface FileRecord {
  id: string;
  projectId: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisOptions {
  bpm: number;
  grid: GridType;
  triplets: boolean;
  rmsThreshold: number;
  clarityThreshold: number;
  minNoteMs: number;
  keyMode: KeyMode;
  key: string;
  scale: ScaleType;
  snapEnabled: boolean;
  snapToleranceCents: number;
  minHz: number;
  maxHz: number;
  analysisMode: AnalysisMode;
}

export interface AnalyzeResult {
  melody: MelodyStep[];
  segments: Segment[];
  suggestedKey: string;
  suggestedScale: ScaleType;
  warning?: string;
  debug?: {
    backend?: "pitchy" | "essentia-melodia";
    bpm?: number;
    bpmConfidence?: number;
    keyStrength?: number;
    voicedPercent?: number;
    restRatio?: number;
    midiMin?: number;
    midiMedian?: number;
    midiMax?: number;
    continuityMode?: ContinuityMode;
    continuityRemovedRests?: number;
    continuityShortenedRests?: number;
    continuityFillsInserted?: number;
  };
}
