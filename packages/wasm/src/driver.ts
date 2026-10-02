import type { SqliteConnection, SqliteDatabase, SqliteDriver, SqliteExecResult, SqliteParameters, SqliteQueryResult, SqliteRow, SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteWasmDriverOptions, SqliteWasmParameters, SqlJsDatabase, SqlJsInitializer, SqlJsParameters, SqlJsResult, SqlJsScalar } from './types'
import { createSqliteDatabase } from '@weapp-sqlite/core'

function normalizeScalar(value: SqliteScalar): SqlJsScalar {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('SQLite WASM bigint parameters must be within the JavaScript safe integer range.')
    }
    return Number(value)
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return value
}

function normalizeParameters(parameters?: SqliteWasmParameters): SqlJsParameters | undefined {
  if (parameters === undefined) {
    return undefined
  }
  if (Array.isArray(parameters)) {
    return parameters.map(normalizeScalar)
  }
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, normalizeScalar(value)]))
}

function rowsFromResult<Row extends SqliteRow>(result: { columns: readonly string[], values: readonly (readonly unknown[])[] }): SqliteQueryResult<Row> {
  return {
    columns: result.columns,
    rows: result.values.map((values) => {
      const row: Record<string, unknown> = {}
      result.columns.forEach((column, index) => {
        row[column] = values[index]
      })
      return row as Row
    }),
  }
}

function createConnection(database: SqlJsDatabase, name: string, storage: SqliteWasmDriverOptions['storage']): SqliteConnection {
  let revision = 0
  let savedRevision = 0
  let saving = Promise.resolve()

  function execute(sql: string, parameters: SqliteParameters | undefined, fallback: 'run' | 'exec'): readonly SqlJsResult[] {
    const normalized = normalizeParameters(parameters)
    const previousRevision = revision
    // Mark before execution: a later statement can fail after an earlier write.
    revision += 1
    if (database.execWithMetadata) {
      const execution = database.execWithMetadata(sql, normalized)
      if (execution.readOnly) {
        revision = previousRevision
      }
      return execution.results
    }
    if (fallback === 'run') {
      database.run(sql, normalized)
      return []
    }
    return database.exec(sql, normalized)
  }

  return {
    async exec(sql: string, parameters?: SqliteParameters): Promise<SqliteExecResult> {
      execute(sql, parameters, 'run')
      const result = database.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid')
      const row = result[0]?.values[0]
      return {
        changes: Number(row?.[0] ?? 0),
        lastInsertRowid: Number(row?.[1] ?? 0),
      }
    },
    async query<Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters): Promise<SqliteQueryResult<Row>> {
      const result = execute(sql, parameters, 'exec')[0]
      return result ? rowsFromResult<Row>(result) : { columns: [], rows: [] }
    },
    flush() {
      const operation = saving.then(async () => {
        if (revision === savedRevision) {
          return
        }
        const snapshotRevision = revision
        await storage.save(name, database.exportSnapshot())
        savedRevision = snapshotRevision
      })
      saving = operation.catch(() => undefined)
      return operation
    },
    async close() {
      database.close()
    },
  }
}

export function createSqliteWasmDriver(initializer: SqlJsInitializer, options: SqliteWasmDriverOptions): SqliteDriver {
  let modulePromise: ReturnType<SqlJsInitializer> | undefined

  return {
    kind: 'wasm',
    async open(name) {
      if (!modulePromise) {
        const pending = Promise.resolve().then(() => initializer(options.locateFile ? { locateFile: options.locateFile } : undefined))
        modulePromise = pending
        void pending.catch(() => {
          if (modulePromise === pending) {
            modulePromise = undefined
          }
        })
      }
      const module = await modulePromise
      const data = await options.storage.load(name)
      const database = new module.Database(data)
      if (typeof database.exportSnapshot !== 'function') {
        const error = new TypeError('SQLite WASM engines must implement exportSnapshot() without resetting the connection. Use @weapp-sqlite/sqljs or migrate the custom initializer.')
        try {
          database.close()
        }
        catch (closeError) {
          throw new AggregateError([error, closeError], error.message, { cause: error })
        }
        throw error
      }
      return createConnection(database, name, options.storage)
    },
  }
}

export async function openSqliteWasmDatabase(initializer: SqlJsInitializer, name: string, options: SqliteWasmDriverOptions): Promise<SqliteDatabase> {
  const driver = createSqliteWasmDriver(initializer, options)
  const connection = await driver.open(name)
  return createSqliteDatabase(name, connection)
}
