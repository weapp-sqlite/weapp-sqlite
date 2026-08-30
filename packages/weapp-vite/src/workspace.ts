import type { SqliteScalar } from '@weapp-sqlite/core'
import type {
  SqliteDebugColumn,
  SqliteDebugController,
  SqliteDebugFilter,
  SqliteDebugImportMapping,
  SqliteDebugImportPreview,
  SqliteDebugIndex,
  SqliteDebugPage,
  SqliteDebugRowLocator,
  SqliteDebugTable,
  SqliteDebugTableCapabilities,
  SqliteDebugTableFormat,
  SqliteDebugTableImportSource,
} from '@weapp-sqlite/debug'
import type { SqliteDebugWorkspaceOptions } from './types'
import { serializeSqliteDebugError } from '@weapp-sqlite/debug'
import { createSqliteDebugWorkspace } from './debug'

interface WorkspaceEvent {
  readonly currentTarget?: { readonly dataset?: Readonly<Record<string, string | number>> }
  readonly detail?: { readonly value?: unknown }
}

interface EditorField {
  readonly name: string
  readonly type: string
  readonly value: string
  readonly isNull: boolean
  readonly disabled: boolean
}

interface DisplayCell {
  readonly column: string
  readonly value: string
  readonly kind: 'null' | 'integer' | 'real' | 'text' | 'blob'
}

interface DisplayRow {
  readonly index: number
  readonly selected: boolean
  readonly cells: readonly DisplayCell[]
}

interface ActivityEntry {
  readonly id: number
  readonly status: 'success' | 'error'
  readonly action: string
  readonly detail: string
  readonly time: string
}

interface WorkspaceData {
  [key: string]: unknown
  phase: 'loading' | 'ready' | 'unsupported' | 'failed'
  databaseName: string
  runtimeLabel: string
  tables: readonly SqliteDebugTable[]
  selectedTable: string
  capabilities?: SqliteDebugTableCapabilities
  columns: readonly SqliteDebugColumn[]
  indexes: readonly SqliteDebugIndex[]
  page?: SqliteDebugPage
  displayRows: readonly DisplayRow[]
  selectedRows: readonly number[]
  activeTab: 'data' | 'schema' | 'sql' | 'activity'
  search: string
  filters: readonly SqliteDebugFilter[]
  filterColumn: string
  filterOperator: string
  filterOperators: readonly { readonly label: string, readonly value: SqliteDebugFilter['operator'] }[]
  filterValue: string
  orderColumn: string
  orderDirection: 'asc' | 'desc'
  sql: string
  result: string
  error: { readonly code: string, readonly message: string } | null
  editorOpen: boolean
  editorMode: 'insert' | 'update'
  editorRow: number
  editorFields: readonly EditorField[]
  confirmOpen: boolean
  confirmAction: string
  confirmValue: string
  confirmTarget: string
  formName: string
  formValue: string
  formType: string
  columnTypes: readonly string[]
  indexUnique: boolean
  importSource: SqliteDebugTableImportSource | null
  importPreview: SqliteDebugImportPreview | null
  importMappings: readonly SqliteDebugImportMapping[]
  importMode: 'create' | 'append' | 'replace'
  importConfirmValue: string
  importModes: readonly { readonly label: string, readonly value: WorkspaceData['importMode'] }[]
  activities: readonly ActivityEntry[]
  undoLabel: string
}

interface WorkspacePageContext {
  readonly data: WorkspaceData
  setData: (data: Partial<WorkspaceData>) => void
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const COLUMN_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'] as const
const FILTER_OPERATORS: WorkspaceData['filterOperators'] = [
  { label: '包含', value: 'contains' },
  { label: '前缀', value: 'startsWith' },
  { label: '等于', value: 'eq' },
  { label: '不等于', value: 'ne' },
  { label: '小于', value: 'lt' },
  { label: '小于等于', value: 'lte' },
  { label: '大于', value: 'gt' },
  { label: '大于等于', value: 'gte' },
  { label: '为空', value: 'isNull' },
  { label: '不为空', value: 'isNotNull' },
]
const IMPORT_MODES: WorkspaceData['importModes'] = [
  { label: '新建', value: 'create' },
  { label: '追加', value: 'append' },
  { label: '替换', value: 'replace' },
]
let activityId = 0

function bytesToBase64(bytes: Uint8Array) {
  let result = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const value = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    result += BASE64[(value >> 18) & 63]
    result += BASE64[(value >> 12) & 63]
    result += index + 1 < bytes.length ? BASE64[(value >> 6) & 63] : '='
    result += index + 2 < bytes.length ? BASE64[value & 63] : '='
  }
  return result
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/\s/g, '')
  const bytes: number[] = []
  for (let index = 0; index < normalized.length; index += 4) {
    const first = BASE64.indexOf(normalized[index] ?? '')
    const second = BASE64.indexOf(normalized[index + 1] ?? '')
    const thirdCharacter = normalized[index + 2] ?? '='
    const fourthCharacter = normalized[index + 3] ?? '='
    const third = thirdCharacter === '=' ? 0 : BASE64.indexOf(thirdCharacter)
    const fourth = fourthCharacter === '=' ? 0 : BASE64.indexOf(fourthCharacter)
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth
    bytes.push((combined >> 16) & 255)
    if (thirdCharacter !== '=') {
      bytes.push((combined >> 8) & 255)
    }
    if (fourthCharacter !== '=') {
      bytes.push(combined & 255)
    }
  }
  return Uint8Array.from(bytes)
}

function valueKind(value: unknown): DisplayCell['kind'] {
  if (value == null) {
    return 'null'
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return 'blob'
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return typeof value === 'number' && !Number.isInteger(value) ? 'real' : 'integer'
  }
  return 'text'
}

function displayValue(value: unknown) {
  if (value == null) {
    return 'NULL'
  }
  if (value instanceof Uint8Array) {
    return `BLOB · ${value.byteLength} bytes`
  }
  if (value instanceof ArrayBuffer) {
    return `BLOB · ${value.byteLength} bytes`
  }
  return String(value)
}

function inputValue(value: unknown) {
  if (value == null) {
    return ''
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return ''
  }
  return String(value)
}

function parseField(field: EditorField): SqliteScalar {
  if (field.isNull) {
    return null
  }
  if (field.type.toUpperCase().includes('INT')) {
    if (!/^-?\d+$/.test(field.value)) {
      throw new TypeError(`${field.name} must be an integer.`)
    }
    const number = Number(field.value)
    return Number.isSafeInteger(number) ? number : BigInt(field.value)
  }
  if (/REAL|FLOA|DOUB|NUM/.test(field.type.toUpperCase())) {
    const number = Number(field.value)
    if (!Number.isFinite(number)) {
      throw new TypeError(`${field.name} must be numeric.`)
    }
    return number
  }
  return field.value
}

function activity(action: string, status: ActivityEntry['status'], detail: string): ActivityEntry {
  return { id: ++activityId, action, status, detail, time: new Date().toLocaleTimeString() }
}

function eventValue(event: WorkspaceEvent) {
  return String(event.detail?.value ?? '')
}

export function createSqliteDebugWorkspacePage(options: SqliteDebugWorkspaceOptions) {
  let workspacePromise: ReturnType<typeof createSqliteDebugWorkspace> | undefined
  const workspace = () => workspacePromise ??= createSqliteDebugWorkspace(options)
  const controller = async (): Promise<SqliteDebugController> => (await workspace()).controller

  async function record(this: WorkspacePageContext, action: string, callback: () => Promise<unknown>) {
    try {
      const result = await callback()
      this.setData({
        error: null,
        result: result === undefined ? `${action} completed.` : JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2),
        activities: [activity(action, 'success', 'Completed'), ...this.data.activities].slice(0, 30),
      })
      return result
    }
    catch (error) {
      const serialized = serializeSqliteDebugError(error)
      this.setData({ error: serialized, activities: [activity(action, 'error', `${serialized.code}: ${serialized.message}`), ...this.data.activities].slice(0, 30) })
      throw error
    }
  }

  async function refreshTable(this: WorkspacePageContext, offset = 0) {
    if (!this.data.selectedTable) {
      return
    }
    const current = await controller()
    const [columns, capabilities, indexes, page] = await Promise.all([
      current.describeTable(this.data.selectedTable),
      current.getTableCapabilities(this.data.selectedTable),
      current.listIndexes(this.data.selectedTable),
      current.readTable(this.data.selectedTable, {
        limit: 50,
        offset,
        filters: this.data.filters,
        ...(this.data.search ? { search: this.data.search } : {}),
        ...(this.data.orderColumn ? { orderBy: [{ column: this.data.orderColumn, direction: this.data.orderDirection }] } : {}),
      }),
    ])
    const selected = new Set(this.data.selectedRows)
    this.setData({
      columns,
      capabilities,
      indexes,
      page,
      displayRows: page.rows.map((row, index) => ({
        index,
        selected: selected.has(index),
        cells: page.columns.map(column => ({ column, value: displayValue(row[column]), kind: valueKind(row[column]) })),
      })),
      selectedRows: [],
      filterColumn: this.data.filterColumn || columns[0]?.name || '',
      orderColumn: this.data.orderColumn && columns.some(column => column.name === this.data.orderColumn) ? this.data.orderColumn : '',
      undoLabel: current.getUndoState().available ? `撤销：${current.getUndoState().operation}` : '暂无可撤销操作',
    })
  }

  async function refreshAll(this: WorkspacePageContext) {
    const active = await workspace()
    const tables = await active.controller.listTables()
    const selectedTable = tables.some(table => table.name === this.data.selectedTable) ? this.data.selectedTable : tables[0]?.name ?? ''
    this.setData({
      phase: 'ready',
      databaseName: options.databaseName,
      runtimeLabel: `${active.runtime.target} · ${active.runtime.system ?? active.runtime.platform ?? active.runtime['userAgent'] ?? active.runtime.engine}`,
      tables,
      selectedTable,
      error: null,
    })
    await refreshTable.call(this)
  }

  function openConfirmation(this: WorkspacePageContext, actionName: string, target = '') {
    this.setData({ confirmOpen: true, confirmAction: actionName, confirmTarget: target, confirmValue: '' })
  }

  const initialData: WorkspaceData = {
    phase: 'loading',
    databaseName: options.databaseName,
    runtimeLabel: '',
    tables: [],
    selectedTable: '',
    columns: [],
    indexes: [],
    displayRows: [],
    selectedRows: [],
    activeTab: 'data',
    search: '',
    filters: [],
    filterColumn: '',
    filterOperator: 'contains',
    filterOperators: FILTER_OPERATORS,
    filterValue: '',
    orderColumn: '',
    orderDirection: 'asc',
    sql: 'SELECT name, type FROM sqlite_schema ORDER BY name',
    result: '',
    error: null,
    editorOpen: false,
    editorMode: 'insert',
    editorRow: -1,
    editorFields: [],
    confirmOpen: false,
    confirmAction: '',
    confirmValue: '',
    confirmTarget: '',
    formName: '',
    formValue: '',
    formType: 'TEXT',
    columnTypes: COLUMN_TYPES,
    indexUnique: false,
    importSource: null,
    importPreview: null,
    importMappings: [],
    importMode: 'append',
    importConfirmValue: '',
    importModes: IMPORT_MODES,
    activities: [],
    undoLabel: '暂无可撤销操作',
  }

  return {
    data: initialData,
    async onLoad(this: WorkspacePageContext) {
      try {
        await refreshAll.call(this)
      }
      catch (error) {
        const serialized = serializeSqliteDebugError(error)
        this.setData({ phase: serialized.code.includes('UNSUPPORTED') ? 'unsupported' : 'failed', error: serialized })
      }
    },
    async onUnload() {
      if (workspacePromise) {
        await (await workspacePromise).controller.close()
      }
      workspacePromise = undefined
    },
    async refreshWorkspace(this: WorkspacePageContext) {
      await record.call(this, '刷新', () => refreshAll.call(this))
    },
    async selectTable(this: WorkspacePageContext, event: WorkspaceEvent) {
      this.setData({ selectedTable: String(event.currentTarget?.dataset?.['table'] ?? ''), filters: [], search: '', orderColumn: '' })
      await refreshTable.call(this)
    },
    switchTab(this: WorkspacePageContext, event: WorkspaceEvent) {
      this.setData({ activeTab: String(event.currentTarget?.dataset?.['tab'] ?? 'data') as WorkspaceData['activeTab'] })
    },
    onSearchInput(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ search: eventValue(event) }) },
    async applySearch(this: WorkspacePageContext) { await refreshTable.call(this) },
    onFilterColumn(this: WorkspacePageContext, event: WorkspaceEvent) {
      const column = this.data.columns[Number(event.detail?.value)]
      this.setData({ filterColumn: column?.name ?? this.data.filterColumn })
    },
    onFilterOperator(this: WorkspacePageContext, event: WorkspaceEvent) {
      const operator = this.data.filterOperators[Number(event.detail?.value)]
      this.setData({ filterOperator: operator?.value ?? this.data.filterOperator })
    },
    onFilterValue(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ filterValue: eventValue(event) }) },
    async addFilter(this: WorkspacePageContext) {
      const operator = this.data.filterOperator as SqliteDebugFilter['operator']
      const filter: SqliteDebugFilter = {
        column: this.data.filterColumn,
        operator,
        ...(/^(?:isNull|isNotNull)$/.test(operator) ? {} : { value: this.data.filterValue }),
      }
      this.setData({ filters: [...this.data.filters, filter], filterValue: '' })
      await refreshTable.call(this)
    },
    async clearFilters(this: WorkspacePageContext) {
      this.setData({ filters: [] })
      await refreshTable.call(this)
    },
    async sortColumn(this: WorkspacePageContext, event: WorkspaceEvent) {
      const column = String(event.currentTarget?.dataset?.['column'] ?? '')
      this.setData({ orderColumn: column, orderDirection: this.data.orderColumn === column && this.data.orderDirection === 'asc' ? 'desc' : 'asc' })
      await refreshTable.call(this)
    },
    async previousPage(this: WorkspacePageContext) { await refreshTable.call(this, Math.max(0, (this.data.page?.offset ?? 0) - 50)) },
    async nextPage(this: WorkspacePageContext) { await refreshTable.call(this, (this.data.page?.offset ?? 0) + 50) },
    toggleRow(this: WorkspacePageContext, event: WorkspaceEvent) {
      const index = Number(event.currentTarget?.dataset?.['index'])
      const selected = new Set(this.data.selectedRows)
      selected.has(index) ? selected.delete(index) : selected.add(index)
      this.setData({ selectedRows: [...selected], displayRows: this.data.displayRows.map(row => ({ ...row, selected: selected.has(row.index) })) })
    },
    openInsert(this: WorkspacePageContext) {
      this.setData({ editorOpen: true, editorMode: 'insert', editorRow: -1, editorFields: this.data.columns.map(column => ({ name: column.name, type: column.type, value: '', isNull: !column.notNull, disabled: false })) })
    },
    openEdit(this: WorkspacePageContext, event: WorkspaceEvent) {
      const index = Number(event.currentTarget?.dataset?.['index'])
      const row = this.data.page?.rows[index]
      if (!row) {
        return
      }
      this.setData({ editorOpen: true, editorMode: 'update', editorRow: index, editorFields: this.data.columns.map(column => ({ name: column.name, type: column.type, value: inputValue(row[column.name]), isNull: row[column.name] == null, disabled: valueKind(row[column.name]) === 'blob' })) })
    },
    closeEditor(this: WorkspacePageContext) { this.setData({ editorOpen: false }) },
    updateEditorField(this: WorkspacePageContext, event: WorkspaceEvent) {
      const index = Number(event.currentTarget?.dataset?.['index'])
      this.setData({ editorFields: this.data.editorFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, value: eventValue(event), isNull: false } : field) })
    },
    toggleEditorNull(this: WorkspacePageContext, event: WorkspaceEvent) {
      const index = Number(event.currentTarget?.dataset?.['index'])
      this.setData({ editorFields: this.data.editorFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, isNull: !field.isNull } : field) })
    },
    async saveEditor(this: WorkspacePageContext) {
      const values = Object.fromEntries(this.data.editorFields.filter(field => !field.disabled).map(field => [field.name, parseField(field)]))
      await record.call(this, this.data.editorMode === 'insert' ? '新增行' : '编辑行', async () => {
        const current = await controller()
        if (this.data.editorMode === 'insert') {
          await current.insertRow(this.data.selectedTable, values, { allowWrite: true })
        }
        else {
          const locator = this.data.page?.rowLocators[this.data.editorRow]
          if (!locator) {
            throw new Error('The selected row no longer has a locator.')
          }
          await current.updateRow(this.data.selectedTable, locator, values, { allowWrite: true })
        }
        this.setData({ editorOpen: false })
        await refreshTable.call(this)
      })
    },
    requestDeleteRows(this: WorkspacePageContext) { openConfirmation.call(this, 'deleteRows', this.data.selectedTable) },
    requestTruncate(this: WorkspacePageContext) { openConfirmation.call(this, 'truncateTable', this.data.selectedTable) },
    requestDropTable(this: WorkspacePageContext) { openConfirmation.call(this, 'dropTable', this.data.selectedTable) },
    requestDropColumn(this: WorkspacePageContext, event: WorkspaceEvent) { openConfirmation.call(this, `dropColumn:${String(event.currentTarget?.dataset?.['column'] ?? '')}`, this.data.selectedTable) },
    requestDropIndex(this: WorkspacePageContext, event: WorkspaceEvent) { openConfirmation.call(this, `dropIndex:${String(event.currentTarget?.dataset?.['indexName'] ?? '')}`, this.data.selectedTable) },
    requestWriteSql(this: WorkspacePageContext) { openConfirmation.call(this, 'writeSql') },
    closeConfirmation(this: WorkspacePageContext) { this.setData({ confirmOpen: false, confirmValue: '' }) },
    onConfirmInput(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ confirmValue: eventValue(event) }) },
    async confirmDanger(this: WorkspacePageContext) {
      const actionName = this.data.confirmAction
      await record.call(this, '危险操作', async () => {
        const current = await controller()
        if (actionName === 'deleteRows') {
          const locators = this.data.selectedRows.map(index => this.data.page?.rowLocators[index]).filter((locator): locator is SqliteDebugRowLocator => Boolean(locator))
          await current.deleteRows(this.data.selectedTable, locators, { allowWrite: true, confirmTable: this.data.confirmValue })
        }
        else if (actionName === 'truncateTable') {
          await current.truncateTable(this.data.selectedTable, { allowWrite: true, confirmTable: this.data.confirmValue })
        }
        else if (actionName === 'dropTable') {
          await current.dropTable(this.data.selectedTable, { allowWrite: true, confirmTable: this.data.confirmValue })
        }
        else if (actionName.startsWith('dropColumn:')) {
          await current.dropColumn(this.data.selectedTable, actionName.slice(11), { allowWrite: true, confirmTable: this.data.confirmValue })
        }
        else if (actionName.startsWith('dropIndex:')) {
          await current.dropIndex(this.data.selectedTable, actionName.slice(10), { allowWrite: true, confirmTable: this.data.confirmValue })
        }
        else if (actionName === 'writeSql') {
          await current.execute(this.data.sql, undefined, { allowWrite: true })
        }
        this.setData({ confirmOpen: false, confirmValue: '' })
        await refreshAll.call(this)
      })
    },
    onFormName(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ formName: eventValue(event) }) },
    onFormValue(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ formValue: eventValue(event) }) },
    onFormType(this: WorkspacePageContext, event: WorkspaceEvent) {
      this.setData({ formType: this.data.columnTypes[Number(event.detail?.value)] ?? this.data.formType })
    },
    toggleIndexUnique(this: WorkspacePageContext) { this.setData({ indexUnique: !this.data.indexUnique }) },
    async createTable(this: WorkspacePageContext) {
      await record.call(this, '创建表', async () => {
        await (await controller()).createTable(this.data.formName, [{ name: 'id', type: 'INTEGER', primaryKey: true }, { name: this.data.formValue || 'value', type: this.data.formType as 'TEXT' }], { allowWrite: true })
        this.setData({ formName: '', formValue: '' })
        await refreshAll.call(this)
      })
    },
    async renameTable(this: WorkspacePageContext) {
      await record.call(this, '重命名表', async () => {
        await (await controller()).renameTable(this.data.selectedTable, this.data.formName, { allowWrite: true, confirmTable: this.data.selectedTable })
        this.setData({ selectedTable: this.data.formName, formName: '' })
        await refreshAll.call(this)
      })
    },
    async addColumn(this: WorkspacePageContext) {
      await record.call(this, '新增列', async () => {
        await (await controller()).addColumn(this.data.selectedTable, { name: this.data.formName, type: this.data.formType as 'TEXT' }, { allowWrite: true })
        this.setData({ formName: '' })
        await refreshTable.call(this)
      })
    },
    async renameColumn(this: WorkspacePageContext) {
      await record.call(this, '重命名列', async () => {
        await (await controller()).renameColumn(this.data.selectedTable, this.data.formName, this.data.formValue, { allowWrite: true, confirmTable: this.data.selectedTable })
        await refreshTable.call(this)
      })
    },
    async createIndex(this: WorkspacePageContext) {
      await record.call(this, '创建索引', async () => {
        const columns = this.data.formValue.split(',').map((value) => {
          const [name = '', direction = 'asc'] = value.trim().split(':')
          return { name: name.trim(), direction: direction.toLowerCase() === 'desc' ? 'desc' as const : 'asc' as const }
        }).filter(column => column.name)
        await (await controller()).createIndex(this.data.selectedTable, this.data.formName, columns, { allowWrite: true, unique: this.data.indexUnique })
        this.setData({ indexUnique: false })
        await refreshTable.call(this)
      })
    },
    onSqlInput(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ sql: eventValue(event) }) },
    async runQuery(this: WorkspacePageContext) { await record.call(this, '查询 SQL', async () => (await controller()).query(this.data.sql)) },
    async exportDatabase(this: WorkspacePageContext) { await record.call(this, '导出 SQLite', async () => (await workspace()).saveDatabase()) },
    async exportTable(this: WorkspacePageContext, event: WorkspaceEvent) {
      const format = String(event.currentTarget?.dataset?.['format'] ?? 'csv') as SqliteDebugTableFormat
      await record.call(this, `导出 ${format.toUpperCase()}`, async () => (await workspace()).saveTable(this.data.selectedTable, format))
    },
    async chooseImport(this: WorkspacePageContext) {
      await record.call(this, '选择导入文件', async () => {
        const file = await (await workspace()).chooseFile({ extensions: ['.csv', '.json', '.sqlite'], maxBytes: 16 * 1024 * 1024 })
        if (file.fileName.toLowerCase().endsWith('.sqlite')) {
          await (await controller()).importDatabase(file.bytes, { replace: true })
          await refreshAll.call(this)
          return { fileName: file.fileName, imported: 'database' }
        }
        const source: SqliteDebugTableImportSource = { format: file.fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'json', bytes: file.bytes, fileName: file.fileName }
        const preview = await (await controller()).previewTableImport(source)
        this.setData({ importSource: source, importPreview: preview, importMappings: preview.suggestedColumns.map(column => ({ source: column.source, target: column.target, type: column.inferredType })), importConfirmValue: '' })
        return preview
      })
    },
    onImportMode(this: WorkspacePageContext, event: WorkspaceEvent) {
      const mode = String(event.currentTarget?.dataset?.['mode'] ?? '') as WorkspaceData['importMode']
      if (this.data.importModes.some(item => item.value === mode)) {
        this.setData({ importMode: mode, importConfirmValue: '' })
      }
    },
    onImportConfirmInput(this: WorkspacePageContext, event: WorkspaceEvent) { this.setData({ importConfirmValue: eventValue(event) }) },
    updateImportTarget(this: WorkspacePageContext, event: WorkspaceEvent) {
      const index = Number(event.currentTarget?.dataset?.['index'])
      this.setData({ importMappings: this.data.importMappings.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, target: eventValue(event) } : mapping) })
    },
    async runImport(this: WorkspacePageContext) {
      if (!this.data.importSource) {
        return
      }
      await record.call(this, '导入表数据', async () => {
        const result = await (await controller()).importTable(this.data.importSource as SqliteDebugTableImportSource, {
          tableName: this.data.selectedTable || this.data.formName,
          mode: this.data.importMode,
          mappings: this.data.importMappings,
          allowWrite: true,
          ...(this.data.importMode === 'replace' ? { confirmTable: this.data.importConfirmValue } : {}),
        })
        this.setData({ importSource: null, importPreview: null, importConfirmValue: '' })
        await refreshAll.call(this)
        return result
      })
    },
    async undoLast(this: WorkspacePageContext) {
      await record.call(this, '撤销上次写入', async () => {
        await (await controller()).undoLastDestructiveChange()
        await refreshAll.call(this)
      })
    },
    async exportArtifactForAutomation(this: WorkspacePageContext, format: 'sqlite' | SqliteDebugTableFormat = 'sqlite') {
      if (format === 'sqlite') {
        const snapshot = await (await controller()).exportDatabase()
        return { fileName: `${options.databaseName}.sqlite`, bytes: bytesToBase64(snapshot.bytes), metadata: snapshot.metadata }
      }
      const artifact = await (await controller()).exportTable(this.data.selectedTable, { format })
      return { ...artifact, bytes: bytesToBase64(artifact.bytes) }
    },
    async importArtifactForAutomation(this: WorkspacePageContext, base64: string) {
      const result = await (await controller()).importDatabase(base64ToBytes(base64), { replace: true })
      await refreshAll.call(this)
      return result
    },
    async queryForAutomation(this: WorkspacePageContext, sql: string) {
      return (await controller()).query(sql)
    },
    async executeForAutomation(this: WorkspacePageContext, sql: string) {
      const result = await (await controller()).execute(sql, undefined, { allowWrite: true })
      await refreshTable.call(this)
      return result
    },
    async workspaceStateForAutomation(this: WorkspacePageContext) {
      return { phase: this.data.phase, tables: this.data.tables, selectedTable: this.data.selectedTable, page: this.data.page, columns: this.data.columns, indexes: this.data.indexes, error: this.data.error }
    },
  }
}
