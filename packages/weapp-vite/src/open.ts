import type { SqliteDatabase, SqliteMigration } from '@weapp-sqlite/core'
import type { OpenSqliteOptions, RemoveSqliteOptions, SqliteRuntimeAdapter } from './types'
import { createSqliteDatabase, migrate } from '@weapp-sqlite/core'
import { SqliteRuntimeError, unsupportedRuntime } from './errors'

interface RegistryEntry {
  readonly adapter: SqliteRuntimeAdapter
  readonly migrations: readonly SqliteMigration[]
  readonly promise: Promise<SqliteDatabase>
}

const registry = new Map<string, RegistryEntry>()

function sameMigrations(left: readonly SqliteMigration[], right: readonly SqliteMigration[]) {
  return left.length === right.length && left.every((migration, index) => {
    const candidate = right[index]
    return candidate?.version === migration.version
      && candidate.name === migration.name
      && candidate.up === migration.up
  })
}

function assertDatabaseName(name: string) {
  if (!name || !/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
    throw new TypeError('SQLite database names may only contain letters, numbers, dots, underscores, and hyphens.')
  }
}

export async function openSqliteWithAdapter(
  options: OpenSqliteOptions,
  defaultAdapter: SqliteRuntimeAdapter,
): Promise<SqliteDatabase> {
  assertDatabaseName(options.name)
  const adapter = options.adapter ?? defaultAdapter
  const migrations = options.migrations ?? []
  const existing = registry.get(options.name)
  if (existing) {
    if (existing.adapter !== adapter || !sameMigrations(existing.migrations, migrations)) {
      throw new SqliteRuntimeError(
        'SQLITE_OPEN_OPTIONS_CONFLICT',
        adapter.target,
        `SQLite database "${options.name}" is already open with different adapter or migration options.`,
      )
    }
    return existing.promise
  }

  let entry: RegistryEntry
  const promise = (async () => {
    const capability = await adapter.probe()
    if (!capability.supported) {
      throw unsupportedRuntime(capability)
    }
    let connection
    try {
      connection = await adapter.open(options.name)
    }
    catch (error) {
      if (error instanceof SqliteRuntimeError) {
        throw error
      }
      throw new SqliteRuntimeError(
        'SQLITE_ENGINE_INIT_FAILED',
        adapter.target,
        `Failed to initialize SQLite on the ${adapter.target} runtime.`,
        { cause: error },
      )
    }
    const database = createSqliteDatabase(options.name, connection)
    const close = database.close.bind(database)
    const managed: SqliteDatabase = {
      ...database,
      async close() {
        await close()
        if (registry.get(options.name) === entry) {
          registry.delete(options.name)
        }
      },
    }
    if (migrations.length > 0) {
      try {
        await migrate(managed, migrations)
      }
      catch (error) {
        await managed.close()
        throw error
      }
    }
    return managed
  })()
  entry = { adapter, migrations: [...migrations], promise }
  registry.set(options.name, entry)
  try {
    return await promise
  }
  catch (error) {
    if (registry.get(options.name) === entry) {
      registry.delete(options.name)
    }
    throw error
  }
}

export async function removeSqliteWithAdapter(
  options: RemoveSqliteOptions,
  defaultAdapter: SqliteRuntimeAdapter,
) {
  assertDatabaseName(options.name)
  const adapter = options.adapter ?? defaultAdapter
  const existing = registry.get(options.name)
  if (existing) {
    if (existing.adapter !== adapter) {
      throw new SqliteRuntimeError(
        'SQLITE_OPEN_OPTIONS_CONFLICT',
        adapter.target,
        `SQLite database "${options.name}" is open with a different adapter.`,
      )
    }
    await (await existing.promise).close()
  }
  const capability = await adapter.probe()
  if (!capability.supported) {
    throw unsupportedRuntime(capability)
  }
  await adapter.remove(options.name)
}

export function clearSqliteRuntimeRegistryForTests() {
  registry.clear()
}
