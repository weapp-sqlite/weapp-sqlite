import type { SqliteMigration } from '@weapp-sqlite/core'
import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import type { SqliteRuntimeAdapter } from '@/types'
import initSqlJs from '@weapp-sqlite/sqljs/full'
import initSqlJsLite from '@weapp-sqlite/sqljs/lite'
import { resolveSqliteWasmAsset } from '@weapp-sqlite/sqljs/node'
import { createSqliteWasmRuntimeAdapter } from '@/adapter'
import { SqliteRuntimeError } from '@/errors'
import { clearSqliteRuntimeRegistryForTests, openSqliteWithAdapter, removeSqliteWithAdapter } from '@/open'

function createAdapter(initializer: SqlJsInitializer = initSqlJs, kind = 'sql.js-wasm') {
  const files = new Map<string, Uint8Array>()
  const storage = {
    async load(name: string) {
      const bytes = files.get(name)
      return bytes && Uint8Array.from(bytes)
    },
    async save(name: string, bytes: Uint8Array) {
      files.set(name, Uint8Array.from(bytes))
    },
    async remove(name: string) {
      files.delete(name)
    },
  }
  const adapter = createSqliteWasmRuntimeAdapter({ target: 'web', initializer, kind, storage })
  return { adapter, files }
}

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    name: 'create_notes',
    up: async transaction => transaction.exec('CREATE TABLE notes (body TEXT NOT NULL)').then(() => undefined),
  },
]

describe('unified SQLite runtime', () => {
  afterEach(() => clearSqliteRuntimeRegistryForTests())

  it('coalesces concurrent opens, runs migrations, and persists after reopen', async () => {
    const { adapter } = createAdapter()
    const [first, second] = await Promise.all([
      openSqliteWithAdapter({ name: 'app.sqlite', migrations }, adapter),
      openSqliteWithAdapter({ name: 'app.sqlite', migrations }, adapter),
    ])
    expect(first).toBe(second)

    await first.exec('INSERT INTO notes VALUES (?)', ['persisted'])
    await first.close()
    const reopened = await openSqliteWithAdapter({ name: 'app.sqlite', migrations }, adapter)
    await expect(reopened.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'persisted' }] })
    await reopened.close()
  })

  it('runs migrations and reports the lite engine', async () => {
    const liteInitializer: SqlJsInitializer = options => initSqlJsLite({
      ...options,
      locateFile: () => resolveSqliteWasmAsset('lite', 'miniprogram'),
    })
    const { adapter } = createAdapter(liteInitializer, 'sql.js-wasm-lite')
    const database = await openSqliteWithAdapter({ name: 'lite.sqlite', migrations }, adapter)
    await database.exec('INSERT INTO notes VALUES (?)', ['lite'])
    await database.close()

    const reopened = await openSqliteWithAdapter({ name: 'lite.sqlite', migrations }, adapter)
    await expect(reopened.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'lite' }] })
    await expect(adapter.getRuntimeInfo()).resolves.toMatchObject({ engine: 'sql.js-wasm-lite' })
    await reopened.close()
  })

  it('rejects incompatible options for an open database', async () => {
    const { adapter } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'conflict', migrations }, adapter)
    const incompatible = [{ ...migrations[0], up: async () => undefined }] as readonly SqliteMigration[]

    await expect(openSqliteWithAdapter({ name: 'conflict', migrations: incompatible }, adapter)).rejects.toMatchObject({
      code: 'SQLITE_OPEN_OPTIONS_CONFLICT',
    })
    await database.close()
  })

  it('removes the persistent snapshot after closing an open database', async () => {
    const { adapter, files } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'remove-me', migrations }, adapter)
    await database.close()
    expect(files.has('remove-me')).toBe(true)

    await removeSqliteWithAdapter({ name: 'remove-me' }, adapter)
    expect(files.has('remove-me')).toBe(false)
  })

  it('normalizes unsupported hosts without opening a connection', async () => {
    const open = vi.fn()
    const adapter: SqliteRuntimeAdapter = {
      target: 'tt',
      kind: 'test',
      probe: async () => ({
        target: 'tt',
        supported: false,
        capability: 'webassembly',
        code: 'HOST_WASM_MISSING',
        message: 'missing wasm',
      }),
      open,
      loadSnapshot: async () => undefined,
      saveSnapshot: async () => undefined,
      remove: async () => undefined,
      getRuntimeInfo: async () => ({ target: 'tt', engine: 'test' }),
    }

    await expect(openSqliteWithAdapter({ name: 'unsupported' }, adapter)).rejects.toEqual(expect.objectContaining({
      code: 'SQLITE_RUNTIME_UNSUPPORTED',
      hostCode: 'HOST_WASM_MISSING',
    }))
    expect(open).not.toHaveBeenCalled()
  })

  it('uses a stable structured engine error', () => {
    expect(new SqliteRuntimeError('SQLITE_ENGINE_INIT_FAILED', 'web', 'failed')).toMatchObject({
      name: 'SqliteRuntimeError',
      code: 'SQLITE_ENGINE_INIT_FAILED',
      target: 'web',
    })
  })
})
