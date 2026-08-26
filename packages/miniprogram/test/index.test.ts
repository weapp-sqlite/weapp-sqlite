import type { MiniProgramHostAdapter, MiniProgramSqliteOptions } from '@/index'
import {
  createMiniProgramSqliteWasmStorage,
  loadMiniProgramPackageBinary,
  MiniProgramSqliteUnsupportedError,
  probeMiniProgramSqliteCapabilities,
} from '@/index'

function createRuntime() {
  const files = new Map<string, Uint8Array>([
    ['assets/sql-wasm.wasm', new Uint8Array([0, 97, 115, 109])],
  ])
  const runtime = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager: () => ({
      mkdir: ({ success }: { success: () => void }) => success(),
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
  it('persists binary databases in the built-in weapp driver', async () => {
    const { runtime } = createRuntime()
    const storage = createMiniProgramSqliteWasmStorage({ platform: 'weapp', runtime })

    await expect(storage.load('demo')).resolves.toBeUndefined()
    await storage.save('demo', new Uint8Array([1, 2, 3]))
    await expect(storage.load('demo')).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await storage.remove('demo')
    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('loads package assets and probes required capabilities', async () => {
    const { runtime } = createRuntime()
    const options: MiniProgramSqliteOptions = {
      platform: 'weapp',
      runtime,
      packageBinaryPath: 'assets/sql-wasm.wasm',
      webAssembly: {},
    }

    await expect(loadMiniProgramPackageBinary('assets/sql-wasm.wasm', options)).resolves.toEqual(new Uint8Array([0, 97, 115, 109]))
    await expect(probeMiniProgramSqliteCapabilities(options)).resolves.toEqual({ platform: 'weapp', supported: true })
  })

  it('reports unimplemented platforms without falling back', async () => {
    const options = { platform: 'alipay' as const, runtime: {} }
    expect(() => createMiniProgramSqliteWasmStorage(options)).toThrow(MiniProgramSqliteUnsupportedError)
    await expect(probeMiniProgramSqliteCapabilities(options)).resolves.toMatchObject({
      supported: false,
      capability: 'platform',
      code: 'MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED',
    })
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
})
