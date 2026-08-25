import initSqlJs from 'sql.js'
import { openSqliteWasmDatabase } from '@/index'

describe('sqlite wasm adapter', () => {
  it('runs SQL and persists the exported database', async () => {
    const files = new Map<string, Uint8Array>()
    const database = await openSqliteWasmDatabase(
      options => initSqlJs(options?.locateFile ? { locateFile: options.locateFile } : undefined),
      'demo',
      {
        storage: {
          async load(name) {
            return files.get(name)
          },
          async save(name, data) {
            files.set(name, data)
          },
        },
        locateFile: file => new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url).pathname,
      },
    )

    await database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    await database.exec('INSERT INTO items (name) VALUES (?)', ['one'])
    expect(await database.query<{ id: number, name: string }>('SELECT id, name FROM items')).toEqual({
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'one' }],
    })
    await database.close()
    expect(files.get('demo')?.byteLength).toBeGreaterThan(0)

    const reopened = await openSqliteWasmDatabase(
      options => initSqlJs(options?.locateFile ? { locateFile: options.locateFile } : undefined),
      'demo',
      {
        storage: {
          load: async name => files.get(name),
          save: async (name, data) => {
            files.set(name, data)
          },
        },
        locateFile: file => new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url).pathname,
      },
    )
    await expect(reopened.query<{ name: string }>('SELECT name FROM items')).resolves.toEqual({
      columns: ['name'],
      rows: [{ name: 'one' }],
    })
    await reopened.close()
  })
})
