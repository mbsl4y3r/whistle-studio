import { FolderRecord, ProjectRecord } from "./types";

const DB_NAME = "whistle-studio-db";
const DB_VERSION = 1;
const FOLDERS = "folders";
const PROJECTS = "projects";

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

  async trashFolder(folderId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([FOLDERS, PROJECTS], "readwrite");
    const now = Date.now();
    const folderStore = tx.objectStore(FOLDERS);
    const projectStore = tx.objectStore(PROJECTS);

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
      }
    }

    await txDone(tx);
  }

  async trashProject(projectId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(PROJECTS, "readwrite");
    const store = tx.objectStore(PROJECTS);
    const project = await reqToPromise(store.get(projectId) as IDBRequest<ProjectRecord>);
    if (project) {
      project.trashedAt = Date.now();
      project.updatedAt = Date.now();
      store.put(project);
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
    const tx = db.transaction([FOLDERS, PROJECTS], "readwrite");
    const folders = await reqToPromise(tx.objectStore(FOLDERS).getAll() as IDBRequest<FolderRecord[]>);
    for (const folder of folders) {
      if (folder.trashedAt) tx.objectStore(FOLDERS).delete(folder.id);
    }
    const projects = await reqToPromise(tx.objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>);
    for (const project of projects) {
      if (project.trashedAt) tx.objectStore(PROJECTS).delete(project.id);
    }
    await txDone(tx);
  }
}
