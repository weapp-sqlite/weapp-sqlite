export interface WebSqliteDebugArtifact {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface WebSqliteDebugFile {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface WebSqliteDebugSaveResult {
  readonly method: 'file-system-access' | 'download'
  readonly fileName: string
}

interface WritableFileStream {
  write: (data: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

interface FileHandle {
  createWritable: () => Promise<WritableFileStream>
  getFile: () => Promise<{ readonly name: string, readonly type: string, arrayBuffer: () => Promise<ArrayBuffer> }>
}

interface PickerScope {
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>
  showOpenFilePicker?: (options: unknown) => Promise<readonly FileHandle[]>
}

interface AnchorLike {
  download: string
  href: string
  click: () => void
  remove: () => void
}

interface InputFileLike {
  readonly name: string
  readonly type: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

interface InputLike {
  type: string
  accept: string
  files: { readonly length: number, readonly [index: number]: InputFileLike | undefined } | null
  click: () => void
  remove: () => void
  addEventListener: (name: 'change' | 'cancel', listener: () => void, options?: { readonly once?: boolean }) => void
}

interface DocumentLike {
  createElement: ((name: 'a') => AnchorLike) & ((name: 'input') => InputLike)
  readonly body?: { appendChild: (element: InputLike) => void }
}

interface UrlLike {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

export interface WebSqliteDebugFileAdapterOptions {
  readonly scope?: PickerScope
  readonly document?: DocumentLike
  readonly url?: UrlLike
  readonly Blob?: typeof Blob
}

export interface WebSqliteDebugFileAdapter {
  save: (artifact: WebSqliteDebugArtifact) => Promise<WebSqliteDebugSaveResult>
  choose: (options?: { readonly accept?: readonly string[], readonly maxBytes?: number }) => Promise<WebSqliteDebugFile>
}

export class WebSqliteDebugFileError extends Error {
  readonly code: 'WEB_SQLITE_DEBUG_FILE_UNSUPPORTED' | 'WEB_SQLITE_DEBUG_FILE_TOO_LARGE' | 'WEB_SQLITE_DEBUG_FILE_CANCELLED'

  constructor(code: WebSqliteDebugFileError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WebSqliteDebugFileError'
    this.code = code
  }
}

export function createWebSqliteDebugFileAdapter(options: WebSqliteDebugFileAdapterOptions = {}): WebSqliteDebugFileAdapter {
  const scope = options.scope ?? globalThis as unknown as PickerScope

  return {
    async save(artifact) {
      if (scope.showSaveFilePicker) {
        try {
          const handle = await scope.showSaveFilePicker({
            suggestedName: artifact.fileName,
            types: [{ description: 'SQLite debug artifact', accept: { [artifact.mimeType]: [`.${artifact.fileName.split('.').pop() ?? 'bin'}`] } }],
          })
          const writable = await handle.createWritable()
          await writable.write(Uint8Array.from(artifact.bytes))
          await writable.close()
          return { method: 'file-system-access', fileName: artifact.fileName }
        }
        catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_CANCELLED', 'File saving was cancelled.', { cause: error })
          }
          throw error
        }
      }
      const document = options.document ?? globalThis.document as unknown as DocumentLike | undefined
      const url = options.url ?? globalThis.URL as unknown as UrlLike | undefined
      const BlobConstructor = options.Blob ?? globalThis.Blob
      if (!document || !url || !BlobConstructor) {
        throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_UNSUPPORTED', 'This browser cannot save SQLite debug artifacts.')
      }
      const objectUrl = url.createObjectURL(new BlobConstructor([Uint8Array.from(artifact.bytes)], { type: artifact.mimeType }))
      const anchor = document.createElement('a')
      anchor.download = artifact.fileName
      anchor.href = objectUrl
      anchor.click()
      anchor.remove()
      url.revokeObjectURL(objectUrl)
      return { method: 'download', fileName: artifact.fileName }
    },
    async choose(chooseOptions = {}) {
      let file: InputFileLike | undefined
      if (scope.showOpenFilePicker) {
        try {
          const handles = await scope.showOpenFilePicker({ multiple: false, types: chooseOptions.accept?.map(extension => ({ accept: { 'application/octet-stream': [extension] } })) })
          file = await handles[0]?.getFile()
        }
        catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_CANCELLED', 'File selection was cancelled.', { cause: error })
          }
          throw error
        }
      }
      else {
        const document = options.document ?? globalThis.document as unknown as DocumentLike | undefined
        if (!document) {
          throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_UNSUPPORTED', 'This browser cannot select SQLite debug files.')
        }
        file = await new Promise<InputFileLike>((resolve, reject) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = chooseOptions.accept?.join(',') ?? ''
          input.addEventListener('change', () => {
            const selected = input.files?.[0]
            input.remove()
            selected ? resolve(selected) : reject(new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_CANCELLED', 'No file was selected.'))
          }, { once: true })
          input.addEventListener('cancel', () => {
            input.remove()
            reject(new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_CANCELLED', 'File selection was cancelled.'))
          }, { once: true })
          document.body?.appendChild(input)
          input.click()
        })
      }
      if (!file) {
        throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_CANCELLED', 'No file was selected.')
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (chooseOptions.maxBytes !== undefined && bytes.byteLength > chooseOptions.maxBytes) {
        throw new WebSqliteDebugFileError('WEB_SQLITE_DEBUG_FILE_TOO_LARGE', `The selected file exceeds ${chooseOptions.maxBytes} bytes.`)
      }
      return { fileName: file.name, mimeType: file.type, bytes }
    },
  }
}
