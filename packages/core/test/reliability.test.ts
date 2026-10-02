import type { SqliteConnection, SqliteTransaction } from '@/index'
import { createSqliteDatabase, SqlitePersistenceError, SqliteTransactionError } from '@/index'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const calls: string[] = []
  const connection: SqliteConnection = {
    exec: vi.fn(async (sql) => {
      calls.push(sql)
      return { changes: 1 }
    }),
    query: vi.fn(async () => ({ columns: [], rows: [] })),
    flush: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { connection, calls, database: createSqliteDatabase('test', connection) }
}

describe('transaction failure boundaries', () => {
  it('reports committed persistence failure and retries without repeating SQL', async () => {
    const { database, connection, calls } = setup()
    const cause = new Error('storage unavailable')
    vi.mocked(connection.flush!).mockRejectedValueOnce(cause)
    const callback = vi.fn(async (transaction: SqliteTransaction) => transaction.exec('INSERT'))

    await expect(database.transaction(callback)).rejects.toMatchObject({
      name: 'SqlitePersistenceError',
      committed: true,
      cause,
    })
    expect(calls).toEqual(['BEGIN', 'INSERT', 'COMMIT'])
    await database.flush()
    expect(callback).toHaveBeenCalledOnce()
    expect(connection.flush).toHaveBeenCalledTimes(2)
    await database.query('SELECT')
  })

  it('does not roll back a BEGIN that failed, and releases the queue', async () => {
    const { database, connection } = setup()
    const cause = new Error('begin failed')
    vi.mocked(connection.exec).mockRejectedValueOnce(cause)
    const callback = vi.fn(async () => undefined)
    await expect(database.transaction(callback)).rejects.toBe(cause)
    expect(callback).not.toHaveBeenCalled()
    expect(connection.exec).toHaveBeenCalledOnce()
    await database.transaction(callback)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('rolls back a failed COMMIT and preserves its error', async () => {
    const { database, connection, calls } = setup()
    const cause = new Error('commit failed')
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'COMMIT') {
        throw cause
      }
      return { changes: 0 }
    })
    await expect(database.transaction(async () => undefined)).rejects.toBe(cause)
    expect(calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK'])
    expect(connection.flush).not.toHaveBeenCalled()
    await database.query('SELECT')
  })

  it('preserves both errors on rollback failure and prevents saving unknown state', async () => {
    const { database, connection } = setup()
    const original = new Error('callback failed')
    const rollback = new Error('rollback failed')
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      if (sql === 'ROLLBACK') {
        throw rollback
      }
      return { changes: 0 }
    })
    const failure = await database.transaction(async () => {
      throw original
    }).catch(error => error)
    expect(failure).toBeInstanceOf(SqliteTransactionError)
    expect(failure.cause).toBeInstanceOf(AggregateError)
    expect(failure.cause.errors).toEqual([original, rollback])
    await expect(database.exec('INSERT')).rejects.toBe(failure)
    await expect(database.flush()).rejects.toBe(failure)
    await database.close()
    expect(connection.flush).not.toHaveBeenCalled()
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('allows retrying a close whose persistence failed', async () => {
    const { database, connection } = setup()
    const cause = new Error('save failed')
    vi.mocked(connection.flush!).mockRejectedValueOnce(cause)
    await expect(database.close()).rejects.toBe(cause)
    expect(connection.close).not.toHaveBeenCalled()
    await database.close()
    await database.close()
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('exports an identifiable persistence error', () => {
    const cause = new Error('offline')
    const error = new SqlitePersistenceError({ cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.committed).toBe(true)
    expect(error.cause).toBe(cause)
  })
})

describe('transaction scope', () => {
  it('serializes and drains started operations before COMMIT', async () => {
    const { database, connection, calls } = setup()
    const started = deferred()
    const release = deferred()
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'first') {
        started.resolve()
        await release.promise
      }
      return { changes: 1 }
    })
    const transaction = database.transaction(async (tx) => {
      void tx.exec('first')
      void tx.exec('second')
    })
    await started.promise
    expect(calls).toEqual(['BEGIN', 'first'])
    release.resolve()
    await transaction
    expect(calls).toEqual(['BEGIN', 'first', 'second', 'COMMIT'])
  })

  it('rolls back a failed operation even if the callback omitted await', async () => {
    const { database, connection, calls } = setup()
    const cause = new Error('write failed')
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'INSERT') {
        throw cause
      }
      return { changes: 0 }
    })
    await expect(database.transaction(async (tx) => {
      void tx.exec('INSERT')
    })).rejects.toBe(cause)
    expect(calls).toEqual(['BEGIN', 'INSERT', 'ROLLBACK'])
  })

  it('rolls back caught operation failures and skips later accepted work', async () => {
    const { database, connection, calls } = setup()
    const cause = new Error('write failed')
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'INSERT') {
        throw cause
      }
      return { changes: 0 }
    })
    await expect(database.transaction(async (tx) => {
      await tx.exec('INSERT').catch(() => undefined)
      await expect(tx.exec('later INSERT')).rejects.toBe(cause)
      await expect(tx.query('later SELECT')).rejects.toBe(cause)
    })).rejects.toBe(cause)
    expect(calls).toEqual(['BEGIN', 'INSERT', 'ROLLBACK'])
    expect(connection.query).not.toHaveBeenCalled()
    expect(connection.flush).not.toHaveBeenCalled()
  })

  it('rejects new operations while accepted operations drain', async () => {
    const { database, connection, calls } = setup()
    const started = deferred()
    const release = deferred()
    let escaped!: SqliteTransaction
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'INSERT') {
        started.resolve()
        await release.promise
      }
      return { changes: 0 }
    })
    const outcome = database.transaction(async (tx) => {
      escaped = tx
      void tx.exec('INSERT')
    })
    await started.promise
    await expect(escaped.exec('late INSERT')).rejects.toBeInstanceOf(SqliteTransactionError)
    release.resolve()
    await outcome
    expect(calls).toEqual(['BEGIN', 'INSERT', 'COMMIT'])
  })

  it('drains started operations before rolling back a callback failure', async () => {
    const { database, connection, calls } = setup()
    const started = deferred()
    const release = deferred()
    const cause = new Error('callback failed')
    vi.mocked(connection.exec).mockImplementation(async (sql) => {
      calls.push(sql)
      if (sql === 'INSERT') {
        started.resolve()
        await release.promise
      }
      return { changes: 0 }
    })
    const outcome = database.transaction(async (tx) => {
      void tx.exec('INSERT')
      throw cause
    }).catch(error => error)
    await started.promise
    expect(calls).toEqual(['BEGIN', 'INSERT'])
    release.resolve()
    expect(await outcome).toBe(cause)
    expect(calls).toEqual(['BEGIN', 'INSERT', 'ROLLBACK'])
  })

  it.each([false, true])('rejects an escaped handle after settlement (failed: %s)', async (failed) => {
    const { database, connection } = setup()
    let escaped!: SqliteTransaction
    await database.transaction(async (tx) => {
      escaped = tx
      if (failed) {
        throw new Error('failed')
      }
    }).catch(() => undefined)
    await database.close()
    const calls = vi.mocked(connection.exec).mock.calls.length
    await expect(escaped.exec('INSERT')).rejects.toBeInstanceOf(SqliteTransactionError)
    await expect(escaped.query('SELECT')).rejects.toBeInstanceOf(SqliteTransactionError)
    expect(connection.exec).toHaveBeenCalledTimes(calls)
    expect(connection.query).not.toHaveBeenCalled()
  })
})
