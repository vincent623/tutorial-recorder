const DB_NAME = 'tutorialRecorder';
const DB_VERSION = 1;
const RECORDINGS_STORE = 'recordings';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE, mode);
    const store = transaction.objectStore(RECORDINGS_STORE);
    const result = callback(store);

    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putRecording(recording) {
  return withStore('readwrite', (store) => store.put(recording));
}

export async function getRecording(id) {
  return withStore('readonly', (store) => store.get(id));
}

export async function listRecordings() {
  return withStore('readonly', (store) => store.getAll());
}

export async function deleteRecording(id) {
  return withStore('readwrite', (store) => store.delete(id));
}
