import "./styles.css";
import { analyzeAudioBuffer } from "./audio/analyzer";
import { AudioRecorder } from "./audio/recorder";
import { WhistleSynth } from "./audio/synth";
import { AppDB } from "./db";
import { exportMelodyJs, exportMelodyJson, exportMelodyMidi } from "./exporters";
import { KEYS, uid } from "./music";
import { FolderRecord, GridType, KeyMode, ProjectRecord, ScaleType } from "./types";

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
const segmentsViewEl = document.querySelector<HTMLDivElement>("#segments-view")!;
const audioPreviewEl = document.querySelector<HTMLAudioElement>("#audio-preview")!;

const recordBtn = document.querySelector<HTMLButtonElement>("#record-btn")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause-btn")!;
const resumeBtn = document.querySelector<HTMLButtonElement>("#resume-btn")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const analyzeBtn = document.querySelector<HTMLButtonElement>("#analyze-btn")!;
const playBtn = document.querySelector<HTMLButtonElement>("#play-btn")!;
const stopPlayBtn = document.querySelector<HTMLButtonElement>("#stop-play-btn")!;
const uploadInput = document.querySelector<HTMLInputElement>("#upload-input")!;
const unlockAudioBtn = document.querySelector<HTMLButtonElement>("#unlock-audio-btn")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
const exportAllBtn = document.querySelector<HTMLButtonElement>("#export-all-btn")!;

const bpmInput = document.querySelector<HTMLInputElement>("#bpm-input")!;
const gridSelect = document.querySelector<HTMLSelectElement>("#grid-select")!;
const tripletToggle = document.querySelector<HTMLInputElement>("#triplet-toggle")!;
const rmsInput = document.querySelector<HTMLInputElement>("#rms-input")!;
const clarityInput = document.querySelector<HTMLInputElement>("#clarity-input")!;
const minNoteMsInput = document.querySelector<HTMLInputElement>("#min-note-ms-input")!;
const minHzInput = document.querySelector<HTMLInputElement>("#min-hz-input")!;
const maxHzInput = document.querySelector<HTMLInputElement>("#max-hz-input")!;
const keyModeSelect = document.querySelector<HTMLSelectElement>("#key-mode-select")!;
const keySelect = document.querySelector<HTMLSelectElement>("#key-select")!;
const scaleSelect = document.querySelector<HTMLSelectElement>("#scale-select")!;
const snapToggle = document.querySelector<HTMLInputElement>("#snap-toggle")!;
const snapCentsInput = document.querySelector<HTMLInputElement>("#snap-cents-input")!;

const toggleTrashBtn = document.querySelector<HTMLButtonElement>("#toggle-trash-btn")!;
const newFolderBtn = document.querySelector<HTMLButtonElement>("#new-folder-btn")!;
const renameFolderBtn = document.querySelector<HTMLButtonElement>("#rename-folder-btn")!;
const deleteFolderBtn = document.querySelector<HTMLButtonElement>("#delete-folder-btn")!;
const newProjectBtn = document.querySelector<HTMLButtonElement>("#new-project-btn")!;
const renameProjectBtn = document.querySelector<HTMLButtonElement>("#rename-project-btn")!;
const moveProjectBtn = document.querySelector<HTMLButtonElement>("#move-project-btn")!;
const deleteProjectBtn = document.querySelector<HTMLButtonElement>("#delete-project-btn")!;
const restoreBtn = document.querySelector<HTMLButtonElement>("#restore-btn")!;
const emptyTrashBtn = document.querySelector<HTMLButtonElement>("#empty-trash-btn")!;

let folders: FolderRecord[] = [];
let projects: ProjectRecord[] = [];
let currentFolderId: string | null = null;
let currentProjectId: string | null = null;
let showTrash = false;
let dirty = false;

for (const key of KEYS) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key;
  keySelect.appendChild(option);
}

function setStatus(msg: string): void {
  statusText.textContent = msg;
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
    segments: []
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

function formatSegments(project: ProjectRecord): string {
  if (!project.segments.length) return "No segments yet.";
  return project.segments
    .slice(0, 200)
    .map((s, i) => `${String(i + 1).padStart(2, "0")}: ${s.noteName.padEnd(6)} ${s.beats.toFixed(3)} beats`)
    .join("\n");
}

function updateEditorFromProject(project?: ProjectRecord): void {
  if (!project) {
    jsonPreviewEl.textContent = "[]";
    segmentsViewEl.textContent = "No project selected.";
    warningText.textContent = "";
    return;
  }

  bpmInput.value = String(project.bpm);
  gridSelect.value = project.grid;
  tripletToggle.checked = project.triplets;
  rmsInput.value = String(project.rmsThreshold);
  clarityInput.value = String(project.clarityThreshold);
  minNoteMsInput.value = String(project.minNoteMs);
  minHzInput.value = String(project.minHz);
  maxHzInput.value = String(project.maxHz);
  keyModeSelect.value = project.keyMode;
  keySelect.value = project.key;
  scaleSelect.value = project.scale;
  snapToggle.checked = project.snapEnabled;
  snapCentsInput.value = String(project.snapToleranceCents);

  jsonPreviewEl.textContent = JSON.stringify(project.melody, null, 2);
  segmentsViewEl.textContent = formatSegments(project);
}

async function saveCurrentProject(): Promise<void> {
  const project = getCurrentProject();
  if (!project) return;
  project.updatedAt = Date.now();
  await db.saveProject(project);
  dirty = false;
  setStatus(`Saved ${project.name}`);
}

function hydrateSettings(project: ProjectRecord): void {
  project.bpm = Number(bpmInput.value);
  project.grid = gridSelect.value as GridType;
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

  renderLists();
  updateEditorFromProject(getCurrentProject());
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
      updateEditorFromProject(project);
      renderLists();
    };
    projectListEl.appendChild(li);
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
    await saveCurrentProject();
    setStatus(`Analyzed ${project.name}`);
  } catch (error) {
    console.error(error);
    setStatus("Analysis failed, check the audio format and retry.");
  }
}

function wireEvents(): void {
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
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
    setStatus("Recording paused");
  };

  resumeBtn.onclick = () => {
    recorder.resume();
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
      recordBtn.disabled = false;
      pauseBtn.disabled = true;
      resumeBtn.disabled = true;
      stopBtn.disabled = true;
    }
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

  playBtn.onclick = async () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) {
      setStatus("Nothing to play, analyze first.");
      return;
    }
    await synth.unlock();
    synth.playMelody(project.melody, project.bpm);
    setStatus("Playing melody");
  };

  stopPlayBtn.onclick = () => {
    synth.stop();
    setStatus("Playback stopped");
  };

  saveBtn.onclick = () => {
    void saveCurrentProject();
  };

  exportAllBtn.onclick = () => {
    const project = getCurrentProject();
    if (!project || !project.melody.length) {
      setStatus("No melody to export.");
      return;
    }
    exportMelodyJson(project.name, project.bpm, project.melody);
    exportMelodyJs(project.name, project.melody);
    exportMelodyMidi(project.name, project.melody, project.bpm);
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
    snapCentsInput
  ];

  for (const el of settingInputs) {
    el.addEventListener("change", async () => {
      const project = getCurrentProject();
      if (!project) return;
      hydrateSettings(project);
      dirty = true;
      updateEditorFromProject(project);
      await saveCurrentProject();
    });
  }

  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function boot(): Promise<void> {
  wireEvents();
  await refresh();

  if (!projects.some((p) => !p.trashedAt)) {
    const project = ensureDefaultProject(currentFolderId);
    await db.saveProject(project);
    currentProjectId = project.id;
    await refresh();
  }

  setStatus("Ready");
}

void boot();
