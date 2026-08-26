import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'

const DEFAULT_DATABASE_NAME = 'weapp-sqlite'
const DEFAULT_STORE_NAME = 'databases'

export interface IndexedDbSqliteWasmStorageOptions {
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
  readonly storeName?: string
}

export interface IndexedDbSqliteWasmStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
}

export class SqliteWebStorageUnavailableError extends Error {
  readonly code = 'WEB_SQLITE_INDEXEDDB_UNAVAILABLE'

  constructor() {
    super('IndexedDB is unavailable in the current Web runtime.')
    this.name = 'SqliteWebStorageUnavailableError'
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
  })
}

function normalizeStoredBytes(value: unknown): Uint8Array | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value)
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0))
  }
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  throw new TypeError('IndexedDB contains an invalid SQLite database value.')
}

export function createIndexedDbSqliteWasmStorage(
  options: IndexedDbSqliteWasmStorageOptions = {},
): IndexedDbSqliteWasmStorage {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB
  if (!indexedDB) {
    throw new SqliteWebStorageUnavailableError()
  }

  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
  const storeName = options.storeName ?? DEFAULT_STORE_NAME
  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open the SQLite IndexedDB database.'))
    request.onblocked = () => reject(new Error('Opening the SQLite IndexedDB database was blocked.'))
  })

  return {
    async load(name) {
      const database = await databasePromise
      const transaction = database.transaction(storeName, 'readonly')
      const value = await requestResult(transaction.objectStore(storeName).get(name))
      await transactionComplete(transaction)
      return normalizeStoredBytes(value)
    },
    async save(name, data) {
      const database = await databasePromise
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(Uint8Array.from(data), name)
      await transactionComplete(transaction)
    },
    async remove(name) {
      const database = await databasePromise
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(name)
      await transactionComplete(transaction)
    },
  }
}
