import type { SqliteDatabase, SqliteParameters } from '@weapp-sqlite/core'
import type {
  SqliteDebugController,
  SqliteDebugControllerOptions,
  SqliteDebugExecutionResult,
  SqliteDebugLimits,
  SqliteDebugMigrationStatus,
  SqliteDebugPage,
  SqliteDebugQueryResult,
  SqliteDebugSnapshot,
  SqliteDebugSnapshotMetadata,
} from './types'
import { SqliteDebugError } from './errors'

const SQLITE_HEADER = 'SQLite format 3\0'
const SQLITE_HEADER_BYTES = Uint8Array.from(SQLITE_HEADER, character => character.charCodeAt(0))
const MIGRATIONS_TABLE = '__weapp_sqlite_migrations'
const DEFAULT_LIMITS: Required<SqliteDebugLimits> = {
  maxRows: 500,
  maxResultBytes: 1024 * 1024,
  maxImportBytes: 16 * 1024 * 1024,
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

export function createSqliteDebugController(options: SqliteDebugControllerOptions): SqliteDebugController {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  let databasePromise: Promise<SqliteDatabase> | undefined
  let closed = false

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
    async readTable(tableName, pageOptions = {}) {
      const limit = bounded(pageOptions.limit, 50, limits.maxRows)
      const offset = bounded(pageOptions.offset, 0, Number.MAX_SAFE_INTEGER)
      const current = await database()
      const totalResult = await current.query<{ total: number }>(`SELECT count(*) AS total FROM ${quoteIdentifier(tableName)}`)
      const result = await read(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ? OFFSET ?`, [limit, offset])
      const page: SqliteDebugPage = {
        columns: result.columns,
        rows: result.rows as Record<string, unknown>[],
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
      if (executeOptions.allowWrite !== true) {
        throw new SqliteDebugError('SQLITE_DEBUG_WRITE_CONFIRMATION_REQUIRED', 'Write SQL requires allowWrite: true and an explicit UI confirmation.')
      }
      const current = await database()
      const started = Date.now()
      const result = await current.exec(normalized, parameters)
      return { ...result, elapsedMs: Date.now() - started } satisfies SqliteDebugExecutionResult
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
    async resetDatabase() {
      const current = await database()
      await current.close()
      databasePromise = undefined
      await options.storage.remove(options.databaseName)
      await database()
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
