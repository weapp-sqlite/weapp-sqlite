import type { SqlJsDatabase, SqlJsInitializer } from '@weapp-sqlite/wasm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { initSqlJsFull } from '@/full'
import { initSqlJsFull as initSqlJsFullBrowser } from '@/full-browser'
import { initSqlJsLite } from '@/lite'

const fullWasmPath = path.resolve(import.meta.dirname, '../src/vendor/sql-wasm.wasm')
const liteWasmPath = path.resolve(import.meta.dirname, '../src/vendor/sql-wasm-lite.wasm')
const browserWasmPath = path.resolve(import.meta.dirname, '../src/vendor/sql-wasm-browser.wasm')

// Exercise the Web build's actual WASM, using bytes in Node instead of a browser fetch.
const browserInitializer: SqlJsInitializer = async (options) => {
  const config = { ...options, wasmBinary: await readFile(browserWasmPath) }
  return initSqlJsFullBrowser(config)
}

interface SessionDatabase extends SqlJsDatabase {
  create_function: (name: string, callback: (value: number) => number) => void
  updateHook: (callback: (operation: string, database: string, table: string, rowid: number) => void) => void
  prepare: (sql: string) => { step: () => boolean, get: () => unknown[], free: () => void }
}

async function initialize(initializer: SqlJsInitializer, wasmPath: string) {
  return initializer({ locateFile: () => wasmPath })
}

function exerciseDatabase(database: SqlJsDatabase) {
  database.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, payload BLOB)')
  database.run('CREATE INDEX notes_body ON notes(body)')
  database.run('CREATE TABLE audit (body TEXT NOT NULL)')
  database.run('CREATE TRIGGER notes_audit AFTER INSERT ON notes BEGIN INSERT INTO audit VALUES (new.body); END')
  database.run('INSERT INTO notes(body, payload) VALUES (?, ?)', ['persisted', new Uint8Array([1, 2, 255])])
  database.run('BEGIN')
  database.run('INSERT INTO notes(body) VALUES ($body)', { $body: 'rolled-back' })
  database.run('ROLLBACK')
  database.run('ALTER TABLE notes ADD COLUMN rank INTEGER DEFAULT 0')
  return database.exec(`
    WITH selected AS (SELECT body, hex(payload) AS payload, rank FROM notes)
    SELECT body, payload, rank, json_extract('{"enabled":true}', '$.enabled') AS enabled
    FROM selected
  `)[0]
}

describe.each([
  ['full', initSqlJsFull, fullWasmPath],
  ['web full', browserInitializer, browserWasmPath],
  ['lite', initSqlJsLite, liteWasmPath],
] as const)('%s sql.js engine', (_variant, initializer, wasmPath) => {
  it('supports the common database contract', async () => {
    const SQL = await initialize(initializer, wasmPath)
    const database = new SQL.Database()
    expect(exerciseDatabase(database)).toEqual({
      columns: ['body', 'payload', 'rank', 'enabled'],
      values: [['persisted', '0102FF', 0, 1]],
    })
    expect(database.exec('SELECT body FROM audit')[0]?.values).toEqual([['persisted']])

    const exported = database.exportSnapshot()
    database.close()
    const reopened = new SQL.Database(exported)
    expect(reopened.exec('SELECT body FROM notes')[0]?.values).toEqual([['persisted']])
    reopened.close()
  })

  it('copies an empty database and rejects snapshots after close', async () => {
    const SQL = await initialize(initializer, wasmPath)
    const database = new SQL.Database()
    const reopened = new SQL.Database(database.exportSnapshot())
    expect(reopened.exec('SELECT count(*) FROM sqlite_schema')[0]?.values).toEqual([[0]])
    reopened.close()
    database.close()
    expect(() => database.exportSnapshot()).toThrow('Database closed')
  })

  it('preserves the live session and returns independent snapshots', async () => {
    const SQL = await initialize(initializer, wasmPath)
    const database = new SQL.Database() as SessionDatabase
    database.run('PRAGMA foreign_keys = ON')
    database.run('PRAGMA recursive_triggers = ON')
    database.run('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
    database.run('CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))')
    database.run('CREATE TEMP TABLE transient (value TEXT)')
    database.run('INSERT INTO transient VALUES (?)', ['session'])
    database.run('INSERT INTO parent VALUES (7)')
    database.create_function('retained_function', value => value + 1)
    const updates: number[] = []
    database.updateHook((_operation, _database, _table, rowid) => updates.push(rowid))
    const statement = database.prepare('SELECT id FROM parent')

    const snapshot = database.exportSnapshot()
    expect(database.exec('PRAGMA foreign_keys')[0]?.values).toEqual([[1]])
    expect(database.exec('PRAGMA recursive_triggers')[0]?.values).toEqual([[1]])
    expect(database.exec('SELECT last_insert_rowid()')[0]?.values).toEqual([[7]])
    expect(database.exec('SELECT value FROM transient')[0]?.values).toEqual([['session']])
    expect(database.exec('SELECT retained_function(4)')[0]?.values).toEqual([[5]])
    expect(statement.step()).toBe(true)
    expect(statement.get()).toEqual([7])
    statement.free()
    expect(() => database.run('INSERT INTO child VALUES (999)')).toThrow('FOREIGN KEY constraint failed')
    database.run('INSERT INTO parent VALUES (9)')
    expect(updates).toEqual([9])
    database.exportSnapshot()

    const reopened = new SQL.Database(snapshot)
    expect(reopened.exec('SELECT id FROM parent')[0]?.values).toEqual([[7]])
    reopened.close()
    database.close()
  })

  it('reports write metadata while preparing statements in execution order', async () => {
    const SQL = await initialize(initializer, wasmPath)
    const database = new SQL.Database()
    expect(database.execWithMetadata).toBeTypeOf('function')
    expect(database.execWithMetadata!('SELECT ? AS value', [42])).toEqual({
      readOnly: true,
      results: [{ columns: ['value'], values: [[42]] }],
    })
    expect(database.execWithMetadata!(' -- empty statement\n ;')).toEqual({ readOnly: true, results: [] })
    expect(database.execWithMetadata!('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items VALUES (1, \'one\') RETURNING value')).toEqual({
      readOnly: false,
      results: [{ columns: ['value'], values: [['one']] }],
    })
    expect(database.execWithMetadata!('SELECT value FROM items; UPDATE items SET value = $value RETURNING value', { $value: 'two' })).toEqual({
      readOnly: false,
      results: [
        { columns: ['value'], values: [['one']] },
        { columns: ['value'], values: [['two']] },
      ],
    })
    expect(database.execWithMetadata!('PRAGMA user_version = 7').readOnly).toBe(false)
    expect(database.execWithMetadata!('PRAGMA user_version').readOnly).toBe(true)
    expect(database.execWithMetadata!('CREATE TABLE keyed (id TEXT PRIMARY KEY) WITHOUT ROWID; INSERT INTO keyed VALUES (\'key\')').readOnly).toBe(false)
    expect(database.execWithMetadata!('DELETE FROM items RETURNING value').results[0]?.values).toEqual([['two']])
    expect(() => database.execWithMetadata!('INSERT INTO keyed VALUES (\'second\'); SELECT * FROM missing')).toThrow('no such table')
    expect(database.exec('SELECT id FROM keyed ORDER BY id')[0]?.values).toEqual([['key'], ['second']])
    database.close()
  })
})

it('keeps full and lite database files interoperable', async () => {
  const [full, lite] = await Promise.all([
    initialize(initSqlJsFull, fullWasmPath),
    initialize(initSqlJsLite, liteWasmPath),
  ])
  const fullDatabase = new full.Database()
  fullDatabase.run('CREATE TABLE shared (value TEXT)')
  fullDatabase.run('INSERT INTO shared VALUES (?)', ['from-full'])
  const liteDatabase = new lite.Database(fullDatabase.exportSnapshot())
  liteDatabase.run('INSERT INTO shared VALUES (?)', ['from-lite'])
  const reopenedWithFull = new full.Database(liteDatabase.exportSnapshot())
  expect(reopenedWithFull.exec('SELECT value FROM shared ORDER BY rowid')[0]?.values).toEqual([
    ['from-full'],
    ['from-lite'],
  ])
  reopenedWithFull.close()
  liteDatabase.close()
  fullDatabase.close()
})

it('only full exposes FTS3 and contributed extension functions', async () => {
  const [full, lite] = await Promise.all([
    initialize(initSqlJsFull, fullWasmPath),
    initialize(initSqlJsLite, liteWasmPath),
  ])
  const fullDatabase = new full.Database()
  expect(() => fullDatabase.run('CREATE VIRTUAL TABLE search USING fts3(content)')).not.toThrow()
  expect(fullDatabase.exec('SELECT reverse(\'abc\')')[0]?.values).toEqual([['cba']])

  const liteDatabase = new lite.Database()
  expect(() => liteDatabase.run('CREATE VIRTUAL TABLE search USING fts3(content)')).toThrow()
  expect(() => liteDatabase.exec('SELECT reverse(\'abc\')')).toThrow()
  liteDatabase.close()
  fullDatabase.close()
})
