import type { Draft } from './draft';

const DB = 'enso-theme-studio';
const STORE = 'drafts';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** 草稿连同图片 Blob 一起存；读写失败只影响刷新后能否恢复 */
export const loadDraft = () => run<Draft | undefined>('readonly', (s) => s.get(KEY));
export const saveDraft = (draft: Draft) => run('readwrite', (s) => s.put(draft, KEY));
