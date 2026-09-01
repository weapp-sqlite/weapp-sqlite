import type { SqlJsDatabase, SqlJsInitializer } from '@weapp-sqlite/wasm'
import { createRequire } from 'node:module'
import path from 'node:path'
import { initSqlJsFull } from '@/full'
import { initSqlJsLite } from '@/lite'

const require = createRequire(import.meta.url)
const fullWasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')
const liteWasmPath = path.resolve(import.meta.dirname, '../src/vendor/sql-wasm-lite.wasm')

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

    const exported = database.export()
    database.close()
    const reopened = new SQL.Database(exported)
    expect(reopened.exec('SELECT body FROM notes')[0]?.values).toEqual([['persisted']])
    reopened.close()
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
  const liteDatabase = new lite.Database(fullDatabase.export())
  liteDatabase.run('INSERT INTO shared VALUES (?)', ['from-lite'])
  const reopenedWithFull = new full.Database(liteDatabase.export())
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
