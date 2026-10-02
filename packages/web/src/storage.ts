import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'

const DEFAULT_DATABASE_NAME = 'weapp-sqlite'
const DEFAULT_STORE_NAME = 'databases'

interface SharedIndexedDbState {
  databasePromise: Promise<IDBDatabase> | undefined
  activeDatabase: IDBDatabase | undefined
  tail: Promise<void>
}

const sharedStates = new WeakMap<object, Map<string, SharedIndexedDbState>>()

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
  const stateKey = `${databaseName}\0${storeName}`
  let states = sharedStates.get(indexedDB)
  if (!states) {
    states = new Map()
    sharedStates.set(indexedDB, states)
  }
  const state = states.get(stateKey) ?? {
    databasePromise: undefined,
    activeDatabase: undefined,
    tail: Promise.resolve(),
  }
  states.set(stateKey, state)

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = state.tail.then(operation)
    state.tail = result.then(() => undefined, () => undefined)
    return result
  }

  function openDatabase(): Promise<IDBDatabase> {
    if (state.databasePromise) {
      return state.databasePromise
    }
    let abandoned = false
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      const fail = (error: Error) => {
        abandoned = true
        // Clear synchronously so the next queued operation can retry immediately,
        // even when a host delivers an error through a non-standard request shim.
        state.databasePromise = undefined
        reject(error)
      }
      request.onupgradeneeded = () => {
        if (abandoned) {
          request.transaction?.abort()
          return
        }
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName)
        }
      }
      request.onsuccess = () => {
        const database = request.result
        if (abandoned) {
          database.close()
          return
        }
        const release = () => {
          if (state.databasePromise === opening) {
            state.databasePromise = undefined
            state.activeDatabase = undefined
          }
        }
        database.onversionchange = () => {
          // Closing waits for active transactions while allowing the requesting peer to proceed.
          database.close()
          release()
        }
        database.onclose = release
        state.activeDatabase = database
        resolve(database)
      }
      request.onerror = () => fail(request.error ?? new Error('Failed to open the SQLite IndexedDB database.'))
      request.onblocked = () => fail(new Error('Opening the SQLite IndexedDB database was blocked.'))
    })
    state.databasePromise = opening
    void opening.catch(() => {
      if (state.databasePromise === opening) {
        state.databasePromise = undefined
      }
    })
    return opening
  }

  function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
    // Start opening synchronously so callers can observe and cancel a host request
    // before the serialized operation reaches the queue.
    const pendingDatabase = openDatabase()
    return enqueue(async () => {
      let database = await pendingDatabase
      let transaction: IDBTransaction
      try {
        transaction = database.transaction(storeName, mode)
      }
      catch (error) {
        if (!(error instanceof Error) || error.name !== 'InvalidStateError') {
          throw error
        }
        // The host may close a resolved connection before this operation resumes.
        if (state.activeDatabase === database) {
          state.activeDatabase = undefined
          state.databasePromise = undefined
        }
        database = await openDatabase()
        transaction = database.transaction(storeName, mode)
      }
      const completion = transactionComplete(transaction)
      let result: T | Promise<T>
      try {
        result = operation(transaction.objectStore(storeName))
      }
      catch (error) {
        transaction.abort()
        await completion.catch(() => undefined)
        throw error
      }
      const [requestResult, transactionResult] = await Promise.allSettled([result, completion])
      if (requestResult.status === 'rejected') {
        throw requestResult.reason
      }
      if (transactionResult.status === 'rejected') {
        throw transactionResult.reason
      }
      return requestResult.value
    })
  }

  return {
    async load(name) {
      const value = await transact('readonly', store => requestResult(store.get(name)))
      return normalizeStoredBytes(value)
    },
    async save(name, data) {
      const bytes = Uint8Array.from(data)
      await transact('readwrite', (store) => {
        store.put(bytes, name)
      })
    },
    async remove(name) {
      await transact('readwrite', (store) => {
        store.delete(name)
      })
    },
  }
}
