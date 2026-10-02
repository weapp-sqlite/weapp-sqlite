import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb'
import { createIndexedDbSqliteWasmStorage } from '@/index'

function openDatabase(indexedDB: IDBFactory, name: string, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('databases')) {
        request.result.createObjectStore('databases')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Unexpected blocked open'))
  })
}

function deleteDatabase(indexedDB: IDBFactory, name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Unexpected blocked deletion'))
  })
}

function pendingOpenRequest() {
  const request = {} as IDBOpenDBRequest
  return {
    request,
    succeed(database: IDBDatabase) {
      Object.defineProperty(request, 'result', { configurable: true, value: database })
      request.onsuccess?.(new Event('success'))
    },
    fail(error: DOMException) {
      Object.defineProperty(request, 'error', { configurable: true, value: error })
      request.onerror?.(new Event('error'))
    },
    block() {
      request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
    },
  }
}

describe('IndexedDB connection lifecycle', () => {
  it('shares the connection and operation queue across storage instances', async () => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const first = createIndexedDbSqliteWasmStorage({ indexedDB })
    const second = createIndexedDbSqliteWasmStorage({ indexedDB })

    await Promise.all([
      first.save('shared', Uint8Array.of(1)),
      second.save('shared', Uint8Array.of(2)),
    ])

    expect(open).toHaveBeenCalledOnce()
    await expect(first.load('shared')).resolves.toEqual(Uint8Array.of(2))
  })

  it('opens lazily and shares the pending connection between concurrent operations', async () => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    expect(open).not.toHaveBeenCalled()
    await Promise.all([storage.load('first'), storage.load('second')])
    expect(open).toHaveBeenCalledOnce()
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('releases connections for upgrades and deletion, then reopens the current version', async () => {
    const indexedDB = new IDBFactory()
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    await storage.save('demo', Uint8Array.of(1, 2, 3))
    const upgraded = await openDatabase(indexedDB, 'weapp-sqlite', 2)
    upgraded.close()
    await expect(storage.load('demo')).resolves.toEqual(Uint8Array.of(1, 2, 3))
    await deleteDatabase(indexedDB, 'weapp-sqlite')
    await expect(storage.load('demo')).resolves.toBeUndefined()
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('lets an active transaction finish before releasing a versionchanged connection', async () => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    await storage.load('demo')
    const database = open.mock.results[0]!.value.result
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((...args) => {
      const active = transaction(...args)
      queueMicrotask(() => database.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent))
      return active
    })
    await expect(storage.save('demo', Uint8Array.of(4))).resolves.toBeUndefined()
    await expect(storage.load('demo')).resolves.toEqual(Uint8Array.of(4))
    expect(open).toHaveBeenCalledTimes(2)
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('reopens after an unexpected host connection close', async () => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    await storage.save('demo', Uint8Array.of(5))
    const database = open.mock.results[0]!.value.result
    const closed = new Promise<void>(resolve => database.addEventListener('close', () => resolve(), { once: true }))
    forceCloseDatabase(database)
    await closed
    await expect(storage.load('demo')).resolves.toEqual(Uint8Array.of(5))
    expect(open).toHaveBeenCalledTimes(2)
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('retries when a versionchange closes a connection before an operation starts its transaction', async () => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    await storage.save('demo', Uint8Array.of(5))
    const database = open.mock.results[0]!.value.result
    const loading = storage.load('demo')
    database.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent)
    await expect(loading).resolves.toEqual(Uint8Array.of(5))
    expect(open).toHaveBeenCalledTimes(2)
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('retries an opening failure without retaining a rejected connection promise', async () => {
    const indexedDB = new IDBFactory()
    const pending = pendingOpenRequest()
    const open = vi.spyOn(indexedDB, 'open').mockReturnValueOnce(pending.request)
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    const loading = storage.load('demo')
    const failure = new DOMException('Temporarily unavailable', 'UnknownError')
    pending.fail(failure)
    await expect(loading).rejects.toBe(failure)
    await expect(storage.save('demo', Uint8Array.of(6))).resolves.toBeUndefined()
    expect(open).toHaveBeenCalledTimes(2)
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })

  it('closes late successful connections from abandoned requests without clearing a newer connection', async () => {
    const indexedDB = new IDBFactory()
    const lateDatabase = await openDatabase(indexedDB, 'late')
    const close = vi.spyOn(lateDatabase, 'close')
    const pending = pendingOpenRequest()
    const open = vi.spyOn(indexedDB, 'open').mockReturnValueOnce(pending.request)
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    const loading = storage.load('demo')
    pending.block()
    await expect(loading).rejects.toThrow('blocked')
    await storage.save('demo', Uint8Array.of(7))
    pending.succeed(lateDatabase)
    expect(close).toHaveBeenCalledOnce()
    await expect(storage.load('demo')).resolves.toEqual(Uint8Array.of(7))
    expect(open).toHaveBeenCalledTimes(2)
    await deleteDatabase(indexedDB, 'weapp-sqlite')
    await deleteDatabase(indexedDB, 'late')
  })

  it.each(['load', 'save'] as const)('rejects an aborted %s transaction and permits subsequent operations', async (operation) => {
    const indexedDB = new IDBFactory()
    const open = vi.spyOn(indexedDB, 'open')
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB })
    await storage.save('demo', Uint8Array.of(8))
    const database = open.mock.results[0]!.value.result
    const transaction = database.transaction.bind(database)
    let aborted = false
    vi.spyOn(database, 'transaction').mockImplementationOnce((...args) => {
      const active = transaction(...args)
      active.addEventListener('abort', () => {
        aborted = true
      })
      queueMicrotask(() => active.abort())
      return active
    })
    const result = operation === 'load' ? storage.load('demo') : storage.save('demo', Uint8Array.of(9))
    await expect(result).rejects.toBeDefined()
    expect(aborted).toBe(true)
    await expect(storage.load('demo')).resolves.toEqual(Uint8Array.of(8))
    await deleteDatabase(indexedDB, 'weapp-sqlite')
  })
})
