import type { AppData } from '../domain/types'
import type { Storage } from './types'

const DB_NAME = 'dog-ledger'
const STORE = 'appdata'
const KEY = 'singleton'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  }))
}

/** 整个数据集作为一个对象整体读写。数据量在几百条以内，不做增量持久化。 */
export const indexedDbStorage: Storage = {
  async load() {
    const value = await tx<AppData | undefined>('readonly', s => s.get(KEY) as IDBRequest<AppData | undefined>)
    return value ?? null
  },
  async save(data) {
    await tx('readwrite', s => s.put(data, KEY))
  },
  async clear() {
    await tx('readwrite', s => s.delete(KEY))
  },
}

/** 请求浏览器把本站数据标记为持久化，降低被系统回收的概率。 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
