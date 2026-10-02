import type {
  SqliteConnection,
  SqliteDatabase,
  SqliteParameters,
  SqliteQueryResult,
  SqliteRow,
  SqliteTransaction,
} from './types'
import { SqliteClosedError, SqlitePersistenceError, SqliteTransactionError } from './errors'

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

function createTransaction(connection: SqliteConnection) {
  let active = true
  let pending = Promise.resolve()
  let failure: { error: unknown } | undefined

  function run<T>(operation: () => Promise<T>): Promise<T> {
    if (!active) {
      return Promise.reject(new SqliteTransactionError('SQLite transaction scope is no longer active.'))
    }
    const result = pending.then(() => {
      if (failure) {
        throw failure.error
      }
      return operation()
    })
    // Observe failures even when the callback does not await an operation.
    pending = result.then(() => undefined, (error: unknown) => {
      failure ??= { error }
    })
    return result
  }

  const transaction: SqliteTransaction = {
    exec: (sql, parameters) => run(() => connection.exec(sql, parameters)),
    query: <Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters): Promise<SqliteQueryResult<Row>> => run(() => connection.query<Row>(sql, parameters)),
  }
  return {
    transaction,
    async finish() {
      active = false
      await pending
      if (failure) {
        throw failure.error
      }
    },
  }
}

export function createSqliteDatabase(name: string, connection: SqliteConnection): SqliteDatabase {
  const runExclusive = createQueue()
  let closed = false
  let transactionActive = false
  let transactionFailure: SqliteTransactionError | undefined

  function assertOpen() {
    if (closed) {
      throw new SqliteClosedError()
    }
    if (transactionFailure) {
      throw transactionFailure
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
        const result = await connection.query<Row>(sql, parameters)
        await connection.flush?.()
        return result
      })
    },
    transaction<T>(callback: (transaction: SqliteTransaction) => Promise<T>) {
      if (transactionActive) {
        return Promise.reject(new SqliteTransactionError('Nested transactions are not supported.'))
      }
      return runExclusive(async () => {
        assertOpen()
        transactionActive = true
        let began = false
        try {
          await connection.exec('BEGIN')
          began = true
          const scope = createTransaction(connection)
          let result: T
          try {
            result = await callback(scope.transaction)
          }
          catch (error) {
            // Drain started work before rollback, preserving the callback error.
            await scope.finish().catch(() => undefined)
            throw error
          }
          await scope.finish()
          await connection.exec('COMMIT')
          began = false
          try {
            await connection.flush?.()
          }
          catch (cause) {
            throw new SqlitePersistenceError({ cause })
          }
          return result
        }
        catch (error) {
          if (began) {
            try {
              await connection.exec('ROLLBACK')
            }
            catch (rollbackError) {
              transactionFailure = new SqliteTransactionError('Transaction rollback failed. Close and reopen the database before continuing.', {
                cause: new AggregateError([error, rollbackError], 'Transaction and rollback both failed.'),
              })
              throw transactionFailure
            }
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
        if (!transactionFailure) {
          await connection.flush?.()
        }
        await connection.close()
        closed = true
      })
    },
  }
}
