import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import initSqlJs from 'sql.js'
import { createSqliteDebugController, SqliteDebugError } from '@/index'

function createHarness() {
  const files = new Map<string, Uint8Array>()
  const storage = {
    load: async (name: string) => files.get(name),
    save: async (name: string, bytes: Uint8Array) => { files.set(name, Uint8Array.from(bytes)) },
    remove: async (name: string) => { files.delete(name) },
  }
  const openDatabase = () => openSqliteWasmDatabase(
    options => initSqlJs(options?.locateFile ? { locateFile: options.locateFile } : undefined),
    'debug-test',
    {
      storage,
      locateFile: file => new URL(`../../wasm/node_modules/sql.js/dist/${file}`, import.meta.url).pathname,
    },
  )
  return { files, storage, openDatabase }
}

describe('sqlite debug controller', () => {
  it('previews schema and paginated data while protecting identifiers', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({
      databaseName: 'debug-test',
      openDatabase: harness.openDatabase,
      storage: harness.storage,
      enabled: true,
    })
    await controller.execute('CREATE TABLE "notes" ("id" INTEGER PRIMARY KEY, "body" TEXT)', { }, { allowWrite: true })
    await controller.execute('INSERT INTO "notes" ("body") VALUES (?)', ['one'], { allowWrite: true })
    await controller.execute('INSERT INTO "notes" ("body") VALUES (?)', ['two'], { allowWrite: true })

    await expect(controller.listTables()).resolves.toEqual([{ name: 'notes', type: 'table', sql: expect.stringContaining('CREATE TABLE') }])
    await expect(controller.describeTable('notes')).resolves.toEqual([
      { name: 'id', type: 'INTEGER', notNull: false, primaryKey: true, defaultValue: null },
      { name: 'body', type: 'TEXT', notNull: false, primaryKey: false, defaultValue: null },
    ])
    await expect(controller.readTable('notes', { limit: 1, offset: 1 })).resolves.toMatchObject({
      total: 2,
      rows: [{ id: 2, body: 'two' }],
    })
    await expect(controller.describeTable('notes" OR 1=1 --')).resolves.toEqual([])
  })

  it('enforces read and write SQL contracts and result limits', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true, limits: { maxRows: 1 } })
    await expect(controller.query('DELETE FROM notes')).rejects.toMatchObject({ code: 'SQLITE_DEBUG_READ_ONLY_SQL' })
    await expect(controller.query('PRAGMA journal_mode')).rejects.toMatchObject({ code: 'SQLITE_DEBUG_READ_ONLY_SQL' })
    await expect(controller.query('PRAGMA table_info("notes")')).resolves.toMatchObject({ rows: [] })
    await expect(controller.query('SELECT \';\' AS value; -- trailing comment')).resolves.toMatchObject({ rows: [{ value: ';' }] })
    await expect(controller.execute('CREATE TABLE notes (id INTEGER)', undefined)).rejects.toMatchObject({ code: 'SQLITE_DEBUG_WRITE_CONFIRMATION_REQUIRED' })
    await expect(controller.execute('ATTACH DATABASE ? AS other', ['x'], { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_FORBIDDEN_SQL' })
    await expect(controller.execute('PRAGMA main.writable_schema = 1', undefined, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_FORBIDDEN_SQL' })
    await expect(controller.execute('VACUUM main INTO ?', ['copy.sqlite'], { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_FORBIDDEN_SQL' })
    await controller.execute('CREATE TABLE notes (id INTEGER)', undefined, { allowWrite: true })
    await controller.execute('INSERT INTO notes VALUES (1)', undefined, { allowWrite: true })
    await controller.execute('INSERT INTO notes VALUES (2)', undefined, { allowWrite: true })
    await expect(controller.query('SELECT * FROM notes')).rejects.toMatchObject({ code: 'SQLITE_DEBUG_RESULT_LIMIT_EXCEEDED' })
  })

  it('flushes and exports metadata, then imports a replacement snapshot', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({
      databaseName: 'debug-test',
      openDatabase: harness.openDatabase,
      storage: harness.storage,
      enabled: true,
      runtime: { platform: 'web', system: 'test' },
    })
    await controller.execute('CREATE TABLE notes (body TEXT)', undefined, { allowWrite: true })
    await controller.execute('INSERT INTO notes VALUES (?)', ['before'], { allowWrite: true })
    const exported = await controller.exportDatabase()
    expect(exported.metadata.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(exported.metadata.runtime.platform).toBe('web')
    const crypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    try {
      await expect(controller.exportDatabase()).resolves.toMatchObject({ metadata: { sha256: exported.metadata.sha256 } })
    }
    finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto })
    }

    const replacementHarness = createHarness()
    const replacement = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: replacementHarness.openDatabase, storage: replacementHarness.storage, enabled: true })
    await replacement.execute('CREATE TABLE replacement (value TEXT)', undefined, { allowWrite: true })
    await replacement.execute('INSERT INTO replacement VALUES (?)', ['after'], { allowWrite: true })
    const replacementSnapshot = await replacement.exportDatabase()
    await controller.importDatabase(replacementSnapshot.bytes, { replace: true })
    await expect(controller.query('SELECT value FROM replacement')).resolves.toMatchObject({ rows: [{ value: 'after' }] })
    await controller.resetDatabase()
    await expect(controller.listTables()).resolves.toEqual([])
  })

  it('rejects invalid imports and disabled controllers with structured errors', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true })
    await expect(controller.importDatabase(new Uint8Array([1, 2, 3]), { replace: true })).rejects.toBeInstanceOf(SqliteDebugError)
    const defaultDisabled = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage })
    await expect(defaultDisabled.listTables()).rejects.toMatchObject({ code: 'SQLITE_DEBUG_DISABLED' })
    const disabled = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: false })
    await expect(disabled.listTables()).rejects.toMatchObject({ code: 'SQLITE_DEBUG_DISABLED' })
  })

  it('restores the previous snapshot when a replacement fails validation', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true })
    await controller.execute('CREATE TABLE notes (body TEXT)', undefined, { allowWrite: true })
    await controller.execute('INSERT INTO notes VALUES (?)', ['preserved'], { allowWrite: true })
    await controller.exportDatabase()
    const corrupt = new Uint8Array(512)
    corrupt.set(new TextEncoder().encode('SQLite format 3\0'))

    await expect(controller.importDatabase(corrupt, { replace: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_IMPORT_FAILED' })
    await expect(controller.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'preserved' }] })
  })
})
