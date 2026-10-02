import type { SqliteDatabase } from '@weapp-sqlite/core'
import type { SqliteDebugStorage } from './types'
import { SqliteDebugError } from './errors'

/** Access is valid only until the exclusive callback settles. */
export interface SqliteDebugSessionScope {
  readonly database: Omit<SqliteDatabase, 'close'>
  readonly revision: number
  loadSnapshot: () => Promise<Uint8Array | undefined>
  replaceSnapshot: (bytes: Uint8Array | undefined) => Promise<void>
}

/** The host coordinates this queue with every other user of the database. */
export interface SqliteDebugSession {
  runExclusive: <T>(operation: (scope: SqliteDebugSessionScope) => Promise<T>) => Promise<T>
  /** Releases this debugger's ownership, without closing another owner's database. */
  close: () => Promise<void>
}

export function createOwnedSqliteDebugSession(options: {
  readonly databaseName: string
  readonly openDatabase: () => Promise<SqliteDatabase>
  readonly storage: SqliteDebugStorage
}): SqliteDebugSession {
  let current: SqliteDatabase | undefined
  let revision = 0
  let closed = false
  let tail = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>) {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  async function database() {
    return current ??= await options.openDatabase()
  }

  async function replaceSnapshot(bytes: Uint8Array | undefined) {
    const previous = await database()
    await previous.flush()
    const saved = await options.storage.load(options.databaseName)
    await previous.close()
    current = undefined
    try {
      if (bytes === undefined) {
        await options.storage.remove(options.databaseName)
      }
      else {
        await options.storage.save(options.databaseName, Uint8Array.from(bytes))
      }
      const replacement = await database()
      const validation = await replacement.query<{ quick_check: string }>('PRAGMA quick_check')
      if (validation.rows[0]?.quick_check !== 'ok') {
        throw new Error('SQLite quick_check did not return ok.')
      }
      revision++
    }
    catch (error) {
      try {
        const failedReplacement = current as SqliteDatabase | undefined
        try {
          await (failedReplacement as unknown as SqliteDatabase | undefined)?.close()
        }
        catch {
          // A corrupt replacement may fail while flushing on close; discard it.
        }
        current = undefined
        if (saved === undefined) {
          await options.storage.remove(options.databaseName)
        }
        else {
          await options.storage.save(options.databaseName, saved)
        }
        current = await options.openDatabase()
      }
      catch (rollbackError) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'The SQLite replacement and snapshot recovery both failed.', {
          cause: new AggregateError([error, rollbackError], 'SQLite replacement recovery failed.'),
        })
      }
      throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'The SQLite replacement failed; the previous snapshot was restored.', { cause: error })
    }
  }

  return {
    runExclusive(operation) {
      return enqueue(async () => {
        if (closed) {
          throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'The debug session is closed.')
        }
        let active = true
        function assertActive() {
          if (!active) {
            throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'The debug operation scope is no longer active.')
          }
        }
        const scopedDatabase: SqliteDebugSessionScope['database'] = {
          name: options.databaseName,
          async exec(sql, parameters) {
            assertActive()
            const result = await (await database()).exec(sql, parameters)
            revision++
            return result
          },
          async query(sql, parameters) {
            assertActive()
            return (await database()).query(sql, parameters)
          },
          async transaction(callback) {
            assertActive()
            const result = await (await database()).transaction(callback)
            revision++
            return result
          },
          async flush() {
            assertActive()
            await (await database()).flush()
          },
        }
        try {
          return await operation({
            database: scopedDatabase,
            get revision() { return revision },
            async loadSnapshot() {
              assertActive()
              await scopedDatabase.flush()
              const bytes = await options.storage.load(options.databaseName)
              return bytes === undefined ? undefined : Uint8Array.from(bytes)
            },
            async replaceSnapshot(bytes) {
              assertActive()
              await replaceSnapshot(bytes)
            },
          })
        }
        finally {
          active = false
        }
      })
    },
    close() {
      return enqueue(async () => {
        if (!closed) {
          await current?.close()
          current = undefined
          closed = true
        }
      })
    },
  }
}
