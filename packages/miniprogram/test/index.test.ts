import type { SqlJsDatabase } from '@weapp-sqlite/wasm'
import type { MiniProgramHostAdapter, MiniProgramSqliteOptions, MiniProgramWebAssemblyRuntime } from '@/index'
import { readFile } from 'node:fs/promises'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import initSqlJs from 'sql.js'
import {
  createMiniProgramSqliteDebugFileAdapter,
  createMiniProgramSqliteWasmStorage,
  createMiniProgramSqlJsInitializer,
  loadMiniProgramPackageBinary,
  MiniProgramSqliteUnsupportedError,
  probeMiniProgramSqliteCapabilities,
} from '@/index'

const nativeWebAssembly = globalThis.WebAssembly

function createWebAssemblyRuntime(
  instantiate: MiniProgramWebAssemblyRuntime['instantiate'] = async () => ({ exports: {} }),
): MiniProgramWebAssemblyRuntime {
  return {
    instantiate,
    Module: nativeWebAssembly.Module,
    Instance: nativeWebAssembly.Instance,
    Memory: nativeWebAssembly.Memory,
    Table: nativeWebAssembly.Table,
    RuntimeError: nativeWebAssembly.RuntimeError,
  }
}

function invokeMiniProgramWasm(
  options: unknown,
  callback: (instance: unknown, module?: unknown) => void,
) {
  const factoryOptions = options as {
    instantiateWasm: (imports: Record<string, never>, callback: (instance: unknown, module?: unknown) => void) => unknown
  }
  factoryOptions.instantiateWasm({}, callback)
}

function createRuntime(options: { readonly directoryExists?: boolean } = {}) {
  const files = new Map<string, Uint8Array>([
    ['assets/sql-wasm.wasm', new Uint8Array([0, 97, 115, 109])],
  ])
  const runtime = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager: () => ({
      mkdir: ({ success, fail }: { success: () => void, fail: (error: { errMsg: string }) => void }) => {
        options.directoryExists ? fail({ errMsg: 'mkdir:fail file already exists' }) : success()
      },
      readFile: ({ filePath, success, fail }: { filePath: string, success: (result: { data: ArrayBuffer }) => void, fail: (error: { errMsg: string }) => void }) => {
        const data = files.get(filePath)
        if (!data) {
          fail({ errMsg: 'no such file' })
          return
        }
        success({ data: Uint8Array.from(data).buffer })
      },
      writeFile: ({ filePath, data, success }: { filePath: string, data: ArrayBuffer, success: () => void }) => {
        files.set(filePath, new Uint8Array(data))
        success()
      },
      unlink: ({ filePath, success, fail }: { filePath: string, success: () => void, fail: (error: { errMsg: string }) => void }) => {
        files.delete(filePath) ? success() : fail({ errMsg: 'no such file' })
      },
    }),
  }
  return { files, runtime }
}

describe('mini-program storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists binary databases in the built-in weapp driver', async () => {
    const { runtime } = createRuntime()
    const storage = createMiniProgramSqliteWasmStorage({ platform: 'weapp', runtime })

    expect(storage.getDatabasePath?.('demo')).toBe('/user/weapp-sqlite/demo.sqlite')
    await expect(storage.load('demo')).resolves.toBeUndefined()
    await storage.save('demo', new Uint8Array([1, 2, 3]))
    await expect(storage.load('demo')).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await storage.remove('demo')
    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('delivers debug artifacts through desktop save and mobile share APIs', async () => {
    const desktop = createRuntime()
    const saveFileToDisk = vi.fn(({ success }: { success: () => void }) => success())
    const desktopAdapter = createMiniProgramSqliteDebugFileAdapter({
      platform: 'weapp',
      runtime: { ...desktop.runtime, getDeviceInfo: () => ({ platform: 'devtools' }), saveFileToDisk },
    })
    await expect(desktopAdapter.save({ fileName: 'demo.sqlite', mimeType: 'application/vnd.sqlite3', bytes: new Uint8Array([1, 2]) })).resolves.toEqual({ method: 'save-file-to-disk', fileName: 'demo.sqlite' })
    expect(saveFileToDisk).toHaveBeenCalledOnce()

    const mobile = createRuntime()
    const shareFileMessage = vi.fn(({ success }: { success: () => void }) => success())
    const mobileAdapter = createMiniProgramSqliteDebugFileAdapter({
      platform: 'weapp',
      runtime: { ...mobile.runtime, getDeviceInfo: () => ({ platform: 'ios' }), shareFileMessage },
    })
    await expect(mobileAdapter.save({ fileName: 'notes.csv', mimeType: 'text/csv', bytes: new Uint8Array([3]) })).resolves.toEqual({ method: 'share-file-message', fileName: 'notes.csv' })
    expect(shareFileMessage).toHaveBeenCalledOnce()
  })

  it('imports WeChat message files and rejects unsupported platform delivery', async () => {
    const { runtime, files } = createRuntime()
    files.set('/tmp/import.json', new Uint8Array([4, 5, 6]))
    const adapter = createMiniProgramSqliteDebugFileAdapter({
      platform: 'weapp',
      runtime: {
        ...runtime,
        chooseMessageFile: ({ success }: { success: (result: { tempFiles: { name: string, path: string, type: string, size: number }[] }) => void }) => success({ tempFiles: [{ name: 'import.json', path: '/tmp/import.json', type: 'application/json', size: 3 }] }),
      },
    })
    await expect(adapter.choose({ extensions: ['.json'], maxBytes: 10 })).resolves.toEqual({ fileName: 'import.json', mimeType: 'application/json', bytes: new Uint8Array([4, 5, 6]) })
    expect(() => createMiniProgramSqliteDebugFileAdapter({ platform: 'alipay', runtime })).toThrow(MiniProgramSqliteUnsupportedError)
  })

  it('treats an existing WeChat data directory as initialized', async () => {
    const { runtime } = createRuntime({ directoryExists: true })
    const storage = createMiniProgramSqliteWasmStorage({ platform: 'weapp', runtime })

    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('loads package assets and probes required capabilities', async () => {
    const { runtime } = createRuntime()
    const options: MiniProgramSqliteOptions = {
      platform: 'weapp',
      runtime,
      packageBinaryPath: 'assets/sql-wasm.wasm',
      webAssembly: createWebAssemblyRuntime(),
    }

    await expect(loadMiniProgramPackageBinary('assets/sql-wasm.wasm', options)).resolves.toEqual(new Uint8Array([0, 97, 115, 109]))
    await expect(probeMiniProgramSqliteCapabilities(options)).resolves.toEqual({ platform: 'weapp', supported: true })
  })

  it('probes built-in platform adapters without falling back', async () => {
    const options = { platform: 'alipay' as const, runtime: {} }
    expect(() => createMiniProgramSqliteWasmStorage(options)).toThrow(MiniProgramSqliteUnsupportedError)
    await expect(probeMiniProgramSqliteCapabilities(options)).resolves.toMatchObject({
      supported: false,
      capability: 'filesystem',
      code: 'MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE',
    })
  })

  it('instantiates portable mini-program WASM from package bytes', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const { runtime } = createRuntime()
    const instance = { exports: {} }
    let instantiatedSource: string | Uint8Array | undefined
    const instantiate: MiniProgramWebAssemblyRuntime['instantiate'] = async (source) => {
      instantiatedSource = source
      return instance
    }
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'tt',
      runtime,
      packageBinaryPath: '/assets/sql-wasm.wasm',
      webAssembly: createWebAssemblyRuntime(instantiate),
      initializer: async options => new Promise((resolve) => {
        invokeMiniProgramWasm(options, () => resolve({ Database: class {} as never }))
      }),
    })

    await expect(initializer()).resolves.toHaveProperty('Database')
    expect(instantiatedSource).toEqual(new Uint8Array([0, 97, 115, 109]))
  })

  it('accepts a custom host adapter for future platforms', async () => {
    const storage = {
      load: async () => undefined,
      save: async () => undefined,
      remove: async () => undefined,
    }
    const adapter: MiniProgramHostAdapter = {
      probe: async options => ({ platform: options.platform, supported: true }),
      createStorage: () => storage,
      loadPackageBinary: async () => new Uint8Array([1]),
    }

    expect(createMiniProgramSqliteWasmStorage({ platform: 'tt', runtime: {}, adapter })).toBe(storage)
  })

  it('reports an incompatible mini-program WebAssembly runtime', async () => {
    const { runtime } = createRuntime()
    await expect(probeMiniProgramSqliteCapabilities({
      platform: 'weapp',
      runtime,
      webAssembly: { instantiate: () => Promise.resolve({ exports: {} }) },
    })).resolves.toMatchObject({
      supported: false,
      capability: 'webassembly',
      code: 'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE',
    })
  })

  it('reports missing BigInt typed arrays required by sql.js', async () => {
    vi.stubGlobal('BigInt64Array', undefined)
    const { runtime } = createRuntime()
    await expect(probeMiniProgramSqliteCapabilities({
      platform: 'weapp',
      runtime,
      webAssembly: createWebAssemblyRuntime(),
    })).resolves.toMatchObject({
      supported: false,
      capability: 'typed-array',
      code: 'MINIPROGRAM_SQLITE_TYPED_ARRAY_UNAVAILABLE',
    })
  })

  it('fills the RuntimeError constructor omitted by WeChat DevTools', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const { runtime } = createRuntime()
    const webAssembly = createWebAssemblyRuntime()
    const { RuntimeError: _runtimeError, ...withoutRuntimeError } = webAssembly
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'weapp',
      runtime,
      packageBinaryPath: '/assets/sql-wasm.wasm',
      webAssembly: withoutRuntimeError,
      initializer: async options => new Promise((resolve) => {
        invokeMiniProgramWasm(options, () => resolve({ Database: class {} as never }))
      }),
    })

    await expect(initializer()).resolves.toHaveProperty('Database')
    expect((globalThis.WebAssembly as unknown as { RuntimeError: unknown }).RuntimeError).toBe(Error)
  })

  it('normalizes wrapped instantiation results and package-root paths', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const { runtime } = createRuntime()
    const instance = { exports: {} }
    const module = { id: 'module' }
    const instantiate = vi.fn(async () => ({ instance, module }))
    const webAssembly = createWebAssemblyRuntime(instantiate)
    let callbackModule: unknown
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'weapp',
      runtime,
      packageBinaryPath: 'assets/sql-wasm.wasm',
      webAssembly,
      initializer: async (options) => {
        return new Promise((resolve) => {
          invokeMiniProgramWasm(options, (_value, instantiatedModule) => {
            callbackModule = instantiatedModule
            resolve({ Database: class {} as never })
          })
        })
      },
    })

    await expect(initializer()).resolves.toHaveProperty('Database')
    expect(instantiate).toHaveBeenCalledWith('/assets/sql-wasm.wasm', {})
    expect(callbackModule).toBe(module)
    expect(globalThis.WebAssembly).toBe(webAssembly)
  })

  it('rejects conflicts instead of overwriting standard WebAssembly', async () => {
    const { runtime } = createRuntime()
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'weapp',
      runtime,
      packageBinaryPath: '/assets/sql-wasm.wasm',
      webAssembly: createWebAssemblyRuntime(),
      initializer: async options => new Promise((resolve) => {
        invokeMiniProgramWasm(options, () => resolve({ Database: class {} as never }))
      }),
    })

    await expect(initializer()).rejects.toMatchObject({
      code: 'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE',
    })
    expect(globalThis.WebAssembly).toBe(nativeWebAssembly)
  })

  it('rejects asynchronous WASM instantiation failures without hanging', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const { runtime } = createRuntime()
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'weapp',
      runtime,
      packageBinaryPath: '/assets/missing.wasm',
      webAssembly: createWebAssemblyRuntime(async () => {
        throw new Error('missing package asset')
      }),
      initializer: async options => new Promise((resolve) => {
        invokeMiniProgramWasm(options, () => resolve({ Database: class {} as never }))
      }),
    })

    await expect(initializer()).rejects.toMatchObject({
      capability: 'wasm-instantiation',
      code: 'MINIPROGRAM_SQLITE_WASM_INSTANTIATION_FAILED',
    })
  })

  it('runs sql.js through a package-path WebAssembly runtime and persists transactions', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    const { runtime } = createRuntime()
    const wasmBinary = await readFile(new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url))
    const webAssembly = createWebAssemblyRuntime(async (_path, imports) => {
      const result = await nativeWebAssembly.instantiate(wasmBinary, imports as WebAssembly.Imports)
      return result.instance as unknown as { exports: Readonly<Record<string, unknown>> }
    })
    const initializer = createMiniProgramSqlJsInitializer({
      platform: 'weapp',
      runtime,
      packageBinaryPath: '/assets/sql-wasm.wasm',
      webAssembly,
      initializer: initSqlJs,
    })
    let databaseFile: Uint8Array | undefined
    const storage = {
      load: async () => databaseFile,
      save: async (_name: string, data: Uint8Array) => {
        databaseFile = Uint8Array.from(data)
      },
    }

    const database = await openSqliteWasmDatabase(initializer, 'integration', { storage })
    await database.exec('CREATE TABLE notes (body TEXT NOT NULL)')
    await database.transaction(async (transaction) => {
      await transaction.exec('INSERT INTO notes VALUES (?)', ['committed'])
    })
    await expect(database.transaction(async (transaction) => {
      await transaction.exec('INSERT INTO notes VALUES (?)', ['rolled back'])
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    await database.close()

    const reopened = await openSqliteWasmDatabase(initializer, 'integration', { storage })
    await expect(reopened.query('SELECT body FROM notes ORDER BY body')).resolves.toMatchObject({
      rows: [{ body: 'committed' }],
    })
    await reopened.close()

    const SQL = await initializer()
    const rawDatabase = new SQL.Database() as SqlJsDatabase & {
      create_function: (name: string, callback: (value: number) => number) => void
    }
    rawDatabase.create_function('double_value', value => value * 2)
    expect(rawDatabase.exec('SELECT double_value(21) AS value')[0]?.values[0]?.[0]).toBe(42)
    rawDatabase.close()
  })
})
