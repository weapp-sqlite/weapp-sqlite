import { describe, expect, it } from 'vitest'
import { decodeSqliteDevtoolsValue, encodeSqliteDevtoolsValue, serializeDevtoolsError } from '../src/protocol'

describe('SQLite DevTools codec', () => {
  it('round trips bigint, ArrayBuffer and nested records', () => {
    const value = { count: 2n ** 60n, blob: new Uint8Array([0, 1, 255]), nested: [null, true] }
    const decoded = decodeSqliteDevtoolsValue(encodeSqliteDevtoolsValue(value)) as typeof value
    expect(decoded.count).toBe(value.count)
    expect(decoded.blob).toEqual(value.blob)
    expect(decoded.nested).toEqual(value.nested)
  })

  it('rejects cyclic and non-finite values', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => encodeSqliteDevtoolsValue(cycle)).toThrow('Invalid')
    expect(() => encodeSqliteDevtoolsValue(Number.NaN)).toThrow('Invalid')
  })

  it('normalizes thrown errors before they cross the runtime protocol', () => {
    const error = Object.assign(new Error('database failed'), { code: 'x'.repeat(257) })
    expect(serializeDevtoolsError(error)).toEqual({ code: 'SQLITE_DEVTOOLS_RUNTIME_ERROR', message: 'database failed' })
    expect(serializeDevtoolsError(Object.assign(new Error('unknown'), { code: 'BAD\nCODE' }))).toEqual({
      code: 'SQLITE_DEVTOOLS_RUNTIME_ERROR',
      message: 'unknown',
    })
  })
})
