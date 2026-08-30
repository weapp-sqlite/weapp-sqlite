import type {
  MiniProgramPlatform,
  MiniProgramSqliteDebugArtifact,
  MiniProgramSqliteDebugFile,
  MiniProgramSqliteDebugFileAdapter,
} from './types'
import { MiniProgramSqliteUnsupportedError } from './errors'

interface FileSystemError {
  readonly errMsg?: string
}

interface DebugFileSystem {
  mkdir: (options: { dirPath: string, recursive: boolean, success: () => void, fail: (error: FileSystemError) => void }) => void
  writeFile: (options: { filePath: string, data: ArrayBuffer, success: () => void, fail: (error: FileSystemError) => void }) => void
  readFile: (options: { filePath: string, success: (result: { data: ArrayBuffer | string }) => void, fail: (error: FileSystemError) => void }) => void
}

interface DebugRuntime {
  readonly env?: { readonly USER_DATA_PATH?: string }
  readonly getFileSystemManager?: () => DebugFileSystem
  readonly getDeviceInfo?: () => { readonly platform?: string }
  readonly getSystemInfoSync?: () => { readonly platform?: string }
  readonly saveFileToDisk?: (options: { filePath: string, success: () => void, fail: (error: FileSystemError) => void }) => void
  readonly shareFileMessage?: (options: { filePath: string, fileName?: string, success: () => void, fail: (error: FileSystemError) => void }) => void
  readonly chooseMessageFile?: (options: {
    count: number
    type: 'file'
    extension?: readonly string[]
    success: (result: { tempFiles: readonly { name: string, path: string, type?: string, size?: number }[] }) => void
    fail: (error: FileSystemError) => void
  }) => void
}

export interface MiniProgramSqliteDebugFileAdapterOptions {
  readonly platform: MiniProgramPlatform
  readonly runtime: unknown
  readonly directoryName?: string
}

function unsupported(platform: MiniProgramPlatform, capability: 'file-delivery' | 'file-selection', message: string, cause?: unknown) {
  return new MiniProgramSqliteUnsupportedError(
    platform,
    capability,
    'MINIPROGRAM_SQLITE_DEBUG_FILE_UNSUPPORTED',
    message,
    cause === undefined ? undefined : { cause },
  )
}

function failed(platform: MiniProgramPlatform, capability: 'file-delivery' | 'file-selection', message: string, cause?: unknown) {
  return new MiniProgramSqliteUnsupportedError(
    platform,
    capability,
    'MINIPROGRAM_SQLITE_DEBUG_FILE_FAILED',
    message,
    cause === undefined ? undefined : { cause },
  )
}

function safeFileName(value: string) {
  const normalized = value.replaceAll(/[^\w.-]/g, '_')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new TypeError('Debug artifact file names must contain a usable file name.')
  }
  return normalized
}

function call(options: { readonly invoke: (success: () => void, fail: (error: FileSystemError) => void) => void }) {
  return new Promise<void>((resolve, reject) => options.invoke(resolve, reject))
}

export function createMiniProgramSqliteDebugFileAdapter(
  options: MiniProgramSqliteDebugFileAdapterOptions,
): MiniProgramSqliteDebugFileAdapter {
  if (options.platform !== 'weapp') {
    throw unsupported(options.platform, 'file-delivery', `Debug file delivery for ${options.platform} is not supported.`)
  }
  if (!options.runtime || typeof options.runtime !== 'object') {
    throw unsupported(options.platform, 'file-delivery', 'The WeChat runtime is unavailable.')
  }
  const runtime = options.runtime as DebugRuntime
  const fileSystem = runtime.getFileSystemManager?.()
  const userDataPath = runtime.env?.USER_DATA_PATH
  if (!fileSystem || !userDataPath) {
    throw unsupported(options.platform, 'file-delivery', 'The WeChat filesystem or user data path is unavailable.')
  }
  const resolvedFileSystem = fileSystem
  const directory = `${userDataPath}/${options.directoryName ?? 'weapp-sqlite-debug'}`
  let directoryPromise: Promise<void> | undefined
  const ensureDirectory = () => directoryPromise ??= call({
    invoke: (success, fail) => resolvedFileSystem.mkdir({
      dirPath: directory,
      recursive: true,
      success,
      fail: error => /file already exists/i.test(error.errMsg ?? '') ? success() : fail(error),
    }),
  })

  async function writeArtifact(artifact: MiniProgramSqliteDebugArtifact) {
    await ensureDirectory()
    const fileName = safeFileName(artifact.fileName)
    const filePath = `${directory}/${fileName}`
    await call({
      invoke: (success, fail) => resolvedFileSystem.writeFile({ filePath, data: Uint8Array.from(artifact.bytes).buffer, success, fail }),
    })
    return { fileName, filePath }
  }

  return {
    async save(artifact) {
      const { fileName, filePath } = await writeArtifact(artifact)
      const platform = runtime.getDeviceInfo?.().platform ?? runtime.getSystemInfoSync?.().platform ?? ''
      const desktop = /^(?:devtools|windows|mac)$/i.test(platform)
      try {
        if (desktop && runtime.saveFileToDisk) {
          await call({ invoke: (success, fail) => runtime.saveFileToDisk?.({ filePath, success, fail }) })
          return { method: 'save-file-to-disk', fileName }
        }
        if (runtime.shareFileMessage) {
          await call({ invoke: (success, fail) => runtime.shareFileMessage?.({ filePath, fileName, success, fail }) })
          return { method: 'share-file-message', fileName }
        }
        if (runtime.saveFileToDisk) {
          await call({ invoke: (success, fail) => runtime.saveFileToDisk?.({ filePath, success, fail }) })
          return { method: 'save-file-to-disk', fileName }
        }
      }
      catch (error) {
        throw failed(options.platform, 'file-delivery', 'The WeChat file could not be delivered.', error)
      }
      throw unsupported(options.platform, 'file-delivery', 'Neither wx.saveFileToDisk nor wx.shareFileMessage is available.')
    },
    async choose(chooseOptions = {}): Promise<MiniProgramSqliteDebugFile> {
      if (!runtime.chooseMessageFile) {
        throw unsupported(options.platform, 'file-selection', 'wx.chooseMessageFile is unavailable.')
      }
      let selection: { readonly name: string, readonly path: string, readonly type?: string, readonly size?: number }
      try {
        selection = await new Promise((resolve, reject) => runtime.chooseMessageFile?.({
          count: 1,
          type: 'file',
          ...(chooseOptions.extensions === undefined ? {} : { extension: chooseOptions.extensions }),
          success: result => result.tempFiles[0] ? resolve(result.tempFiles[0]) : reject(new Error('No file was selected.')),
          fail: reject,
        }))
      }
      catch (error) {
        throw failed(options.platform, 'file-selection', 'The WeChat file selection failed.', error)
      }
      if (chooseOptions.maxBytes !== undefined && selection.size !== undefined && selection.size > chooseOptions.maxBytes) {
        throw new MiniProgramSqliteUnsupportedError(options.platform, 'file-selection', 'MINIPROGRAM_SQLITE_DEBUG_FILE_TOO_LARGE', `The selected file exceeds ${chooseOptions.maxBytes} bytes.`)
      }
      const bytes = await new Promise<Uint8Array>((resolve, reject) => resolvedFileSystem.readFile({
        filePath: selection.path,
        success: ({ data }) => typeof data === 'string' ? reject(new TypeError('Expected binary file data.')) : resolve(new Uint8Array(data)),
        fail: reject,
      }))
      if (chooseOptions.maxBytes !== undefined && bytes.byteLength > chooseOptions.maxBytes) {
        throw new MiniProgramSqliteUnsupportedError(options.platform, 'file-selection', 'MINIPROGRAM_SQLITE_DEBUG_FILE_TOO_LARGE', `The selected file exceeds ${chooseOptions.maxBytes} bytes.`)
      }
      return { fileName: selection.name, mimeType: selection.type ?? 'application/octet-stream', bytes }
    },
  }
}
