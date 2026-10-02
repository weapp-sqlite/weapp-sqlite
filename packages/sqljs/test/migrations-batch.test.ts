import type { SqliteMigration } from '@weapp-sqlite/core'
import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import path from 'node:path'
import { execMany, getMigrationStatus, migrate } from '@weapp-sqlite/core'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import { initSqlJsFull } from '@/full'
import { initSqlJsLite } from '@/lite'

function createStorage(initializer: SqlJsInitializer, wasmPath: string) {
  const files = new Map<string, Uint8Array>()
  let saves = 0
  const storage = {
    load: async (name: string) => files.get(name),
    async save(name: string, data: Uint8Array) {
      saves += 1
      files.set(name, data.slice())
    },
  }
  return {
    files,
    get saves() { return saves },
    open: () => openSqliteWasmDatabase(initializer, 'batch.sqlite', { storage, locateFile: () => wasmPath }),
  }
}

describe.each([
  ['full', initSqlJsFull, path.resolve(import.meta.dirname, '../src/vendor/sql-wasm.wasm')],
  ['lite', initSqlJsLite, path.resolve(import.meta.dirname, '../src/vendor/sql-wasm-lite.wasm')],
] as const)('%s migration and batch integration', (_variant, initializer, wasmPath) => {
  it('persists an atomic batch once and reuses an existing transaction', async () => {
    const storage = createStorage(initializer, wasmPath)
    const database = await storage.open()
    await database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    const savesBefore = storage.saves
    expect(await execMany(database, 'INSERT INTO items VALUES (?, ?)', [[1, 'first'], [2, 'second']] as const)).toEqual([
      { changes: 1, lastInsertRowid: 1 },
      { changes: 1, lastInsertRowid: 2 },
    ])
    expect(storage.saves).toBe(savesBefore + 1)
    await database.transaction(async (transaction) => {
      await execMany(transaction, 'INSERT INTO items VALUES ($id, $value)', [{ $id: 3, $value: 'third' }])
      await transaction.exec('UPDATE items SET value = ? WHERE id = ?', ['updated', 1])
    })
    expect(storage.saves).toBe(savesBefore + 2)
    await database.close()

    const reopened = await storage.open()
    expect((await reopened.query('SELECT id, value FROM items ORDER BY id')).rows).toEqual([
      { id: 1, value: 'updated' },
      { id: 2, value: 'second' },
      { id: 3, value: 'third' },
    ])
    await reopened.close()
  })

  it('rolls back earlier rows on a middle constraint failure and skips later rows', async () => {
    const storage = createStorage(initializer, wasmPath)
    const database = await storage.open()
    await database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)')
    await database.exec('INSERT INTO items VALUES (1)')
    await expect(execMany(database, 'INSERT INTO items VALUES (?)', [[2], [1], [3]])).rejects.toThrow('UNIQUE constraint failed')
    expect((await database.query('SELECT id FROM items ORDER BY id')).rows).toEqual([{ id: 1 }])
    await database.close()
    const reopened = await storage.open()
    expect((await reopened.query('SELECT id FROM items ORDER BY id')).rows).toEqual([{ id: 1 }])
    await reopened.close()
  })

  it('diagnoses without creating history, serializes migrations, and detects drift before any new up', async () => {
    const storage = createStorage(initializer, wasmPath)
    const database = await storage.open()
    const runs: number[] = []
    const migrations: readonly SqliteMigration[] = [
      {
        version: 2,
        name: 'seed',
        async up(transaction) {
          runs.push(2)
          await execMany(transaction, 'INSERT INTO items VALUES (?)', [[1], [2]])
        },
      },
      {
        version: 1,
        name: 'create',
        async up(transaction) {
          runs.push(1)
          await transaction.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)')
        },
      },
    ]
    expect(await getMigrationStatus(database, migrations)).toEqual({
      tablePresent: false,
      applied: [],
      pending: [{ version: 1, name: 'create' }, { version: 2, name: 'seed' }],
      unknown: [],
      conflicts: [],
    })
    expect(storage.saves).toBe(0)
    const [first, second, status] = await Promise.all([
      migrate(database, migrations),
      migrate(database, migrations),
      getMigrationStatus(database, migrations),
    ])
    expect(first).toEqual([1, 2])
    expect(second).toEqual([1, 2])
    expect(runs).toEqual([1, 2])
    expect(status.pending).toEqual([])
    expect(status.applied).toEqual([
      { version: 1, name: 'create', appliedAt: expect.any(String) },
      { version: 2, name: 'seed', appliedAt: expect.any(String) },
    ])

    let newMigrationRan = false
    const changed: SqliteMigration[] = [
      { version: 3, name: 'new', async up() { newMigrationRan = true } },
      { ...migrations[1]!, name: 'renamed' },
    ]
    expect(await getMigrationStatus(database, changed)).toMatchObject({
      pending: [{ version: 3, name: 'new' }],
      unknown: [{ version: 2, name: 'seed' }],
      conflicts: [{ version: 1, appliedName: 'create', expectedName: 'renamed' }],
    })
    await expect(migrate(database, changed)).rejects.toThrow('Migration version 1 was applied as "create", but is declared as "renamed".')
    expect(newMigrationRan).toBe(false)
    await database.close()

    const reopened = await storage.open()
    expect(await migrate(reopened, migrations)).toEqual([1, 2])
    expect(runs).toEqual([1, 2])
    expect((await reopened.query('SELECT id FROM items ORDER BY id')).rows).toEqual([{ id: 1 }, { id: 2 }])
    await reopened.close()
  })

  it('preserves earlier committed migrations and retries a rolled-back migration', async () => {
    const storage = createStorage(initializer, wasmPath)
    const database = await storage.open()
    let fail = true
    const migrations: SqliteMigration[] = [
      { version: 1, name: 'create', async up(transaction) { await transaction.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)') } },
      {
        version: 2,
        name: 'seed',
        async up(transaction) {
          await execMany(transaction, 'INSERT INTO items VALUES (?)', [[1], [2]])
          if (fail) {
            throw new Error('migration interrupted')
          }
        },
      },
    ]
    await expect(migrate(database, migrations)).rejects.toThrow('migration interrupted')
    expect((await database.query('SELECT id FROM items')).rows).toEqual([])
    expect(await getMigrationStatus(database, migrations)).toMatchObject({
      applied: [{ version: 1, name: 'create' }],
      pending: [{ version: 2, name: 'seed' }],
    })
    fail = false
    expect(await migrate(database, migrations)).toEqual([1, 2])
    expect((await database.query('SELECT id FROM items ORDER BY id')).rows).toEqual([{ id: 1 }, { id: 2 }])
    await database.close()
  })
})
