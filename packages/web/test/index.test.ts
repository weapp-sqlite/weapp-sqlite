import { IDBFactory } from 'fake-indexeddb'
import { createIndexedDbSqliteWasmStorage, SqliteWebStorageUnavailableError } from '@/index'

describe('web IndexedDB storage', () => {
  it('loads, saves, and removes binary databases', async () => {
    const storage = createIndexedDbSqliteWasmStorage({ indexedDB: new IDBFactory() })

    await expect(storage.load('demo')).resolves.toBeUndefined()
    await storage.save('demo', new Uint8Array([1, 2, 3]))
    await expect(storage.load('demo')).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await storage.remove('demo')
    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('isolates custom database names', async () => {
    const indexedDB = new IDBFactory()
    const first = createIndexedDbSqliteWasmStorage({ indexedDB, databaseName: 'first' })
    const second = createIndexedDbSqliteWasmStorage({ indexedDB, databaseName: 'second' })

    await first.save('demo', new Uint8Array([1]))
    await expect(second.load('demo')).resolves.toBeUndefined()
  })

  it('reports unavailable IndexedDB without an in-memory fallback', () => {
    const previous = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    try {
      expect(() => createIndexedDbSqliteWasmStorage()).toThrow(SqliteWebStorageUnavailableError)
    }
    finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: previous })
    }
  })
})
