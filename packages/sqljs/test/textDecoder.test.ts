import type { SqlJsModule } from '@weapp-sqlite/wasm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'

describe.each(['sql-wasm', 'sql-wasm-lite', 'sql-wasm-browser'])('%s UTF-8 decoding', (engine) => {
  it.each([false, true])('initializes and round-trips text with TextDecoder available: %s', async (hasDecoder) => {
    const vendor = path.resolve(import.meta.dirname, '../src/vendor')
    const [glue, bytes] = await Promise.all([
      readFile(path.join(vendor, `${engine}.js`), 'utf8'),
      readFile(path.join(vendor, `${engine}.wasm`)),
    ])
    const module = { exports: {} }
    const context = createContext({
      module,
      exports: module.exports,
      bytes,
      setTimeout,
      clearTimeout,
      ...(hasDecoder ? { TextDecoder } : {}),
    })

    expect(runInContext('typeof TextDecoder', context)).toBe(hasDecoder ? 'function' : 'undefined')
    runInContext(glue, context, { filename: `${engine}.js` })
    const sql = await runInContext('module.exports({ wasmBinary: Uint8Array.from(bytes) })', context) as SqlJsModule
    const database = new sql.Database()
    const shortText = '你好 🌏'
    const longText = shortText.repeat(4)
    try {
      database.run('CREATE TABLE messages (short_text TEXT, long_text TEXT)')
      database.run('INSERT INTO messages VALUES (?, ?)', [shortText, longText])
      expect(database.exec('SELECT short_text, long_text FROM messages')[0]?.values).toEqual([[shortText, longText]])
      expect(runInContext('typeof TextDecoder', context)).toBe(hasDecoder ? 'function' : 'undefined')
    }
    finally {
      database.close()
    }
  })
})
