export type ScaleType = "major" | "minor";
export type KeyMode = "auto" | "manual";
export type GridType = "quarter" | "eighth" | "sixteenth";
export type AnalysisMode = "monophonic" | "full_mix";

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
  analysisMode: AnalysisMode;
  melody: MelodyStep[];
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
}
