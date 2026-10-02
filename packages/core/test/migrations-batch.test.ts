import type { SqliteAppliedMigration, SqliteConnection, SqliteMigration, SqliteParameters, SqliteRow } from '@/index'
import { createSqliteDatabase, execMany, getMigrationStatus, migrate } from '@/index'

const historyTable = '__weapp_sqlite_migrations'

function createFixture(initialHistory?: readonly SqliteAppliedMigration[]) {
  const calls: { sql: string, parameters: SqliteParameters | undefined }[] = []
  let history = [...(initialHistory ?? [])]
  let tablePresent = initialHistory !== undefined
  let values: unknown[] = []
  let snapshot: { history: SqliteAppliedMigration[], values: unknown[] } | undefined
  let flushes = 0
  const failure = new Error('injected constraint failure')
  const connection: SqliteConnection = {
    async exec(sql, parameters) {
      calls.push({ sql, parameters })
      if (sql === 'BEGIN') {
        snapshot = { history: [...history], values: [...values] }
      }
      else if (sql === 'COMMIT') {
        snapshot = undefined
      }
      else if (sql === 'ROLLBACK') {
        if (snapshot) {
          ({ history, values } = snapshot)
          snapshot = undefined
        }
      }
      else if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) {
        tablePresent = true
      }
      else if (sql.startsWith(`INSERT INTO ${historyTable}`)) {
        const [version, name, appliedAt] = parameters as readonly [number, string, string]
        history.push({ version, name, appliedAt })
      }
      else if (sql.startsWith('INSERT INTO items')) {
        const value = Object.values(parameters ?? {})[0]
        if (value === 'fail') {
          throw failure
        }
        values.push(value)
        return { changes: 1, lastInsertRowid: values.length }
      }
      return { changes: 0 }
    },
    async query<Row extends SqliteRow>(sql: string, parameters?: SqliteParameters) {
      calls.push({ sql, parameters })
      const rows = sql.includes('sqlite_schema') || sql.includes('sqlite_master')
        ? tablePresent ? [{ name: historyTable }] : []
        : [...history].sort((left, right) => left.version - right.version).map(({ version, name, appliedAt }) => ({ version, name, applied_at: appliedAt }))
      return { columns: [], rows: rows as unknown as Row[] }
    },
    async flush() {
      flushes += 1
    },
    async close() {},
  }
  return {
    database: createSqliteDatabase('test', connection),
    calls,
    failure,
    get values() { return values },
    get history() { return history },
    get flushes() { return flushes },
  }
}

function migration(version: number, name = `migration ${version}`): SqliteMigration {
  return {
    version,
    name,
    up: async (transaction) => {
      await transaction.exec('INSERT INTO items VALUES (?)', [version])
    },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('execMany', () => {
  it('executes bound parameters in order in one transaction with one flush', async () => {
    const fixture = createFixture()
    const parameterSets = [['one'], ['two']] as const

    expect(await execMany(fixture.database, 'INSERT INTO items VALUES (?)', parameterSets)).toEqual([
      { changes: 1, lastInsertRowid: 1 },
      { changes: 1, lastInsertRowid: 2 },
    ])
    expect(fixture.calls.map(call => call.sql)).toEqual(['BEGIN', 'INSERT INTO items VALUES (?)', 'INSERT INTO items VALUES (?)', 'COMMIT'])
    expect(fixture.calls.slice(1, 3).map(call => call.parameters)).toEqual(parameterSets)
    expect(fixture.values).toEqual(['one', 'two'])
    expect(fixture.flushes).toBe(1)
  })

  it('participates in an existing transaction and accepts named parameters', async () => {
    const fixture = createFixture()
    await fixture.database.transaction(async (transaction) => {
      await execMany(transaction, 'INSERT INTO items VALUES ($value)', [{ $value: 'first' }, { $value: 'second' }])
      expect(fixture.flushes).toBe(0)
    })
    expect(fixture.values).toEqual(['first', 'second'])
    expect(fixture.calls.filter(call => call.sql === 'BEGIN')).toHaveLength(1)
    expect(fixture.calls.filter(call => call.sql === 'COMMIT')).toHaveLength(1)
    expect(fixture.flushes).toBe(1)
  })

  it('does nothing for an empty batch', async () => {
    const fixture = createFixture()
    expect(await execMany(fixture.database, 'INSERT INTO items VALUES (?)', [])).toEqual([])
    expect(fixture.calls).toEqual([])
    expect(fixture.flushes).toBe(0)
  })

  it('stops at the first error and rolls back the entire batch', async () => {
    const fixture = createFixture()
    await expect(execMany(fixture.database, 'INSERT INTO items VALUES (?)', [['first'], ['fail'], ['last']])).rejects.toBe(fixture.failure)
    expect(fixture.values).toEqual([])
    expect(fixture.calls.filter(call => call.sql.startsWith('INSERT')).map(call => call.parameters)).toEqual([['first'], ['fail']])
    expect(fixture.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.flushes).toBe(0)
  })
})

describe('migration diagnostics and serialization', () => {
  it('reports pending migrations without creating a history table or running callbacks', async () => {
    const fixture = createFixture()
    const migrations = [migration(2), migration(1)]
    expect(await getMigrationStatus(fixture.database, migrations)).toEqual({
      tablePresent: false,
      applied: [],
      pending: [{ version: 1, name: 'migration 1' }, { version: 2, name: 'migration 2' }],
      unknown: [],
      conflicts: [],
    })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]?.sql).toContain('SELECT')
    expect(fixture.values).toEqual([])
    expect(migrations.map(item => item.version)).toEqual([2, 1])
  })

  it('reports applied, pending, unknown and renamed migrations in version order', async () => {
    const applied = [
      { version: 1, name: 'original name', appliedAt: '2026-01-01T00:00:00.000Z' },
      { version: 3, name: 'external migration', appliedAt: '2026-01-03T00:00:00.000Z' },
    ]
    const fixture = createFixture([...applied].reverse())
    expect(await getMigrationStatus(fixture.database, [migration(2), migration(1, 'new name')])).toEqual({
      tablePresent: true,
      applied,
      pending: [{ version: 2, name: 'migration 2' }],
      unknown: [applied[1]],
      conflicts: [{ version: 1, appliedName: 'original name', expectedName: 'new name' }],
    })
    expect((await getMigrationStatus(fixture.database)).unknown).toEqual(applied)
    expect(fixture.calls.every(call => call.sql.startsWith('SELECT'))).toBe(true)
  })

  it('checks every name conflict before applying any new migration', async () => {
    const fixture = createFixture([{ version: 2, name: 'old', appliedAt: 'existing' }])
    await expect(migrate(fixture.database, [migration(1), migration(2, 'new')])).rejects.toThrow('Migration version 2 was applied as "old", but is declared as "new".')
    expect(fixture.values).toEqual([])
    expect(fixture.calls.every(call => call.sql.startsWith('SELECT'))).toBe(true)
  })

  it('applies migrations once, preserves unknown versions and commits each migration separately', async () => {
    const fixture = createFixture([{ version: 5, name: 'external', appliedAt: 'existing' }])
    const migrations = [migration(2), migration(1)]
    expect(await migrate(fixture.database, migrations)).toEqual([1, 2, 5])
    expect(await migrate(fixture.database, migrations)).toEqual([1, 2, 5])
    expect(fixture.values).toEqual([1, 2])
    expect(fixture.calls.filter(call => call.sql === 'COMMIT')).toHaveLength(2)
  })

  it('serializes complete migration runs and diagnostics on the same database', async () => {
    const fixture = createFixture()
    const started = deferred()
    const release = deferred()
    let runs = 0
    const migrations: SqliteMigration[] = [{
      version: 1,
      name: 'delayed',
      async up(transaction) {
        runs += 1
        started.resolve()
        await release.promise
        await transaction.exec('INSERT INTO items VALUES (?)', ['migrated'])
      },
    }]
    const first = migrate(fixture.database, migrations)
    await started.promise
    const callCount = fixture.calls.length
    const second = migrate(fixture.database, migrations)
    const status = getMigrationStatus(fixture.database, migrations)
    await Promise.resolve()
    expect(fixture.calls).toHaveLength(callCount)
    release.resolve()

    expect(await first).toEqual([1])
    expect(await second).toEqual([1])
    expect(await status).toMatchObject({ applied: [{ version: 1, name: 'delayed' }], pending: [] })
    expect(runs).toBe(1)
  })

  it('releases the queue after failure and retries only the failed migration', async () => {
    const fixture = createFixture()
    let fail = true
    const migrations: SqliteMigration[] = [migration(1), {
      version: 2,
      name: 'retryable',
      async up(transaction) {
        await transaction.exec('INSERT INTO items VALUES (?)', [2])
        if (fail) {
          throw fixture.failure
        }
      },
    }]
    await expect(migrate(fixture.database, migrations)).rejects.toBe(fixture.failure)
    expect(fixture.values).toEqual([1])
    expect((await getMigrationStatus(fixture.database, migrations)).pending).toEqual([{ version: 2, name: 'retryable' }])
    fail = false
    expect(await migrate(fixture.database, migrations)).toEqual([1, 2])
    expect(fixture.values).toEqual([1, 2])
  })

  it('does not serialize different database objects against each other', async () => {
    const first = createFixture()
    const second = createFixture()
    const started = deferred()
    const release = deferred()
    const pending = migrate(first.database, [{
      version: 1,
      name: 'delayed',
      async up() {
        started.resolve()
        await release.promise
      },
    }])
    await started.promise
    expect(await migrate(second.database, [migration(1)])).toEqual([1])
    release.resolve()
    await pending
  })

  it.each([
    [migration(0)],
    [migration(-1)],
    [migration(1.5)],
    [migration(Number.NaN)],
    [migration(1), migration(1)],
  ])('rejects invalid migration versions before accessing the database: %j', async (...migrations) => {
    const fixture = createFixture()
    await expect(getMigrationStatus(fixture.database, migrations)).rejects.toThrow('positive and unique')
    await expect(migrate(fixture.database, migrations)).rejects.toThrow('positive and unique')
    expect(fixture.calls).toEqual([])
  })
})
