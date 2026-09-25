/**
 * Files of a message sent before sign-in (landing → sign-in → Builder).
 *
 * Kept apart from attachment-client so the landing does not load the API
 * client and Supabase for a feature most visits never use.
 */

const DB = 'coden-composer-files';
const STORE = 'files';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Keeps the files of a message that starts a project before the user is signed in. */
export async function stashPendingFiles(files: File[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(files.map(file => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file })), 'pending');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  db.close();
}

export async function takePendingFiles(): Promise<File[]> {
  const db = await openDb();
  if (!db) return [];
  const records = await new Promise<Array<{ name: string; type: string; lastModified: number; blob: Blob }>>(resolve => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get('pending');
    request.onsuccess = () => { store.delete('pending'); resolve(Array.isArray(request.result) ? request.result : []); };
    request.onerror = () => resolve([]);
  });
  db.close();
  return records.map(record => new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }));
}
