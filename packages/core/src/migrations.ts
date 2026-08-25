import type { SqliteDatabase, SqliteMigration } from './types'

const MIGRATIONS_TABLE = '__weapp_sqlite_migrations'

export async function migrate(database: SqliteDatabase, migrations: readonly SqliteMigration[]) {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  const versions = new Set<number>()
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) {
      throw new Error('Migration versions must be positive and unique.')
    }
    versions.add(migration.version)
  }

  await database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
  const result = await database.query<{ version: number }>(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`)
  const applied = new Set(result.rows.map(row => Number(row.version)))

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
}
