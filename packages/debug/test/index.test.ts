import { fileURLToPath } from 'node:url'
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
      locateFile: file => fileURLToPath(new URL(`../../wasm/node_modules/sql.js/dist/${file}`, import.meta.url)),
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

  it('manages rows with structured filters, ordering, locators, and one-step undo', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true })
    await controller.createTable('notes', [
      { name: 'id', type: 'INTEGER', primaryKey: true },
      { name: 'body', type: 'TEXT', notNull: true },
      { name: 'score', type: 'REAL' },
    ], { allowWrite: true })
    await controller.insertRow('notes', { body: 'alpha', score: 1.5 }, { allowWrite: true })
    await controller.insertRow('notes', { body: 'alphabet', score: 2.5 }, { allowWrite: true })
    await controller.insertRow('notes', { body: 'beta', score: 3.5 }, { allowWrite: true })

    const page = await controller.readTable('notes', {
      filters: [{ column: 'body', operator: 'startsWith', value: 'alph' }],
      orderBy: [{ column: 'score', direction: 'desc' }],
    })
    expect(page.rows.map(row => row['body'])).toEqual(['alphabet', 'alpha'])
    expect(page.rowLocators[0]).toEqual({ kind: 'primary-key', values: { id: 2 } })

    await controller.updateRow('notes', page.rowLocators[0]!, { body: 'changed' }, { allowWrite: true })
    await expect(controller.query('SELECT body FROM notes WHERE id = 2')).resolves.toMatchObject({ rows: [{ body: 'changed' }] })
    await controller.undoLastDestructiveChange()
    await expect(controller.query('SELECT body FROM notes WHERE id = 2')).resolves.toMatchObject({ rows: [{ body: 'alphabet' }] })
    await expect(controller.undoLastDestructiveChange()).rejects.toMatchObject({ code: 'SQLITE_DEBUG_UNDO_UNAVAILABLE' })

    const all = await controller.readTable('notes')
    await expect(controller.deleteRows('notes', [all.rowLocators[0]!], { allowWrite: true, confirmTable: 'wrong' })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_CONFIRMATION_MISMATCH' })
    await controller.deleteRows('notes', [all.rowLocators[0]!], { allowWrite: true, confirmTable: 'notes' })
    await expect(controller.query('SELECT count(*) AS total FROM notes')).resolves.toMatchObject({ rows: [{ total: 2 }] })
  })

  it('manages columns and indexes without rebuilding tables', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true })
    await controller.createTable('items', [{ name: 'id', type: 'INTEGER', primaryKey: true }, { name: 'name', type: 'TEXT' }], { allowWrite: true })
    await controller.addColumn('items', { name: 'category', type: 'TEXT' }, { allowWrite: true })
    await controller.renameColumn('items', 'category', 'group_name', { allowWrite: true, confirmTable: 'items' })
    await controller.createIndex('items', 'items_name_idx', [{ name: 'name', direction: 'asc' }], { allowWrite: true, unique: true })
    await expect(controller.listIndexes('items')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'items_name_idx', unique: true, editable: true }),
    ]))
    await controller.dropIndex('items', 'items_name_idx', { allowWrite: true, confirmTable: 'items' })
    await controller.dropColumn('items', 'group_name', { allowWrite: true, confirmTable: 'items' })
    await expect(controller.describeTable('items')).resolves.toEqual([
      expect.objectContaining({ name: 'id' }),
      expect.objectContaining({ name: 'name' }),
    ])
    await expect(controller.dropTable('__weapp_sqlite_migrations', { allowWrite: true, confirmTable: '__weapp_sqlite_migrations' })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_PROTECTED_OBJECT' })
    await expect(controller.execute('DELETE FROM "__weapp_sqlite_migrations"', undefined, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_PROTECTED_OBJECT' })
  })

  it('exports and transactionally imports CSV and lossless JSON table data', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({ databaseName: 'debug-test', openDatabase: harness.openDatabase, storage: harness.storage, enabled: true })
    await controller.createTable('source', [{ name: 'id', type: 'INTEGER' }, { name: 'text', type: 'TEXT' }, { name: 'payload', type: 'BLOB' }], { allowWrite: true })
    await controller.insertRow('source', { id: 1, text: '', payload: new Uint8Array([1, 2, 3]) }, { allowWrite: true })
    await controller.insertRow('source', { id: 2, text: null, payload: null }, { allowWrite: true })

    const json = await controller.exportTable('source', { format: 'json' })
    const preview = await controller.previewTableImport({ format: 'json', bytes: json.bytes })
    expect(preview.totalRows).toBe(2)
    expect(preview.suggestedColumns).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'payload', inferredType: 'BLOB' })]))
    await controller.importTable({ format: 'json', bytes: json.bytes }, { tableName: 'copy', mode: 'create', allowWrite: true })
    await expect(controller.query('SELECT id, text, length(payload) AS size FROM copy ORDER BY id')).resolves.toMatchObject({
      rows: [{ id: 1, text: '', size: 3 }, { id: 2, text: null, size: null }],
    })

    const csv = await controller.exportTable('source', { format: 'csv' })
    expect(Array.from(csv.bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF])
    expect(new TextDecoder().decode(csv.bytes)).toContain('"id","text","payload"')
    await expect(controller.importTable({ format: 'csv', bytes: '"id"\r\n"not-an-integer"\r\n' }, {
      tableName: 'copy',
      mode: 'replace',
      mappings: [{ source: 'id', target: 'id', type: 'INTEGER' }],
      allowWrite: true,
      confirmTable: 'copy',
    })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_INVALID_MAPPING' })
    await expect(controller.query('SELECT count(*) AS total FROM copy')).resolves.toMatchObject({ rows: [{ total: 2 }] })
  })
})
