import type { MiniProgramFileSystemManager } from '../src/storage'
import { createMiniProgramSqliteWasmStorage, loadMiniProgramPackageBinary, probeMiniProgramSqliteCapabilities } from '@/index'

const path = '/user/weapp-sqlite/demo.sqlite'
const oldBytes = Uint8Array.of(1, 2, 3)
const newBytes = Uint8Array.of(4, 5, 6)
const ioError = { errMsg: 'filesystem:fail I/O failure' }

function createHost() {
  const files = new Map<string, Uint8Array>()
  const operations: string[] = []
  const fileSystem: MiniProgramFileSystemManager = {
    mkdir: vi.fn(({ success }) => success()),
    readFile: vi.fn(({ filePath, success, fail }) => {
      operations.push(`read ${filePath}`)
      const bytes = files.get(filePath)
      bytes ? success({ data: Uint8Array.from(bytes).buffer }) : fail({ errMsg: 'no such file' })
    }),
    writeFile: vi.fn(({ filePath, data, success }) => {
      operations.push(`write ${filePath}`)
      files.set(filePath, new Uint8Array(data))
      success()
    }),
    unlink: vi.fn(({ filePath, success, fail }) => {
      operations.push(`unlink ${filePath}`)
      files.delete(filePath) ? success() : fail({ errMsg: 'no such file' })
    }),
    rename: vi.fn(({ oldPath, newPath, success, fail }) => {
      operations.push(`rename ${oldPath} ${newPath}`)
      const bytes = files.get(oldPath)
      if (!bytes || files.has(newPath)) {
        fail({ errMsg: !bytes ? 'no such file' : 'file already exists' })
        return
      }
      files.set(newPath, bytes)
      files.delete(oldPath)
      success()
    }),
  }
  const runtime = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => fileSystem }
  const options = { platform: 'weapp' as const, runtime }
  return { files, operations, fileSystem, runtime, options, storage: createMiniProgramSqliteWasmStorage(options) }
}

describe('mini-program snapshot recovery', () => {
  it('keeps the previous snapshot after a partial temporary write and permits retry', async () => {
    const { files, fileSystem, storage } = createHost()
    files.set(path, oldBytes)
    vi.mocked(fileSystem.writeFile).mockImplementationOnce(({ filePath, data, fail }) => {
      files.set(filePath, new Uint8Array(data).slice(0, 1))
      fail(ioError)
    })

    await expect(storage.save('demo', newBytes)).rejects.toBe(ioError)
    await expect(storage.load('demo')).resolves.toEqual(oldBytes)
    await storage.save('demo', newBytes)
    await expect(storage.load('demo')).resolves.toEqual(newBytes)
    expect([...files.keys()]).toEqual([path])
  })

  it.each([0, 1])('recovers the old snapshot when publication rename %i fails', async (failureIndex) => {
    const { files, fileSystem, storage } = createHost()
    files.set(path, oldBytes)
    const rename = vi.mocked(fileSystem.rename).getMockImplementation()!
    let calls = 0
    vi.mocked(fileSystem.rename).mockImplementation((options) => {
      if (calls++ === failureIndex) {
        options.fail(ioError)
      }
      else {
        rename(options)
      }
    })

    await expect(storage.save('demo', newBytes)).rejects.toBe(ioError)
    await expect(storage.load('demo')).resolves.toEqual(oldBytes)
  })

  it('preserves both errors and the backup when publication and rollback fail', async () => {
    const { files, fileSystem, options, storage } = createHost()
    files.set(path, oldBytes)
    const rename = vi.mocked(fileSystem.rename).getMockImplementation()!
    const recoveryError = { errMsg: 'restore:fail I/O failure' }
    vi.mocked(fileSystem.rename)
      .mockImplementationOnce(rename)
      .mockImplementationOnce(({ fail }) => fail(ioError))
      .mockImplementationOnce(({ fail }) => fail(recoveryError))

    await expect(storage.save('demo', newBytes)).rejects.toMatchObject({ errors: [ioError, recoveryError] })
    expect(files.get(`${path}.bak`)).toEqual(oldBytes)
    await expect(createMiniProgramSqliteWasmStorage(options).load('demo')).resolves.toEqual(oldBytes)
  })

  it.each([
    { current: oldBytes, backup: undefined, temporary: newBytes, expected: oldBytes },
    { current: undefined, backup: oldBytes, temporary: newBytes, expected: oldBytes },
    { current: newBytes, backup: oldBytes, temporary: undefined, expected: newBytes },
    { current: undefined, backup: undefined, temporary: newBytes, expected: undefined },
  ])('recovers interrupted state $current / $backup / $temporary', async ({ current, backup, temporary, expected }) => {
    const { files, options } = createHost()
    if (current) {
      files.set(path, current)
    }
    if (backup) {
      files.set(`${path}.bak`, backup)
    }
    if (temporary) {
      files.set(`${path}.tmp`, temporary)
    }
    await expect(createMiniProgramSqliteWasmStorage(options).load('demo')).resolves.toEqual(expected)
    expect(files.get(path)).toEqual(expected)
  })

  it('does not recover a backup when reading the current file fails for another reason', async () => {
    const { files, fileSystem, storage } = createHost()
    files.set(`${path}.bak`, oldBytes)
    vi.mocked(fileSystem.readFile).mockImplementationOnce(({ fail }) => fail(ioError))
    await expect(storage.load('demo')).rejects.toBe(ioError)
    expect(fileSystem.rename).not.toHaveBeenCalled()
    expect(files.get(`${path}.bak`)).toEqual(oldBytes)
  })

  it('reports success once published even if backup cleanup fails', async () => {
    const { files, fileSystem, storage } = createHost()
    files.set(path, oldBytes)
    const unlink = vi.mocked(fileSystem.unlink).getMockImplementation()!
    vi.mocked(fileSystem.unlink).mockImplementation(({ filePath, ...callbacks }) => {
      if (filePath.endsWith('.bak') && files.has(path) && files.has(filePath)) {
        callbacks.fail(ioError)
      }
      else {
        unlink({ filePath, ...callbacks })
      }
    })
    await expect(storage.save('demo', newBytes)).resolves.toBeUndefined()
    await expect(storage.load('demo')).resolves.toEqual(newBytes)
    expect(files.get(`${path}.bak`)).toEqual(oldBytes)
    await expect(storage.save('demo', oldBytes)).rejects.toBe(ioError)
    expect(files.get(path)).toEqual(newBytes)
  })

  it('removes temporary and backup files before the current snapshot to prevent resurrection', async () => {
    const { files, operations, storage } = createHost()
    files.set(path, newBytes)
    files.set(`${path}.bak`, oldBytes)
    files.set(`${path}.tmp`, oldBytes)
    await storage.remove('demo')
    expect(operations).toEqual([`unlink ${path}.tmp`, `unlink ${path}.bak`, `unlink ${path}`])
    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('keeps the current snapshot when backup removal fails', async () => {
    const { files, fileSystem, storage } = createHost()
    files.set(path, newBytes)
    files.set(`${path}.bak`, oldBytes)
    const unlink = vi.mocked(fileSystem.unlink).getMockImplementation()!
    vi.mocked(fileSystem.unlink).mockImplementation(options => options.filePath.endsWith('.bak') ? options.fail(ioError) : unlink(options))
    await expect(storage.remove('demo')).rejects.toBe(ioError)
    await expect(storage.load('demo')).resolves.toEqual(newBytes)
  })

  it('retries directory initialization after a transient failure', async () => {
    const { fileSystem, storage } = createHost()
    vi.mocked(fileSystem.mkdir).mockImplementationOnce(({ fail }) => fail(ioError))
    await expect(storage.load('demo')).rejects.toBe(ioError)
    await expect(storage.save('demo', newBytes)).resolves.toBeUndefined()
    expect(fileSystem.mkdir).toHaveBeenCalledTimes(2)
  })

  it('serializes aliases across storage instances while other hosts remain independent', async () => {
    const { files, fileSystem, options, storage } = createHost()
    const second = createMiniProgramSqliteWasmStorage(options)
    const sharedFileSystem = createMiniProgramSqliteWasmStorage({ ...options, runtime: { ...options.runtime } })
    const anotherHost = createHost()
    let resume: (() => void) | undefined
    const started = Promise.withResolvers<void>()
    const write = vi.mocked(fileSystem.writeFile).getMockImplementation()!
    vi.mocked(fileSystem.writeFile).mockImplementationOnce((options) => {
      resume = () => write(options)
      started.resolve()
    })
    const saving = storage.save('demo', newBytes)
    await started.promise
    const loaded = second.load('demo.sqlite')
    const sharedLoaded = sharedFileSystem.load('demo')
    const removed = second.remove('demo')
    await second.save('other', oldBytes)
    await anotherHost.storage.save('demo', oldBytes)
    expect(anotherHost.files.get(path)).toEqual(oldBytes)
    expect(files.has(path)).toBe(false)
    resume!()
    await saving
    await expect(loaded).resolves.toEqual(newBytes)
    await expect(sharedLoaded).resolves.toEqual(newBytes)
    await removed
    await expect(storage.load('demo')).resolves.toBeUndefined()
  })

  it('requires rename for storage without restricting package binary reads', async () => {
    const { runtime, fileSystem, files } = createHost()
    const { rename: _rename, ...readable } = fileSystem
    const options = { platform: 'weapp' as const, runtime: { ...runtime, getFileSystemManager: () => readable } }
    files.set('assets/sql.wasm', newBytes)
    expect(() => createMiniProgramSqliteWasmStorage(options)).toThrow('Missing: rename')
    await expect(probeMiniProgramSqliteCapabilities(options)).resolves.toMatchObject({
      supported: false,
      capability: 'filesystem',
      code: 'MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE',
    })
    await expect(loadMiniProgramPackageBinary('assets/sql.wasm', options)).resolves.toEqual(newBytes)
  })
})
