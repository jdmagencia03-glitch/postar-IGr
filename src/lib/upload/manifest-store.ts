const DB_NAME = "postarigr-upload";
const STORE = "manifest";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "fileId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

export interface ManifestEntry {
  fileId: string;
  batchId: string;
  name: string;
  size: number;
  lastModified: number;
  fingerprint: string;
}

export async function saveManifestEntries(entries: ManifestEntry[]) {
  if (!entries.length) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const entry of entries) {
      store.put(entry);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB indisponível (modo privado, quota) — retomada usa matching por metadados.
  }
}

export async function getManifestForBatch(batchId: string) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const request = store.getAll();

    const entries: ManifestEntry[] = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as ManifestEntry[]);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return entries.filter((entry) => entry.batchId === batchId);
  } catch {
    return [];
  }
}

export async function clearManifestBatch(batchId: string) {
  try {
    const entries = await getManifestForBatch(batchId);
    if (!entries.length) return;
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const entry of entries) {
      store.delete(entry.fileId);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export function matchFilesToManifest(files: File[], manifest: ManifestEntry[]) {
  const map = new Map<string, File>();
  for (const file of files) {
    const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
    const entry = manifest.find((item) => item.fingerprint === fingerprint);
    if (entry) map.set(entry.fileId, file);
  }
  return map;
}
