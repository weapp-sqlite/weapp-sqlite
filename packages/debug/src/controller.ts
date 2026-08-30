import type { SqliteDatabase, SqliteParameters, SqliteScalar } from '@weapp-sqlite/core'
import type {
  SqliteDebugColumnDefinition,
  SqliteDebugController,
  SqliteDebugControllerOptions,
  SqliteDebugDestructiveOptions,
  SqliteDebugExecutionResult,
  SqliteDebugFilter,
  SqliteDebugImportMapping,
  SqliteDebugLimits,
  SqliteDebugMigrationStatus,
  SqliteDebugOrder,
  SqliteDebugPage,
  SqliteDebugQueryResult,
  SqliteDebugRowLocator,
  SqliteDebugSnapshot,
  SqliteDebugSnapshotMetadata,
  SqliteDebugTableCapabilities,
} from './types'
import { encodeDebugTable, parseDebugTable } from './codecs'
import { SqliteDebugError } from './errors'

const SQLITE_HEADER = 'SQLite format 3\0'
const SQLITE_HEADER_BYTES = Uint8Array.from(SQLITE_HEADER, character => character.charCodeAt(0))
const MIGRATIONS_TABLE = '__weapp_sqlite_migrations'
const DEFAULT_LIMITS: Required<SqliteDebugLimits> = {
  maxRows: 500,
  maxResultBytes: 1024 * 1024,
  maxImportBytes: 16 * 1024 * 1024,
  maxImportRows: 100_000,
  maxExportBytes: 16 * 1024 * 1024,
  maxExportRows: 100_000,
  maxUndoBytes: 16 * 1024 * 1024,
}

const READ_ONLY_PRAGMAS = new Set([
  'application_id',
  'collation_list',
  'compile_options',
  'encoding',
  'foreign_key_check',
  'foreign_key_list',
  'freelist_count',
  'function_list',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'module_list',
  'page_count',
  'page_size',
  'pragma_list',
  'quick_check',
  'schema_version',
  'table_info',
  'table_list',
  'table_xinfo',
  'user_version',
])

function quoteIdentifier(value: string) {
  if (!value || value.includes('\0')) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IDENTIFIER', 'SQLite identifiers may not be empty or contain NUL bytes.')
  }
  return `"${value.replaceAll('"', '""')}"`
}

function sqlCode(sql: string) {
  let result = ''
  let index = 0
  let quote: '\'' | '"' | '`' | ']' | undefined
  while (index < sql.length) {
    const current = sql[index] ?? ''
    const next = sql[index + 1] ?? ''
    if (quote) {
      result += current === '\n' ? '\n' : ' '
      if (quote === ']' ? current === ']' : current === quote) {
        if (quote !== ']' && next === quote) {
          result += ' '
          index += 2
          continue
        }
        quote = undefined
      }
      index += 1
      continue
    }
    if (current === '\'' || current === '"' || current === '`' || current === '[') {
      quote = current === '[' ? ']' : current
      result += ' '
      index += 1
      continue
    }
    if (current === '-' && next === '-') {
      result += '  '
      index += 2
      while (index < sql.length && sql[index] !== '\n') {
        result += ' '
        index += 1
      }
      continue
    }
    if (current === '/' && next === '*') {
      result += '  '
      index += 2
      while (index < sql.length) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          result += '  '
          index += 2
          break
        }
        result += sql[index] === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }
    result += current
    index += 1
  }
  return result
}

function normalizeSql(sql: string) {
  const value = sql.trim()
  if (!value) {
    throw new SqliteDebugError('SQLITE_DEBUG_READ_ONLY_SQL', 'SQL must not be empty.')
  }
  const code = sqlCode(value)
  const separators = Array.from(code.matchAll(/;/g), match => match.index)
  if (separators.length > 1 || (separators[0] !== undefined && code.slice(separators[0] + 1).trim())) {
    throw new SqliteDebugError('SQLITE_DEBUG_MULTIPLE_STATEMENTS', 'Only one SQL statement can be executed at a time.')
  }
  return separators[0] === undefined ? value : value.slice(0, separators[0]).trim()
}

function assertForbiddenSql(sql: string) {
  const normalized = sqlCode(sql).toLowerCase()
  const forbidden = /\b(?:attach|detach|load_extension)\b|pragma\s+(?:(?:main|temp)\s*\.\s*)?(?:writable_schema|database_list)\b|vacuum(?:\s+[a-z_][a-z0-9_]*)?\s+into\b/
  if (forbidden.test(normalized)) {
    throw new SqliteDebugError('SQLITE_DEBUG_FORBIDDEN_SQL', 'This SQL operation is not available from the debug controller.')
  }
  if (/\b(?:sqlite_\w*|__weapp_sqlite_migrations)\b|["`[](?:sqlite_\w*|__weapp_sqlite_migrations)["`\]]/i.test(sql)) {
    throw new SqliteDebugError('SQLITE_DEBUG_PROTECTED_OBJECT', 'SQLite system objects and the migration table are protected from debug writes.')
  }
}

function assertReadSql(sql: string) {
  assertForbiddenSql(sql)
  const normalized = sqlCode(sql).trim().toLowerCase()
  if (!/^(?:select|explain|pragma)\b/.test(normalized)) {
    throw new SqliteDebugError('SQLITE_DEBUG_READ_ONLY_SQL', 'Read mode only allows SELECT, EXPLAIN, and safe PRAGMA statements.')
  }
  if (normalized.startsWith('pragma')) {
    const match = /^pragma\s+(?:(?:main|temp)\s*\.\s*)?([a-z_][a-z0-9_]*)\b/.exec(normalized)
    if (!match?.[1] || !READ_ONLY_PRAGMAS.has(match[1]) || normalized.includes('=')) {
      throw new SqliteDebugError('SQLITE_DEBUG_READ_ONLY_SQL', 'Read mode only allows explicitly safe PRAGMA statements.')
    }
  }
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 0) {
    throw new SqliteDebugError('SQLITE_DEBUG_RESULT_LIMIT_EXCEEDED', 'Pagination values must be non-negative integers.')
  }
  return Math.min(result, maximum)
}

function normalizeBytes(value: Uint8Array | ArrayBuffer) {
  return value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(value.slice(0))
}

function byteLength(value: string) {
  return typeof TextEncoder === 'undefined' ? value.length : new TextEncoder().encode(value).byteLength
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Uint8Array) {
    return Array.from(value)
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }
  return value
}

function assertResultSize(value: unknown, limits: Required<SqliteDebugLimits>) {
  const serialized = JSON.stringify(jsonSafe(value))
  if (serialized === undefined || byteLength(serialized) > limits.maxResultBytes) {
    throw new SqliteDebugError('SQLITE_DEBUG_RESULT_LIMIT_EXCEEDED', `The result exceeds ${limits.maxResultBytes} bytes.`)
  }
}

function sha256Fallback(bytes: Uint8Array) {
  const constants = new Uint32Array([
    0x428A2F98,
    0x71374491,
    0xB5C0FBCF,
    0xE9B5DBA5,
    0x3956C25B,
    0x59F111F1,
    0x923F82A4,
    0xAB1C5ED5,
    0xD807AA98,
    0x12835B01,
    0x243185BE,
    0x550C7DC3,
    0x72BE5D74,
    0x80DEB1FE,
    0x9BDC06A7,
    0xC19BF174,
    0xE49B69C1,
    0xEFBE4786,
    0x0FC19DC6,
    0x240CA1CC,
    0x2DE92C6F,
    0x4A7484AA,
    0x5CB0A9DC,
    0x76F988DA,
    0x983E5152,
    0xA831C66D,
    0xB00327C8,
    0xBF597FC7,
    0xC6E00BF3,
    0xD5A79147,
    0x06CA6351,
    0x14292967,
    0x27B70A85,
    0x2E1B2138,
    0x4D2C6DFC,
    0x53380D13,
    0x650A7354,
    0x766A0ABB,
    0x81C2C92E,
    0x92722C85,
    0xA2BFE8A1,
    0xA81A664B,
    0xC24B8B70,
    0xC76C51A3,
    0xD192E819,
    0xD6990624,
    0xF40E3585,
    0x106AA070,
    0x19A4C116,
    0x1E376C08,
    0x2748774C,
    0x34B0BCB5,
    0x391C0CB3,
    0x4ED8AA4A,
    0x5B9CCA4F,
    0x682E6FF3,
    0x748F82EE,
    0x78A5636F,
    0x84C87814,
    0x8CC70208,
    0x90BEFFFA,
    0xA4506CEB,
    0xBEF9A3F7,
    0xC67178F2,
  ])
  const bitLength = bytes.byteLength * 8
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.byteLength] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  const hash = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19])
  const words = new Uint32Array(64)
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount))
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0
      const right = words[index - 2] ?? 0
      const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3)
      const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10)
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotate(e ?? 0, 6) ^ rotate(e ?? 0, 11) ^ rotate(e ?? 0, 25)
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0))
      const temp1 = ((h ?? 0) + sigma1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0
      const sigma0 = rotate(a ?? 0, 2) ^ rotate(a ?? 0, 13) ^ rotate(a ?? 0, 22)
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0))
      const temp2 = (sigma0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = ((d ?? 0) + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index += 1) {
      hash[index] = ((hash[index] ?? 0) + (next[index] ?? 0)) >>> 0
    }
  }
  return Array.from(hash, value => value.toString(16).padStart(8, '0')).join('')
}

async function sha256(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    return sha256Fallback(bytes)
  }
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function isSqliteFile(bytes: Uint8Array) {
  return bytes.byteLength >= SQLITE_HEADER_BYTES.byteLength
    && SQLITE_HEADER_BYTES.every((byte, index) => bytes[index] === byte)
}

function assertMutableIdentifier(value: string) {
  quoteIdentifier(value)
  if (value.startsWith('sqlite_') || value === MIGRATIONS_TABLE) {
    throw new SqliteDebugError('SQLITE_DEBUG_PROTECTED_OBJECT', `SQLite object "${value}" is protected from debug writes.`)
  }
}

function assertWrite(options: { readonly allowWrite?: boolean } | undefined) {
  if (options?.allowWrite !== true) {
    throw new SqliteDebugError('SQLITE_DEBUG_WRITE_CONFIRMATION_REQUIRED', 'This operation requires allowWrite: true and an explicit UI confirmation.')
  }
}

function assertDestructive(tableName: string, options: SqliteDebugDestructiveOptions) {
  assertWrite(options)
  if (options.confirmTable !== tableName) {
    throw new SqliteDebugError('SQLITE_DEBUG_CONFIRMATION_MISMATCH', `Type the exact table name "${tableName}" to confirm this operation.`)
  }
}

function columnDefinitionSql(column: SqliteDebugColumnDefinition) {
  assertMutableIdentifier(column.name)
  const parts = [quoteIdentifier(column.name), column.type]
  if (column.primaryKey) {
    parts.push('PRIMARY KEY')
  }
  if (column.notNull) {
    parts.push('NOT NULL')
  }
  if (column.unique) {
    parts.push('UNIQUE')
  }
  if (column.defaultExpression) {
    parts.push('DEFAULT', column.defaultExpression)
  }
  return parts.join(' ')
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function compileWhere(
  columns: readonly string[],
  filters: readonly SqliteDebugFilter[] = [],
  search?: string,
) {
  const available = new Set(columns)
  const clauses: string[] = []
  const parameters: SqliteScalar[] = []
  const operators: Record<Exclude<SqliteDebugFilter['operator'], 'contains' | 'startsWith' | 'isNull' | 'isNotNull'>, string> = {
    eq: '=',
    ne: '<>',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
  }
  for (const filter of filters) {
    if (!available.has(filter.column)) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_FILTER', `Unknown filter column "${filter.column}".`)
    }
    const identifier = quoteIdentifier(filter.column)
    if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
      clauses.push(`${identifier} IS ${filter.operator === 'isNull' ? '' : 'NOT '}NULL`)
    }
    else if (filter.operator === 'contains' || filter.operator === 'startsWith') {
      if (typeof filter.value !== 'string') {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_FILTER', `${filter.operator} requires a string value.`)
      }
      clauses.push(`CAST(${identifier} AS TEXT) LIKE ? ESCAPE '\\'`)
      parameters.push(`${filter.operator === 'contains' ? '%' : ''}${escapeLike(filter.value)}%`)
    }
    else {
      if (filter.value === undefined) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_FILTER', `${filter.operator} requires a value.`)
      }
      clauses.push(`${identifier} ${operators[filter.operator]} ?`)
      parameters.push(filter.value)
    }
  }
  if (search) {
    const value = `%${escapeLike(search)}%`
    clauses.push(`(${columns.map(column => `CAST(${quoteIdentifier(column)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    parameters.push(...columns.map(() => value))
  }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', parameters }
}

function compileOrder(columns: readonly string[], orderBy: readonly SqliteDebugOrder[] = []) {
  const available = new Set(columns)
  for (const order of orderBy) {
    if (!available.has(order.column) || (order.direction !== 'asc' && order.direction !== 'desc')) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_FILTER', `Invalid order column or direction for "${order.column}".`)
    }
  }
  return orderBy.length === 0 ? '' : ` ORDER BY ${orderBy.map(order => `${quoteIdentifier(order.column)} ${order.direction.toUpperCase()}`).join(', ')}`
}

function locatorWhere(locator: SqliteDebugRowLocator, primaryKey: readonly string[]) {
  if (locator.kind === 'rowid') {
    return { sql: 'rowid = ?', parameters: [locator.value] satisfies SqliteScalar[] }
  }
  const keys = Object.keys(locator.values)
  if (primaryKey.length === 0 || keys.length !== primaryKey.length || primaryKey.some(key => !Object.hasOwn(locator.values, key))) {
    throw new SqliteDebugError('SQLITE_DEBUG_ROW_CONFLICT', 'The row locator does not match the table primary key.')
  }
  return {
    sql: primaryKey.map(column => `${quoteIdentifier(column)} IS ?`).join(' AND '),
    parameters: primaryKey.map(column => locator.values[column] ?? null),
  }
}

function normalizeMapping(
  sourceColumns: readonly string[],
  mappings: readonly SqliteDebugImportMapping[] | undefined,
) {
  const result: readonly SqliteDebugImportMapping[] = mappings ?? sourceColumns.map(column => ({ source: column, target: column }))
  const source = new Set(sourceColumns)
  const targets = new Set<string>()
  for (const mapping of result) {
    if (!source.has(mapping.source) || targets.has(mapping.target)) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Import mappings must reference existing source fields and unique target columns.')
    }
    assertMutableIdentifier(mapping.target)
    targets.add(mapping.target)
  }
  if (result.length === 0) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'At least one import mapping is required.')
  }
  return result
}

function coerceImportedValue(value: SqliteScalar, type: SqliteDebugColumnDefinition['type']): SqliteScalar {
  if (value === null) {
    return null
  }
  if (type === 'TEXT') {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'BLOB values cannot be imported into a TEXT column automatically.')
    }
    return String(value)
  }
  if (type === 'BLOB') {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return value
    }
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Only tagged JSON BLOB values can be imported into a BLOB column.')
  }
  if (type === 'INTEGER') {
    if (typeof value === 'bigint') {
      return value
    }
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isSafeInteger(number)) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', `Value "${String(value)}" is not a safe INTEGER.`)
    }
    return number
  }
  if (type === 'REAL' || type === 'NUMERIC') {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number)) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', `Value "${String(value)}" is not numeric.`)
    }
    return number
  }
  return value
}

export function createSqliteDebugController(options: SqliteDebugControllerOptions): SqliteDebugController {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  let databasePromise: Promise<SqliteDatabase> | undefined
  let closed = false
  let undo: { readonly bytes?: Uint8Array, readonly operation: string, readonly createdAt: string } | undefined

  function assertEnabled() {
    if (options.enabled !== true) {
      throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'SQLite debug capability is disabled in this build.')
    }
  }

  async function database() {
    assertEnabled()
    if (closed) {
      throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'The debug controller is closed.')
    }
    return databasePromise ??= options.openDatabase()
  }

  async function read(sql: string, parameters?: SqliteParameters) {
    const current = await database()
    const started = Date.now()
    const result = await current.query(sql, parameters)
    assertResultSize(result, limits)
    if (result.rows.length > limits.maxRows) {
      throw new SqliteDebugError('SQLITE_DEBUG_RESULT_LIMIT_EXCEEDED', `The result exceeds ${limits.maxRows} rows.`)
    }
    return { ...result, elapsedMs: Date.now() - started } satisfies SqliteDebugQueryResult
  }

  async function objectRecord(tableName: string) {
    quoteIdentifier(tableName)
    const current = await database()
    const result = await current.query<{ name: string, type: string, sql: string | null }>(
      'SELECT name, type, sql FROM sqlite_schema WHERE name = ? AND type IN (\'table\', \'view\')',
      [tableName],
    )
    const record = result.rows[0]
    if (!record) {
      throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_NOT_FOUND', `SQLite object "${tableName}" does not exist.`)
    }
    return record
  }

  async function tableDetails(tableName: string) {
    const object = await objectRecord(tableName)
    const current = await database()
    const info = await current.query<{ name: string, type: string, notnull: number, pk: number, dflt_value: unknown }>(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    const primaryKey = info.rows.filter(column => Number(column.pk) > 0).sort((left, right) => Number(left.pk) - Number(right.pk)).map(column => String(column.name))
    const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(object.sql ?? '')
    const capabilities: SqliteDebugTableCapabilities = {
      tableName,
      objectType: object.type === 'view' ? 'view' : 'table',
      readable: true,
      writable: object.type === 'table' && (primaryKey.length > 0 || !withoutRowid),
      locator: object.type === 'view' ? 'none' : primaryKey.length > 0 ? 'primary-key' : withoutRowid ? 'none' : 'rowid',
      primaryKey,
      supportsRenameColumn: object.type === 'table',
      supportsDropColumn: object.type === 'table',
      ...(object.type === 'view' ? { reason: 'Views are read-only.' } : withoutRowid && primaryKey.length === 0 ? { reason: 'This table has no usable row locator.' } : {}),
    }
    return { object, info: info.rows, capabilities }
  }

  async function createUndoSnapshot(operation: string) {
    const current = await database()
    await current.flush()
    const bytes = await options.storage.load(options.databaseName)
    if (bytes && bytes.byteLength > limits.maxUndoBytes) {
      throw new SqliteDebugError('SQLITE_DEBUG_UNDO_TOO_LARGE', `The database exceeds the ${limits.maxUndoBytes} byte undo limit.`)
    }
    return {
      ...(bytes === undefined ? {} : { bytes: Uint8Array.from(bytes) }),
      operation,
      createdAt: new Date().toISOString(),
    }
  }

  async function writeOperation<T>(operation: string, callback: (current: SqliteDatabase) => Promise<T>) {
    const previous = await createUndoSnapshot(operation)
    const result = await callback(await database())
    undo = previous
    return result
  }

  async function replaceSnapshot(bytes: Uint8Array, failureCode: 'SQLITE_DEBUG_IMPORT_FAILED' | 'SQLITE_DEBUG_UNDO_UNAVAILABLE') {
    const current = await database()
    await current.close()
    databasePromise = undefined
    let replacement: SqliteDatabase | undefined
    try {
      await options.storage.save(options.databaseName, bytes)
      replacement = await database()
      const validation = await replacement.query<{ quick_check: string }>('PRAGMA quick_check')
      if (validation.rows[0]?.quick_check !== 'ok') {
        throw new Error('SQLite quick_check did not return ok.')
      }
      return replacement
    }
    catch (error) {
      databasePromise = undefined
      try {
        await replacement?.close()
      }
      catch {}
      throw new SqliteDebugError(failureCode, 'The SQLite snapshot could not be opened.', { cause: error })
    }
  }

  function assertWritable(capabilities: SqliteDebugTableCapabilities) {
    if (!capabilities.writable) {
      throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_READ_ONLY', capabilities.reason ?? `SQLite object "${capabilities.tableName}" is read-only.`)
    }
  }

  async function migrationStatus(current: SqliteDatabase): Promise<SqliteDebugMigrationStatus> {
    const exists = await current.query<{ name: string }>(
      'SELECT name FROM sqlite_schema WHERE type = \'table\' AND name = ?',
      [MIGRATIONS_TABLE],
    )
    if (exists.rows.length === 0) {
      return { tablePresent: false, versions: [] }
    }
    const result = await current.query<{ version: number, name: string, applied_at: string }>(
      `SELECT version, name, applied_at FROM ${quoteIdentifier(MIGRATIONS_TABLE)} ORDER BY version`,
    )
    return {
      tablePresent: true,
      versions: result.rows.map(row => ({ version: Number(row.version), name: row.name, appliedAt: row.applied_at })),
    }
  }

  async function metadata(bytes: Uint8Array, current: SqliteDatabase): Promise<SqliteDebugSnapshotMetadata> {
    const migrations = await migrationStatus(current)
    return {
      databaseName: options.databaseName,
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
      migrationVersions: migrations.versions.map(item => item.version),
      exportedAt: new Date().toISOString(),
      runtime: options.runtime ?? {},
    }
  }

  return {
    async listTables() {
      const result = await read('SELECT name, type, sql FROM sqlite_schema WHERE type IN (\'table\', \'view\') AND name NOT LIKE \'sqlite_%\' AND name <> ? ORDER BY name', [MIGRATIONS_TABLE])
      return result.rows.map(row => ({ name: String(row['name']), type: String(row['type']), sql: row['sql'] == null ? null : String(row['sql']) }))
    },
    async describeTable(tableName) {
      const result = await read(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      return result.rows.map(row => ({
        name: String(row['name']),
        type: String(row['type'] ?? ''),
        notNull: Number(row['notnull']) === 1,
        primaryKey: Number(row['pk']) > 0,
        defaultValue: row['dflt_value'],
      }))
    },
    async getTableCapabilities(tableName) {
      return (await tableDetails(tableName)).capabilities
    },
    async listIndexes(tableName) {
      await objectRecord(tableName)
      const current = await database()
      const indexes = await current.query<{ name: string, unique: number, origin: string, partial: number }>(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
      return Promise.all(indexes.rows.map(async (index) => {
        const columns = await current.query<{ name: string | null, desc: number, key: number }>(`PRAGMA index_xinfo(${quoteIdentifier(index.name)})`)
        return {
          name: index.name,
          unique: Number(index.unique) === 1,
          origin: index.origin,
          partial: Number(index.partial) === 1,
          columns: columns.rows.filter(column => Number(column.key) === 1 && column.name != null).map(column => ({
            name: String(column.name),
            direction: Number(column.desc) === 1 ? 'desc' as const : 'asc' as const,
          })),
          editable: index.origin === 'c' && !index.name.startsWith('sqlite_'),
        }
      }))
    },
    async readTable(tableName, pageOptions = {}) {
      const limit = bounded(pageOptions.limit, 50, limits.maxRows)
      const offset = bounded(pageOptions.offset, 0, Number.MAX_SAFE_INTEGER)
      const current = await database()
      const details = await tableDetails(tableName)
      const columns = details.info.map(column => String(column.name))
      const where = compileWhere(columns, pageOptions.filters, pageOptions.search)
      const order = compileOrder(columns, pageOptions.orderBy)
      const totalResult = await current.query<{ total: number }>(`SELECT count(*) AS total FROM ${quoteIdentifier(tableName)}${where.sql}`, where.parameters)
      let rowidAlias = '__weapp_sqlite_rowid'
      while (columns.includes(rowidAlias)) {
        rowidAlias += '_'
      }
      const locatorSelect = details.capabilities.locator === 'rowid' ? `rowid AS ${quoteIdentifier(rowidAlias)}, ` : ''
      const result = await read(`SELECT ${locatorSelect}* FROM ${quoteIdentifier(tableName)}${where.sql}${order} LIMIT ? OFFSET ?`, [...where.parameters, limit, offset])
      const rows = result.rows.map((row) => {
        if (details.capabilities.locator !== 'rowid') {
          return row as Record<string, unknown>
        }
        return Object.fromEntries(Object.entries(row).filter(([key]) => key !== rowidAlias))
      })
      const rowLocators = result.rows.map((row): SqliteDebugRowLocator => details.capabilities.locator === 'primary-key'
        ? { kind: 'primary-key', values: Object.fromEntries(details.capabilities.primaryKey.map(column => [column, row[column] as SqliteScalar])) }
        : { kind: 'rowid', value: row[rowidAlias] as number | bigint })
      const page: SqliteDebugPage = {
        columns,
        rows,
        rowLocators: details.capabilities.locator === 'none' ? [] : rowLocators,
        total: Number(totalResult.rows[0]?.total ?? 0),
        limit,
        offset,
      }
      assertResultSize(page, limits)
      return page
    },
    async query(sql, parameters) {
      const normalized = normalizeSql(sql)
      assertReadSql(normalized)
      const querySql = sqlCode(normalized).trimStart().toLowerCase().startsWith('select')
        ? `SELECT * FROM (${normalized}) LIMIT ${limits.maxRows + 1}`
        : normalized
      return read(querySql, parameters)
    },
    async execute(sql, parameters, executeOptions = {}) {
      const normalized = normalizeSql(sql)
      assertForbiddenSql(normalized)
      assertWrite(executeOptions)
      const started = Date.now()
      const result = await writeOperation('Execute write SQL', current => current.exec(normalized, parameters))
      return { ...result, elapsedMs: Date.now() - started } satisfies SqliteDebugExecutionResult
    },
    async insertRow(tableName, values, writeOptions) {
      assertWrite(writeOptions)
      assertMutableIdentifier(tableName)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      const columns = Object.keys(values)
      if (columns.length === 0) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Insert requires at least one column value.')
      }
      const available = new Set(details.info.map(column => String(column.name)))
      if (columns.some(column => !available.has(column))) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Insert contains an unknown column.')
      }
      const started = Date.now()
      const result = await writeOperation(`Insert row into ${tableName}`, current => current.exec(
        `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map(column => values[column] ?? null),
      ))
      return { ...result, elapsedMs: Date.now() - started }
    },
    async updateRow(tableName, locator, values, writeOptions) {
      assertWrite(writeOptions)
      assertMutableIdentifier(tableName)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      const columns = Object.keys(values)
      const available = new Set(details.info.map(column => String(column.name)))
      if (columns.length === 0 || columns.some(column => !available.has(column))) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Update requires valid column values.')
      }
      const where = locatorWhere(locator, details.capabilities.primaryKey)
      const started = Date.now()
      const result = await writeOperation(`Update row in ${tableName}`, current => current.exec(
        `UPDATE ${quoteIdentifier(tableName)} SET ${columns.map(column => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where.sql}`,
        [...columns.map(column => values[column] ?? null), ...where.parameters],
      ))
      if (result.changes !== 1) {
        throw new SqliteDebugError('SQLITE_DEBUG_ROW_CONFLICT', `Expected to update one row, but SQLite changed ${result.changes}.`)
      }
      return { ...result, elapsedMs: Date.now() - started }
    },
    async deleteRows(tableName, locators, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      if (locators.length === 0) {
        throw new SqliteDebugError('SQLITE_DEBUG_ROW_CONFLICT', 'Select at least one row to delete.')
      }
      const started = Date.now()
      const result = await writeOperation(`Delete ${locators.length} row(s) from ${tableName}`, current => current.transaction(async (transaction) => {
        let changes = 0
        for (const locator of locators) {
          const where = locatorWhere(locator, details.capabilities.primaryKey)
          const deleted = await transaction.exec(`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${where.sql}`, where.parameters)
          if (deleted.changes !== 1) {
            throw new SqliteDebugError('SQLITE_DEBUG_ROW_CONFLICT', `A selected row in "${tableName}" changed before deletion.`)
          }
          changes += deleted.changes
        }
        return { changes }
      }))
      return { ...result, elapsedMs: Date.now() - started }
    },
    async createTable(tableName, columns, writeOptions) {
      assertWrite(writeOptions)
      assertMutableIdentifier(tableName)
      if (columns.length === 0) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'A table requires at least one column.')
      }
      const names = columns.map(column => column.name)
      if (new Set(names).size !== names.length || columns.filter(column => column.primaryKey).length > 1) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Table columns must be unique and contain at most one inline primary key.')
      }
      const current = await database()
      const existing = await current.query('SELECT name FROM sqlite_schema WHERE name = ?', [tableName])
      if (existing.rows.length > 0) {
        throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_CONFLICT', `SQLite object "${tableName}" already exists.`)
      }
      await writeOperation(`Create table ${tableName}`, database => database.exec(`CREATE TABLE ${quoteIdentifier(tableName)} (${columns.map(columnDefinitionSql).join(', ')})`).then(() => undefined))
    },
    async renameTable(tableName, newName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertMutableIdentifier(newName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      await writeOperation(`Rename table ${tableName} to ${newName}`, current => current.exec(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(newName)}`).then(() => undefined))
    },
    async dropTable(tableName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      if (details.object.type !== 'table') {
        throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_READ_ONLY', 'Views cannot be dropped through table management.')
      }
      await writeOperation(`Drop table ${tableName}`, current => current.exec(`DROP TABLE ${quoteIdentifier(tableName)}`).then(() => undefined))
    },
    async truncateTable(tableName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      const started = Date.now()
      const result = await writeOperation(`Truncate table ${tableName}`, current => current.exec(`DELETE FROM ${quoteIdentifier(tableName)}`))
      return { ...result, elapsedMs: Date.now() - started }
    },
    async addColumn(tableName, column, writeOptions) {
      assertWrite(writeOptions)
      assertMutableIdentifier(tableName)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      if (column.primaryKey || column.unique) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'SQLite ALTER TABLE cannot add a primary-key or unique column without rebuilding the table.')
      }
      await writeOperation(`Add column ${column.name} to ${tableName}`, current => current.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${columnDefinitionSql(column)}`).then(() => undefined))
    },
    async renameColumn(tableName, columnName, newName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertMutableIdentifier(columnName)
      assertMutableIdentifier(newName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      await writeOperation(`Rename column ${tableName}.${columnName}`, current => current.exec(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(columnName)} TO ${quoteIdentifier(newName)}`).then(() => undefined))
    },
    async dropColumn(tableName, columnName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertMutableIdentifier(columnName)
      assertDestructive(tableName, destructiveOptions)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      await writeOperation(`Drop column ${tableName}.${columnName}`, current => current.exec(`ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`).then(() => undefined))
    },
    async createIndex(tableName, indexName, columns, indexOptions) {
      assertWrite(indexOptions)
      assertMutableIdentifier(tableName)
      assertMutableIdentifier(indexName)
      const details = await tableDetails(tableName)
      assertWritable(details.capabilities)
      const available = new Set(details.info.map(column => String(column.name)))
      if (columns.length === 0 || columns.some(column => !available.has(column.name))) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'Index columns must exist on the selected table.')
      }
      await writeOperation(`Create index ${indexName}`, current => current.exec(
        `CREATE ${indexOptions.unique === true ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${columns.map(column => `${quoteIdentifier(column.name)} ${column.direction.toUpperCase()}`).join(', ')})`,
      ).then(() => undefined))
    },
    async dropIndex(tableName, indexName, destructiveOptions) {
      assertMutableIdentifier(tableName)
      assertMutableIdentifier(indexName)
      assertDestructive(tableName, destructiveOptions)
      const indexes = await this.listIndexes(tableName)
      const index = indexes.find(item => item.name === indexName)
      if (!index) {
        throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_NOT_FOUND', `Index "${indexName}" does not exist on "${tableName}".`)
      }
      if (!index.editable) {
        throw new SqliteDebugError('SQLITE_DEBUG_PROTECTED_OBJECT', `Index "${indexName}" is managed by SQLite and cannot be dropped.`)
      }
      await writeOperation(`Drop index ${indexName}`, current => current.exec(`DROP INDEX ${quoteIdentifier(indexName)}`).then(() => undefined))
    },
    async getMigrationStatus() {
      return migrationStatus(await database())
    },
    async exportDatabase(): Promise<SqliteDebugSnapshot> {
      const current = await database()
      await current.flush()
      const bytes = await options.storage.load(options.databaseName)
      if (!bytes) {
        throw new SqliteDebugError('SQLITE_DEBUG_STORAGE_UNSUPPORTED', 'The database has not produced a persistent SQLite snapshot yet.')
      }
      return { bytes: Uint8Array.from(bytes), metadata: await metadata(bytes, current) }
    },
    async importDatabase(input, importOptions) {
      assertEnabled()
      if (importOptions.replace !== true) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'Import must explicitly set replace: true.')
      }
      const bytes = normalizeBytes(input)
      if (bytes.byteLength > limits.maxImportBytes) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_TOO_LARGE', `The import exceeds ${limits.maxImportBytes} bytes.`)
      }
      if (!isSqliteFile(bytes)) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The import is not a SQLite database file.')
      }
      const current = await database()
      await current.flush()
      const previous = await options.storage.load(options.databaseName)
      await current.close()
      databasePromise = undefined
      let replacement: SqliteDatabase | undefined
      try {
        await options.storage.save(options.databaseName, bytes)
        replacement = await database()
        const validation = await replacement.query<{ quick_check: string }>('PRAGMA quick_check')
        if (validation.rows[0]?.quick_check !== 'ok') {
          throw new Error('SQLite quick_check did not return ok.')
        }
        if (previous && previous.byteLength <= limits.maxUndoBytes) {
          undo = { bytes: Uint8Array.from(previous), operation: 'Import SQLite database', createdAt: new Date().toISOString() }
        }
        return metadata(bytes, replacement)
      }
      catch (error) {
        databasePromise = undefined
        if (replacement) {
          try {
            await replacement.close()
          }
          catch {}
        }
        try {
          if (previous) {
            await options.storage.save(options.databaseName, previous)
          }
          else {
            await options.storage.remove(options.databaseName)
          }
          await database()
        }
        catch (rollbackError) {
          databasePromise = undefined
          throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'The imported SQLite database failed validation and the previous snapshot could not be reopened.', { cause: rollbackError })
        }
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'The imported SQLite database could not be opened; the previous snapshot was restored.', { cause: error })
      }
    },
    async exportTable(tableName, exportOptions) {
      const details = await tableDetails(tableName)
      const current = await database()
      const total = await current.query<{ total: number }>(`SELECT count(*) AS total FROM ${quoteIdentifier(tableName)}`)
      const rowCount = Number(total.rows[0]?.total ?? 0)
      if (rowCount > limits.maxExportRows) {
        throw new SqliteDebugError('SQLITE_DEBUG_EXPORT_TOO_LARGE', `The table exceeds the ${limits.maxExportRows} row export limit.`)
      }
      const result = await current.query(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ?`, [limits.maxExportRows + 1])
      const columns = details.info.map(column => String(column.name))
      const bytes = encodeDebugTable(tableName, exportOptions.format, columns, result.rows)
      if (bytes.byteLength > limits.maxExportBytes) {
        throw new SqliteDebugError('SQLITE_DEBUG_EXPORT_TOO_LARGE', `The table export exceeds ${limits.maxExportBytes} bytes.`)
      }
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
      return {
        fileName: `${tableName}-${timestamp}.${exportOptions.format}`,
        mimeType: exportOptions.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
        bytes,
        tableName,
        format: exportOptions.format,
        rowCount,
        byteLength: bytes.byteLength,
      }
    },
    async previewTableImport(source, previewOptions = {}) {
      const sourceBytes = typeof source.bytes === 'string' ? byteLength(source.bytes) : source.bytes.byteLength
      if (sourceBytes > limits.maxImportBytes) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_TOO_LARGE', `The import exceeds ${limits.maxImportBytes} bytes.`)
      }
      const parsed = parseDebugTable(source)
      if (parsed.rows.length > limits.maxImportRows) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_ROW_LIMIT_EXCEEDED', `The import exceeds ${limits.maxImportRows} rows.`)
      }
      const sampleRows = bounded(previewOptions.sampleRows, 20, 100)
      return {
        format: source.format,
        sourceColumns: parsed.columns,
        suggestedColumns: parsed.columns.map(column => ({ source: column, target: column, inferredType: parsed.inferredTypes[column] ?? 'TEXT' })),
        sampleRows: parsed.rows.slice(0, sampleRows),
        totalRows: parsed.rows.length,
      }
    },
    async importTable(source, importOptions) {
      assertWrite(importOptions)
      assertMutableIdentifier(importOptions.tableName)
      const sourceBytes = typeof source.bytes === 'string' ? byteLength(source.bytes) : source.bytes.byteLength
      if (sourceBytes > limits.maxImportBytes) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_TOO_LARGE', `The import exceeds ${limits.maxImportBytes} bytes.`)
      }
      const parsed = parseDebugTable(source)
      if (parsed.rows.length > limits.maxImportRows) {
        throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_ROW_LIMIT_EXCEEDED', `The import exceeds ${limits.maxImportRows} rows.`)
      }
      const mappings = normalizeMapping(parsed.columns, importOptions.mappings)
      const current = await database()
      const existingResult = await current.query<{ name: string }>('SELECT name FROM sqlite_schema WHERE name = ? AND type = \'table\'', [importOptions.tableName])
      const exists = existingResult.rows.length > 0
      if (importOptions.mode === 'create' && exists) {
        throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_CONFLICT', `Table "${importOptions.tableName}" already exists.`)
      }
      if (importOptions.mode === 'append' && !exists) {
        throw new SqliteDebugError('SQLITE_DEBUG_OBJECT_NOT_FOUND', `Table "${importOptions.tableName}" does not exist.`)
      }
      if (importOptions.mode === 'replace' && exists && importOptions.confirmTable !== importOptions.tableName) {
        throw new SqliteDebugError('SQLITE_DEBUG_CONFIRMATION_MISMATCH', `Type the exact table name "${importOptions.tableName}" to replace its data.`)
      }
      const definitions = mappings.map(mapping => ({
        name: mapping.target,
        type: mapping.type ?? parsed.inferredTypes[mapping.source] ?? 'TEXT',
      }))
      if (exists) {
        const targetColumns = new Set((await tableDetails(importOptions.tableName)).info.map(column => String(column.name)))
        if (definitions.some(column => !targetColumns.has(column.name))) {
          throw new SqliteDebugError('SQLITE_DEBUG_INVALID_MAPPING', 'An import target column does not exist on the selected table.')
        }
      }
      const insertedRows = await writeOperation(`Import ${parsed.rows.length} row(s) into ${importOptions.tableName}`, database => database.transaction(async (transaction) => {
        if (!exists) {
          await transaction.exec(`CREATE TABLE ${quoteIdentifier(importOptions.tableName)} (${definitions.map(columnDefinitionSql).join(', ')})`)
        }
        else if (importOptions.mode === 'replace') {
          await transaction.exec(`DELETE FROM ${quoteIdentifier(importOptions.tableName)}`)
        }
        const columnSql = definitions.map(column => quoteIdentifier(column.name)).join(', ')
        const placeholders = definitions.map(() => '?').join(', ')
        let inserted = 0
        for (const row of parsed.rows) {
          const values = mappings.map((mapping, index) => coerceImportedValue(row[mapping.source] ?? null, definitions[index]?.type ?? 'TEXT'))
          const result = await transaction.exec(`INSERT INTO ${quoteIdentifier(importOptions.tableName)} (${columnSql}) VALUES (${placeholders})`, values)
          inserted += result.changes
        }
        return inserted
      }))
      return { tableName: importOptions.tableName, mode: importOptions.mode, insertedRows }
    },
    getUndoState() {
      return undo
        ? { available: true, operation: undo.operation, createdAt: undo.createdAt, byteLength: undo.bytes?.byteLength ?? 0 }
        : { available: false }
    },
    async undoLastDestructiveChange() {
      assertEnabled()
      if (!undo) {
        throw new SqliteDebugError('SQLITE_DEBUG_UNDO_UNAVAILABLE', 'No debug write is available to undo in this session.')
      }
      const snapshot = undo
      if (snapshot.bytes) {
        await replaceSnapshot(snapshot.bytes, 'SQLITE_DEBUG_UNDO_UNAVAILABLE')
      }
      else {
        const current = await database()
        await current.close()
        databasePromise = undefined
        await options.storage.remove(options.databaseName)
        await database()
      }
      undo = undefined
    },
    async resetDatabase() {
      await writeOperation('Reset database', async (current) => {
        await current.close()
        databasePromise = undefined
        await options.storage.remove(options.databaseName)
        await database()
      })
    },
    async close() {
      if (closed) {
        return
      }
      closed = true
      if (databasePromise) {
        const current = await databasePromise
        await current.close()
      }
      databasePromise = undefined
    },
  }
}
