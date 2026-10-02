import type { SqliteAppliedMigration, SqliteDatabase, SqliteMigration, SqliteMigrationStatus } from './types'

const MIGRATIONS_TABLE = '__weapp_sqlite_migrations'
const migrationQueues = new WeakMap<SqliteDatabase, Promise<void>>()

async function runExclusive<T>(database: SqliteDatabase, callback: () => Promise<T>): Promise<T> {
  const previous = migrationQueues.get(database) ?? Promise.resolve()
  const result = previous.then(callback)
  const tail = result.then(() => undefined, () => undefined)
  migrationQueues.set(database, tail)
  try {
    return await result
  }
  finally {
    if (migrationQueues.get(database) === tail) {
      migrationQueues.delete(database)
    }
  }
}

function orderMigrations(migrations: readonly SqliteMigration[]) {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  const versions = new Set<number>()
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) {
      throw new Error('Migration versions must be positive and unique.')
    }
    versions.add(migration.version)
  }
  return ordered
}

async function readMigrationStatus(database: SqliteDatabase, ordered: readonly SqliteMigration[]): Promise<SqliteMigrationStatus> {
  const table = await database.query<{ name: string }>(
    'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?',
    [MIGRATIONS_TABLE],
  )
  const tablePresent = table.rows.length > 0
  let applied: SqliteAppliedMigration[] = []
  if (tablePresent) {
    const result = await database.query<{ version: number, name: string, applied_at: string }>(
      `SELECT version, name, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`,
    )
    applied = result.rows.map(row => ({
      version: Number(row.version),
      name: row.name,
      appliedAt: row.applied_at,
    }))
  }
  const appliedByVersion = new Map(applied.map(migration => [migration.version, migration]))
  const expectedByVersion = new Map(ordered.map(migration => [migration.version, migration]))

  return {
    tablePresent,
    applied,
    pending: ordered.filter(migration => !appliedByVersion.has(migration.version)).map(({ version, name }) => ({ version, name })),
    unknown: applied.filter(migration => !expectedByVersion.has(migration.version)),
    conflicts: ordered.flatMap((migration) => {
      const existing = appliedByVersion.get(migration.version)
      return existing && existing.name !== migration.name
        ? [{ version: migration.version, appliedName: existing.name, expectedName: migration.name }]
        : []
    }),
  }
}

/** Reads migration history without creating the history table or applying SQL. */
export function getMigrationStatus(database: SqliteDatabase, migrations: readonly SqliteMigration[] = []): Promise<SqliteMigrationStatus> {
  return runExclusive(database, () => readMigrationStatus(database, orderMigrations(migrations)))
}

export function migrate(database: SqliteDatabase, migrations: readonly SqliteMigration[]): Promise<number[]> {
  return runExclusive(database, async () => {
    const ordered = orderMigrations(migrations)
    const status = await readMigrationStatus(database, ordered)
    if (status.conflicts.length > 0) {
      const conflict = status.conflicts[0]!
      throw new Error(`Migration version ${conflict.version} was applied as "${conflict.appliedName}", but is declared as "${conflict.expectedName}".`)
    }
    if (!status.tablePresent) {
      await database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
    }
    const applied = new Set(status.applied.map(migration => migration.version))

    for (const migration of ordered) {
      if (applied.has(migration.version)) {
        continue
      }
      await database.transaction(async (transaction) => {
        await migration.up(transaction)
        await transaction.exec(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`,
          [migration.version, migration.name, new Date().toISOString()],
        )
      })
      applied.add(migration.version)
    }

    return [...applied].sort((left, right) => left - right)
  })
}
