import type { SqliteMigration } from '@weapp-sqlite/core'
import type { SqliteWasmDriverOptions, SqliteWasmStorage, SqlJsInitializer } from '@weapp-sqlite/wasm'
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

export interface AcceptanceSqliteStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
}

export interface SqliteAcceptanceOptions {
  readonly storage: AcceptanceSqliteStorage
  readonly initializer?: SqlJsInitializer
  readonly databaseName?: string
  readonly locateFile?: (file: string) => string
}

export interface SqliteAcceptanceCheck {
  readonly id: string
  readonly passed: boolean
  readonly detail: string
}

export interface SqliteAcceptanceResult {
  readonly schemaVersion: 1
  readonly passed: boolean
  readonly migrationVersions: readonly number[]
  readonly checks: readonly SqliteAcceptanceCheck[]
  readonly rows: readonly { id: number, body: string }[]
}

const ACCEPTANCE_DATABASE_NAME = 'weapp-sqlite-acceptance'
const COMMITTED_BODY = 'parameter-bound value with \'quotes\''
const ROLLED_BACK_BODY = 'this row must be rolled back'
const SEED_BODY = 'SQLite works across frameworks'

const migrations: readonly SqliteMigration[] = [
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
      await transaction.exec('INSERT INTO notes (body) VALUES (?)', [SEED_BODY])
    },
  },
]

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
    const migrationVersions = await migrate(database, migrations)
    const rows = await database.query<{ id: number, body: string }>('SELECT id, body FROM notes ORDER BY id')
    return { migrationVersions, rows: rows.rows }
  }
  finally {
    await database.close()
  }
}

function createAcceptanceDriverOptions(options: SqliteAcceptanceOptions): SqliteWasmDriverOptions {
  return options.locateFile
    ? { storage: options.storage, locateFile: options.locateFile }
    : { storage: options.storage }
}

async function openAcceptanceDatabase(options: SqliteAcceptanceOptions) {
  return openSqliteWasmDatabase(
    options.initializer ?? initSqlJs,
    options.databaseName ?? ACCEPTANCE_DATABASE_NAME,
    createAcceptanceDriverOptions(options),
  )
}

function check(id: string, passed: boolean, detail: string): SqliteAcceptanceCheck {
  return { id, passed, detail }
}

export async function resetSqliteAcceptance(options: SqliteAcceptanceOptions): Promise<void> {
  await options.storage.remove(options.databaseName ?? ACCEPTANCE_DATABASE_NAME)
}

export async function runSqliteAcceptance(options: SqliteAcceptanceOptions): Promise<SqliteAcceptanceResult> {
  const database = await openAcceptanceDatabase(options)
  let migrationVersions: readonly number[] = []
  let rows: readonly { id: number, body: string }[] = []
  let rollbackObserved = false
  let closed = false

  try {
    migrationVersions = await migrate(database, migrations)
    await database.transaction(async (transaction) => {
      await transaction.exec('INSERT INTO notes (body) VALUES (?)', [COMMITTED_BODY])
    })
    try {
      await database.transaction(async (transaction) => {
        await transaction.exec('INSERT INTO notes (body) VALUES (?)', [ROLLED_BACK_BODY])
        throw new Error('acceptance rollback sentinel')
      })
    }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'acceptance rollback sentinel') {
        throw error
      }
      rollbackObserved = true
    }
    rows = (await database.query<{ id: number, body: string }>('SELECT id, body FROM notes ORDER BY id')).rows
  }
  finally {
    await database.close()
    closed = true
  }

  const bodies = rows.map(row => row.body)
  const checks = [
    check('migration', migrationVersions.join(',') === '1,2', `applied=[${migrationVersions.join(',')}]`),
    check('parameter-binding', bodies.includes(COMMITTED_BODY), `value=${COMMITTED_BODY}`),
    check('transaction-commit', bodies.filter(body => body === COMMITTED_BODY).length === 1, 'committed row count must be 1'),
    check('transaction-rollback', rollbackObserved && !bodies.includes(ROLLED_BACK_BODY), 'rolled-back row must be absent'),
    check('database-close', closed, 'database closed after first run'),
  ]
  return { schemaVersion: 1, passed: checks.every(item => item.passed), migrationVersions, checks, rows }
}

export async function verifySqliteAcceptance(options: SqliteAcceptanceOptions): Promise<SqliteAcceptanceResult> {
  const database = await openAcceptanceDatabase(options)
  let migrationVersions: readonly number[] = []
  let rows: readonly { id: number, body: string }[] = []
  let closed = false

  try {
    migrationVersions = await migrate(database, migrations)
    rows = (await database.query<{ id: number, body: string }>('SELECT id, body FROM notes ORDER BY id')).rows
  }
  finally {
    await database.close()
    closed = true
  }

  const bodies = rows.map(row => row.body)
  const checks = [
    check('migration-idempotent', migrationVersions.join(',') === '1,2', `registered=[${migrationVersions.join(',')}] without rerunning migration bodies`),
    check('seed-persisted', bodies.includes(SEED_BODY), 'seed row must persist'),
    check('commit-persisted', bodies.filter(body => body === COMMITTED_BODY).length === 1, 'committed row must persist exactly once'),
    check('rollback-persisted', !bodies.includes(ROLLED_BACK_BODY), 'rolled-back row must remain absent'),
    check('database-close', closed, 'database closed after persistence verification'),
  ]
  return { schemaVersion: 1, passed: checks.every(item => item.passed), migrationVersions, checks, rows }
}
