import { FileRecord, FolderRecord, ProjectRecord } from "./types";

const DB_NAME = "whistle-studio-db";
const DB_VERSION = 2;
const FOLDERS = "folders";
const PROJECTS = "projects";
const FILES = "files";

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export class AppDB {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FOLDERS)) {
          const store = db.createObjectStore(FOLDERS, { keyPath: "id" });
          store.createIndex("by_parent", "parentId");
          store.createIndex("by_trashed", "trashedAt");
        }
        if (!db.objectStoreNames.contains(PROJECTS)) {
          const store = db.createObjectStore(PROJECTS, { keyPath: "id" });
          store.createIndex("by_folder", "folderId");
          store.createIndex("by_trashed", "trashedAt");
        }
        if (!db.objectStoreNames.contains(FILES)) {
          const store = db.createObjectStore(FILES, { keyPath: "id" });
          store.createIndex("by_project", "projectId");
          store.createIndex("by_updated", "updatedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async listFolders(includeTrash = false): Promise<FolderRecord[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(FOLDERS, "readonly");
    const all = await reqToPromise(tx.objectStore(FOLDERS).getAll() as IDBRequest<FolderRecord[]>);
    return all
      .filter((f) => (includeTrash ? true : !f.trashedAt))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listProjects(includeTrash = false): Promise<ProjectRecord[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS, "readonly");
    const all = await reqToPromise(tx.objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>);
    return all
      .filter((p) => (includeTrash ? true : !p.trashedAt))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS, "readonly");
    return reqToPromise(tx.objectStore(PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>);
  }

  async listFilesByProject(projectId: string): Promise<FileRecord[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(FILES, "readonly");
    const all = await reqToPromise(tx.objectStore(FILES).getAll() as IDBRequest<FileRecord[]>);
    return all
      .filter((f) => f.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFile(id: string): Promise<FileRecord | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(FILES, "readonly");
    return reqToPromise(tx.objectStore(FILES).get(id) as IDBRequest<FileRecord | undefined>);
  }

  async saveFolder(folder: FolderRecord): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(FOLDERS, "readwrite");
    tx.objectStore(FOLDERS).put(folder);
    await txDone(tx);
  }

  async saveProject(project: ProjectRecord): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS, "readwrite");
    tx.objectStore(PROJECTS).put(project);
    await txDone(tx);
  }

  async saveFile(file: FileRecord): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).put(file);
    await txDone(tx);
  }

  async deleteFile(fileId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).delete(fileId);
    await txDone(tx);
  }

  async trashFolder(folderId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([FOLDERS, PROJECTS, FILES], "readwrite");
    const now = Date.now();
    const folderStore = tx.objectStore(FOLDERS);
    const projectStore = tx.objectStore(PROJECTS);
    const fileStore = tx.objectStore(FILES);

    const folder = await reqToPromise(folderStore.get(folderId) as IDBRequest<FolderRecord>);
    if (folder) {
      folder.trashedAt = now;
      folder.updatedAt = now;
      folderStore.put(folder);
    }

    const projects = await reqToPromise(projectStore.getAll() as IDBRequest<ProjectRecord[]>);
    for (const project of projects) {
      if (project.folderId === folderId && !project.trashedAt) {
        project.trashedAt = now;
        project.updatedAt = now;
        projectStore.put(project);
        const files = await reqToPromise(fileStore.getAll() as IDBRequest<FileRecord[]>);
        for (const file of files) {
          if (file.projectId === project.id) {
            fileStore.delete(file.id);
          }
        }
      }
    }

    await txDone(tx);
  }

  async trashProject(projectId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([PROJECTS, FILES], "readwrite");
    const store = tx.objectStore(PROJECTS);
    const fileStore = tx.objectStore(FILES);
    const project = await reqToPromise(store.get(projectId) as IDBRequest<ProjectRecord>);
    if (project) {
      project.trashedAt = Date.now();
      project.updatedAt = Date.now();
      store.put(project);
      const files = await reqToPromise(fileStore.getAll() as IDBRequest<FileRecord[]>);
      for (const file of files) {
        if (file.projectId === project.id) fileStore.delete(file.id);
      }
    }
    await txDone(tx);
  }

  async restoreFolder(folderId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(FOLDERS, "readwrite");
    const store = tx.objectStore(FOLDERS);
    const folder = await reqToPromise(store.get(folderId) as IDBRequest<FolderRecord>);
    if (folder) {
      folder.trashedAt = null;
      folder.updatedAt = Date.now();
      store.put(folder);
    }
    await txDone(tx);
  }

  async restoreProject(projectId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS, "readwrite");
    const store = tx.objectStore(PROJECTS);
    const project = await reqToPromise(store.get(projectId) as IDBRequest<ProjectRecord>);
    if (project) {
      project.trashedAt = null;
      project.updatedAt = Date.now();
      store.put(project);
    }
    await txDone(tx);
  }

  async emptyTrash(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([FOLDERS, PROJECTS, FILES], "readwrite");
    const folders = await reqToPromise(tx.objectStore(FOLDERS).getAll() as IDBRequest<FolderRecord[]>);
    for (const folder of folders) {
      if (folder.trashedAt) tx.objectStore(FOLDERS).delete(folder.id);
    }
    const projects = await reqToPromise(tx.objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>);
    for (const project of projects) {
      if (project.trashedAt) tx.objectStore(PROJECTS).delete(project.id);
    }
    const files = await reqToPromise(tx.objectStore(FILES).getAll() as IDBRequest<FileRecord[]>);
    for (const file of files) {
      const parent = projects.find((p) => p.id === file.projectId);
      if (!parent || parent.trashedAt) tx.objectStore(FILES).delete(file.id);
    }
    await txDone(tx);
  }
}
