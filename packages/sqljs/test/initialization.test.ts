import type { SqlJsModule } from '@weapp-sqlite/wasm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { initSqlJsFull } from '@/full'
import { initSqlJsFull as initSqlJsBrowser } from '@/full-browser'
import { initSqlJsLite } from '@/lite'

type CustomInitializer = (options: {
  instantiateWasm: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => WebAssembly.Exports
}) => Promise<SqlJsModule>

it.each([
  ['full', initSqlJsFull, 'sql-wasm.wasm'],
  ['browser', initSqlJsBrowser, 'sql-wasm-browser.wasm'],
  ['lite', initSqlJsLite, 'sql-wasm-lite.wasm'],
] as const)('%s preserves custom WASM instantiation', async (_variant, initializer, asset) => {
  const bytes = new Uint8Array(await readFile(path.resolve(import.meta.dirname, '../src/vendor', asset)))
  const module = new WebAssembly.Module(bytes)
  const instantiateWasm = vi.fn((imports: WebAssembly.Imports, receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
    const instance = new WebAssembly.Instance(module, imports)
    receiveInstance(instance, module)
    return instance.exports
  })
  const SQL = await (initializer as unknown as CustomInitializer)({ instantiateWasm })
  expect(instantiateWasm).toHaveBeenCalledOnce()
  const database = new SQL.Database()
  database.run('CREATE TABLE smoke (value INTEGER)')
  expect(database.execWithMetadata!('INSERT INTO smoke VALUES (1) RETURNING value')).toMatchObject({
    readOnly: false,
    results: [{ values: [[1]] }],
  })
  const reopened = new SQL.Database(database.exportSnapshot())
  expect(reopened.exec('SELECT value FROM smoke')[0]?.values).toEqual([[1]])
  reopened.close()
  database.close()
})
