import type { SqliteDevtoolsWireValue } from './protocol'
import { isRecord, SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES, SqliteDevtoolsError } from './protocol'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function failure(): never {
  throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_PAYLOAD', 'Invalid or oversized SQLite DevTools payload.')
}

function budget(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES) {
    failure()
  }
  let nodes = 0
  let bytes = 0
  return (depth: number, size = 1) => {
    nodes += 1
    bytes += size
    if (depth > 32 || nodes > 100_000 || bytes > maxBytes) {
      failure()
    }
  }
}

function encodeBytes(bytes: Uint8Array) {
  const blocks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset] ?? 0
    const b = bytes[offset + 1] ?? 0
    const c = bytes[offset + 2] ?? 0
    blocks.push(`${alphabet[a >> 2]}${alphabet[((a & 3) << 4) | (b >> 4)]}${offset + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '='}${offset + 2 < bytes.length ? alphabet[c & 63] : '='}`)
  }
  return blocks.join('')
}

function decodeBytes(value: string) {
  if (!/^(?:[A-Z\d+/]{4})*(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?$/i.test(value)) {
    failure()
  }
  const length = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
  const bytes = new Uint8Array(length)
  let cursor = 0
  for (let offset = 0; offset < value.length; offset += 4) {
    const bits = (alphabet.indexOf(value[offset]!) << 18) | (alphabet.indexOf(value[offset + 1]!) << 12)
      | (Math.max(0, alphabet.indexOf(value[offset + 2]!)) << 6) | Math.max(0, alphabet.indexOf(value[offset + 3]!))
    if (cursor < length) { bytes[cursor++] = (bits >> 16) & 255 }
    if (cursor < length) { bytes[cursor++] = (bits >> 8) & 255 }
    if (cursor < length) { bytes[cursor++] = bits & 255 }
  }
  if (encodeBytes(bytes) !== value) { failure() }
  return bytes
}

/** 使用显式标签保留整数和二进制值，普通对象不能伪装成协议标签。 */
export function encodeSqliteDevtoolsValue(value: unknown, maxBytes = SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES): SqliteDevtoolsWireValue {
  const check = budget(maxBytes)
  const seen = new Set<object>()
  function visit(input: unknown, depth: number): SqliteDevtoolsWireValue {
    check(depth)
    if (input === undefined) { return { type: 'undefined' } }
    if (input === null || typeof input === 'boolean') { return input }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) { failure() }
      return input
    }
    if (typeof input === 'string') { check(depth, input.length * 3); return input }
    if (typeof input === 'bigint') {
      const text = input.toString()
      check(depth, text.length)
      return { type: 'bigint', value: text }
    }
    if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
      check(depth, Math.ceil(bytes.byteLength / 3) * 4)
      return { type: 'bytes', kind: input instanceof Uint8Array ? 'uint8array' : 'arraybuffer', value: encodeBytes(bytes) }
    }
    if (typeof input !== 'object' || seen.has(input)) { failure() }
    seen.add(input)
    try {
      if (Array.isArray(input)) {
        return { type: 'array', value: input.map(item => visit(item, depth + 1)) }
      }
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) { failure() }
      return {
        type: 'object',
        value: Object.entries(input).map(([key, entry]) => {
          check(depth, key.length * 3)
          return [key, visit(entry, depth + 1)] as const
        }),
      }
    }
    finally { seen.delete(input) }
  }
  const result = visit(value, 0)
  if (JSON.stringify(result).length > maxBytes) { failure() }
  return result
}

export function decodeSqliteDevtoolsValue(value: unknown, maxBytes = SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES): unknown {
  const check = budget(maxBytes)
  function visit(input: unknown, depth: number): unknown {
    check(depth)
    if (input === null || typeof input === 'boolean') { return input }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) { failure() }
      return input
    }
    if (typeof input === 'string') { check(depth, input.length * 3); return input }
    if (!isRecord(input)) { failure() }
    if (input.type === 'undefined') { return undefined }
    if (input.type === 'bigint' && typeof input.value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(input.value)) {
      check(depth, input.value.length)
      return BigInt(input.value)
    }
    if (input.type === 'bytes' && typeof input.value === 'string' && (input.kind === 'uint8array' || input.kind === 'arraybuffer')) {
      check(depth, input.value.length)
      const bytes = decodeBytes(input.value)
      return input.kind === 'arraybuffer' ? bytes.buffer : bytes
    }
    if (input.type === 'array' && Array.isArray(input.value)) {
      return input.value.map(item => visit(item, depth + 1))
    }
    if (input.type === 'object' && Array.isArray(input.value)) {
      const keys = new Set<string>()
      return Object.fromEntries(input.value.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) { failure() }
        check(depth, entry[0].length * 3)
        keys.add(entry[0])
        return [entry[0], visit(entry[1], depth + 1)]
      }))
    }
    return failure()
  }
  return visit(value, 0)
}
