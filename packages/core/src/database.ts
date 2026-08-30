import type {
  SqliteConnection,
  SqliteDatabase,
  SqliteParameters,
  SqliteQueryResult,
  SqliteRow,
  SqliteTransaction,
} from './types'
import { SqliteClosedError, SqliteTransactionError } from './errors'

function createQueue() {
  let tail = Promise.resolve()

  return async function runExclusive<T>(callback: () => Promise<T>) {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await callback()
    }
    finally {
      release()
    }
  }
}

function createTransaction(connection: SqliteConnection): SqliteTransaction {
  return {
    exec: (sql, parameters) => connection.exec(sql, parameters),
    query: <Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters): Promise<SqliteQueryResult<Row>> => connection.query<Row>(sql, parameters),
  }
}

export function createSqliteDatabase(name: string, connection: SqliteConnection): SqliteDatabase {
  const runExclusive = createQueue()
  let closed = false
  let transactionActive = false

  function assertOpen() {
    if (closed) {
      throw new SqliteClosedError()
    }
  }

  return {
    name,
    exec(sql, parameters) {
      return runExclusive(async () => {
        assertOpen()
        const result = await connection.exec(sql, parameters)
        await connection.flush?.()
        return result
      })
    },
    query<Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters) {
      return runExclusive(async () => {
        assertOpen()
        return connection.query<Row>(sql, parameters)
      })
    },
    transaction<T>(callback: (transaction: SqliteTransaction) => Promise<T>) {
      if (transactionActive) {
        return Promise.reject(new SqliteTransactionError('Nested transactions are not supported.'))
      }
      return runExclusive(async () => {
        assertOpen()
        transactionActive = true
        try {
          await connection.exec('BEGIN')
          const result = await callback(createTransaction(connection))
          await connection.exec('COMMIT')
          await connection.flush?.()
          return result
        }
        catch (error) {
          try {
            await connection.exec('ROLLBACK')
          }
          catch (rollbackError) {
            throw new SqliteTransactionError('Transaction rollback failed.', { cause: rollbackError })
          }
          throw error
        }
        finally {
          transactionActive = false
        }
      })
    },
    flush() {
      return runExclusive(async () => {
        assertOpen()
        await connection.flush?.()
      })
    },
    close() {
      return runExclusive(async () => {
        if (closed) {
          return
        }
        await connection.flush?.()
        await connection.close()
        closed = true
      })
    },
  }
}
