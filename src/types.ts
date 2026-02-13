export type ScaleType = "major" | "minor";
export type KeyMode = "auto" | "manual";
export type GridType = "quarter" | "eighth" | "sixteenth";

export interface MelodyStep {
  note: string;
  beats: number;
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
  melody: MelodyStep[];
  segments: Segment[];
  rawAudioBlob?: Blob;
  sourceFileName?: string;
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
}

export interface AnalyzeResult {
  melody: MelodyStep[];
  segments: Segment[];
  suggestedKey: string;
  suggestedScale: ScaleType;
  warning?: string;
}
