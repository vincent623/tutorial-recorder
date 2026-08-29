

const DB_NAME = 'tutorialRecorder';
const DB_VERSION = 2;
const RECORDINGS_STORE = 'recordings';
const ASSETS_STORE = 'assets';
const ASSETS_RECORDING_INDEX = 'recordingId';

let dbPromise = null;
let dbHandle = null;

function resetDatabaseConnection() {
  dbPromise = null;
  dbHandle = null;
}

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

      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const assetsStore = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
        assetsStore.createIndex(ASSETS_RECORDING_INDEX, 'recordingId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.addEventListener('versionchange', () => {
        db.close();
      });
      db.addEventListener('close', () => {
        if (dbHandle === db) {
          resetDatabaseConnection();
        }
      });

      dbHandle = db;
      resolve(db);
    };
    request.onerror = () => {
      resetDatabaseConnection();
      reject(request.error);
    };
    request.onblocked = () => {
      console.warn('[AssetStore] Database upgrade blocked by another open connection');
    };
  }).catch((error) => {
    resetDatabaseConnection();
    throw error;
  });

  return dbPromise;
}

function isConnectionLostError(error) {
  const name = error?.name || '';
  return (
    name === 'InvalidStateError' ||
    name === 'ConnectionClosedError' ||
    name === 'TransactionInactiveError' ||
    name === 'NotFoundError'
  );
}

async function withStoreRobust(factory) {
  try {
    return await factory();
  } catch (error) {
    if (!isConnectionLostError(error) || !dbHandle) {
      throw error;
    }

    resetDatabaseConnection();
    return factory();
  }
}

async function withStore(storeName, mode, callback) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    try {
      result = callback(store, transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function withStores(storeNames, mode, callback) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(
      storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)])
    );
    let result;

    try {
      result = callback(stores, transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putRecording(recording) {
  return withStoreRobust(() =>
    withStore(RECORDINGS_STORE, 'readwrite', (store) => store.put(recording))
  );
}

export async function putRecordingWithAssets(recording, assets = [], options = {}) {
  return withStoreRobust(() =>
    withStores([RECORDINGS_STORE, ASSETS_STORE], 'readwrite', (stores) => {
      const assetStore = stores[ASSETS_STORE];
      const deleteAssetIds = Array.isArray(options.deleteAssetIds) ? options.deleteAssetIds : [];

      for (const assetId of deleteAssetIds) {
        if (assetId) {
          assetStore.delete(assetId);
        }
      }

      for (const asset of assets) {
        if (asset?.id) {
          assetStore.put(asset);
        }
      }

      return stores[RECORDINGS_STORE].put(recording);
    })
  );
}

export async function getRecording(id) {
  return withStoreRobust(() => withStore(RECORDINGS_STORE, 'readonly', (store) => store.get(id)));
}

export async function listRecordings() {
  return withStoreRobust(() => withStore(RECORDINGS_STORE, 'readonly', (store) => store.getAll()));
}

export async function putAsset(asset) {
  return withStoreRobust(() => withStore(ASSETS_STORE, 'readwrite', (store) => store.put(asset)));
}

export async function getAsset(id) {
  return withStoreRobust(() => withStore(ASSETS_STORE, 'readonly', (store) => store.get(id)));
}

export async function listAssetsForRecording(recordingId) {
  return withStoreRobust(() =>
    withStore(ASSETS_STORE, 'readonly', (store) => store.index(ASSETS_RECORDING_INDEX).getAll(recordingId))
  );
}

export async function deleteAssetsForRecording(recordingId) {
  return withStoreRobust(() =>
    withStore(ASSETS_STORE, 'readwrite', (store) => {
      const index = store.index(ASSETS_RECORDING_INDEX);
      const request = index.openCursor(IDBKeyRange.only(recordingId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          return;
        }

        cursor.delete();
        cursor.continue();
      };
    })
  );
}

export async function deleteRecording(id) {
  return withStoreRobust(() =>
    withStores([RECORDINGS_STORE, ASSETS_STORE], 'readwrite', (stores) => {
    stores[RECORDINGS_STORE].delete(id);

    const index = stores[ASSETS_STORE].index(ASSETS_RECORDING_INDEX);
    const request = index.openCursor(IDBKeyRange.only(id));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      cursor.delete();
      cursor.continue();
    };
    })
  );
}
