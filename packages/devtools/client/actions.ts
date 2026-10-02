import type { SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteDebugColumnDefinition, SqliteDebugTableImportOptions } from '@weapp-sqlite/debug'
import type { PanelContext } from './context'
import { dialog, download, element, field, input, select, table } from './dom'
import { parseEditable, parseParameters, stringifyEditable } from './state'

const COLUMN_TYPES: SqliteDebugColumnDefinition['type'][] = ['INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC']

/** Capture the destination before the user opens a form. Closing a form never changes it. */
function guard(context: PanelContext) {
  const ticket = context.state.begin('dialog')
  return () => {
    if (!context.state.accepts(ticket)) { throw new Error('连接或所选数据库已改变，请关闭此窗口并重新操作。') }
    if (context.readOnly) { throw new Error('当前运行实例为只读模式。') }
  }
}

export function confirmAction(context: PanelContext, title: string, target: string, action: () => Promise<unknown>) {
  const assertCurrent = guard(context)
  const content = element('div', 'dialog-content')
  content.append(element('p', '', target ? `输入「${target}」以确认${title}。` : `确认${title}？此操作会修改当前数据库。`))
  const confirmation = input('输入名称以确认')
  if (target) { content.append(confirmation) }
  dialog(title, content, async () => {
    assertCurrent()
    if (target && confirmation.value !== target) { throw new Error('输入的名称与目标不一致。') }
    await action()
    await context.refresh()
  }, '确认执行', true)
}

export function editRow(context: PanelContext, index?: number) {
  const current = context.state.current
  const tableName = current.table
  const locator = index === undefined ? undefined : current.page?.rowLocators[index]
  const assertCurrent = guard(context)
  const content = element('div', 'dialog-content')
  content.append(element('p', '', '使用 JSON 对象编辑列值。省略的列保留默认值；NULL 使用 null。'))
  content.append(element('p', 'muted', '大整数：{"$bigint":"9007199254740993"} · BLOB：{"$blob":[0,255]}'))
  const initial = index === undefined ? {} : current.page?.rows[index] ?? {}
  const editor = input('行数据 JSON', stringifyEditable(initial), undefined, true)
  editor.className = 'code-editor row-editor'
  content.append(editor)
  dialog(index === undefined ? `新增行 · ${tableName}` : `编辑行 · ${tableName}`, content, async () => {
    assertCurrent()
    const values = parseEditable(editor.value)
    if (!values || Array.isArray(values) || typeof values !== 'object' || values instanceof Uint8Array) { throw new Error('行数据必须是 JSON 对象。') }
    parseParameters(editor.value)
    if (index === undefined) { await context.request('insertRow', tableName, values as Record<string, SqliteScalar>, { allowWrite: true }) }
    else if (locator) { await context.request('updateRow', tableName, locator, values as Record<string, SqliteScalar>, { allowWrite: true }) }
    else { throw new Error('当前行缺少可写定位信息，请刷新后重试。') }
    await context.refresh()
  })
}

export function createTable(context: PanelContext) {
  const assertCurrent = guard(context)
  const content = element('div', 'dialog-content')
  const name = input('表名')
  const columns = input('列定义 JSON', '[\n  {"name": "id", "type": "INTEGER", "primaryKey": true},\n  {"name": "name", "type": "TEXT"}\n]', undefined, true)
  columns.className = 'code-editor row-editor'
  content.append(field('表名', name), field('列定义', columns), element('p', 'muted', '支持 primaryKey、notNull、unique 与 defaultExpression。'))
  dialog('新建数据表', content, async () => {
    assertCurrent()
    const definitions = JSON.parse(columns.value) as unknown
    if (!Array.isArray(definitions) || !definitions.length) { throw new Error('至少需要一列。') }
    await context.request('createTable', name.value, definitions as SqliteDebugColumnDefinition[], { allowWrite: true })
    context.state.selectTable(name.value)
    await context.refresh()
  }, '创建表')
}

export function addColumn(context: PanelContext) {
  const assertCurrent = guard(context)
  const tableName = context.state.current.table
  const content = element('div', 'dialog-content')
  const name = input('列名')
  const type = select('列类型', COLUMN_TYPES.map(value => ({ value, label: value })), 'TEXT')
  content.append(field('列名', name), field('类型', type))
  dialog(`新增列 · ${tableName}`, content, async () => {
    assertCurrent()
    await context.request('addColumn', tableName, { name: name.value, type: type.value as SqliteDebugColumnDefinition['type'] }, { allowWrite: true })
    await context.refresh()
  })
}

export function rename(context: PanelContext, column?: string) {
  const assertCurrent = guard(context)
  const tableName = context.state.current.table
  const content = element('div', 'dialog-content')
  const name = input('新名称', column ?? tableName)
  content.append(field('新名称', name))
  dialog(column ? `重命名列 · ${column}` : `重命名表 · ${tableName}`, content, async () => {
    assertCurrent()
    const options = { allowWrite: true as const, confirmTable: tableName }
    if (column) {
      await context.request('renameColumn', tableName, column, name.value, options)
    }
    else {
      await context.request('renameTable', tableName, name.value, options)
      context.state.selectTable(name.value)
    }
    await context.refresh()
  })
}

export function createIndex(context: PanelContext) {
  const assertCurrent = guard(context)
  const tableName = context.state.current.table
  const content = element('div', 'dialog-content')
  const name = input('索引名', `${tableName}_idx`)
  const columns = input('索引列 JSON', stringifyEditable([{ name: context.state.current.columns[0]?.name ?? '', direction: 'asc' }]), undefined, true)
  columns.className = 'code-editor'
  const unique = select('唯一索引', [{ value: 'no', label: '普通索引' }, { value: 'yes', label: '唯一索引' }], 'no')
  content.append(field('索引名', name), field('列与排序方向', columns), field('类型', unique))
  dialog(`创建索引 · ${tableName}`, content, async () => {
    assertCurrent()
    await context.request('createIndex', tableName, name.value, JSON.parse(columns.value), { allowWrite: true, unique: unique.value === 'yes' })
    await context.refresh()
  }, '创建索引')
}

export async function exportFile(context: PanelContext, format: 'sqlite' | 'csv' | 'json') {
  const databaseName = context.state.databaseName
  const tableName = context.state.current.table
  await context.perform('导出完成', async () => {
    if (format === 'sqlite') {
      const snapshot = await context.request('exportDatabase')
      download(snapshot.bytes, `${databaseName}.sqlite`, 'application/vnd.sqlite3')
      download(new TextEncoder().encode(JSON.stringify(snapshot.metadata, null, 2)), `${databaseName}.metadata.json`, 'application/json')
    }
    else {
      const artifact = await context.request('exportTable', tableName, { format })
      download(artifact.bytes, artifact.fileName, artifact.mimeType)
    }
  })
}

export function importFile(context: PanelContext, format: 'sqlite' | 'csv' | 'json') {
  const assertCurrent = guard(context)
  const picker = element('input')
  picker.type = 'file'
  picker.accept = format === 'sqlite' ? '.sqlite,.sqlite3,.db' : `.${format}`
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    if (!file) { return }
    void context.perform('已读取导入文件', async () => {
      assertCurrent()
      const bytes = new Uint8Array(await file.arrayBuffer())
      assertCurrent()
      if (format === 'sqlite') {
        confirmAction(context, '替换数据库', context.state.databaseName, () => context.request('importDatabase', bytes, { replace: true }))
        return
      }
      const source = { format, bytes, fileName: file.name }
      const preview = await context.request('previewTableImport', source, { sampleRows: 5 })
      assertCurrent()
      const content = element('div', 'dialog-content')
      content.append(element('p', '', `${file.name} · ${preview.totalRows} 行 · 预览前 ${preview.sampleRows.length} 行`), table(preview.sourceColumns, preview.sampleRows))
      const name = input('目标表名', context.state.current.table || file.name.replace(/\.[^.]+$/, ''))
      const mode = select('导入方式', [{ value: 'append', label: '追加到现有表' }, { value: 'create', label: '创建新表' }, { value: 'replace', label: '替换表中数据' }], context.state.current.table ? 'append' : 'create')
      const mappings = input('列映射 JSON', stringifyEditable(preview.suggestedColumns.map(column => ({ source: column.source, target: column.target, type: column.inferredType }))), undefined, true)
      mappings.className = 'code-editor'
      const confirm = input('替换时输入目标表名')
      content.append(field('目标表', name), field('方式', mode), field('列映射', mappings), field('替换时输入目标表名', confirm))
      dialog('导入数据', content, async () => {
        assertCurrent()
        if (mode.value === 'replace' && confirm.value !== name.value) { throw new Error('请完整输入目标表名后再替换。') }
        await context.request('importTable', source, { tableName: name.value, mode: mode.value as SqliteDebugTableImportOptions['mode'], mappings: JSON.parse(mappings.value), allowWrite: true, confirmTable: confirm.value })
        context.state.selectTable(name.value)
        await context.refresh()
      }, '执行导入')
    })
  })
  picker.click()
}
