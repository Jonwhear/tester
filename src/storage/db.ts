/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Hand-rolled rather than pulling in a wrapper library: the surface actually
 * used here is small, and keeping it local means the storage layer can be
 * swapped for a server-backed repository later without touching callers.
 */

export const DB_NAME = 'qbank-exam';
export const DB_VERSION = 1;

export const STORE_BANKS = 'banks';
export const STORE_ATTEMPTS = 'attempts';
export const STORE_RESPONSES = 'responses';
export const STORE_KV = 'kv';

export const RESPONSE_ATTEMPT_INDEX = 'by-attempt';

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  if (!isStorageAvailable()) {
    return Promise.reject(
      new Error(
        'IndexedDB is unavailable in this browser context. Progress cannot be saved — ' +
          'private-browsing restrictions are the usual cause.',
      ),
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_BANKS)) {
        db.createObjectStore(STORE_BANKS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'attemptId' });
      }
      if (!db.objectStoreNames.contains(STORE_RESPONSES)) {
        const store = db.createObjectStore(STORE_RESPONSES, { keyPath: 'key' });
        store.createIndex(RESPONSE_ATTEMPT_INDEX, 'attemptId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade blocked by another open tab of this application.'));
  });

  return dbPromise;
}

/** Test seam: forget the cached connection. */
export function resetDatabaseConnection(): void {
  dbPromise = null;
}

async function withStore<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(storeNames, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  const result = await run(tx);
  await done;
  return result;
}

export async function get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore(storeName, 'readonly', (tx) =>
    requestToPromise<T | undefined>(tx.objectStore(storeName).get(key) as IDBRequest<T | undefined>),
  );
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  return withStore(storeName, 'readonly', (tx) =>
    requestToPromise<T[]>(tx.objectStore(storeName).getAll() as IDBRequest<T[]>),
  );
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return withStore(storeName, 'readonly', (tx) =>
    requestToPromise<T[]>(tx.objectStore(storeName).index(indexName).getAll(key) as IDBRequest<T[]>),
  );
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  await withStore(storeName, 'readwrite', (tx) => {
    tx.objectStore(storeName).put(value);
  });
}

/** Write several records inside ONE transaction. */
export async function putMany<T>(storeName: string, values: readonly T[]): Promise<void> {
  if (values.length === 0) return;
  await withStore(storeName, 'readwrite', (tx) => {
    const store = tx.objectStore(storeName);
    values.forEach((value) => store.put(value));
  });
}

export async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  await withStore(storeName, 'readwrite', (tx) => {
    tx.objectStore(storeName).delete(key);
  });
}

export async function removeByIndex(
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<void> {
  await withStore(storeName, 'readwrite', async (tx) => {
    const store = tx.objectStore(storeName);
    const keys = await requestToPromise<IDBValidKey[]>(store.index(indexName).getAllKeys(key));
    keys.forEach((k) => store.delete(k));
  });
}

export async function clearStore(storeName: string): Promise<void> {
  await withStore(storeName, 'readwrite', (tx) => {
    tx.objectStore(storeName).clear();
  });
}
