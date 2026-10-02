import type { SqliteDatabase, SqliteParameters, SqliteRow } from '@weapp-sqlite/core'
import { createSqliteDatabase, migrate } from '@weapp-sqlite/core'
import initSqlJs from '@weapp-sqlite/sqljs/full'
import { resolveSqliteWasmAsset } from '@weapp-sqlite/sqljs/node'
import { createSqliteWasmDriver } from '@weapp-sqlite/wasm'
import { createSqliteDebugController } from '@/index'

function createHarness() {
  const files = new Map<string, Uint8Array>()
  const statements: string[] = []
  const storage = {
    load: async (name: string) => files.get(name),
    save: async (name: string, bytes: Uint8Array) => { files.set(name, Uint8Array.from(bytes)) },
    remove: async (name: string) => { files.delete(name) },
  }
  const driver = createSqliteWasmDriver(
    options => initSqlJs(options?.locateFile ? { locateFile: options.locateFile } : undefined),
    {
      storage,
      locateFile: () => resolveSqliteWasmAsset('full', 'miniprogram'),
    },
  )
  let current: SqliteDatabase
  const controller = createSqliteDebugController({
    databaseName: 'reliability',
    enabled: true,
    storage,
    async openDatabase() {
      const connection = await driver.open('reliability')
      current = createSqliteDatabase('reliability', {
        ...connection,
        exec(sql, parameters) {
          statements.push(sql)
          return connection.exec(sql, parameters)
        },
        query<Row extends SqliteRow>(sql: string, parameters?: SqliteParameters) {
          statements.push(sql)
          return connection.query<Row>(sql, parameters)
        },
      })
      return current
    },
  })
  return { controller, statements, database: () => current }
}

describe('debug row identity and atomic writes', () => {
  it('keeps generated hidden columns out of the visible page and rowid locator', async () => {
    const { controller } = createHarness()
    try {
      await controller.execute(
        'CREATE TABLE notes (body TEXT, __weapp_sqlite_rowid TEXT GENERATED ALWAYS AS (body || \'-generated\') STORED)',
        undefined,
        { allowWrite: true },
      )
      await controller.insertRow('notes', { body: 'first' }, { allowWrite: true })

      const page = await controller.readTable('notes')
      expect(page.columns).toEqual(['body'])
      expect(page.rows).toEqual([{ body: 'first' }])
      expect(page.rowLocators).toEqual([{ kind: 'rowid', value: 1 }])

      await controller.updateRow('notes', page.rowLocators[0]!, { body: 'changed' }, { allowWrite: true })
      await expect(controller.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'changed' }] })
    }
    finally {
      await controller.close()
    }
  })

  it.each([
    { name: 'nullable text key', definition: 'id TEXT PRIMARY KEY', keys: ['id'] },
    { name: 'nullable composite key', definition: 'a TEXT, b TEXT, PRIMARY KEY (a, b)', keys: ['a', 'b'] },
    { name: 'descending integer key', definition: 'id INTEGER PRIMARY KEY DESC', keys: ['id'] },
  ])('uses distinct rowids for a $name', async ({ definition, keys }) => {
    const { controller } = createHarness()
    try {
      await controller.execute(`CREATE TABLE notes (body TEXT, ${definition})`, undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes (body) VALUES (?), (?)', ['first', 'second'], { allowWrite: true })
      const page = await controller.readTable('notes')
      expect(page.rowLocators).toEqual([{ kind: 'rowid', value: 1 }, { kind: 'rowid', value: 2 }])
      await controller.updateRow('notes', page.rowLocators[0]!, { body: 'changed' }, { allowWrite: true })
      const undo = controller.getUndoState()
      await expect(controller.updateRow('notes', {
        kind: 'primary-key',
        values: Object.fromEntries(keys.map(key => [key, null])),
      }, { body: 'unsafe' }, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_ROW_CONFLICT' })
      expect(controller.getUndoState()).toEqual(undo)
      expect((await controller.readTable('notes')).rows.map(row => row['body'])).toEqual(['changed', 'second'])
      await controller.deleteRows('notes', [page.rowLocators[1]!], { allowWrite: true, confirmTable: 'notes' })
      expect((await controller.readTable('notes')).rows.map(row => row['body'])).toEqual(['changed'])
    }
    finally {
      await controller.close()
    }
  })

  it.each([
    { name: 'integer rowid alias', definition: 'id INTEGER PRIMARY KEY', suffix: '', key: 1 },
    { name: 'non-null text key', definition: 'id TEXT NOT NULL PRIMARY KEY', suffix: '', key: 'one' },
    { name: 'strict text key', definition: 'id TEXT PRIMARY KEY', suffix: ' STRICT', key: 'one' },
    { name: 'without-rowid text key', definition: 'id TEXT PRIMARY KEY', suffix: ' WITHOUT ROWID', key: 'one' },
  ])('keeps a primary-key locator for a $name', async ({ definition, suffix, key }) => {
    const { controller } = createHarness()
    try {
      await controller.execute(`CREATE TABLE notes (${definition}, body TEXT)${suffix}`, undefined, { allowWrite: true })
      await controller.insertRow('notes', { id: key, body: 'before' }, { allowWrite: true })
      const page = await controller.readTable('notes')
      expect(page.rowLocators).toEqual([{ kind: 'primary-key', values: { id: key } }])
      await controller.updateRow('notes', page.rowLocators[0]!, { body: 'after' }, { allowWrite: true })
      expect((await controller.readTable('notes')).rows).toEqual([{ id: key, body: 'after' }])
    }
    finally {
      await controller.close()
    }
  })

  it.each([
    { name: 'rowid', columns: 'ROWID TEXT DEFAULT \'shadow\',' },
    { name: 'rowid and _rowid_', columns: 'ROWID TEXT DEFAULT \'shadow\', _ROWID_ TEXT DEFAULT \'shadow\',' },
    { name: 'generated rowid', columns: 'ROWID TEXT GENERATED ALWAYS AS (\'shadow\') STORED,' },
  ])('uses an accessible hidden alias when $name is shadowed', async ({ columns }) => {
    const { controller } = createHarness()
    try {
      await controller.execute(`CREATE TABLE notes (${columns} body TEXT)`, undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes (body) VALUES (?), (?)', ['first', 'second'], { allowWrite: true })
      const page = await controller.readTable('notes')
      expect(page.rowLocators).toEqual([{ kind: 'rowid', value: 1 }, { kind: 'rowid', value: 2 }])
      await controller.updateRow('notes', page.rowLocators[1]!, { body: 'changed' }, { allowWrite: true })
      await controller.deleteRows('notes', [page.rowLocators[0]!], { allowWrite: true, confirmTable: 'notes' })
      expect((await controller.readTable('notes')).rows.map(row => row['body'])).toEqual(['changed'])
    }
    finally {
      await controller.close()
    }
  })

  it.each([
    { name: 'absent', key: '', writable: false },
    { name: 'nullable', key: 'id TEXT PRIMARY KEY,', writable: false },
    { name: 'non-null', key: 'id TEXT NOT NULL PRIMARY KEY DEFAULT \'one\',', writable: true },
    { name: 'integer rowid alias', key: 'id INTEGER PRIMARY KEY,', writable: true },
  ])('handles all rowid aliases being shadowed with an $name key', async ({ key, writable }) => {
    const { controller } = createHarness()
    try {
      await controller.execute(`CREATE TABLE notes (ROWID TEXT, _ROWID_ TEXT, OID TEXT, ${key} body TEXT)`, undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes (body) VALUES (?)', ['before'], { allowWrite: true })
      expect(await controller.getTableCapabilities('notes')).toMatchObject({ writable, locator: writable ? 'primary-key' : 'none' })
      const page = await controller.readTable('notes')
      if (writable) {
        await controller.updateRow('notes', page.rowLocators[0]!, { body: 'after' }, { allowWrite: true })
        expect((await controller.readTable('notes')).rows[0]?.['body']).toBe('after')
      }
      else {
        expect(page.rowLocators).toEqual([])
        await expect(controller.updateRow('notes', { kind: 'rowid', value: 1 }, { body: 'unsafe' }, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_OBJECT_READ_ONLY' })
        expect((await controller.readTable('notes')).rows[0]?.['body']).toBe('before')
      }
    }
    finally {
      await controller.close()
    }
  })

  it('uses metadata for WITHOUT ROWID and preserves composite-key order', async () => {
    const { controller } = createHarness()
    try {
      await controller.execute('CREATE TABLE quoted (body TEXT DEFAULT \'WITHOUT ROWID\')', undefined, { allowWrite: true })
      expect(await controller.getTableCapabilities('quoted')).toMatchObject({ writable: true, locator: 'rowid' })
      await controller.execute('CREATE TABLE notes (a TEXT, b INTEGER, body TEXT, PRIMARY KEY (b, a)) WITHOUT ROWID', undefined, { allowWrite: true })
      await controller.insertRow('notes', { a: 'one', b: 1, body: 'before' }, { allowWrite: true })
      expect(await controller.getTableCapabilities('notes')).toMatchObject({ locator: 'primary-key', primaryKey: ['b', 'a'] })
      const page = await controller.readTable('notes')
      await expect(controller.updateRow('notes', { kind: 'rowid', value: 1 }, { body: 'unsafe' }, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_ROW_CONFLICT' })
      await controller.updateRow('notes', page.rowLocators[0]!, { body: 'after' }, { allowWrite: true })
      expect((await controller.readTable('notes')).rows).toEqual([{ a: 'one', b: 1, body: 'after' }])
    }
    finally {
      await controller.close()
    }
  })

  it('rolls back a multi-row update conflict and preserves the previous undo snapshot', async () => {
    const { controller, statements } = createHarness()
    try {
      // The key index is case-sensitive, while an ordinary column comparison is not.
      await controller.execute('CREATE TABLE notes (id TEXT COLLATE NOCASE NOT NULL, body TEXT, PRIMARY KEY (id COLLATE BINARY))', undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes VALUES (?, ?), (?, ?)', ['a', 'first', 'A', 'second'], { allowWrite: true })
      const page = await controller.readTable('notes')
      const undo = controller.getUndoState()
      statements.length = 0
      await expect(controller.updateRow('notes', page.rowLocators[0]!, { body: 'unsafe' }, { allowWrite: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_ROW_CONFLICT' })
      expect(statements[0]).toBe('BEGIN')
      expect(statements.at(-1)).toBe('ROLLBACK')
      expect(statements.some(statement => statement.startsWith('PRAGMA main.table_xinfo'))).toBe(true)
      expect((await controller.readTable('notes')).rows).toEqual(page.rows)
      expect(controller.getUndoState()).toEqual(undo)
      await controller.undoLastDestructiveChange()
      expect((await controller.readTable('notes')).rows).toEqual([])
    }
    finally {
      await controller.close()
    }
  })

  it('rolls back earlier deletions when a later locator conflicts', async () => {
    const { controller, statements } = createHarness()
    try {
      await controller.execute('CREATE TABLE notes (body TEXT)', undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes VALUES (?), (?)', ['first', 'second'], { allowWrite: true })
      const page = await controller.readTable('notes')
      const undo = controller.getUndoState()
      statements.length = 0
      await expect(controller.deleteRows('notes', [page.rowLocators[0]!, page.rowLocators[0]!], { allowWrite: true, confirmTable: 'notes' })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_ROW_CONFLICT' })
      expect(statements[0]).toBe('BEGIN')
      expect(statements.at(-1)).toBe('ROLLBACK')
      expect(statements.some(statement => statement.startsWith('PRAGMA main.table_xinfo'))).toBe(true)
      expect((await controller.readTable('notes')).rows).toEqual(page.rows)
      expect(controller.getUndoState()).toEqual(undo)
    }
    finally {
      await controller.close()
    }
  })

  it('rejects undo after an external write changes the snapshot at the same debug revision', async () => {
    const { controller, database } = createHarness()
    try {
      await controller.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)', undefined, { allowWrite: true })
      await controller.insertRow('notes', { id: 1, body: 'before' }, { allowWrite: true })
      const page = await controller.readTable('notes')
      await controller.updateRow('notes', page.rowLocators[0]!, { body: 'debug-write' }, { allowWrite: true })
      expect(controller.getUndoState()).toMatchObject({ available: true })

      await database().exec('UPDATE notes SET body = ? WHERE id = ?', ['external-write', 1])

      await expect(controller.undoLastDestructiveChange()).rejects.toMatchObject({ code: 'SQLITE_DEBUG_UNDO_STALE' })
      expect((await controller.readTable('notes')).rows).toEqual([{ id: 1, body: 'external-write' }])
      expect(controller.getUndoState()).toEqual({ available: false })
    }
    finally {
      await controller.close()
    }
  })
})

describe('debug core helper integration', () => {
  it('imports batches inside one transaction and rolls back partial failures', async () => {
    const { controller, statements } = createHarness()
    try {
      await controller.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)', undefined, { allowWrite: true })
      statements.length = 0
      await expect(controller.importTable({ format: 'csv', bytes: 'id,body\n1,first\n2,second' }, {
        tableName: 'notes',
        mode: 'append',
        allowWrite: true,
      })).resolves.toMatchObject({ insertedRows: 2 })
      expect(statements.filter(statement => statement === 'BEGIN')).toHaveLength(1)
      expect(statements.filter(statement => statement === 'COMMIT')).toHaveLength(1)
      const page = await controller.readTable('notes')
      const undo = controller.getUndoState()
      await expect(controller.importTable({ format: 'csv', bytes: 'id,body\n3,third\n1,duplicate' }, {
        tableName: 'notes',
        mode: 'append',
        allowWrite: true,
      })).rejects.toThrow()
      expect((await controller.readTable('notes')).rows).toEqual(page.rows)
      expect(controller.getUndoState()).toEqual(undo)
    }
    finally {
      await controller.close()
    }
  })

  it('preserves migration diagnostics and snapshot metadata without creating history on reads', async () => {
    const { controller, database, statements } = createHarness()
    try {
      expect(await controller.getMigrationStatus()).toEqual({ tablePresent: false, versions: [] })
      expect(statements.every(statement => statement.startsWith('SELECT'))).toBe(true)
      expect((await controller.query('SELECT name FROM sqlite_schema')).rows).toEqual([])
      await migrate(database(), [
        { version: 2, name: 'add_tags', up: async (transaction) => { await transaction.exec('CREATE TABLE tags (body TEXT)') } },
        { version: 1, name: 'add_notes', up: async (transaction) => { await transaction.exec('CREATE TABLE notes (body TEXT)') } },
      ])
      expect(await controller.getMigrationStatus()).toEqual({
        tablePresent: true,
        versions: [
          { version: 1, name: 'add_notes', appliedAt: expect.any(String) },
          { version: 2, name: 'add_tags', appliedAt: expect.any(String) },
        ],
      })
      expect((await controller.exportDatabase()).metadata.migrationVersions).toEqual([1, 2])
    }
    finally {
      await controller.close()
    }
  })
})
