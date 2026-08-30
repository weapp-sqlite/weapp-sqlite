import { IDBFactory } from 'fake-indexeddb'
import { createIndexedDbSqliteWasmStorage, createWebSqliteDebugFileAdapter, SqliteWebStorageUnavailableError } from '@/index'

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

describe('web debug file delivery', () => {
  it('uses the File System Access API when available', async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const adapter = createWebSqliteDebugFileAdapter({
      scope: { showSaveFilePicker: async () => ({ createWritable: async () => ({ write, close }), getFile: async () => ({ name: 'unused', type: '', arrayBuffer: async () => new ArrayBuffer(0) }) }) },
    })
    await expect(adapter.save({ fileName: 'demo.sqlite', mimeType: 'application/vnd.sqlite3', bytes: new Uint8Array([1, 2]) })).resolves.toEqual({ method: 'file-system-access', fileName: 'demo.sqlite' })
    expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2]))
    expect(close).toHaveBeenCalledOnce()
  })

  it('falls back to a Blob download without reporting an internal path', async () => {
    const click = vi.fn()
    const revokeObjectURL = vi.fn()
    const adapter = createWebSqliteDebugFileAdapter({
      scope: {},
      document: { createElement: (() => ({ download: '', href: '', click, remove: vi.fn() })) as never },
      url: { createObjectURL: () => 'blob:debug', revokeObjectURL },
      Blob,
    })
    await expect(adapter.save({ fileName: 'notes.csv', mimeType: 'text/csv', bytes: new Uint8Array([1]) })).resolves.toEqual({ method: 'download', fileName: 'notes.csv' })
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:debug')
  })
})
