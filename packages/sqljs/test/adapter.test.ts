import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import { initSqlJsFull } from '@/full'
import { initSqlJsFull as initSqlJsFullBrowser } from '@/full-browser'
import { initSqlJsLite } from '@/lite'

const browserInitializer: SqlJsInitializer = async (options) => {
  const config = { ...options, wasmBinary: await readFile(path.resolve(import.meta.dirname, '../src/vendor/sql-wasm-browser.wasm')) }
  return initSqlJsFullBrowser(config)
}

describe.each([
  ['full', initSqlJsFull, 'sql-wasm.wasm'],
  ['web full', browserInitializer, 'sql-wasm-browser.wasm'],
  ['lite', initSqlJsLite, 'sql-wasm-lite.wasm'],
] as const)('%s persistence adapter', (_variant, initializer, asset) => {
  function createStorage() {
    const files = new Map<string, Uint8Array>()
    const save = vi.fn(async (name: string, bytes: Uint8Array) => {
      files.set(name, bytes)
    })
    const options = {
      locateFile: () => path.resolve(import.meta.dirname, '../src/vendor', asset),
      storage: { load: async (name: string) => files.get(name), save },
    }
    return {
      files,
      save,
      open: (engine: SqlJsInitializer = initializer) => openSqliteWasmDatabase(engine, 'regression', options),
    }
  }

  it('preserves foreign keys and temporary state across automatic and explicit flushes', async () => {
    const storage = createStorage()
    const database = await storage.open()
    await database.exec('PRAGMA foreign_keys = ON')
    await database.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
    await database.exec('CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))')
    await database.exec('CREATE TEMP TABLE transient (value TEXT)')
    await database.exec('INSERT INTO transient VALUES (?)', ['session'])
    await database.flush()
    expect((await database.query('PRAGMA foreign_keys')).rows).toEqual([{ foreign_keys: 1 }])
    expect((await database.query('SELECT value FROM transient')).rows).toEqual([{ value: 'session' }])
    await expect(database.exec('INSERT INTO child VALUES (999)')).rejects.toThrow('FOREIGN KEY constraint failed')
    await database.close()
  })

  it('persists RETURNING writes and metadata-only changes without saving read-only queries', async () => {
    const storage = createStorage()
    const database = await storage.open()
    await database.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID')
    const beforeRead = storage.save.mock.calls.length
    await database.query('SELECT * FROM items')
    await database.exec('SELECT * FROM items')
    await database.transaction(async (transaction) => {
      await transaction.query('SELECT * FROM items')
      await transaction.exec('SELECT * FROM items')
    })
    expect(storage.save).toHaveBeenCalledTimes(beforeRead)
    expect((await database.query('INSERT INTO items VALUES (?, ?) RETURNING id', ['key', 'one'])).rows).toEqual([{ id: 'key' }])
    await database.query('UPDATE items SET value = ? RETURNING value', ['two'])
    await database.query('INSERT INTO items VALUES (\'removed\', \'temporary\') RETURNING id')
    await database.query('DELETE FROM items WHERE id = ? RETURNING id', ['removed'])
    await database.query('PRAGMA user_version = 7')
    await database.query('CREATE TABLE extra (value INTEGER); INSERT INTO extra VALUES (1); SELECT value FROM extra')
    await database.close()

    const reopened = await storage.open()
    expect((await reopened.query('SELECT * FROM items')).rows).toEqual([{ id: 'key', value: 'two' }])
    expect((await reopened.query('PRAGMA user_version')).rows).toEqual([{ user_version: 7 }])
    expect((await reopened.query('SELECT * FROM extra')).rows).toEqual([{ value: 1 }])
    await reopened.close()
  })

  it('retains partial writes after a later statement fails and retries a failed save', async () => {
    const storage = createStorage()
    const database = await storage.open()
    await database.exec('CREATE TABLE items (value TEXT)')
    await expect(database.query('INSERT INTO items VALUES (\'partial\'); SELECT * FROM missing')).rejects.toThrow('no such table')
    await database.flush()
    const cause = new Error('storage unavailable')
    storage.save.mockRejectedValueOnce(cause)
    await expect(database.transaction(async (transaction) => {
      await transaction.query('INSERT INTO items VALUES (?) RETURNING value', ['committed'])
    })).rejects.toMatchObject({ name: 'SqlitePersistenceError', committed: true, cause })
    expect((await database.query('SELECT value FROM items')).rows).toEqual([{ value: 'partial' }, { value: 'committed' }])
    await database.flush()
    await database.close()

    const reopened = await storage.open()
    expect((await reopened.query('SELECT value FROM items')).rows).toEqual([{ value: 'partial' }, { value: 'committed' }])
    await reopened.close()
  })

  it('rejects bigint precision loss before the statement writes anything', async () => {
    const storage = createStorage()
    const database = await storage.open()
    await database.exec('CREATE TABLE numbers (value INTEGER)')
    await expect(database.exec('INSERT INTO numbers VALUES (?)', [9007199254740993n])).rejects.toBeInstanceOf(RangeError)
    await expect(database.exec('INSERT INTO numbers VALUES ($value)', { $value: -9007199254740993n })).rejects.toBeInstanceOf(RangeError)
    await database.exec('INSERT INTO numbers VALUES (?)', [9007199254740991n])
    expect((await database.query('SELECT CAST(value AS TEXT) AS value FROM numbers')).rows).toEqual([{ value: '9007199254740991' }])
    await database.close()
  })
})
