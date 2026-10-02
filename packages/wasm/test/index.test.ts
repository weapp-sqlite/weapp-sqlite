import type { SqliteWasmStorage, SqlJsDatabase, SqlJsInitializer, SqlJsModule } from '@/index'
import { createSqliteWasmDriver, openSqliteWasmDatabase } from '@/index'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const engine: SqlJsDatabase = {
    run: vi.fn(() => engine),
    exec: vi.fn(() => [{ columns: ['value'], values: [[1]] }]),
    export: vi.fn(() => { throw new Error('Destructive export must not be used.') }),
    exportSnapshot: vi.fn(() => new Uint8Array([1, 2, 3])),
    execWithMetadata: vi.fn(() => ({ results: [{ columns: ['id'], values: [[1]] }], readOnly: true })),
    close: vi.fn(),
  }
  function Database() {
    return engine
  }
  const module: SqlJsModule = { Database: vi.fn(Database) as unknown as SqlJsModule['Database'] }
  const initializer: SqlJsInitializer = vi.fn(async () => module)
  const storage: SqliteWasmStorage = { load: vi.fn(async () => undefined), save: vi.fn(async () => undefined) }
  return { engine, initializer, storage, module }
}

describe('WASM persistence boundaries', () => {
  it('persists result-producing writes while avoiding saves for read-only queries', async () => {
    const { engine, initializer, storage } = setup()
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    await expect(database.query('SELECT id')).resolves.toEqual({ columns: ['id'], rows: [{ id: 1 }] })
    expect(storage.save).not.toHaveBeenCalled()
    vi.mocked(engine.execWithMetadata!).mockReturnValueOnce({ results: [{ columns: ['id'], values: [[2]] }], readOnly: false })
    await expect(database.query('INSERT RETURNING id')).resolves.toEqual({ columns: ['id'], rows: [{ id: 2 }] })
    expect(storage.save).toHaveBeenCalledExactlyOnceWith('demo', new Uint8Array([1, 2, 3]))
    await database.close()
    expect(storage.save).toHaveBeenCalledOnce()
    expect(engine.export).not.toHaveBeenCalled()
  })

  it.each(['exec', 'query'] as const)('conservatively persists %s from engines without execution metadata', async (method) => {
    const { engine, initializer, storage } = setup()
    delete engine.execWithMetadata
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    await database[method]('custom SQL')
    expect(storage.save).toHaveBeenCalledOnce()
  })

  it.each(['exec', 'query'] as const)('keeps %s partial writes dirty after execution throws', async (method) => {
    const { engine, initializer, storage } = setup()
    const cause = new Error('later statement failed')
    vi.mocked(engine.execWithMetadata!).mockImplementationOnce(() => {
      throw cause
    })
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    await expect(database[method]('multiple statements')).rejects.toBe(cause)
    expect(storage.save).not.toHaveBeenCalled()
    await database.flush()
    expect(storage.save).toHaveBeenCalledOnce()
  })

  it('retries failed saves and does not clear prior writes after a read-only query', async () => {
    const { engine, initializer, storage } = setup()
    const cause = new Error('quota')
    vi.mocked(storage.save).mockRejectedValueOnce(cause)
    vi.mocked(engine.execWithMetadata!).mockReturnValueOnce({ results: [], readOnly: false })
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    await expect(database.exec('INSERT')).rejects.toBe(cause)
    await database.query('SELECT')
    expect(storage.save).toHaveBeenCalledTimes(2)
    await database.flush()
    expect(storage.save).toHaveBeenCalledTimes(2)
  })

  it('serializes saves and retains writes made while a snapshot is being saved', async () => {
    const { engine, initializer, storage } = setup()
    vi.mocked(engine.execWithMetadata!).mockReturnValue({ results: [], readOnly: false })
    const started = deferred()
    const release = deferred()
    vi.mocked(storage.save).mockImplementationOnce(async () => {
      started.resolve()
      await release.promise
    })
    const connection = await createSqliteWasmDriver(initializer, { storage }).open('demo')
    await connection.exec('first')
    const first = connection.flush!()
    await started.promise
    await connection.exec('second')
    const second = connection.flush!()
    expect(storage.save).toHaveBeenCalledOnce()
    release.resolve()
    await Promise.all([first, second])
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(engine.exportSnapshot).toHaveBeenCalledTimes(2)
    await connection.flush!()
    expect(storage.save).toHaveBeenCalledTimes(2)
  })

  it('rejects an incompatible initializer and releases the newly created engine', async () => {
    const { engine, initializer, storage } = setup()
    Reflect.deleteProperty(engine, 'exportSnapshot')
    await expect(openSqliteWasmDatabase(initializer, 'demo', { storage })).rejects.toThrow('must implement exportSnapshot()')
    expect(engine.close).toHaveBeenCalledOnce()
    expect(engine.export).not.toHaveBeenCalled()
  })
})

describe('parameter safety', () => {
  it.each(['exec', 'query'] as const)('%s rejects unsafe bigint before any SQL executes', async (method) => {
    const { engine, initializer, storage } = setup()
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    for (const value of [9007199254740992n, -9007199254740992n]) {
      await expect(database[method]('SQL', [value])).rejects.toBeInstanceOf(RangeError)
      await expect(database[method]('SQL', { $value: value })).rejects.toBeInstanceOf(RangeError)
    }
    expect(engine.run).not.toHaveBeenCalled()
    expect(engine.exec).not.toHaveBeenCalled()
    expect(engine.execWithMetadata).not.toHaveBeenCalled()
    await database.flush()
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('normalizes safe boundaries, booleans and binary values without changing bindings', async () => {
    const { engine, initializer, storage } = setup()
    const database = await openSqliteWasmDatabase(initializer, 'demo', { storage })
    const bytes = new Uint8Array([0, 255])
    await database.exec('bound SQL', [9007199254740991n, -9007199254740991n, true, false, bytes.buffer, null])
    expect(engine.execWithMetadata).toHaveBeenCalledWith('bound SQL', [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1, 0, bytes, null])
    await database.query('named SQL', { $id: 123n, $enabled: true })
    expect(engine.execWithMetadata).toHaveBeenCalledWith('named SQL', { $id: 123, $enabled: 1 })
  })
})

it('shares initialization, clears failure, and caches a successful retry', async () => {
  const { initializer, storage } = setup()
  const cause = new Error('download failed')
  vi.mocked(initializer).mockRejectedValueOnce(cause)
  const driver = createSqliteWasmDriver(initializer, { storage })
  const results = await Promise.allSettled([driver.open('first'), driver.open('second')])
  expect(results).toEqual([{ status: 'rejected', reason: cause }, { status: 'rejected', reason: cause }])
  expect(initializer).toHaveBeenCalledOnce()
  await Promise.all([driver.open('first'), driver.open('second')])
  await driver.open('third')
  expect(initializer).toHaveBeenCalledTimes(2)
})
