import type { SqliteConnection, SqliteMigration } from '@weapp-sqlite/core'
import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import type { SqliteRuntimeAdapter } from '@/types'
import { createSqliteDebugController } from '@weapp-sqlite/debug'
import initSqlJs from '@weapp-sqlite/sqljs/full'
import initSqlJsLite from '@weapp-sqlite/sqljs/lite'
import { resolveSqliteWasmAsset } from '@weapp-sqlite/sqljs/node'
import { createSqliteWasmRuntimeAdapter } from '@/adapter'
import { createMiniProgramSqliteRuntimeAdapterWithInitializer } from '@/advanced'
import { SqliteRuntimeError } from '@/errors'
import { clearSqliteRuntimeRegistryForTests, createSqliteDebugSessionWithAdapter, openSqliteWithAdapter, removeSqliteWithAdapter } from '@/open'

const fullInitializer: SqlJsInitializer = options => initSqlJs({
  ...options,
  locateFile: () => resolveSqliteWasmAsset('full', 'miniprogram'),
})

function createAdapter(initializer: SqlJsInitializer = fullInitializer, kind = 'sql.js-wasm') {
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createFakeConnection(): SqliteConnection {
  return {
    exec: vi.fn(async () => ({ changes: 1 })),
    query: async () => ({ columns: [], rows: [] }),
    close: vi.fn(async () => undefined),
  }
}

function createFakeAdapter(): SqliteRuntimeAdapter {
  return {
    target: 'web',
    kind: 'test',
    probe: async () => ({ target: 'web', supported: true }),
    open: vi.fn(async () => createFakeConnection()),
    loadSnapshot: async () => undefined,
    saveSnapshot: async () => undefined,
    remove: vi.fn(async () => undefined),
    getRuntimeInfo: async () => ({ target: 'web', engine: 'test' }),
  }
}

function createDebugController(name: string, adapter: SqliteRuntimeAdapter) {
  const session = createSqliteDebugSessionWithAdapter({ name, adapter }, adapter)
  return createSqliteDebugController({ databaseName: name, session, enabled: true })
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

  it('keeps application handles usable when debug sessions close or recover a snapshot', async () => {
    const { adapter } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'debug-shared', adapter }, adapter)
    const controller = createDebugController('debug-shared', adapter)
    await database.exec('CREATE TABLE notes (body TEXT)')
    await database.exec('INSERT INTO notes VALUES (?)', ['before'])
    await expect(controller.listTables()).resolves.toEqual([{ name: 'notes', type: 'table', sql: expect.stringContaining('CREATE TABLE') }])

    const corrupt = new Uint8Array(512)
    corrupt.set(new TextEncoder().encode('SQLite format 3\0'))
    await expect(controller.importDatabase(corrupt, { replace: true })).rejects.toMatchObject({ code: 'SQLITE_DEBUG_IMPORT_FAILED' })
    await controller.close()

    await database.exec('INSERT INTO notes VALUES (?)', ['after'])
    await expect(database.query('SELECT body FROM notes ORDER BY rowid')).resolves.toMatchObject({ rows: [{ body: 'before' }, { body: 'after' }] })
    await database.close()
    await expect(database.query('SELECT 1')).rejects.toThrow()
  })

  it('serializes a transaction and a debug operation without deadlock', async () => {
    const { adapter } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'interleave', adapter }, adapter)
    const controller = createDebugController('interleave', adapter)
    await database.exec('CREATE TABLE notes (body TEXT)')

    const transaction = database.transaction(async (transactionScope) => {
      await transactionScope.exec('INSERT INTO notes VALUES (?)', ['transaction'])
    })
    const debugQuery = controller.query('SELECT count(*) AS total FROM notes')
    await expect(transaction).resolves.toBeUndefined()
    await expect(debugQuery).resolves.toMatchObject({ rows: [{ total: 1 }] })
    await controller.close()
    await database.close()
  })

  it('rejects an undo after an application write changes the database revision', async () => {
    const { adapter } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'stale-undo', adapter }, adapter)
    const controller = createDebugController('stale-undo', adapter)
    await database.exec('CREATE TABLE notes (body TEXT)')
    await database.exec('INSERT INTO notes VALUES (?)', ['before'])
    await controller.truncateTable('notes', { allowWrite: true, confirmTable: 'notes' })
    await expect(database.query('SELECT count(*) AS total FROM notes')).resolves.toMatchObject({ rows: [{ total: 0 }] })
    expect(controller.getUndoState()).toMatchObject({ available: true })
    await database.exec('INSERT INTO notes VALUES (?)', ['business'])
    await expect(controller.undoLastDestructiveChange()).rejects.toMatchObject({ code: 'SQLITE_DEBUG_UNDO_STALE' })
    await expect(database.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'business' }] })
    await controller.close()
    await database.close()
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

  it('waits for close before reopening and ignores a stale handle closing again', async () => {
    const closeStarted = deferred()
    const releaseClose = deferred()
    const adapter = createFakeAdapter()
    const connection = createFakeConnection()
    connection.close = vi.fn(async () => {
      closeStarted.resolve()
      await releaseClose.promise
    })
    vi.mocked(adapter.open).mockResolvedValueOnce(connection)
    const original = await openSqliteWithAdapter({ name: 'closing' }, adapter)
    const closing = original.close()
    await closeStarted.promise

    const reopening = openSqliteWithAdapter({ name: 'closing' }, adapter)
    expect(original.close()).toBe(closing)
    const anotherOpen = openSqliteWithAdapter({ name: 'closing' }, adapter)
    const independent = await openSqliteWithAdapter({ name: 'independent' }, adapter)
    expect(adapter.open).toHaveBeenCalledTimes(2)
    releaseClose.resolve()
    await closing
    const reopened = await reopening
    expect(reopened).not.toBe(original)
    expect(await anotherOpen).toBe(reopened)
    await original.close()
    expect(await openSqliteWithAdapter({ name: 'closing' }, adapter)).toBe(reopened)
    await expect(reopened.query('SELECT 1')).resolves.toEqual({ columns: [], rows: [] })
    await reopened.close()
    await independent.close()
  })

  it('does not let an old handle interfere with a replacement adapter', async () => {
    const adapter = createFakeAdapter()
    const replacement = createFakeAdapter()
    const original = await openSqliteWithAdapter({ name: 'replacement' }, adapter)
    const closing = original.close()
    const opening = openSqliteWithAdapter({ name: 'replacement' }, replacement)
    expect(original.close()).toBe(closing)
    await closing
    const current = await opening
    await original.close()
    expect(await openSqliteWithAdapter({ name: 'replacement' }, replacement)).toBe(current)
    await removeSqliteWithAdapter({ name: 'replacement' }, replacement)
    expect(replacement.remove).toHaveBeenCalledOnce()
  })

  it('keeps the database name reserved until persistent removal finishes', async () => {
    const { adapter, files } = createAdapter()
    const database = await openSqliteWithAdapter({ name: 'removing', migrations }, adapter)
    await database.exec('INSERT INTO notes VALUES (?)', ['old'])
    const removeStarted = deferred()
    const releaseRemove = deferred()
    const remove = adapter.remove
    adapter.remove = async (name) => {
      removeStarted.resolve()
      await releaseRemove.promise
      await remove(name)
    }
    const removing = removeSqliteWithAdapter({ name: 'removing' }, adapter)
    await removeStarted.promise
    let reopened = false
    const reopening = openSqliteWithAdapter({ name: 'removing', migrations }, adapter).then((value) => {
      reopened = true
      return value
    })
    const independent = await openSqliteWithAdapter({ name: 'independent' }, adapter)
    expect(reopened).toBe(false)
    expect(files.has('removing')).toBe(true)
    releaseRemove.resolve()
    await removing
    const fresh = await reopening
    await expect(fresh.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [] })
    await fresh.exec('INSERT INTO notes VALUES (?)', ['new'])
    await fresh.close()
    const persisted = await openSqliteWithAdapter({ name: 'removing', migrations }, adapter)
    await expect(persisted.query('SELECT body FROM notes')).resolves.toMatchObject({ rows: [{ body: 'new' }] })
    await persisted.close()
    await independent.close()
  })

  it('orders queued removes and opens by invocation without blocking other names', async () => {
    const adapter = createFakeAdapter()
    const removeStarted = deferred()
    const releaseRemove = deferred()
    const events: string[] = []
    let removals = 0
    adapter.remove = vi.fn(async () => {
      const attempt = ++removals
      events.push(`remove:${attempt}:start`)
      if (attempt === 1) {
        removeStarted.resolve()
        await releaseRemove.promise
      }
      events.push(`remove:${attempt}:end`)
    })
    adapter.open = vi.fn(async (name) => {
      events.push(`open:${name}`)
      return createFakeConnection()
    })
    const first = removeSqliteWithAdapter({ name: 'ordered' }, adapter)
    await removeStarted.promise
    const second = removeSqliteWithAdapter({ name: 'ordered' }, adapter)
    const opening = openSqliteWithAdapter({ name: 'ordered' }, adapter)
    const independent = await openSqliteWithAdapter({ name: 'other' }, adapter)
    expect(events).toEqual(['remove:1:start', 'open:other'])
    releaseRemove.resolve()
    await Promise.all([first, second])
    const database = await opening
    expect(events).toEqual(['remove:1:start', 'open:other', 'remove:1:end', 'remove:2:start', 'remove:2:end', 'open:ordered'])
    await database.close()
    await independent.close()
  })

  it('coalesces failed opens and retries after the failed attempt', async () => {
    const adapter = createFakeAdapter()
    const failure = new Error('temporary initialization failure')
    vi.mocked(adapter.open).mockRejectedValueOnce(failure)
    const results = await Promise.allSettled([
      openSqliteWithAdapter({ name: 'retry' }, adapter),
      openSqliteWithAdapter({ name: 'retry' }, adapter),
    ])
    expect(results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: 'SQLITE_ENGINE_INIT_FAILED', cause: failure }) },
      { status: 'rejected', reason: expect.objectContaining({ code: 'SQLITE_ENGINE_INIT_FAILED', cause: failure }) },
    ])
    expect(adapter.open).toHaveBeenCalledOnce()
    const database = await openSqliteWithAdapter({ name: 'retry' }, adapter)
    expect(adapter.open).toHaveBeenCalledTimes(2)
    await database.close()
  })

  it('retains a connection after close fails and permits a later close retry', async () => {
    const adapter = createFakeAdapter()
    const connection = createFakeConnection()
    const failure = new Error('close failed')
    vi.mocked(connection.close).mockRejectedValueOnce(failure)
    vi.mocked(adapter.open).mockResolvedValueOnce(connection)
    const database = await openSqliteWithAdapter({ name: 'retry-close' }, adapter)
    const closing = database.close()
    const opening = openSqliteWithAdapter({ name: 'retry-close' }, adapter)
    await expect(closing).rejects.toBe(failure)
    expect(await opening).toBe(database)
    expect(adapter.open).toHaveBeenCalledOnce()
    await expect(database.exec('INSERT INTO notes VALUES (1)')).resolves.toEqual({ changes: 1 })
    await database.close()
    const reopened = await openSqliteWithAdapter({ name: 'retry-close' }, adapter)
    expect(reopened).not.toBe(database)
    await reopened.close()
  })

  it('rejects operations submitted after close has been requested', async () => {
    const adapter = createFakeAdapter()
    const connection = createFakeConnection()
    vi.mocked(adapter.open).mockResolvedValueOnce(connection)
    const database = await openSqliteWithAdapter({ name: 'close-order' }, adapter)
    const closing = database.close()
    const results = await Promise.allSettled([
      database.exec('INSERT INTO notes VALUES (1)'),
      database.query('SELECT 1'),
      database.transaction(async () => undefined),
      database.flush(),
    ])
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result).toMatchObject({ status: 'rejected', reason: { name: 'SqliteClosedError' } })
    }
    await closing
    expect(connection.exec).not.toHaveBeenCalled()
  })

  it('does not remove storage after close fails and can retry removal', async () => {
    const adapter = createFakeAdapter()
    const connection = createFakeConnection()
    const failure = new Error('close failed')
    vi.mocked(connection.close).mockRejectedValueOnce(failure)
    vi.mocked(adapter.open).mockResolvedValueOnce(connection)
    await openSqliteWithAdapter({ name: 'retry-remove-close' }, adapter)
    await expect(removeSqliteWithAdapter({ name: 'retry-remove-close' }, adapter)).rejects.toBe(failure)
    expect(adapter.remove).not.toHaveBeenCalled()
    await removeSqliteWithAdapter({ name: 'retry-remove-close' }, adapter)
    expect(adapter.remove).toHaveBeenCalledOnce()
  })

  it('releases the lifecycle queue after removal fails', async () => {
    const adapter = createFakeAdapter()
    const failure = new Error('storage unavailable')
    vi.mocked(adapter.remove).mockRejectedValueOnce(failure)
    const removal = removeSqliteWithAdapter({ name: 'retry-remove' }, adapter)
    const opening = openSqliteWithAdapter({ name: 'retry-remove' }, adapter)
    await expect(removal).rejects.toBe(failure)
    const database = await opening
    await database.close()
    await removeSqliteWithAdapter({ name: 'retry-remove' }, adapter)
    expect(adapter.remove).toHaveBeenCalledTimes(2)
  })

  it('rejects conflicting options during opening and conflicting adapters during removal', async () => {
    const adapter = createFakeAdapter()
    const otherAdapter = createFakeAdapter()
    const opening = openSqliteWithAdapter({ name: 'busy' }, adapter)
    await expect(openSqliteWithAdapter({ name: 'busy', migrations }, adapter)).rejects.toMatchObject({ code: 'SQLITE_OPEN_OPTIONS_CONFLICT' })
    await expect(removeSqliteWithAdapter({ name: 'busy' }, otherAdapter)).rejects.toMatchObject({ code: 'SQLITE_OPEN_OPTIONS_CONFLICT' })
    await opening
    const removing = removeSqliteWithAdapter({ name: 'busy' }, adapter)
    await expect(openSqliteWithAdapter({ name: 'busy' }, otherAdapter)).rejects.toMatchObject({ code: 'SQLITE_OPEN_OPTIONS_CONFLICT' })
    await removing
  })

  it('preserves migration and cleanup errors while allowing a fresh open', async () => {
    const adapter = createFakeAdapter()
    const connection = createFakeConnection()
    const migrationError = new Error('migration failed')
    const closeError = new Error('cleanup failed')
    vi.mocked(connection.close).mockRejectedValueOnce(closeError)
    vi.mocked(adapter.open).mockResolvedValueOnce(connection)
    const failedMigrations = [{
      version: 1,
      name: 'fail',
      up: async () => {
        throw migrationError
      },
    }]
    await expect(openSqliteWithAdapter({ name: 'migration-failure', migrations: failedMigrations }, adapter)).rejects.toMatchObject({
      name: 'AggregateError',
      cause: migrationError,
      errors: [migrationError, closeError],
    })
    expect(connection.close).toHaveBeenCalledOnce()
    const database = await openSqliteWithAdapter({ name: 'migration-failure' }, adapter)
    expect(adapter.open).toHaveBeenCalledTimes(2)
    await database.close()
  })

  it('reports host capability before loading an unavailable initializer', async () => {
    const loadInitializer = vi.fn<() => Promise<SqlJsInitializer>>().mockRejectedValue(new Error('subpackage download failed'))
    const adapter = createMiniProgramSqliteRuntimeAdapterWithInitializer({
      platform: 'weapp',
      runtime: {},
      engine: 'test',
      loadInitializer,
    })
    const results = await Promise.allSettled([adapter.probe(), adapter.probe()])
    expect(results).toEqual([
      { status: 'fulfilled', value: expect.objectContaining({ target: 'weapp', supported: false }) },
      { status: 'fulfilled', value: expect.objectContaining({ target: 'weapp', supported: false }) },
    ])
    expect(loadInitializer).not.toHaveBeenCalled()
  })

  it('shares the mini-program engine across concurrent database names and retries failed initialization', async () => {
    class FakeDatabase {
      run() { return this }
      exec() { return [] }
      export() { return new Uint8Array() }
      exportSnapshot() { return new Uint8Array() }
      close() {}
    }
    const failure = new Error('temporary WASM initialization failure')
    const initializer = vi.fn<SqlJsInitializer>().mockRejectedValueOnce(failure).mockResolvedValue({ Database: FakeDatabase })
    const loadInitializer = vi.fn(async () => initializer)
    const succeed = ({ success }: { success: () => void }) => success()
    const adapter = createMiniProgramSqliteRuntimeAdapterWithInitializer({
      platform: 'weapp',
      runtime: {
        env: { USER_DATA_PATH: '/user' },
        getFileSystemManager: () => ({
          mkdir: succeed,
          readFile: ({ fail }: { fail: (error: { errMsg: string }) => void }) => fail({ errMsg: 'no such file' }),
          writeFile: succeed,
          unlink: succeed,
          rename: succeed,
        }),
      },
      engine: 'test',
      loadInitializer,
    })
    const failed = await Promise.allSettled([adapter.open('first'), adapter.open('second')])
    expect(failed).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }])
    expect(initializer).toHaveBeenCalledOnce()
    const [first, second] = await Promise.all([adapter.open('first'), adapter.open('second')])
    expect(initializer).toHaveBeenCalledTimes(2)
    expect(loadInitializer).toHaveBeenCalledOnce()
    await first.close()
    await second.close()
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
