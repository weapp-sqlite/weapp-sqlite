import type { SqliteWasmDriverOptions, SqliteWasmStorage } from '@weapp-sqlite/wasm'
import { migrate } from '@weapp-sqlite/core'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import initSqlJs from 'sql.js'

export interface StringStorageAdapter {
  load: (name: string) => Promise<string | undefined>
  save: (name: string, value: string) => Promise<void>
}

export interface DemoSqliteOptions {
  readonly storage?: SqliteWasmStorage
  readonly locateFile?: (file: string) => string
}

export interface DemoSqliteResult {
  readonly migrationVersions: readonly number[]
  readonly rows: readonly { id: number, body: string }[]
}

const memoryFiles = new Map<string, string>()

function encode(data: Uint8Array) {
  let value = ''
  for (const byte of data) {
    value += String.fromCharCode(byte)
  }
  return btoa(value)
}

function decode(value: string) {
  const binary = atob(value)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index)
  }
  return data
}

export function createStringStorage(adapter: StringStorageAdapter): SqliteWasmStorage {
  return {
    async load(name) {
      const value = await adapter.load(name)
      return value ? decode(value) : undefined
    },
    async save(name, data) {
      await adapter.save(name, encode(data))
    },
  }
}

export function createMemoryStorage(): SqliteWasmStorage {
  return createStringStorage({
    load: async name => memoryFiles.get(name),
    save: async (name, value) => {
      memoryFiles.set(name, value)
    },
  })
}

export async function runSqliteDemo(options: DemoSqliteOptions = {}): Promise<DemoSqliteResult> {
  const storage = options.storage ?? createMemoryStorage()
  const driverOptions: SqliteWasmDriverOptions = options.locateFile
    ? { storage, locateFile: options.locateFile }
    : { storage }

  const database = await openSqliteWasmDatabase(
    initSqlJs,
    'weapp-sqlite-demo',
    driverOptions,
  )

  try {
    const migrationVersions = await migrate(database, [
      {
        version: 1,
        name: 'create_notes',
        up: async (transaction) => {
          await transaction.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
        },
      },
      {
        version: 2,
        name: 'seed_note',
        up: async (transaction) => {
          await transaction.exec('INSERT INTO notes (body) VALUES (?)', ['SQLite works across frameworks'])
        },
      },
    ])
    const rows = await database.query<{ id: number, body: string }>('SELECT id, body FROM notes ORDER BY id')
    return { migrationVersions, rows: rows.rows }
  }
  finally {
    await database.close()
  }
}
