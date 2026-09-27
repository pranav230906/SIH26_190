export type SyncStatus = 
  | "QUEUED"
  | "UPLOADING"
  | "PROCESSING"
  | "SYNCED"
  | "FAILED"
  | "SECURITY_REJECTED"
  | "AUTHORIZATION_FAILED"
  | "HASH_MISMATCH";

export type OfflineItem = {
  id?: number; // Auto-incremented local ID
  caseId: string;
  itemType: "DOCUMENT" | "EVIDENCE";
  file: File;
  fileName: string;
  mimeType: string;
  fileSize: number;
  localSha256: string;
  createdAt: string;
  metadata: Record<string, string>; // Form data
  status: SyncStatus;
  retryCount: number;
  lastError: string | null;
  serverRecordId: string | null;
};

const DB_NAME = "secure_dms_offline";
const STORE_NAME = "sync_queue";
const DB_VERSION = 1;

export class OfflineSyncQueue {
  private static async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("caseId", "caseId", { unique: false });
        }
      };
    });
  }

  static async enqueue(item: Omit<OfflineItem, "id" | "status" | "retryCount" | "lastError" | "serverRecordId">): Promise<number> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      
      const fullItem: Omit<OfflineItem, "id"> = {
        ...item,
        status: "QUEUED",
        retryCount: 0,
        lastError: null,
        serverRecordId: null,
      };

      const request = store.add(fullItem);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }

  static async getAll(): Promise<OfflineItem[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async updateStatus(id: number, updates: Partial<Pick<OfflineItem, "status" | "retryCount" | "lastError" | "serverRecordId">>): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          const updatedItem = { ...item, ...updates };
          const putReq = store.put(updatedItem);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          reject(new Error("Item not found"));
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  static async remove(id: number): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
