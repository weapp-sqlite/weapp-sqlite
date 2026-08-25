import type { SqliteConnection } from '@/index'
import { createSqliteDatabase, migrate, SqliteClosedError } from '@/index'

function createFakeConnection() {
  const calls: string[] = []
  let flushCount = 0
  let closed = false
  const connection: SqliteConnection = {
    async exec(sql) {
      calls.push(sql)
      return { changes: sql.startsWith('INSERT') ? 1 : 0, lastInsertRowid: 1 }
    },
    async query() {
      calls.push('QUERY')
      return { columns: ['version'], rows: [] }
    },
    async flush() {
      flushCount += 1
    },
    async close() {
      closed = true
    },
  }
  return {
    calls,
    connection,
    get flushCount() {
      return flushCount
    },
    get closed() {
      return closed
    },
  }
}

describe('sqlite core', () => {
  it('serializes operations and flushes writes', async () => {
    const fake = createFakeConnection()
    const database = createSqliteDatabase('test', fake.connection)

    await Promise.all([
      database.exec('INSERT INTO items VALUES (?)', ['one']),
      database.query('SELECT * FROM items'),
    ])

    expect(fake.calls).toEqual(['INSERT INTO items VALUES (?)', 'QUERY'])
    expect(fake.flushCount).toBe(1)
  })

  it('commits successful transactions and rolls back failures', async () => {
    const fake = createFakeConnection()
    const database = createSqliteDatabase('test', fake.connection)

    await database.transaction(async (transaction) => {
      await transaction.exec('INSERT INTO items VALUES (?)', ['one'])
    })
    expect(fake.calls).toEqual(['BEGIN', 'INSERT INTO items VALUES (?)', 'COMMIT'])
    expect(fake.flushCount).toBe(1)

    await expect(database.transaction(async (transaction) => {
      await transaction.exec('INSERT INTO items VALUES (?)', ['two'])
      throw new Error('failure')
    })).rejects.toThrow('failure')
    expect(fake.calls.slice(-3)).toEqual(['BEGIN', 'INSERT INTO items VALUES (?)', 'ROLLBACK'])
  })

  it('rejects nested transactions and operations after close', async () => {
    const fake = createFakeConnection()
    const database = createSqliteDatabase('test', fake.connection)

    await expect(database.transaction(async () => database.transaction(async () => undefined))).rejects.toThrow('Nested transactions')
    await database.close()
    expect(fake.closed).toBe(true)
    await expect(database.query('SELECT 1')).rejects.toBeInstanceOf(SqliteClosedError)
  })

  it('applies pending migrations once and preserves order', async () => {
    const fake = createFakeConnection()
    const database = createSqliteDatabase('test', fake.connection)
    const applied: number[] = []
    const migrations = [
      { version: 2, name: 'second', up: async () => { applied.push(2) } },
      { version: 1, name: 'first', up: async () => { applied.push(1) } },
    ]

    expect(await migrate(database, migrations)).toEqual([1, 2])
    expect(applied).toEqual([1, 2])
  })
})
