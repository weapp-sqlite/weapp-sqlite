import type { SqliteDatabase, SqliteMigration } from '@weapp-sqlite/core'
import type { OpenSqliteOptions, RemoveSqliteOptions, SqliteRuntimeAdapter } from './types'
import { createSqliteDatabase, migrate, SqliteClosedError, SqliteTransactionError } from '@weapp-sqlite/core'
import { SqliteRuntimeError, unsupportedRuntime } from './errors'

export interface DatabaseEntry {
  readonly generation: number
  readonly adapter: SqliteRuntimeAdapter
  readonly migrations: readonly SqliteMigration[]
  readonly database: SqliteDatabase
  current: SqliteDatabase | undefined
  ownedByApplication: boolean
  debugSessions: number
  revision: number
  transactionActive: boolean
  closed: boolean
  closePromise: Promise<void> | undefined
  failure: unknown
}

type LifecycleOperation
  = | {
    readonly kind: 'open'
    readonly adapter: SqliteRuntimeAdapter
    readonly migrations: readonly SqliteMigration[]
    readonly promise: Promise<SqliteDatabase>
  }
  | {
    readonly kind: 'close' | 'remove'
    readonly adapter: SqliteRuntimeAdapter
    readonly promise: Promise<void>
  }

export interface RegistryEntry {
  active: DatabaseEntry | undefined
  lastOperation: LifecycleOperation | undefined
  pending: number
  tail: Promise<void>
}

export const registry = new Map<string, RegistryEntry>()
let nextGeneration = 1

function sameMigrations(left: readonly SqliteMigration[], right: readonly SqliteMigration[]) {
  return left.length === right.length && left.every((migration, index) => {
    const candidate = right[index]
    return candidate?.version === migration.version
      && candidate.name === migration.name
      && candidate.up === migration.up
  })
}

export function assertDatabaseName(name: string) {
  if (!name || !/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
    throw new TypeError('SQLite database names may only contain letters, numbers, dots, underscores, and hyphens.')
  }
}

function queryMayWrite(sql: string) {
  const keyword = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)*(\w+)/.exec(sql)?.[1]?.toLowerCase()
  if (keyword === 'select' || keyword === 'explain' || keyword === 'values') {
    return false
  }
  if (keyword === 'pragma') {
    return /\s*=/.test(sql)
  }
  // WITH statements can contain INSERT/UPDATE/DELETE/REPLACE CTEs. Treat
  // them as writes so a revision can never be reused after an unknown change.
  return true
}

function optionsConflict(name: string, adapter: SqliteRuntimeAdapter) {
  return new SqliteRuntimeError(
    'SQLITE_OPEN_OPTIONS_CONFLICT',
    adapter.target,
    `SQLite database "${name}" is already open with different adapter or migration options.`,
  )
}

export function registryEntry(name: string) {
  let entry = registry.get(name)
  if (!entry) {
    entry = { active: undefined, lastOperation: undefined, pending: 0, tail: Promise.resolve() }
    registry.set(name, entry)
  }
  return entry
}

export function enqueue<T>(name: string, entry: RegistryEntry, callback: () => Promise<T>): Promise<T> {
  entry.pending++
  const promise = entry.tail.then(callback).finally(() => {
    entry.pending--
    if (entry.lastOperation?.promise === promise) {
      entry.lastOperation = undefined
    }
    if (!entry.active && entry.pending === 0 && registry.get(name) === entry) {
      registry.delete(name)
    }
  })
  // A failed operation must not poison the remaining lifecycle queue.
  entry.tail = promise.then(() => undefined, () => undefined)
  return promise
}

export async function openPhysicalDatabase(name: string, adapter: SqliteRuntimeAdapter, migrations: readonly SqliteMigration[], validate = false) {
  const capability = await adapter.probe()
  if (!capability.supported) {
    throw unsupportedRuntime(capability)
  }
  let connection
  try {
    connection = await adapter.open(name)
  }
  catch (error) {
    if (error instanceof SqliteRuntimeError) {
      throw error
    }
    throw new SqliteRuntimeError('SQLITE_ENGINE_INIT_FAILED', adapter.target, `Failed to initialize SQLite on the ${adapter.target} runtime.`, { cause: error })
  }
  const database = createSqliteDatabase(name, connection)
  try {
    if (validate) {
      const result = await database.query<{ quick_check: string }>('PRAGMA quick_check')
      if (result.rows[0]?.quick_check !== 'ok') {
        throw new Error('SQLite quick_check did not return ok.')
      }
    }
    if (migrations.length > 0) {
      await migrate(database, migrations)
    }
    return database
  }
  catch (error) {
    try {
      await database.close()
    }
    catch (closeError) {
      throw new AggregateError([error, closeError], 'SQLite initialization failed and the connection could not be closed.', { cause: error })
    }
    throw error
  }
}

export function assertActive(entry: RegistryEntry, active: DatabaseEntry) {
  if (active.closed || entry.active !== active) {
    throw new SqliteClosedError()
  }
  if (active.failure) {
    throw active.failure
  }
  if (!active.current) {
    throw new SqliteClosedError()
  }
  return active.current
}

export async function closeActive(entry: RegistryEntry, active: DatabaseEntry) {
  if (active.closed) {
    return
  }
  await active.current?.close()
  active.current = undefined
  active.closed = true
  if (entry.active === active) {
    entry.active = undefined
  }
}

export async function ensureActive(name: string, entry: RegistryEntry, adapter: SqliteRuntimeAdapter, migrations: readonly SqliteMigration[]) {
  if (entry.active) {
    if (entry.active.adapter !== adapter || !sameMigrations(entry.active.migrations, migrations)) {
      throw optionsConflict(name, adapter)
    }
    return entry.active
  }
  const current = await openPhysicalDatabase(name, adapter, migrations)
  const active: DatabaseEntry = {
    generation: nextGeneration++,
    adapter,
    migrations,
    current,
    ownedByApplication: false,
    debugSessions: 0,
    revision: 0,
    transactionActive: false,
    closed: false,
    closePromise: undefined,
    failure: undefined,
    database: {
      name,
      exec(sql, parameters) {
        return enqueue(name, entry, async () => {
          const database = assertActive(entry, active)
          active.revision++
          return database.exec(sql, parameters)
        })
      },
      query(sql, parameters) {
        return enqueue(name, entry, async () => {
          const database = assertActive(entry, active)
          if (queryMayWrite(sql)) {
            active.revision++
          }
          return database.query(sql, parameters)
        })
      },
      transaction(callback) {
        if (active.transactionActive) {
          return Promise.reject(new SqliteTransactionError('Nested transactions are not supported.'))
        }
        return enqueue(name, entry, async () => {
          const database = assertActive(entry, active)
          active.revision++
          active.transactionActive = true
          try {
            return await database.transaction(callback)
          }
          finally {
            active.transactionActive = false
          }
        })
      },
      flush() {
        return enqueue(name, entry, () => assertActive(entry, active).flush())
      },
      close() {
        if (active.closePromise) {
          return active.closePromise
        }
        const closing = enqueue(name, entry, () => closeActive(entry, active))
        active.closePromise = closing
        void closing.catch(() => {
          if (active.closePromise === closing) {
            active.closePromise = undefined
          }
        })
        entry.lastOperation = { kind: 'close', adapter, promise: closing }
        return closing
      },
    },
  }
  entry.active = active
  return active
}

export async function openSqliteWithAdapter(options: OpenSqliteOptions, defaultAdapter: SqliteRuntimeAdapter): Promise<SqliteDatabase> {
  assertDatabaseName(options.name)
  const name = options.name
  const adapter = options.adapter ?? defaultAdapter
  const migrations = (options.migrations ?? []).map(migration => ({ ...migration }))
  const entry = registryEntry(name)
  const previous = entry.lastOperation
  if (previous?.kind === 'open') {
    if (previous.adapter !== adapter || !sameMigrations(previous.migrations, migrations)) {
      throw optionsConflict(name, adapter)
    }
    return previous.promise
  }
  if (previous?.kind === 'remove' && previous.adapter !== adapter) {
    throw optionsConflict(name, adapter)
  }
  const promise = enqueue(name, entry, async () => {
    const active = await ensureActive(name, entry, adapter, migrations)
    active.ownedByApplication = true
    return active.database
  })
  entry.lastOperation = { kind: 'open', adapter, migrations, promise }
  return promise
}

export async function removeSqliteWithAdapter(options: RemoveSqliteOptions, defaultAdapter: SqliteRuntimeAdapter) {
  assertDatabaseName(options.name)
  const name = options.name
  const adapter = options.adapter ?? defaultAdapter
  const entry = registryEntry(name)
  const existingAdapter = entry.lastOperation?.adapter ?? entry.active?.adapter
  if (existingAdapter && existingAdapter !== adapter) {
    throw optionsConflict(name, adapter)
  }
  const promise = enqueue(name, entry, async () => {
    if (entry.active) {
      if (entry.active.adapter !== adapter) {
        throw optionsConflict(name, adapter)
      }
      await closeActive(entry, entry.active)
    }
    const capability = await adapter.probe()
    if (!capability.supported) {
      throw unsupportedRuntime(capability)
    }
    await adapter.remove(name)
  })
  entry.lastOperation = { kind: 'remove', adapter, promise }
  return promise
}

export function listSqliteRuntimeDatabases() {
  return Array.from(registry, ([databaseName, entry]) => entry.active && !entry.active.closed
    ? { databaseName, target: entry.active.adapter.target, engine: entry.active.adapter.kind, generation: entry.active.generation }
    : undefined).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
}

export function getSqliteRuntimeDatabaseOptions(name: string): Pick<OpenSqliteOptions, 'adapter' | 'migrations'> | undefined {
  const active = registry.get(name)?.active
  return active && !active.closed ? { adapter: active.adapter, migrations: active.migrations } : undefined
}

export function clearSqliteRuntimeRegistryForTests() {
  registry.clear()
}
