import "./styles.css";
import { analyzeAudioBuffer, suggestAnalysisSettings } from "./audio/analyzer";
import { AudioRecorder } from "./audio/recorder";
import { renderMelodyToWavBlob, WhistleSynth } from "./audio/synth";
import { AppDB } from "./db";
import { exportMelodyJs, exportMelodyJson, exportMelodyMidi } from "./exporters";
import { KEYS, uid } from "./music";
import { AnalysisMode, FileRecord, FolderRecord, GridType, KeyMode, MelodyStep, ProjectRecord, ScaleType } from "./types";

const db = new AppDB();
const recorder = new AudioRecorder();
const synth = new WhistleSynth();

const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const warningText = document.querySelector<HTMLDivElement>("#analysis-warning")!;
const suggestedKeyText = document.querySelector<HTMLParagraphElement>("#suggested-key-text")!;
const folderTreeEl = document.querySelector<HTMLUListElement>("#folder-tree")!;
const projectListEl = document.querySelector<HTMLUListElement>("#project-list")!;
const trashActionsEl = document.querySelector<HTMLDivElement>("#trash-actions")!;
const jsonPreviewEl = document.querySelector<HTMLElement>("#json-preview")!;
const segmentsViewEl = document.querySelector<HTMLTextAreaElement>("#segments-view")!;
const audioPreviewEl = document.querySelector<HTMLAudioElement>("#audio-preview")!;
const synthAudioPreviewEl = document.querySelector<HTMLAudioElement>("#synth-audio-preview")!;
const recordingIndicatorEl = document.querySelector<HTMLDivElement>("#recording-indicator")!;
const recordingStateEl = document.querySelector<HTMLElement>("#recording-state")!;
const recordingTimerEl = document.querySelector<HTMLElement>("#recording-timer")!;
const recordingDotEl = document.querySelector<HTMLSpanElement>("#recording-dot")!;

const recordBtn = document.querySelector<HTMLButtonElement>("#record-btn")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause-btn")!;
const resumeBtn = document.querySelector<HTMLButtonElement>("#resume-btn")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const discardTakeBtn = document.querySelector<HTMLButtonElement>("#discard-take-btn")!;
const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze-btn")!;
const resetAnalysisBtn = document.querySelector<HTMLButtonElement>("#reset-analysis-btn")!;
const synthPlayBtn = document.querySelector<HTMLButtonElement>("#synth-play-btn")!;
const synthStopBtn = document.querySelector<HTMLButtonElement>("#synth-stop-btn")!;
const synthMuteBtn = document.querySelector<HTMLButtonElement>("#synth-mute-btn")!;
const synthSeekInput = document.querySelector<HTMLInputElement>("#synth-seek-input")!;
const synthTimeLabel = document.querySelector<HTMLElement>("#synth-time-label")!;
const synthSpeedSelect = document.querySelector<HTMLSelectElement>("#synth-speed-select")!;
const synthToneSelect = document.querySelector<HTMLSelectElement>("#synth-tone-select")!;
const synthVolumeInput = document.querySelector<HTMLInputElement>("#synth-volume-input")!;
const uploadInput = document.querySelector<HTMLInputElement>("#upload-input")!;
const themeToggleBtn = document.querySelector<HTMLButtonElement>("#theme-toggle-btn")!;
const unlockAudioBtn = document.querySelector<HTMLButtonElement>("#unlock-audio-btn")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
const exportAllBtn = document.querySelector<HTMLButtonElement>("#export-all-btn")!;
const copyJsonBtn = document.querySelector<HTMLButtonElement>("#copy-json-btn")!;
const copySegmentsBtn = document.querySelector<HTMLButtonElement>("#copy-segments-btn")!;
const copyDebugBtn = document.querySelector<HTMLButtonElement>("#copy-debug-btn")!;

const bpmInput = document.querySelector<HTMLInputElement>("#bpm-input")!;
const gridSelect = document.querySelector<HTMLSelectElement>("#grid-select")!;
const analysisModeSelect = document.querySelector<HTMLSelectElement>("#analysis-mode-select")!;
const tripletToggle = document.querySelector<HTMLInputElement>("#triplet-toggle")!;
const rmsInput = document.querySelector<HTMLInputElement>("#rms-input")!;
const clarityInput = document.querySelector<HTMLInputElement>("#clarity-input")!;
const rmsValueEl = document.querySelector<HTMLElement>("#rms-value")!;
const clarityValueEl = document.querySelector<HTMLElement>("#clarity-value")!;
const minNoteMsInput = document.querySelector<HTMLInputElement>("#min-note-ms-input")!;
const minHzInput = document.querySelector<HTMLInputElement>("#min-hz-input")!;
const maxHzInput = document.querySelector<HTMLInputElement>("#max-hz-input")!;
const keyModeSelect = document.querySelector<HTMLSelectElement>("#key-mode-select")!;
const keySelect = document.querySelector<HTMLSelectElement>("#key-select")!;
const scaleSelect = document.querySelector<HTMLSelectElement>("#scale-select")!;
const snapToggle = document.querySelector<HTMLInputElement>("#snap-toggle")!;
const snapCentsInput = document.querySelector<HTMLInputElement>("#snap-cents-input")!;
const exportNameInput = document.querySelector<HTMLInputElement>("#export-name-input")!;
const copySettingsBtn = document.querySelector<HTMLButtonElement>("#copy-settings-btn")!;
const autoSettingsBtn = document.querySelector<HTMLButtonElement>("#auto-settings-btn")!;
const resetSettingsBtn = document.querySelector<HTMLButtonElement>("#reset-settings-btn")!;

const toggleTrashBtn = document.querySelector<HTMLButtonElement>("#toggle-trash-btn")!;
const newFolderBtn = document.querySelector<HTMLButtonElement>("#new-folder-btn")!;
const renameFolderBtn = document.querySelector<HTMLButtonElement>("#rename-folder-btn")!;
const deleteFolderBtn = document.querySelector<HTMLButtonElement>("#delete-folder-btn")!;
const newProjectBtn = document.querySelector<HTMLButtonElement>("#new-project-btn")!;
const renameProjectBtn = document.querySelector<HTMLButtonElement>("#rename-project-btn")!;
const moveProjectBtn = document.querySelector<HTMLButtonElement>("#move-project-btn")!;
const deleteProjectBtn = document.querySelector<HTMLButtonElement>("#delete-project-btn")!;
const fileListEl = document.querySelector<HTMLUListElement>("#file-list")!;
const newFileBtn = document.querySelector<HTMLButtonElement>("#new-file-btn")!;
const renameFileBtn = document.querySelector<HTMLButtonElement>("#rename-file-btn")!;
const deleteFileBtn = document.querySelector<HTMLButtonElement>("#delete-file-btn")!;
const fileEditorEl = document.querySelector<HTMLTextAreaElement>("#file-editor")!;
const restoreBtn = document.querySelector<HTMLButtonElement>("#restore-btn")!;
const emptyTrashBtn = document.querySelector<HTMLButtonElement>("#empty-trash-btn")!;

let folders: FolderRecord[] = [];
let projects: ProjectRecord[] = [];
let files: FileRecord[] = [];
let currentFolderId: string | null = null;
let currentProjectId: string | null = null;
let currentFileId: string | null = null;
let showTrash = false;
let dirty = false;
let recordTimerId: number | null = null;
let recordStartedAt = 0;
let pausedAccumulatedMs = 0;
let pausedAtMs = 0;
let fileSaveTimer: number | null = null;
let synthTicker: number | null = null;
let synthIsPlaying = false;
let synthCurrentBeat = 0;
let synthPlayStartBeat = 0;
let synthPlayStartAtMs = 0;
let synthPlayTempoBpm = 120;
let synthSpeed = 1;
let synthMuted = false;
let synthVolumeBeforeMute = 0.8;

type SynthTone = "whistle" | "nes" | "gba" | "organ" | "piano" | "guitar";
const TONE_GAIN_COMP: Record<SynthTone, number> = {
  whistle: 1.0,
  nes: 0.72,
  gba: 0.8,
  organ: 0.62,
  piano: 0.88,
  guitar: 0.75
};
let synthUserVolume = 1;
let synthRenderedUrl: string | null = null;
let synthRenderToken = 0;

if (synthToneSelect.value !== "nes") {
  synthToneSelect.value = "nes";
}

for (const key of KEYS) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key;
  keySelect.appendChild(option);
}

function setStatus(msg: string): void {
  statusText.textContent = msg;
}

function updateThresholdReadouts(): void {
  rmsValueEl.textContent = Number(rmsInput.value).toFixed(3);
  clarityValueEl.textContent = Number(clarityInput.value).toFixed(2);
}

function updateSynthButtons(): void {
  synthPlayBtn.textContent = synthIsPlaying ? "Pause" : "Play";
  synthMuteBtn.textContent = synthMuted ? "Mute" : "Vol";
}

function totalBeats(melody: Array<{ beats: number }>): number {
  return melody.reduce((acc, step) => acc + step.beats, 0);
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function beatToSeekValue(beat: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((beat / total) * 1000);
}

function seekValueToBeat(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / 1000) * total;
}

function melodyFromBeatOffset(melody: MelodyStep[], offsetBeats: number): MelodyStep[] {
  if (offsetBeats <= 0) return melody.map((s) => ({ ...s }));
  let remain = offsetBeats;
  const out: MelodyStep[] = [];
  for (const step of melody) {
    if (remain >= step.beats) {
      remain -= step.beats;
      continue;
    }
    if (remain > 0) {
      out.push({ note: step.note, beats: Number((step.beats - remain).toFixed(6)) });
      remain = 0;
    } else {
      out.push({ ...step });
    }
  }
  return out;
}

function clearSynthTicker(): void {
  if (synthTicker != null) {
    window.clearInterval(synthTicker);
    synthTicker = null;
  }
}

function syncCurrentBeatWhilePlaying(project: ProjectRecord): void {
  if (!synthIsPlaying) return;
  const elapsedBeat = ((Date.now() - synthPlayStartAtMs) / 1000) * (synthPlayTempoBpm / 60);
  synthCurrentBeat = Math.min(totalBeats(project.melody), synthPlayStartBeat + elapsedBeat);
}

function applyEffectiveSynthVolume(): void {
  const tone = (synthToneSelect.value as SynthTone) || "whistle";
  const effective = synthMuted ? 0 : synthUserVolume * (TONE_GAIN_COMP[tone] ?? 1);
  synth.setVolume(Math.max(0, Math.min(1, effective)));
}

function synthToneOptions(tone: SynthTone) {
  switch (tone) {
    case "nes":
      return { oscType: "square" as OscillatorType, attack: 0.002, decay: 0.04, sustain: 0.45, release: 0.03, vibratoCents: 6, highpassHz: 180, formantHz: 1800, formantQ: 4, secondHarmonic: 0.12, noiseAmount: 0 };
    case "gba":
      return { oscType: "triangle" as OscillatorType, attack: 0.003, decay: 0.05, sustain: 0.4, release: 0.04, vibratoCents: 8, highpassHz: 220, formantHz: 1900, formantQ: 5, secondHarmonic: 0.2, noiseAmount: 0.01 };
    case "organ":
      return { oscType: "sine" as OscillatorType, attack: 0.01, decay: 0.06, sustain: 0.75, release: 0.12, vibratoCents: 4, highpassHz: 140, formantHz: 1300, formantQ: 3, secondHarmonic: 0.18, noiseAmount: 0 };
    case "piano":
      return { oscType: "triangle" as OscillatorType, attack: 0.002, decay: 0.09, sustain: 0.2, release: 0.08, vibratoCents: 3, highpassHz: 260, formantHz: 2200, formantQ: 4, secondHarmonic: 0.28, noiseAmount: 0.015 };
    case "guitar":
      return { oscType: "sawtooth" as OscillatorType, attack: 0.002, decay: 0.08, sustain: 0.25, release: 0.09, vibratoCents: 2, highpassHz: 300, formantHz: 2400, formantQ: 3.2, secondHarmonic: 0.34, noiseAmount: 0.02 };
    case "whistle":
    default:
      return { oscType: "sine" as OscillatorType, attack: 0.006, decay: 0.06, sustain: 0.5, release: 0.07, vibratoCents: 14, highpassHz: 320, formantHz: 2200, formantQ: 7, secondHarmonic: 0.08, noiseAmount: 0.01 };
  }
}

async function refreshSynthPreviewAudio(project?: ProjectRecord): Promise<void> {
  const token = ++synthRenderToken;
  if (!project || !project.melody.length) {
    if (synthRenderedUrl) {
      URL.revokeObjectURL(synthRenderedUrl);
      synthRenderedUrl = null;
    }
    synthAudioPreviewEl.removeAttribute("src");
    synthAudioPreviewEl.load();
    return;
  }

  try {
    const tone = (synthToneSelect.value as SynthTone) || "nes";
    const blob = await renderMelodyToWavBlob(project.melody, project.bpm, tone);
    if (token !== synthRenderToken) return;
    const nextUrl = URL.createObjectURL(blob);
    if (synthRenderedUrl) URL.revokeObjectURL(synthRenderedUrl);
    synthRenderedUrl = nextUrl;
    synthAudioPreviewEl.src = nextUrl;
    synthAudioPreviewEl.load();
  } catch (error) {
    console.error(error);
    if (token !== synthRenderToken) return;
    synthAudioPreviewEl.removeAttribute("src");
    synthAudioPreviewEl.load();
  }
}

function updateSynthUi(project?: ProjectRecord): void {
  if (!project || !project.melody.length) {
    synthSeekInput.value = "0";
    synthTimeLabel.textContent = "0:00 / 0:00";
    updateSynthButtons();
    return;
  }
  const beats = totalBeats(project.melody);
  const tempo = project.bpm * synthSpeed;
  const elapsedSec = (60 / tempo) * synthCurrentBeat;
  const totalSec = (60 / tempo) * beats;
  synthSeekInput.value = String(beatToSeekValue(synthCurrentBeat, beats));
  synthTimeLabel.textContent = `${formatClock(elapsedSec)} / ${formatClock(totalSec)}`;
  updateSynthButtons();
}

function stopSynthPlayback(project?: ProjectRecord): void {
  synth.stop();
  synthIsPlaying = false;
  clearSynthTicker();
  if (project) {
    synthCurrentBeat = 0;
    updateSynthUi(project);
  }
}

async function playSynthFromCurrentPosition(project: ProjectRecord): Promise<void> {
  if (!project.melody.length) return;
  const beatsTotal = totalBeats(project.melody);
  if (synthCurrentBeat >= beatsTotal) synthCurrentBeat = 0;

  const sliced = melodyFromBeatOffset(project.melody, synthCurrentBeat);
  if (!sliced.length) return;

  await synth.unlock();
  synthPlayTempoBpm = project.bpm * synthSpeed;
  synth.playMelody(sliced, synthPlayTempoBpm, synthToneOptions((synthToneSelect.value as SynthTone) || "whistle"));
  synthIsPlaying = true;
  synthPlayStartBeat = synthCurrentBeat;
  synthPlayStartAtMs = Date.now();
  clearSynthTicker();
  synthTicker = window.setInterval(() => {
    if (!synthIsPlaying) return;
    const elapsedBeat = ((Date.now() - synthPlayStartAtMs) / 1000) * (synthPlayTempoBpm / 60);
    synthCurrentBeat = Math.min(beatsTotal, synthPlayStartBeat + elapsedBeat);
    updateSynthUi(project);
    if (synthCurrentBeat >= beatsTotal) {
      synthIsPlaying = false;
      clearSynthTicker();
    }
  }, 100);
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ws-theme", theme);
  const toLight = theme === "dark";
  themeToggleBtn.innerHTML = toLight
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a6 6 0 1 1 8 0c-1.2 1-2 2.4-2 4h-4c0-1.6-.8-3-2-4Z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a7 7 0 1 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
  themeToggleBtn.setAttribute("aria-label", toLight ? "Switch to light mode" : "Switch to dark mode");
  themeToggleBtn.title = toLight ? "Switch to light mode" : "Switch to dark mode";
}

function formatTimer(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function clearRecordTimer(): void {
  if (recordTimerId != null) {
    window.clearInterval(recordTimerId);
    recordTimerId = null;
  }
}

function updateRecordingIndicator(state: "hidden" | "recording" | "paused"): void {
  if (state === "hidden") {
    recordingIndicatorEl.classList.add("hidden");
    recordingDotEl.classList.remove("paused");
    clearRecordTimer();
    recordingTimerEl.textContent = "00:00";
    return;
  }

  recordingIndicatorEl.classList.remove("hidden");
  recordingStateEl.textContent = state === "recording" ? "REC" : "PAUSED";
  recordingDotEl.classList.toggle("paused", state === "paused");

  const elapsed = state === "paused" ? pausedAtMs - recordStartedAt - pausedAccumulatedMs : Date.now() - recordStartedAt - pausedAccumulatedMs;
  recordingTimerEl.textContent = formatTimer(elapsed);

  if (state === "recording" && recordTimerId == null) {
    recordTimerId = window.setInterval(() => {
      const current = Date.now() - recordStartedAt - pausedAccumulatedMs;
      recordingTimerEl.textContent = formatTimer(current);
    }, 250);
  }
  if (state === "paused") {
    clearRecordTimer();
  }
}

function ensureDefaultProject(folderId: string | null): ProjectRecord {
  const now = Date.now();
  return {
    id: uid("project"),
    name: "New Melody",
    folderId,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    bpm: 120,
    grid: "eighth",
    analysisMode: "monophonic",
    triplets: false,
    keyMode: "auto",
    key: "C",
    scale: "major",
    snapEnabled: true,
    snapToleranceCents: 50,
    minNoteMs: 80,
    rmsThreshold: 0.02,
    clarityThreshold: 0.75,
    minHz: 200,
    maxHz: 2500,
    melody: [],
    segments: [],
    exportBaseName: "New Melody"
  };
}

function folderDepth(folder: FolderRecord): number {
  let depth = 0;
  let parent = folders.find((f) => f.id === folder.parentId);
  while (parent) {
    depth += 1;
    parent = folders.find((f) => f.id === parent!.parentId);
  }
  return depth;
}

function getCurrentProject(): ProjectRecord | undefined {
  return projects.find((p) => p.id === currentProjectId);
}

function getCurrentFile(): FileRecord | undefined {
  return files.find((f) => f.id === currentFileId);
}

function resolveExportBaseName(project: ProjectRecord): string {
  const raw = (project.exportBaseName ?? project.name).trim();
  const base = raw.length ? raw : project.name;
  const cleaned = base.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : "melody";
}

function renderSegments(project: ProjectRecord): string {
  if (!project.segments.length) return "No segments yet.";
  return project.segments
    .slice(0, 200)
    .map((s, i) => {
      const title = `${String(i + 1).padStart(2, "0")} ${s.noteName} ${s.beats.toFixed(3)} beats`;
      const body = `Start ${s.startSec.toFixed(3)}s | Dur ${s.durationSec.toFixed(3)}s${s.midi != null ? ` | MIDI ${s.midi}` : ""}`;
      return `${title}\n${body}`;
    })
    .join("\n\n");
}

function updateEditorFromProject(project?: ProjectRecord): void {
  if (!project) {
    jsonPreviewEl.textContent = "[]";
    segmentsViewEl.value = "No project selected.";
    warningText.textContent = "";
    exportNameInput.value = "";
    exportNameInput.disabled = true;
    fileEditorEl.value = "";
    fileEditorEl.disabled = true;
    synthCurrentBeat = 0;
    updateSynthUi(undefined);
    void refreshSynthPreviewAudio(undefined);
    return;
  }

  bpmInput.value = String(project.bpm);
  gridSelect.value = project.grid;
  analysisModeSelect.value = project.analysisMode ?? "monophonic";
  tripletToggle.checked = project.triplets;
  rmsInput.value = String(project.rmsThreshold);
  clarityInput.value = String(project.clarityThreshold);
  updateThresholdReadouts();
  minNoteMsInput.value = String(project.minNoteMs);
  minHzInput.value = String(project.minHz);
  maxHzInput.value = String(project.maxHz);
  keyModeSelect.value = project.keyMode;
  keySelect.value = project.key;
  scaleSelect.value = project.scale;
  snapToggle.checked = project.snapEnabled;
  snapCentsInput.value = String(project.snapToleranceCents);
  exportNameInput.value = project.exportBaseName ?? project.name;
  exportNameInput.disabled = false;

  jsonPreviewEl.textContent = JSON.stringify(project.melody, null, 2);
  segmentsViewEl.value = renderSegments(project);
  fileEditorEl.disabled = false;
  updateSynthUi(project);
  void refreshSynthPreviewAudio(project);
}

async function saveCurrentProject(): Promise<void> {
  const project = getCurrentProject();
  if (!project) return;
  project.updatedAt = Date.now();
  await db.saveProject(project);
  dirty = false;
  setStatus(`Saved ${project.name}`);
}

async function saveCurrentFile(): Promise<void> {
  const file = getCurrentFile();
  if (!file) return;
  file.content = fileEditorEl.value;
  file.updatedAt = Date.now();
  await db.saveFile(file);
}

function updateFileEditorFromSelection(): void {
  const file = getCurrentFile();
  if (!file) {
    fileEditorEl.value = "";
    fileEditorEl.disabled = !getCurrentProject();
    fileEditorEl.placeholder = "Start typing to create notes.txt in this project.";
    return;
  }
  fileEditorEl.disabled = false;
  fileEditorEl.value = file.content;
  fileEditorEl.placeholder = `Editing ${file.name}`;
}

async function loadFilesForCurrentProject(): Promise<void> {
  if (!currentProjectId || showTrash) {
    files = [];
    currentFileId = null;
    return;
  }
  files = await db.listFilesByProject(currentProjectId);
  if (!currentFileId || !files.some((f) => f.id === currentFileId)) {
    currentFileId = files[0]?.id ?? null;
  }
}

function hydrateSettings(project: ProjectRecord): void {
  project.bpm = Number(bpmInput.value);
  project.grid = gridSelect.value as GridType;
  project.analysisMode = analysisModeSelect.value as AnalysisMode;
  project.triplets = tripletToggle.checked;
  project.rmsThreshold = Number(rmsInput.value);
  project.clarityThreshold = Number(clarityInput.value);
  project.minNoteMs = Number(minNoteMsInput.value);
  project.minHz = Number(minHzInput.value);
  project.maxHz = Number(maxHzInput.value);
  project.keyMode = keyModeSelect.value as KeyMode;
  project.key = keySelect.value;
  project.scale = scaleSelect.value as ScaleType;
  project.snapEnabled = snapToggle.checked;
  project.snapToleranceCents = Number(snapCentsInput.value);
}

function makeFolderNameList(): string {
  return folders.filter((f) => !f.trashedAt).map((f) => `${f.name} (${f.id})`).join("\n");
}

async function refresh(): Promise<void> {
  folders = await db.listFolders(true);
  projects = await db.listProjects(true);

  if (!folders.some((f) => f.trashedAt === null)) {
    const root: FolderRecord = {
      id: uid("folder"),
      name: "My Projects",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      trashedAt: null
    };
    await db.saveFolder(root);
    folders = await db.listFolders(true);
  }

  const visibleFolders = folders.filter((f) => (showTrash ? !!f.trashedAt : !f.trashedAt));
  if (!currentFolderId || !visibleFolders.some((f) => f.id === currentFolderId)) {
    currentFolderId = visibleFolders[0]?.id ?? null;
  }

  const visibleProjects = projects.filter((p) => {
    if (showTrash) return !!p.trashedAt;
    return !p.trashedAt && p.folderId === currentFolderId;
  });

  if (!currentProjectId || !visibleProjects.some((p) => p.id === currentProjectId)) {
    currentProjectId = visibleProjects[0]?.id ?? null;
  }

  await loadFilesForCurrentProject();
  renderLists();
  updateEditorFromProject(getCurrentProject());
  updateFileEditorFromSelection();
}

function renderLists(): void {
  folderTreeEl.textContent = "";
  const visibleFolders = folders
    .filter((f) => (showTrash ? !!f.trashedAt : !f.trashedAt))
    .sort((a, b) => folderDepth(a) - folderDepth(b) || a.name.localeCompare(b.name));

  for (const folder of visibleFolders) {
    const li = document.createElement("li");
    li.textContent = `${"  ".repeat(folderDepth(folder))}${folder.name}`;
    li.className = folder.id === currentFolderId ? "selected" : "";
    if (folder.trashedAt) li.classList.add("trashed");
    li.onclick = () => {
      currentFolderId = folder.id;
      currentProjectId = null;
      void refresh();
    };
    folderTreeEl.appendChild(li);
  }

  projectListEl.textContent = "";
  const visibleProjects = projects
    .filter((p) => (showTrash ? !!p.trashedAt : !p.trashedAt && p.folderId === currentFolderId))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  for (const project of visibleProjects) {
    const li = document.createElement("li");
    li.textContent = project.name;
    li.className = project.id === currentProjectId ? "selected" : "";
    if (project.trashedAt) li.classList.add("trashed");
    li.onclick = () => {
      currentProjectId = project.id;
      currentFileId = null;
      void refresh();
    };
    projectListEl.appendChild(li);
  }

  fileListEl.textContent = "";
  for (const file of files) {
    const li = document.createElement("li");
    li.textContent = file.name;
    li.className = file.id === currentFileId ? "selected" : "";
    li.onclick = () => {
      currentFileId = file.id;
      renderLists();
      updateFileEditorFromSelection();
    };
    fileListEl.appendChild(li);
  }

  trashActionsEl.classList.toggle("hidden", !showTrash);
}

async function decodeBlobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("AudioContext is not supported.");
  const ctx = new Ctx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }
}

function attachAudioBlob(blob: Blob): void {
  const project = getCurrentProject();
  if (!project) return;
  project.rawAudioBlob = blob;
  audioPreviewEl.src = URL.createObjectURL(blob);
  dirty = true;
}

async function discardCurrentTake(): Promise<void> {
  const project = getCurrentProject();
  if (!project) return;
  project.rawAudioBlob = undefined;
  project.sourceFileName = undefined;
  audioPreviewEl.removeAttribute("src");
  audioPreviewEl.load();
  dirty = true;
  await saveCurrentProject();
}

async function runAnalysis(): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    setStatus("Select or create a project first.");
    return;
  }
  if (!project.rawAudioBlob) {
    setStatus("No audio loaded, record or upload first.");
    return;
  }

  hydrateSettings(project);
  setStatus("Analyzing audio...");

  try {
    const buffer = await decodeBlobToAudioBuffer(project.rawAudioBlob);
    const result = await analyzeAudioBuffer(buffer, {
      bpm: project.bpm,
      grid: project.grid,
      triplets: project.triplets,
      analysisMode: project.analysisMode,
      rmsThreshold: project.rmsThreshold,
      clarityThreshold: project.clarityThreshold,
      minNoteMs: project.minNoteMs,
      keyMode: project.keyMode,
      key: project.key,
      scale: project.scale,
      snapEnabled: project.snapEnabled,
      snapToleranceCents: project.snapToleranceCents,
      minHz: project.minHz,
      maxHz: project.maxHz
    });

    project.melody = result.melody;
    project.segments = result.segments;
    if (project.keyMode === "auto") {
      project.key = result.suggestedKey;
      project.scale = result.suggestedScale;
      keySelect.value = project.key;
      scaleSelect.value = project.scale;
    }

    suggestedKeyText.textContent = `Suggested key: ${result.suggestedKey} ${result.suggestedScale}`;
    warningText.textContent = result.warning ?? "";

    dirty = true;
    updateEditorFromProject(project);
    stopSynthPlayback(project);
    await saveCurrentProject();
    setStatus(`Analyzed ${project.name}`);
  } catch (error) {
    console.error(error);
    setStatus("Analysis failed, check the audio format and retry.");
  }
}

function wireEvents(): void {
  themeToggleBtn.onclick = () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  };

  unlockAudioBtn.onclick = async () => {
    await synth.unlock();
    setStatus("Audio unlocked");
  };

  document.body.addEventListener(
    "click",
    () => {
      void synth.unlock();
    },
    { once: true }
  );

  recordBtn.onclick = async () => {
    try {
      await recorder.start();
      recordStartedAt = Date.now();
      pausedAccumulatedMs = 0;
      pausedAtMs = 0;
      updateRecordingIndicator("recording");
      setStatus("Recording...");
      recordBtn.disabled = true;
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
      resumeBtn.disabled = true;
    } catch (error) {
      console.error(error);
      setStatus("Microphone access failed.");
    }
  };

  pauseBtn.onclick = () => {
    recorder.pause();
    pausedAtMs = Date.now();
    updateRecordingIndicator("paused");
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
    setStatus("Recording paused");
  };

  resumeBtn.onclick = () => {
    recorder.resume();
    if (pausedAtMs > 0) {
      pausedAccumulatedMs += Date.now() - pausedAtMs;
      pausedAtMs = 0;
    }
    updateRecordingIndicator("recording");
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    setStatus("Recording resumed");
  };

  stopBtn.onclick = async () => {
    try {
      const blob = await recorder.stop();
      attachAudioBlob(blob);
      const project = getCurrentProject();
      if (project) {
        project.sourceFileName = `recording-${new Date().toISOString()}.webm`;
      }
      setStatus("Recording captured");
      await saveCurrentProject();
    } catch (error) {
      console.error(error);
      setStatus("Stop recording failed.");
    } finally {
      updateRecordingIndicator("hidden");
      recordBtn.disabled = false;
      pauseBtn.disabled = true;
      resumeBtn.disabled = true;
      stopBtn.disabled = true;
    }
  };

  discardTakeBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }
    if (!project.rawAudioBlob) {
      setStatus("No current take to discard.");
      return;
    }
    if (!confirm("Discard current take for this project?")) return;
    await discardCurrentTake();
    setStatus("Current take discarded");
  };

  uploadInput.onchange = async () => {
    const file = uploadInput.files?.[0];
    const project = getCurrentProject();
    if (!file || !project) return;

    try {
      await decodeBlobToAudioBuffer(file);
      attachAudioBlob(file);
      project.sourceFileName = file.name;
      setStatus(`Loaded ${file.name}`);
      await saveCurrentProject();
    } catch (error) {
      console.error(error);
      setStatus("Could not decode this audio file.");
    }
  };

  analyzeBtn.onclick = () => {
    void runAnalysis();
  };

  resetAnalysisBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }
    project.melody = [];
    project.segments = [];
    warningText.textContent = "";
    suggestedKeyText.textContent = "";
    jsonPreviewEl.textContent = "[]";
    segmentsViewEl.value = "No segments yet.";
    dirty = true;
    await saveCurrentProject();
    setStatus("Cleared melody and segments");
  };

  resetSettingsBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }

    project.bpm = 120;
    project.grid = "eighth";
    project.analysisMode = "monophonic";
    project.triplets = false;
    project.keyMode = "auto";
    project.key = "C";
    project.scale = "major";
    project.snapEnabled = true;
    project.snapToleranceCents = 50;
    project.minNoteMs = 80;
    project.rmsThreshold = 0.02;
    project.clarityThreshold = 0.75;
    project.minHz = 200;
    project.maxHz = 2500;

    updateEditorFromProject(project);
    dirty = true;
    await saveCurrentProject();
    setStatus("Settings reset to defaults");
  };

  autoSettingsBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }
    if (!project.rawAudioBlob) {
      setStatus("Load or record audio first.");
      return;
    }

    setStatus("Auto-detecting analysis settings...");
    try {
      const buffer = await decodeBlobToAudioBuffer(project.rawAudioBlob);
      const suggestion = await suggestAnalysisSettings(buffer, {
        bpm: project.bpm,
        grid: project.grid,
        triplets: project.triplets,
        analysisMode: project.analysisMode,
        rmsThreshold: project.rmsThreshold,
        clarityThreshold: project.clarityThreshold,
        minNoteMs: project.minNoteMs,
        keyMode: project.keyMode,
        key: project.key,
        scale: project.scale,
        snapEnabled: project.snapEnabled,
        snapToleranceCents: project.snapToleranceCents,
        minHz: project.minHz,
        maxHz: project.maxHz
      });

      project.bpm = suggestion.bpm;
      project.grid = suggestion.grid;
      project.triplets = suggestion.triplets;
      project.analysisMode = suggestion.analysisMode;
      project.rmsThreshold = suggestion.rmsThreshold;
      project.clarityThreshold = suggestion.clarityThreshold;
      project.minHz = suggestion.minHz;
      project.maxHz = suggestion.maxHz;
      project.minNoteMs = suggestion.minNoteMs;
      updateEditorFromProject(project);
      dirty = true;
      await saveCurrentProject();
      setStatus(
        `Auto settings applied: ${suggestion.bpm} BPM, ${suggestion.grid}, ${suggestion.analysisMode}, RMS ${suggestion.rmsThreshold}, Clarity ${suggestion.clarityThreshold}`
      );
    } catch (error) {
      console.error(error);
      setStatus("Auto settings failed.");
    }
  };

  synthPlayBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) {
      setStatus("Nothing to play, analyze first.");
      return;
    }
    if (synthIsPlaying) {
      syncCurrentBeatWhilePlaying(project);
      synth.stop();
      synthIsPlaying = false;
      clearSynthTicker();
      updateSynthUi(project);
      setStatus("Playback paused");
      return;
    }
    await playSynthFromCurrentPosition(project);
    setStatus("Playing melody");
  };

  synthStopBtn.onclick = () => {
    const project = getCurrentProject();
    stopSynthPlayback(project);
    setStatus("Playback stopped");
  };

  synthMuteBtn.onclick = () => {
    synthMuted = !synthMuted;
    if (synthMuted) {
      synthVolumeBeforeMute = synthUserVolume;
      synthVolumeInput.value = "0";
    } else {
      const restore = Math.max(0.01, synthVolumeBeforeMute);
      synthVolumeInput.value = String(restore);
      synthUserVolume = restore;
    }
    applyEffectiveSynthVolume();
    updateSynthButtons();
  };

  saveBtn.onclick = () => {
    void Promise.all([saveCurrentProject(), saveCurrentFile()]);
  };

  copyJsonBtn.onclick = async () => {
    const text = jsonPreviewEl.textContent ?? "[]";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied melody JSON");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setStatus("Copied melody JSON");
    }
  };

  copySegmentsBtn.onclick = async () => {
    const text = segmentsViewEl.value ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied segments");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setStatus("Copied segments");
    }
  };

  copySettingsBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }
    const payload = {
      bpm: project.bpm,
      grid: project.grid,
      analysisMode: project.analysisMode,
      triplets: project.triplets,
      rmsThreshold: project.rmsThreshold,
      clarityThreshold: project.clarityThreshold,
      minNoteMs: project.minNoteMs,
      minHz: project.minHz,
      maxHz: project.maxHz,
      keyMode: project.keyMode,
      key: project.key,
      scale: project.scale,
      snapEnabled: project.snapEnabled,
      snapToleranceCents: project.snapToleranceCents,
      exportBaseName: project.exportBaseName ?? project.name,
      tone: synthToneSelect.value,
      synthSpeed: synthSpeedSelect.value,
      synthVolume: synthVolumeInput.value
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied settings");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setStatus("Copied settings");
    }
  };

  copyDebugBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) {
      setStatus("Select a project first.");
      return;
    }

    const settingsPayload = {
      bpm: project.bpm,
      grid: project.grid,
      analysisMode: project.analysisMode,
      triplets: project.triplets,
      rmsThreshold: project.rmsThreshold,
      clarityThreshold: project.clarityThreshold,
      minNoteMs: project.minNoteMs,
      minHz: project.minHz,
      maxHz: project.maxHz,
      keyMode: project.keyMode,
      key: project.key,
      scale: project.scale,
      snapEnabled: project.snapEnabled,
      snapToleranceCents: project.snapToleranceCents,
      exportBaseName: project.exportBaseName ?? project.name,
      tone: synthToneSelect.value,
      synthSpeed: synthSpeedSelect.value,
      synthVolume: synthVolumeInput.value
    };

    const debugText = [
      "Settings:",
      JSON.stringify(settingsPayload, null, 2),
      "",
      "Segments:",
      segmentsViewEl.value || "No segments yet.",
      "",
      "JSON:",
      jsonPreviewEl.textContent ?? "[]"
    ].join("\n");

    try {
      await navigator.clipboard.writeText(debugText);
      setStatus("Copied debug bundle");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = debugText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setStatus("Copied debug bundle");
    }
  };

  exportAllBtn.onclick = () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) {
      setStatus("No melody to export.");
      return;
    }
    const baseName = resolveExportBaseName(project);
    project.exportBaseName = baseName;
    exportNameInput.value = baseName;
    exportMelodyJson(baseName, project.bpm, project.melody);
    exportMelodyJs(baseName, project.melody);
    exportMelodyMidi(baseName, project.melody, project.bpm);
    void saveCurrentProject();
    setStatus("Exported JSON, JS, and MIDI");
  };

  toggleTrashBtn.onclick = () => {
    showTrash = !showTrash;
    toggleTrashBtn.textContent = showTrash ? "Back" : "Trash";
    void refresh();
  };

  newFolderBtn.onclick = async () => {
    const name = prompt("Folder name?");
    if (!name) return;
    const folder: FolderRecord = {
      id: uid("folder"),
      name,
      parentId: currentFolderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      trashedAt: null
    };
    await db.saveFolder(folder);
    currentFolderId = folder.id;
    await refresh();
  };

  renameFolderBtn.onclick = async () => {
    const folder = folders.find((f) => f.id === currentFolderId);
    if (!folder) return;
    const name = prompt("New folder name?", folder.name);
    if (!name) return;
    folder.name = name;
    folder.updatedAt = Date.now();
    await db.saveFolder(folder);
    await refresh();
  };

  deleteFolderBtn.onclick = async () => {
    if (!currentFolderId) return;
    await db.trashFolder(currentFolderId);
    currentFolderId = null;
    await refresh();
  };

  newProjectBtn.onclick = async () => {
    const project = ensureDefaultProject(currentFolderId);
    await db.saveProject(project);
    currentProjectId = project.id;
    await refresh();
  };

  renameProjectBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) return;
    const name = prompt("New project name?", project.name);
    if (!name) return;
    project.name = name;
    project.updatedAt = Date.now();
    await db.saveProject(project);
    await refresh();
  };

  moveProjectBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project) return;
    const list = makeFolderNameList();
    const folderId = prompt(`Target folder id:\n${list}`, project.folderId ?? "");
    if (!folderId) return;
    if (!folders.some((f) => f.id === folderId && !f.trashedAt)) {
      setStatus("Folder id not found.");
      return;
    }
    project.folderId = folderId;
    project.updatedAt = Date.now();
    await db.saveProject(project);
    await refresh();
  };

  deleteProjectBtn.onclick = async () => {
    if (!currentProjectId) return;
    await db.trashProject(currentProjectId);
    currentProjectId = null;
    await refresh();
  };

  newFileBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project || showTrash) {
      setStatus("Select a non-trashed project first.");
      return;
    }
    const name = prompt("File name?", "notes.txt");
    if (!name) return;
    const now = Date.now();
    const file: FileRecord = {
      id: uid("file"),
      projectId: project.id,
      name,
      content: "",
      createdAt: now,
      updatedAt: now
    };
    await db.saveFile(file);
    currentFileId = file.id;
    await refresh();
    setStatus(`Created file ${name}`);
  };

  renameFileBtn.onclick = async () => {
    const file = getCurrentFile();
    if (!file) return;
    const name = prompt("Rename file?", file.name);
    if (!name) return;
    file.name = name;
    file.updatedAt = Date.now();
    await db.saveFile(file);
    await refresh();
    setStatus(`Renamed file to ${name}`);
  };

  deleteFileBtn.onclick = async () => {
    const file = getCurrentFile();
    if (!file) return;
    await db.deleteFile(file.id);
    currentFileId = null;
    await refresh();
    setStatus(`Deleted file ${file.name}`);
  };

  restoreBtn.onclick = async () => {
    const project = projects.find((p) => p.id === currentProjectId && p.trashedAt);
    if (project) {
      await db.restoreProject(project.id);
      await refresh();
      return;
    }
    const folder = folders.find((f) => f.id === currentFolderId && f.trashedAt);
    if (folder) {
      await db.restoreFolder(folder.id);
      await refresh();
    }
  };

  emptyTrashBtn.onclick = async () => {
    if (!confirm("Empty trash permanently?")) return;
    await db.emptyTrash();
    currentProjectId = null;
    currentFolderId = null;
    await refresh();
  };

  const settingInputs: Array<HTMLInputElement | HTMLSelectElement> = [
    bpmInput,
    gridSelect,
    analysisModeSelect,
    tripletToggle,
    rmsInput,
    clarityInput,
    minNoteMsInput,
    minHzInput,
    maxHzInput,
    keyModeSelect,
    keySelect,
    scaleSelect,
    snapToggle,
    snapCentsInput,
    exportNameInput
  ];

  for (const el of settingInputs) {
    el.addEventListener("change", async () => {
      const project = getCurrentProject();
      if (!project) return;
      const isBpmChange = el === bpmInput;
      const wasPlaying = synthIsPlaying;
      let resumeRatio = 0;
      if (wasPlaying) {
        syncCurrentBeatWhilePlaying(project);
        const beatsTotal = totalBeats(project.melody);
        resumeRatio = beatsTotal > 0 ? synthCurrentBeat / beatsTotal : 0;
      }
      hydrateSettings(project);
      project.exportBaseName = exportNameInput.value.trim() || project.name;
      dirty = true;

      // BPM should retime current melody playback/render, not re-transcribe audio.
      if (isBpmChange) {
        updateEditorFromProject(project);
        await saveCurrentProject();
        await refreshSynthPreviewAudio(project);
        if (wasPlaying && project.melody.length) {
          const total = totalBeats(project.melody);
          synthCurrentBeat = Math.max(0, Math.min(total, total * resumeRatio));
          await playSynthFromCurrentPosition(project);
        }
        setStatus(`BPM updated live: ${project.bpm}`);
        return;
      }

      // Apply analysis-related settings live by re-running analysis when audio exists.
      if (project.rawAudioBlob) {
        await runAnalysis();
        const updated = getCurrentProject();
        if (wasPlaying && updated && updated.melody.length) {
          synthCurrentBeat = Math.max(0, Math.min(totalBeats(updated.melody), totalBeats(updated.melody) * resumeRatio));
          await playSynthFromCurrentPosition(updated);
          setStatus("Live settings update applied");
        }
      } else {
        updateEditorFromProject(project);
        await saveCurrentProject();
      }
    });
  }

  synthSeekInput.addEventListener("input", () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) return;
    synthCurrentBeat = seekValueToBeat(Number(synthSeekInput.value), totalBeats(project.melody));
    updateSynthUi(project);
  });

  synthSeekInput.addEventListener("change", () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) return;
    if (synthIsPlaying) {
      void playSynthFromCurrentPosition(project);
    }
  });

  synthVolumeInput.addEventListener("input", () => {
    const v = Number(synthVolumeInput.value);
    synthUserVolume = v;
    synthMuted = v <= 0.001;
    if (!synthMuted) synthVolumeBeforeMute = synthUserVolume;
    applyEffectiveSynthVolume();
    updateSynthButtons();
  });

  synthSpeedSelect.addEventListener("change", () => {
    const project = getCurrentProject();
    synthSpeed = Number(synthSpeedSelect.value) || 1;
    if (project) updateSynthUi(project);
    if (project && synthIsPlaying) {
      void playSynthFromCurrentPosition(project);
    }
  });

  synthToneSelect.addEventListener("change", () => {
    const project = getCurrentProject();
    applyEffectiveSynthVolume();
    if (project) {
      void refreshSynthPreviewAudio(project);
    }
    if (project && synthIsPlaying) {
      void playSynthFromCurrentPosition(project);
    }
  });

  rmsInput.addEventListener("input", updateThresholdReadouts);
  clarityInput.addEventListener("input", updateThresholdReadouts);

  fileEditorEl.addEventListener("input", () => {
    const project = getCurrentProject();
    if (!project) return;
    if (!currentFileId) {
      const now = Date.now();
      const file: FileRecord = {
        id: uid("file"),
        projectId: project.id,
        name: "notes.txt",
        content: fileEditorEl.value,
        createdAt: now,
        updatedAt: now
      };
      currentFileId = file.id;
      files.push(file);
      renderLists();
      fileEditorEl.placeholder = `Editing ${file.name}`;
      void db.saveFile(file);
    }
    if (fileSaveTimer != null) window.clearTimeout(fileSaveTimer);
    fileSaveTimer = window.setTimeout(() => {
      void saveCurrentFile().then(() => setStatus("File autosaved"));
    }, 300);
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function boot(): Promise<void> {
  const storedTheme = localStorage.getItem("ws-theme");
  applyTheme(storedTheme === "dark" ? "dark" : "light");
  wireEvents();
  synthUserVolume = Number(synthVolumeInput.value);
  applyEffectiveSynthVolume();
  synthSpeed = Number(synthSpeedSelect.value) || 1;
  updateSynthButtons();
  await refresh();

  if (!projects.some((p) => !p.trashedAt)) {
    const project = ensureDefaultProject(currentFolderId);
    await db.saveProject(project);
    currentProjectId = project.id;
    await refresh();
  }

  setStatus("Ready");
  updateThresholdReadouts();
}

void boot();
