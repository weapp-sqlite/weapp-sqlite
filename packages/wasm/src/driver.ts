import type { SqliteConnection, SqliteDriver, SqliteExecResult, SqliteParameters, SqliteQueryResult, SqliteRow, SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteWasmDriverOptions, SqliteWasmParameters, SqlJsDatabase, SqlJsInitializer, SqlJsParameters, SqlJsScalar } from './types'
import { createSqliteDatabase } from '@weapp-sqlite/core'

function normalizeScalar(value: SqliteScalar): SqlJsScalar {
  if (typeof value === 'bigint') {
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
  let dirty = false

  return {
    async exec(sql: string, parameters?: SqliteParameters): Promise<SqliteExecResult> {
      database.run(sql, normalizeParameters(parameters))
      dirty = true
      const result = database.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid')
      const row = result[0]?.values[0]
      return {
        changes: Number(row?.[0] ?? 0),
        lastInsertRowid: Number(row?.[1] ?? 0),
      }
    },
    async query<Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters): Promise<SqliteQueryResult<Row>> {
      const result = database.exec(sql, normalizeParameters(parameters))[0]
      return result ? rowsFromResult<Row>(result) : { columns: [], rows: [] }
    },
    async flush() {
      if (!dirty) {
        return
      }
      await storage.save(name, database.export())
      dirty = false
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
      modulePromise ??= initializer(options.locateFile ? { locateFile: options.locateFile } : undefined)
      const module = await modulePromise
      const data = await options.storage.load(name)
      const database = new module.Database(data)
      return createConnection(database, name, options.storage)
    },
  }
}

export async function openSqliteWasmDatabase(initializer: SqlJsInitializer, name: string, options: SqliteWasmDriverOptions) {
  const driver = createSqliteWasmDriver(initializer, options)
  const connection = await driver.open(name)
  return createSqliteDatabase(name, connection)
}
