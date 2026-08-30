import type { SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteDebugColumnDefinition, SqliteDebugTableFormat, SqliteDebugTableImportSource } from './types'
import { SqliteDebugError } from './errors'

export interface ParsedDebugTable {
  readonly columns: readonly string[]
  readonly rows: readonly Readonly<Record<string, SqliteScalar>>[]
  readonly inferredTypes: Readonly<Record<string, SqliteDebugColumnDefinition['type']>>
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8Encode(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  const encoded = unescape(encodeURIComponent(value))
  return Uint8Array.from(encoded, character => character.charCodeAt(0))
}

function utf8Decode(value: Uint8Array) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(value)
  }
  return decodeURIComponent(escape(String.fromCharCode(...value)))
}

function normalizeText(source: SqliteDebugTableImportSource) {
  if (typeof source.bytes === 'string') {
    return source.bytes.replace(/^\uFEFF/, '')
  }
  const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes)
  return utf8Decode(bytes).replace(/^\uFEFF/, '')
}

function encodeBase64(bytes: Uint8Array) {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const value = (first << 16) | (second << 8) | third
    output += BASE64_ALPHABET[(value >> 18) & 63]
    output += BASE64_ALPHABET[(value >> 12) & 63]
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : '='
  }
  return output
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, '')
  if (!/^(?:[A-Z\d+/]{4})*(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?$/i.test(normalized)) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The import contains an invalid Base64 BLOB value.')
  }
  const bytes: number[] = []
  for (let index = 0; index < normalized.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(normalized[index] ?? '')
    const second = BASE64_ALPHABET.indexOf(normalized[index + 1] ?? '')
    const thirdCharacter = normalized[index + 2] ?? '='
    const fourthCharacter = normalized[index + 3] ?? '='
    const third = thirdCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(thirdCharacter)
    const fourth = fourthCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter)
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth
    bytes.push((combined >> 16) & 255)
    if (thirdCharacter !== '=') {
      bytes.push((combined >> 8) & 255)
    }
    if (fourthCharacter !== '=') {
      bytes.push(combined & 255)
    }
  }
  return Uint8Array.from(bytes)
}

function normalizeValue(value: unknown): SqliteScalar {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value as SqliteScalar
  }
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value)
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }
  throw new SqliteDebugError('SQLITE_DEBUG_EXPORT_TOO_LARGE', 'SQLite table export encountered an unsupported value.')
}

function taggedValue(value: unknown): Record<string, unknown> {
  const normalized = normalizeValue(value)
  if (normalized === null) {
    return { type: 'null' }
  }
  if (normalized instanceof Uint8Array) {
    return { type: 'blob', value: encodeBase64(normalized) }
  }
  if (normalized instanceof ArrayBuffer) {
    return { type: 'blob', value: encodeBase64(new Uint8Array(normalized)) }
  }
  if (typeof normalized === 'bigint') {
    return { type: 'integer', value: normalized.toString() }
  }
  if (typeof normalized === 'number') {
    return { type: Number.isInteger(normalized) ? 'integer' : 'real', value: normalized }
  }
  if (typeof normalized === 'boolean') {
    return { type: 'integer', value: normalized ? 1 : 0 }
  }
  return { type: 'text', value: normalized }
}

function untaggedValue(value: unknown): SqliteScalar {
  if (!value || typeof value !== 'object') {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The JSON import contains an invalid tagged value.')
  }
  const tagged = value as { readonly type?: unknown, readonly value?: unknown }
  if (tagged.type === 'null') {
    return null
  }
  if (tagged.type === 'blob' && typeof tagged.value === 'string') {
    return decodeBase64(tagged.value)
  }
  if (tagged.type === 'integer') {
    if (typeof tagged.value === 'number' && Number.isSafeInteger(tagged.value)) {
      return tagged.value
    }
    if (typeof tagged.value === 'string' && /^-?\d+$/.test(tagged.value)) {
      return BigInt(tagged.value)
    }
  }
  if (tagged.type === 'real' && typeof tagged.value === 'number' && Number.isFinite(tagged.value)) {
    return tagged.value
  }
  if (tagged.type === 'text' && typeof tagged.value === 'string') {
    return tagged.value
  }
  throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The JSON import contains an invalid tagged value.')
}

function csvCell(value: unknown) {
  const normalized = normalizeValue(value)
  if (normalized === null) {
    return ''
  }
  let text: string
  if (normalized instanceof Uint8Array) {
    text = encodeBase64(normalized)
  }
  else if (normalized instanceof ArrayBuffer) {
    text = encodeBase64(new Uint8Array(normalized))
  }
  else { text = String(normalized) }
  return `"${text.replaceAll('"', '""')}"`
}

export function encodeDebugTable(
  tableName: string,
  format: SqliteDebugTableFormat,
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
) {
  if (format === 'csv') {
    const lines = [columns.map(column => csvCell(column)).join(',')]
    for (const row of rows) {
      lines.push(columns.map(column => csvCell(row[column])).join(','))
    }
    return utf8Encode(`\uFEFF${lines.join('\r\n')}\r\n`)
  }
  return utf8Encode(JSON.stringify({
    schemaVersion: 1,
    tableName,
    columns,
    rows: rows.map(row => Object.fromEntries(columns.map(column => [column, taggedValue(row[column])]))),
  }, null, 2))
}

interface CsvCell {
  readonly value: string
  readonly quoted: boolean
}

function parseCsv(text: string): readonly CsvCell[][] {
  const rows: CsvCell[][] = []
  let row: CsvCell[] = []
  let value = ''
  let quoted = false
  let inQuotes = false
  for (let index = 0; index <= text.length; index += 1) {
    const current = text[index]
    if (inQuotes) {
      if (current === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      }
      else if (current === '"') {
        inQuotes = false
      }
      else if (current === undefined) {
        throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The CSV import contains an unterminated quoted field.')
      }
      else {
        value += current
      }
      continue
    }
    if (current === '"' && value.length === 0) {
      quoted = true
      inQuotes = true
      continue
    }
    if (current === ',') {
      row.push({ value, quoted })
      value = ''
      quoted = false
      continue
    }
    if (current === '\r' || current === '\n' || current === undefined) {
      row.push({ value, quoted })
      if (row.some(cell => cell.value.length > 0 || cell.quoted)) {
        rows.push(row)
      }
      row = []
      value = ''
      quoted = false
      if (current === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      continue
    }
    if (quoted) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The CSV import contains characters after a quoted field.')
    }
    value += current
  }
  return rows
}

function inferValue(cell: CsvCell): SqliteScalar {
  if (!cell.quoted && cell.value === '') {
    return null
  }
  if (!cell.quoted && /^-?(?:0|[1-9]\d*)$/.test(cell.value)) {
    const number = Number(cell.value)
    return Number.isSafeInteger(number) ? number : BigInt(cell.value)
  }
  if (!cell.quoted && /^-?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value)) {
    return Number(cell.value)
  }
  return cell.value
}

function inferType(values: readonly SqliteScalar[]): SqliteDebugColumnDefinition['type'] {
  const nonNull = values.filter(value => value !== null)
  if (nonNull.length === 0) {
    return 'TEXT'
  }
  if (nonNull.every(value => (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'bigint')) {
    return 'INTEGER'
  }
  if (nonNull.every(value => typeof value === 'number' || typeof value === 'bigint')) {
    return 'REAL'
  }
  if (nonNull.every(value => value instanceof Uint8Array || value instanceof ArrayBuffer)) {
    return 'BLOB'
  }
  return 'TEXT'
}

function parseCsvTable(source: SqliteDebugTableImportSource): ParsedDebugTable {
  const csvRows = parseCsv(normalizeText(source))
  const header = csvRows[0]
  if (!header || header.length === 0 || header.some(cell => !cell.value)) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'CSV imports require a non-empty header row.')
  }
  const columns = header.map(cell => cell.value)
  if (new Set(columns).size !== columns.length) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'CSV header names must be unique.')
  }
  const rows = csvRows.slice(1).map((cells, rowIndex) => {
    if (cells.length !== columns.length) {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', `CSV row ${rowIndex + 2} has ${cells.length} fields; expected ${columns.length}.`)
    }
    return Object.fromEntries(columns.map((column, index) => [column, inferValue(cells[index] ?? { value: '', quoted: false })]))
  })
  return {
    columns,
    rows,
    inferredTypes: Object.fromEntries(columns.map(column => [column, inferType(rows.map(row => row[column] ?? null))])),
  }
}

function parseJsonTable(source: SqliteDebugTableImportSource): ParsedDebugTable {
  let value: unknown
  try {
    value = JSON.parse(normalizeText(source))
  }
  catch (error) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The JSON import could not be parsed.', { cause: error })
  }
  if (!value || typeof value !== 'object') {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The JSON import root must be an object.')
  }
  const document = value as { readonly schemaVersion?: unknown, readonly columns?: unknown, readonly rows?: unknown }
  if (document.schemaVersion !== 1 || !Array.isArray(document.columns) || !document.columns.every(column => typeof column === 'string') || !Array.isArray(document.rows)) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'The JSON import does not match the weapp-sqlite table format.')
  }
  const columns = document.columns as string[]
  if (columns.length === 0 || new Set(columns).size !== columns.length) {
    throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', 'JSON columns must be non-empty and unique.')
  }
  const rows = document.rows.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new SqliteDebugError('SQLITE_DEBUG_INVALID_IMPORT', `JSON row ${index + 1} must be an object.`)
    }
    return Object.fromEntries(columns.map(column => [column, untaggedValue((row as Record<string, unknown>)[column])]))
  })
  return {
    columns,
    rows,
    inferredTypes: Object.fromEntries(columns.map(column => [column, inferType(rows.map(row => row[column] ?? null))])),
  }
}

export function parseDebugTable(source: SqliteDebugTableImportSource): ParsedDebugTable {
  return source.format === 'csv' ? parseCsvTable(source) : parseJsonTable(source)
}
