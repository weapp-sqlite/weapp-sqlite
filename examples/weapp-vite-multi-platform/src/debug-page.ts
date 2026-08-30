import type { SqliteDebugColumn, SqliteDebugController, SqliteDebugPage, SqliteDebugSnapshotMetadata, SqliteDebugTable } from '@weapp-sqlite/debug'
import { createPlatformSqliteDebugController, getPlatformSqliteDebugFilePath } from './debug-runtime'

interface DebugState {
  readonly tables: readonly SqliteDebugTable[]
  readonly selectedTable: string
  readonly columns: readonly SqliteDebugColumn[]
  readonly page: SqliteDebugPage | undefined
  readonly pageLabel: string
  readonly displayRows: readonly string[]
  readonly sql: string
  readonly result: string
  readonly snapshot: SqliteDebugSnapshotMetadata | undefined
  readonly error?: { code: string, message: string } | undefined
}

interface DebugPageContext {
  data: { debug: DebugState }
  setData: (data: Partial<{ debug: DebugState }>) => void
}

function serializeError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) }
  }
  return { code: 'SQLITE_DEBUG_UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) }
}

let controllerPromise: Promise<SqliteDebugController> | undefined
function controller() {
  return controllerPromise ??= createPlatformSqliteDebugController()
}

export async function closeDebugPageController() {
  const current = controllerPromise
  controllerPromise = undefined
  if (current) {
    try {
      await (await current).close()
    }
    catch {}
  }
}

function pageLabel(page: SqliteDebugPage | undefined) {
  if (!page || page.total === 0) {
    return '0 / 0'
  }
  return `${page.offset + 1}-${Math.min(page.offset + page.rows.length, page.total)} / ${page.total}`
}

function resultJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item) ?? ''
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let value = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    value += alphabet[first >>> 2]
    value += alphabet[((first & 3) << 4) | (second >>> 4)]
    value += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >>> 6)] : '='
    value += index + 2 < bytes.length ? alphabet[third & 63] : '='
  }
  return value
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, '')
  if (!normalized || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(normalized)) {
    throw new Error('Invalid base64 SQLite artifact.')
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((normalized.length / 4) * 3 - padding)
  let output = 0
  for (let index = 0; index < normalized.length; index += 4) {
    const values = [0, 1, 2, 3].map(offset => normalized[index + offset] === '=' ? 0 : alphabet.indexOf(normalized[index + offset] ?? ''))
    const combined = ((values[0] ?? 0) << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0)
    if (output < bytes.length) {
      bytes[output] = combined >>> 16
      output += 1
    }
    if (output < bytes.length) {
      bytes[output] = (combined >>> 8) & 255
      output += 1
    }
    if (output < bytes.length) {
      bytes[output] = combined & 255
      output += 1
    }
  }
  return bytes
}

async function tablePage(current: SqliteDebugController, selectedTable: string, offset: number) {
  const columns = await current.describeTable(selectedTable)
  let page = await current.readTable(selectedTable, { limit: 50, offset })
  if (page.total > 0 && page.rows.length === 0 && page.offset > 0) {
    page = await current.readTable(selectedTable, { limit: 50, offset: Math.floor((page.total - 1) / page.limit) * page.limit })
  }
  return { columns, page, pageLabel: pageLabel(page), displayRows: page.rows.map(row => resultJson(row) ?? '') }
}

function confirmWrite() {
  const browserConfirm = (globalThis as unknown as { confirm?: (message: string) => boolean }).confirm
  if (browserConfirm) {
    return Promise.resolve(browserConfirm('确认执行写入 SQL？'))
  }
  const runtime = wx as unknown as { showModal?: (options: { title: string, content: string, confirmText: string, success: (result: { confirm: boolean }) => void, fail: (error: unknown) => void }) => void }
  if (!runtime.showModal) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve, reject) => runtime.showModal?.({
    title: '确认写入',
    content: '写入 SQL 会修改当前本地数据库。',
    confirmText: '执行',
    success: result => resolve(result.confirm),
    fail: reject,
  }))
}

export function createDebugPageMethods() {
  async function refreshDebug(this: DebugPageContext) {
    try {
      const current = await controller()
      const tables = await current.listTables()
      const selectedTable = this.data.debug.selectedTable && tables.some(table => table.name === this.data.debug.selectedTable)
        ? this.data.debug.selectedTable
        : tables[0]?.name ?? ''
      const table = selectedTable
        ? await tablePage(current, selectedTable, this.data.debug.page?.offset ?? 0)
        : { columns: [], page: undefined, pageLabel: pageLabel(undefined), displayRows: [] }
      const snapshot = (await current.exportDatabase()).metadata
      this.setData({ debug: { ...this.data.debug, tables, selectedTable, ...table, snapshot, error: undefined } })
    }
    catch (error) {
      this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
    }
  }

  return {
    refreshDebug,
    async selectDebugTable(this: DebugPageContext, event: { currentTarget?: { dataset?: { table?: string } } }) {
      const selectedTable = event.currentTarget?.dataset?.table ?? ''
      try {
        const current = await controller()
        const table = await tablePage(current, selectedTable, 0)
        this.setData({ debug: { ...this.data.debug, selectedTable, ...table, error: undefined } })
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    onDebugSqlInput(this: DebugPageContext, event: { detail?: { value?: string } }) {
      this.setData({ debug: { ...this.data.debug, sql: event.detail?.value ?? '' } })
    },
    async runDebugQuery(this: DebugPageContext) {
      try {
        const result = await (await controller()).query(this.data.debug.sql)
        this.setData({ debug: { ...this.data.debug, result: resultJson(result), error: undefined } })
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async runDebugWrite(this: DebugPageContext) {
      try {
        if (!await confirmWrite()) {
          return
        }
        const result = await (await controller()).execute(this.data.debug.sql, undefined, { allowWrite: true })
        this.setData({ debug: { ...this.data.debug, result: resultJson(result), error: undefined } })
        await refreshDebug.call(this)
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async exportDebug(this: DebugPageContext) {
      try {
        const snapshot = await (await controller()).exportDatabase()
        const browser = globalThis as unknown as { Blob?: typeof Blob, document?: Document, URL?: typeof URL }
        if (browser.Blob && browser.document && browser.URL) {
          const blobBytes = new Uint8Array(snapshot.bytes.byteLength)
          blobBytes.set(snapshot.bytes)
          const url = browser.URL.createObjectURL(new browser.Blob([blobBytes.buffer], { type: 'application/vnd.sqlite3' }))
          const link = browser.document.createElement('a')
          link.href = url
          link.download = `${snapshot.metadata.databaseName}.sqlite`
          link.click()
          browser.URL.revokeObjectURL(url)
        }
        const filePath = await getPlatformSqliteDebugFilePath()
        const result = { metadata: snapshot.metadata, ...(filePath ? { filePath } : {}) }
        this.setData({ debug: { ...this.data.debug, snapshot: snapshot.metadata, result: resultJson(result), error: undefined } })
        return result
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async exportDebugArtifact() {
      const snapshot = await (await controller()).exportDatabase()
      return {
        metadata: snapshot.metadata,
        base64: encodeBase64(snapshot.bytes),
        filePath: await getPlatformSqliteDebugFilePath(),
      }
    },
    async importDebug(this: DebugPageContext, event: { target?: { files?: ArrayLike<File> } }) {
      try {
        const file = event.target?.files?.[0]
        if (!file) {
          return
        }
        const metadata = await (await controller()).importDatabase(new Uint8Array(await file.arrayBuffer()), { replace: true })
        this.setData({ debug: { ...this.data.debug, snapshot: metadata, result: resultJson(metadata), error: undefined } })
        await refreshDebug.call(this)
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async resetDebug(this: DebugPageContext) {
      try {
        await (await controller()).resetDatabase()
        await refreshDebug.call(this)
        this.setData({ debug: { ...this.data.debug, result: 'database reset', error: undefined } })
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async previousDebugPage(this: DebugPageContext) {
      try {
        const offset = Math.max(0, (this.data.debug.page?.offset ?? 0) - (this.data.debug.page?.limit ?? 50))
        const table = await tablePage(await controller(), this.data.debug.selectedTable, offset)
        this.setData({ debug: { ...this.data.debug, ...table, error: undefined } })
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async nextDebugPage(this: DebugPageContext) {
      try {
        const page = this.data.debug.page
        if (!page || page.offset + page.limit >= page.total) {
          return
        }
        const table = await tablePage(await controller(), this.data.debug.selectedTable, page.offset + page.limit)
        this.setData({ debug: { ...this.data.debug, ...table, error: undefined } })
      }
      catch (error) {
        this.setData({ debug: { ...this.data.debug, error: serializeError(error) } })
      }
    },
    async queryDebugForAutomation(this: DebugPageContext, sql: string) {
      const result = await (await controller()).query(sql)
      this.setData({ debug: { ...this.data.debug, sql, result: resultJson(result), error: undefined } })
      return result
    },
    async executeDebugWriteForAutomation(this: DebugPageContext, sql: string) {
      const result = await (await controller()).execute(sql, undefined, { allowWrite: true })
      this.setData({ debug: { ...this.data.debug, sql, result: resultJson(result), error: undefined } })
      await refreshDebug.call(this)
      return result
    },
    async importDebugArtifact(this: DebugPageContext, base64: string) {
      const metadata = await (await controller()).importDatabase(decodeBase64(base64), { replace: true })
      this.setData({ debug: { ...this.data.debug, snapshot: metadata, result: resultJson(metadata), error: undefined } })
      await refreshDebug.call(this)
      return metadata
    },
    async closeDebugController() {
      await closeDebugPageController()
    },
  }
}
