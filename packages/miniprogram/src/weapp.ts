import type {
  MiniProgramHostAdapter,
  MiniProgramHostAdapterOptions,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteErrorCode,
  MiniProgramWebAssemblyInstance,
  MiniProgramWebAssemblyRuntime,
} from './types'
import { MiniProgramSqliteUnsupportedError } from './errors'

interface FileSystemError {
  readonly errMsg?: string
}

interface MiniProgramFileSystemManager {
  mkdir: (options: { dirPath: string, recursive: boolean, success: () => void, fail: (error: FileSystemError) => void }) => void
  readFile: (options: { filePath: string, success: (result: { data: string | ArrayBuffer }) => void, fail: (error: FileSystemError) => void }) => void
  writeFile: (options: { filePath: string, data: ArrayBuffer, success: () => void, fail: (error: FileSystemError) => void }) => void
  unlink: (options: { filePath: string, success: () => void, fail: (error: FileSystemError) => void }) => void
}

interface MiniProgramRuntime {
  readonly env?: { readonly USER_DATA_PATH?: string }
  readonly getFileSystemManager?: () => MiniProgramFileSystemManager
}

interface MiniProgramHostAdapterFactoryOptions {
  readonly wasmSource: 'path' | 'binary'
}

type MiniProgramRuntimeErrorCode = Exclude<
  MiniProgramSqliteErrorCode,
  | 'MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED'
  | 'MINIPROGRAM_SQLITE_DEBUG_FILE_UNSUPPORTED'
  | 'MINIPROGRAM_SQLITE_DEBUG_FILE_FAILED'
  | 'MINIPROGRAM_SQLITE_DEBUG_FILE_TOO_LARGE'
>

const ERROR_CODES: Record<MiniProgramRuntimeErrorCode, string> = {
  MINIPROGRAM_SQLITE_RUNTIME_UNAVAILABLE: 'The mini-program runtime is unavailable.',
  MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE: 'The mini-program filesystem API is unavailable.',
  MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE: 'The mini-program user data path is unavailable.',
  MINIPROGRAM_SQLITE_TYPED_ARRAY_UNAVAILABLE: 'Uint8Array and ArrayBuffer are required.',
  MINIPROGRAM_SQLITE_WEBASSEMBLY_UNAVAILABLE: 'A mini-program WebAssembly runtime is unavailable.',
  MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE: 'The mini-program WebAssembly runtime is incompatible with sql.js.',
  MINIPROGRAM_SQLITE_WASM_INSTANTIATION_FAILED: 'The SQLite WASM package asset could not be instantiated.',
  MINIPROGRAM_SQLITE_PACKAGE_BINARY_UNAVAILABLE: 'The SQLite WASM package asset is unavailable.',
}

const REQUIRED_WEBASSEMBLY_MEMBERS = [
  'instantiate',
  'Module',
  'Instance',
  'Memory',
  'Table',
] as const

const compatibilityRuntimes = new WeakMap<object, MiniProgramWebAssemblyRuntime>()

function failure(
  options: MiniProgramHostAdapterOptions,
  capability: MiniProgramSqliteCapabilityReport['capability'],
  code: MiniProgramRuntimeErrorCode,
  cause?: unknown,
) {
  return new MiniProgramSqliteUnsupportedError(
    options.platform,
    capability ?? 'runtime',
    code,
    ERROR_CODES[code],
    cause === undefined ? undefined : { cause },
  )
}

function resolveRuntime(options: MiniProgramHostAdapterOptions): MiniProgramRuntime {
  if (!options.runtime || typeof options.runtime !== 'object') {
    throw failure(options, 'runtime', 'MINIPROGRAM_SQLITE_RUNTIME_UNAVAILABLE')
  }
  return options.runtime as MiniProgramRuntime
}

function resolveFileSystem(options: MiniProgramHostAdapterOptions) {
  const runtime = resolveRuntime(options)
  if (typeof runtime.getFileSystemManager !== 'function') {
    throw failure(options, 'filesystem', 'MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE')
  }
  return { fileSystem: runtime.getFileSystemManager(), runtime }
}

function resolveWebAssembly(options: MiniProgramHostAdapterOptions): MiniProgramWebAssemblyRuntime {
  if (!options.webAssembly || (typeof options.webAssembly !== 'object' && typeof options.webAssembly !== 'function')) {
    throw failure(options, 'webassembly', 'MINIPROGRAM_SQLITE_WEBASSEMBLY_UNAVAILABLE')
  }
  const webAssembly = options.webAssembly as unknown as Record<string, unknown>
  const missingMembers = REQUIRED_WEBASSEMBLY_MEMBERS.filter(member => typeof webAssembly[member] !== 'function')
  if (missingMembers.length > 0) {
    throw new MiniProgramSqliteUnsupportedError(
      options.platform,
      'webassembly',
      'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE',
      `${ERROR_CODES.MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE} Missing: ${missingMembers.join(', ')}.`,
    )
  }
  if (typeof webAssembly['RuntimeError'] === 'function') {
    return options.webAssembly as MiniProgramWebAssemblyRuntime
  }
  const key = options.webAssembly as object
  const cached = compatibilityRuntimes.get(key)
  if (cached) {
    return cached
  }
  const compatible = {
    instantiate: (webAssembly['instantiate'] as MiniProgramWebAssemblyRuntime['instantiate']).bind(options.webAssembly),
    Module: webAssembly['Module'],
    Instance: webAssembly['Instance'],
    Memory: webAssembly['Memory'],
    Table: webAssembly['Table'],
    RuntimeError: Error,
  }
  compatibilityRuntimes.set(key, compatible)
  return compatible
}

function installWebAssemblyCompatibility(
  options: MiniProgramHostAdapterOptions,
  webAssembly: MiniProgramWebAssemblyRuntime,
) {
  const scope = globalThis as unknown as { WebAssembly?: unknown }
  if (scope.WebAssembly === webAssembly) {
    return
  }
  if (scope.WebAssembly !== undefined) {
    throw failure(options, 'webassembly', 'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE')
  }
  try {
    Object.defineProperty(scope, 'WebAssembly', {
      configurable: true,
      value: webAssembly,
      writable: true,
    })
  }
  catch (error) {
    throw failure(options, 'webassembly', 'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE', error)
  }
}

function normalizePackagePath(path: string) {
  const normalizedPath = path.replace(/^\/+/, '')
  if (!normalizedPath || normalizedPath.split('/').includes('..')) {
    throw new TypeError('Mini-program package asset paths must be relative to the package root and may not contain parent traversal.')
  }
  return `/${normalizedPath}`
}

function normalizeInstantiationResult(
  result: MiniProgramWebAssemblyInstance | { readonly instance?: unknown, readonly module?: unknown },
  options: MiniProgramHostAdapterOptions,
) {
  if (result && typeof result === 'object' && 'exports' in result) {
    return { instance: result as MiniProgramWebAssemblyInstance }
  }
  if (result && typeof result === 'object' && 'instance' in result) {
    const instance = result.instance
    if (instance && typeof instance === 'object' && 'exports' in instance) {
      return {
        instance: instance as MiniProgramWebAssemblyInstance,
        ...(!('module' in result) || result.module === undefined ? {} : { module: result.module }),
      }
    }
  }
  throw failure(options, 'wasm-instantiation', 'MINIPROGRAM_SQLITE_WASM_INSTANTIATION_FAILED')
}

function isMissingFile(error: FileSystemError) {
  return /no such file|not found/i.test(error.errMsg ?? '')
}

function isExistingDirectory(error: FileSystemError) {
  return /file already exists/i.test(error.errMsg ?? '')
}

function readFile(fileSystem: MiniProgramFileSystemManager, filePath: string): Promise<Uint8Array> {
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

export function createMiniProgramHostAdapter(
  factoryOptions: MiniProgramHostAdapterFactoryOptions,
): MiniProgramHostAdapter {
  return {
    async probe(options) {
      try {
        const { runtime } = resolveFileSystem(options)
        if (!runtime.env?.USER_DATA_PATH) {
          throw failure(options, 'user-data-path', 'MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE')
        }
        if (
          typeof Uint8Array === 'undefined'
          || typeof ArrayBuffer === 'undefined'
          || typeof BigInt64Array === 'undefined'
          || typeof BigUint64Array === 'undefined'
        ) {
          throw failure(options, 'typed-array', 'MINIPROGRAM_SQLITE_TYPED_ARRAY_UNAVAILABLE')
        }
        resolveWebAssembly(options)
        if (options.packageBinaryPath) {
          await this.loadPackageBinary(options.packageBinaryPath, options)
        }
        return { platform: options.platform, supported: true }
      }
      catch (error) {
        if (error instanceof MiniProgramSqliteUnsupportedError) {
          return {
            platform: options.platform,
            supported: false,
            capability: error.capability,
            code: error.code,
            message: error.message,
          }
        }
        const unsupported = failure(options, 'package-binary', 'MINIPROGRAM_SQLITE_PACKAGE_BINARY_UNAVAILABLE', error)
        return {
          platform: options.platform,
          supported: false,
          capability: unsupported.capability,
          code: unsupported.code,
          message: unsupported.message,
        }
      }
    },
    createStorage(options) {
      const { fileSystem, runtime } = resolveFileSystem(options)
      const userDataPath = runtime.env?.USER_DATA_PATH
      if (!userDataPath) {
        throw failure(options, 'user-data-path', 'MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE')
      }
      const directory = `${userDataPath}/${options.directoryName ?? 'weapp-sqlite'}`
      let directoryPromise: Promise<void> | undefined
      const ensureDirectory = () => directoryPromise ??= new Promise((resolve, reject) => {
        fileSystem.mkdir({
          dirPath: directory,
          recursive: true,
          success: resolve,
          fail: error => isExistingDirectory(error) ? resolve() : reject(error),
        })
      })
      const databasePath = (name: string) => `${directory}/${databaseFileName(name)}`

      return {
        getDatabasePath(name) {
          return databasePath(name)
        },
        async load(name) {
          await ensureDirectory()
          try {
            return await readFile(fileSystem, databasePath(name))
          }
          catch (error) {
            if (isMissingFile(error as FileSystemError)) {
              return undefined
            }
            throw error
          }
        },
        async save(name, data) {
          await ensureDirectory()
          await new Promise<void>((resolve, reject) => {
            fileSystem.writeFile({
              filePath: databasePath(name),
              data: Uint8Array.from(data).buffer,
              success: resolve,
              fail: reject,
            })
          })
        },
        async remove(name) {
          await ensureDirectory()
          await new Promise<void>((resolve, reject) => {
            fileSystem.unlink({
              filePath: databasePath(name),
              success: resolve,
              fail: error => isMissingFile(error) ? resolve() : reject(error),
            })
          })
        },
      }
    },
    async loadPackageBinary(path, options) {
      const { fileSystem } = resolveFileSystem(options)
      const normalizedPath = normalizePackagePath(path).slice(1)
      try {
        return await readFile(fileSystem, normalizedPath)
      }
      catch (error) {
        throw failure(options, 'package-binary', 'MINIPROGRAM_SQLITE_PACKAGE_BINARY_UNAVAILABLE', error)
      }
    },
    async instantiatePackageWasm(path, imports, options) {
      const webAssembly = resolveWebAssembly(options)
      installWebAssemblyCompatibility(options, webAssembly)
      try {
        const source = factoryOptions.wasmSource === 'path'
          ? normalizePackagePath(path)
          : await this.loadPackageBinary(path, options)
        const result = await webAssembly.instantiate(source, imports)
        return normalizeInstantiationResult(result, options)
      }
      catch (error) {
        if (error instanceof MiniProgramSqliteUnsupportedError) {
          throw error
        }
        throw failure(options, 'wasm-instantiation', 'MINIPROGRAM_SQLITE_WASM_INSTANTIATION_FAILED', error)
      }
    },
  }
}

export const weappHostAdapter = createMiniProgramHostAdapter({ wasmSource: 'path' })
export const portableMiniProgramHostAdapter = createMiniProgramHostAdapter({ wasmSource: 'binary' })
