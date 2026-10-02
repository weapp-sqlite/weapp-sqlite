import type { MiniProgramSqliteWasmStorage } from './types'

export interface FileSystemError {
  readonly errMsg?: string
}

export interface MiniProgramFileSystemManager {
  mkdir: (options: { dirPath: string, recursive: boolean, success: () => void, fail: (error: FileSystemError) => void }) => void
  readFile: (options: { filePath: string, success: (result: { data: string | ArrayBuffer }) => void, fail: (error: FileSystemError) => void }) => void
  writeFile: (options: { filePath: string, data: ArrayBuffer, success: () => void, fail: (error: FileSystemError) => void }) => void
  unlink: (options: { filePath: string, success: () => void, fail: (error: FileSystemError) => void }) => void
  rename: (options: { oldPath: string, newPath: string, success: () => void, fail: (error: FileSystemError) => void }) => void
}

const runtimeQueues = new WeakMap<object, Map<string, Promise<unknown>>>()
const fileSystemQueues = new WeakMap<object, Map<string, Promise<unknown>>>()

export function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'errMsg' in error
    && typeof error.errMsg === 'string' && /no such file|not found/i.test(error.errMsg)
}

export function readFile(fileSystem: MiniProgramFileSystemManager, filePath: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    fileSystem.readFile({
      filePath,
      success: ({ data }) => {
        if (typeof data === 'string') {
          reject(new TypeError(`Expected binary data from ${filePath}.`))
          return
        }
        resolve(Uint8Array.from(new Uint8Array(data)))
      },
      fail: reject,
    })
  })
}

function databaseFileName(name: string) {
  if (!name || !/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
    throw new TypeError('SQLite database names may only contain letters, numbers, dots, underscores, and hyphens.')
  }
  return name.endsWith('.sqlite') ? name : `${name}.sqlite`
}

function queuePath(path: string) {
  const prefix = path.match(/^[\w+.-]+:\/\//)?.[0] ?? ''
  const segments: string[] = []
  for (const segment of path.slice(prefix.length).split('/')) {
    if (segment === '..') {
      segments.pop()
    }
    else if (segment && segment !== '.') {
      segments.push(segment)
    }
  }
  return `${prefix}${segments.join('/')}`
}

export function createFileSystemStorage(
  fileSystem: MiniProgramFileSystemManager,
  runtime: object,
  directory: string,
): MiniProgramSqliteWasmStorage {
  let queues = runtimeQueues.get(runtime)
  if (!queues) {
    queues = new Map()
    runtimeQueues.set(runtime, queues)
  }
  const storageQueues = queues
  let fileQueues = fileSystemQueues.get(fileSystem)
  if (!fileQueues) {
    fileQueues = new Map()
    fileSystemQueues.set(fileSystem, fileQueues)
  }
  const sharedFileQueues = fileQueues
  let directoryPromise: Promise<void> | undefined
  const ensureDirectory = () => directoryPromise ??= new Promise<void>((resolve, reject) => {
    fileSystem.mkdir({
      dirPath: directory,
      recursive: true,
      success: resolve,
      fail: error => /file already exists/i.test(error.errMsg ?? '') ? resolve() : reject(error),
    })
  }).catch((error: unknown) => {
    directoryPromise = undefined
    throw error
  })
  const databasePath = (name: string) => `${directory}/${databaseFileName(name)}`

  function enqueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const key = queuePath(path)
    const previous = [storageQueues.get(key), sharedFileQueues.get(key)]
    const result = Promise.all(previous.map(operation => operation?.catch(() => undefined))).then(async () => {
      await ensureDirectory()
      return operation()
    })
    storageQueues.set(key, result)
    sharedFileQueues.set(key, result)
    const release = () => {
      if (storageQueues.get(key) === result) {
        storageQueues.delete(key)
      }
      if (sharedFileQueues.get(key) === result) {
        sharedFileQueues.delete(key)
      }
    }
    void result.then(release, release)
    return result
  }

  async function readIfPresent(path: string) {
    try {
      return await readFile(fileSystem, path)
    }
    catch (error) {
      if (isMissingFile(error)) {
        return undefined
      }
      throw error
    }
  }

  function rename(oldPath: string, newPath: string) {
    return new Promise<void>((resolve, reject) => fileSystem.rename({ oldPath, newPath, success: resolve, fail: reject }))
  }

  function removeIfPresent(filePath: string) {
    return new Promise<void>((resolve, reject) => fileSystem.unlink({
      filePath,
      success: resolve,
      fail: error => isMissingFile(error) ? resolve() : reject(error),
    }))
  }

  async function loadSnapshot(path: string) {
    const current = await readIfPresent(path)
    if (current !== undefined) {
      return current
    }
    const backup = await readIfPresent(`${path}.bak`)
    if (backup !== undefined) {
      await rename(`${path}.bak`, path)
    }
    return backup
  }

  return {
    getDatabasePath: databasePath,
    async load(name) {
      const path = databasePath(name)
      return enqueue(path, () => loadSnapshot(path))
    },
    async save(name, data) {
      const path = databasePath(name)
      const bytes = Uint8Array.from(data)
      return enqueue(path, async () => {
        const previous = await loadSnapshot(path)
        const temporary = `${path}.tmp`
        const backup = `${path}.bak`
        await removeIfPresent(backup)
        let publishing = false
        try {
          await new Promise<void>((resolve, reject) => fileSystem.writeFile({
            filePath: temporary,
            data: bytes.buffer,
            success: resolve,
            fail: reject,
          }))
          publishing = true
          if (previous !== undefined) {
            await rename(path, backup)
          }
          await rename(temporary, path)
        }
        catch (error) {
          let failure = error
          if (publishing) {
            try {
              await loadSnapshot(path)
            }
            catch (recoveryError) {
              failure = new AggregateError([error, recoveryError], 'SQLite snapshot publication and recovery failed.')
            }
          }
          await removeIfPresent(temporary).catch(() => undefined)
          throw failure
        }
        // Publication has succeeded; leftover backups are safe to clean on the next save.
        await removeIfPresent(backup).catch(() => undefined)
      })
    },
    async remove(name) {
      const path = databasePath(name)
      return enqueue(path, async () => {
        await removeIfPresent(`${path}.tmp`)
        await removeIfPresent(`${path}.bak`)
        await removeIfPresent(path)
      })
    },
  }
}
