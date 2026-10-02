import type { SqliteDebugFilter } from '@weapp-sqlite/debug'
import type { PanelContext } from './context'
import { addColumn, confirmAction, createIndex, editRow, exportFile, importFile, rename } from './actions'
import { button, element, empty, field, input, select, table } from './dom'

export function dataView(context: PanelContext) {
  const state = context.state.current
  const content = element('section', 'data-view')
  if (!state.table) {
    content.append(empty('数据库中还没有表', '从左侧创建一张表，或使用 SQL 编辑器定义结构。'))
    return content
  }
  const writable = !context.readOnly && state.capabilities?.writable && !context.busy
  const tools = element('div', 'data-toolbar')
  const search = input('搜索当前表', state.search, value => state.search = value)
  search.placeholder = '搜索当前表…'
  search.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent
    if (keyboard.key === 'Enter') { state.offset = 0; void context.refreshTable() }
  })
  tools.append(search, button('搜索', () => { state.offset = 0; return context.refreshTable() }, '', context.busy), element('div', 'spacer'), button('新增行', () => editRow(context), 'primary', !writable))
  tools.append(button(`删除选中${state.selectedRows.size ? ` (${state.selectedRows.size})` : ''}`, () => {
    const locators = [...state.selectedRows].map(index => state.page?.rowLocators[index]).filter(item => item !== undefined)
    confirmAction(context, `删除 ${locators.length} 行`, state.table, () => context.request('deleteRows', state.table, locators, { allowWrite: true, confirmTable: state.table }))
  }, 'danger', !writable || !state.selectedRows.size))
  content.append(tools)
  const filters = element('div', 'filter-toolbar')
  const column = select('筛选列', state.columns.map(item => ({ value: item.name, label: item.name })), state.columns[0]?.name ?? '')
  const operator = select('筛选运算符', [
    ['contains', '包含'],
    ['eq', '等于'],
    ['ne', '不等于'],
    ['lt', '小于'],
    ['lte', '小于等于'],
    ['gt', '大于'],
    ['gte', '大于等于'],
    ['startsWith', '前缀'],
    ['isNull', 'IS NULL'],
    ['isNotNull', 'IS NOT NULL'],
  ].map(([value, label]) => ({ value: value!, label: label! })), 'contains')
  const value = input('筛选值')
  value.placeholder = '筛选值'
  filters.append(element('span', 'small-label', 'FILTER'), column, operator, value, button('添加筛选', () => {
    state.filters.push({ column: column.value, operator: operator.value as SqliteDebugFilter['operator'], ...(/^(?:isNull|isNotNull)$/.test(operator.value) ? {} : { value: value.value }) })
    state.offset = 0
    return context.refreshTable()
  }, '', context.busy || !state.columns.length))
  if (state.filters.length) { filters.append(button(`清除 ${state.filters.length} 个筛选`, () => { state.filters = []; state.offset = 0; return context.refreshTable() }, 'text-button')) }
  content.append(filters)
  if (state.filters.length) {
    const chips = element('div', 'filter-chips')
    state.filters.forEach(filter => chips.append(element('code', 'filter-chip', `${filter.column} ${filter.operator}${filter.value === undefined ? '' : ` ${String(filter.value)}`}`)))
    content.append(chips)
  }
  if (!state.page) {
    content.append(empty(context.busy ? '正在读取数据…' : '尚未读取数据', '使用刷新按钮重新读取当前表。'))
    return content
  }
  const page = state.page
  content.append(table(state.page.columns, state.page.rows, {
    sort: (column) => {
      state.orderDirection = state.orderColumn === column && state.orderDirection === 'asc' ? 'desc' : 'asc'
      state.orderColumn = column
      state.offset = 0
      void context.refreshTable()
    },
    selectedRows: state.selectedRows,
    ...(writable
      ? {
          onSelect: (index: number, checked: boolean) => { checked ? state.selectedRows.add(index) : state.selectedRows.delete(index); context.render() },
          onEdit: (index: number) => editRow(context, index),
        }
      : {}),
  }))
  const footer = element('div', 'pagination')
  footer.append(element('span', '', `${state.page.rows.length ? state.page.offset + 1 : 0}–${state.page.offset + state.page.rows.length} / ${state.page.total} 行`))
  if (state.orderColumn) { footer.append(element('span', 'muted', `${state.orderColumn} ${state.orderDirection.toUpperCase()}`)) }
  const pageSizes = [...new Set([25, 50, 100, state.limit])].sort((left, right) => left - right)
  footer.append(element('div', 'spacer'), select('每页行数', pageSizes.map(size => ({ value: String(size), label: `${size} 行 / 页` })), String(state.limit), (value) => { state.limit = Number(value); state.offset = 0; void context.refreshTable() }), button('上一页', () => { state.offset = Math.max(0, state.offset - page.limit); return context.refreshTable() }, '', context.busy || page.offset === 0), button('下一页', () => { state.offset += page.limit; return context.refreshTable() }, '', context.busy || page.limit === 0 || page.offset + page.limit >= page.total))
  content.append(footer)
  if (state.capabilities?.reason) { content.append(element('p', 'capability-note', state.capabilities.reason)) }
  return content
}

export function schemaView(context: PanelContext) {
  const state = context.state.current
  const content = element('section', 'schema-view')
  if (!state.table) {
    content.append(empty('选择一张数据表', '在左侧选择表以查看列、索引和建表语句。'))
    return content
  }
  const disabled = context.readOnly || context.busy || !state.capabilities?.writable
  const tableName = state.table
  const destructive = { allowWrite: true as const, confirmTable: tableName }
  const toolbar = element('div', 'data-toolbar')
  toolbar.append(button('重命名表', () => rename(context), '', disabled), button('新增列', () => addColumn(context), '', disabled), button('创建索引', () => createIndex(context), '', disabled), element('div', 'spacer'), button(state.undo.available ? `撤销${state.undo.operation ? ` · ${state.undo.operation}` : ''}` : '暂无撤销', () => context.perform('已撤销上次操作', async () => { await context.request('undoLastDestructiveChange'); await context.refresh() }), '', disabled || !state.undo.available), button('清空表', () => confirmAction(context, '清空表', tableName, () => context.request('truncateTable', tableName, destructive)), 'danger', disabled), button('删除表', () => confirmAction(context, '删除表', tableName, () => context.request('dropTable', tableName, destructive)), 'danger', disabled))
  content.append(toolbar, element('h3', 'section-title', `列 · ${state.columns.length}`))
  const columns = element('div', 'schema-list')
  for (const column of state.columns) {
    const row = element('div', 'schema-row')
    row.append(element('code', 'schema-name', column.name), element('span', 'type-badge', column.type || 'ANY'), element('span', 'muted', [column.primaryKey ? 'PRIMARY KEY' : '', column.notNull ? 'NOT NULL' : '', column.defaultValue == null ? '' : `DEFAULT ${String(column.defaultValue)}`].filter(Boolean).join(' · ')), button('重命名', () => rename(context, column.name), 'text-button', disabled || !state.capabilities?.supportsRenameColumn), button('删除', () => confirmAction(context, `删除列 ${column.name}`, tableName, () => context.request('dropColumn', tableName, column.name, destructive)), 'text-button danger', disabled || !state.capabilities?.supportsDropColumn))
    columns.append(row)
  }
  content.append(columns, element('h3', 'section-title', `索引 · ${state.indexes.length}`))
  if (!state.indexes.length) { content.append(element('p', 'section-note', '当前表没有索引。')) }
  for (const index of state.indexes) {
    const row = element('div', 'schema-row index-row')
    row.append(element('code', 'schema-name', index.name), element('span', 'type-badge', index.unique ? 'UNIQUE' : 'INDEX'), element('span', 'muted', index.columns.map(column => `${column.name} ${column.direction}`).join(', ')), button('删除', () => confirmAction(context, `删除索引 ${index.name}`, tableName, () => context.request('dropIndex', tableName, index.name, destructive)), 'text-button danger', disabled || !index.editable))
    content.append(row)
  }
  content.append(element('h3', 'section-title', '建表语句'), element('pre', 'schema-sql', state.tables.find(table => table.name === tableName)?.sql ?? '此对象没有建表语句。'))
  return content
}

export function sqlView(context: PanelContext) {
  const state = context.state.current
  const content = element('section', 'sql-view')
  const editorBlock = element('div', 'editor-block')
  const gutter = element('div', 'editor-gutter', 'SQL')
  const sql = input('SQL 编辑器', state.sql, value => state.sql = value, true)
  sql.className = 'code-editor sql-editor'
  sql.spellcheck = false
  sql.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent
    if ((keyboard.ctrlKey || keyboard.metaKey) && keyboard.key === 'Enter') {
      event.preventDefault()
      if (!context.busy) { void context.runSql('query') }
    }
  })
  editorBlock.append(gutter, sql)
  const parameters = input('绑定参数 JSON', state.parameters, value => state.parameters = value, true)
  parameters.className = 'code-editor parameters-editor'
  const parameterField = field('绑定参数 · JSON 数组或命名对象', parameters)
  parameterField.classList.add('parameters-field')
  content.append(editorBlock, parameterField)
  const actions = element('div', 'sql-actions')
  actions.append(button('运行查询', () => context.runSql('query'), 'primary', context.busy), button('执行计划', () => context.runSql('explain'), '', context.busy), button('性能诊断', () => context.runSql('analyze'), '', context.busy), button('执行写入', () => confirmAction(context, '执行写入 SQL', '', () => context.runSql('execute')), 'danger', context.busy || context.readOnly), element('span', 'shortcut', '⌘ / Ctrl + Enter 查询'))
  content.append(actions)
  if (state.sqlSummary) { content.append(element('div', 'result-summary', state.sqlSummary)) }
  if (state.plan) {
    const plan = element('div', 'plan-tree')
    plan.append(element('h3', 'section-title', '执行计划'))
    for (const node of state.plan) {
      const row = element('div', 'plan-node')
      row.style.paddingInlineStart = `${20 + node.depth * 24}px`
      row.append(element('span', 'plan-id', String(node.id)), element('code', /\bSCAN\b/.test(node.detail) ? 'plan-scan' : '', node.detail))
      plan.append(row)
    }
    content.append(plan)
  }
  if (state.analysis) {
    const diagnostics = element('div', 'diagnostics-panel')
    diagnostics.append(element('h3', 'section-title', '查询性能诊断'))
    const summary = state.analysis.diagnostics
    const temporaryBTreeOperations = summary.temporaryBTreeOperations ?? []
    const operationLabels = new Map([
      ['order-by', '排序'],
      ['group-by', '分组'],
      ['distinct', '去重'],
      ['other', '其他'],
    ])
    const temporaryBTreeDetail = [...new Set(temporaryBTreeOperations.map(operation => operationLabels.get(operation) ?? operation))].join('、')
    diagnostics.append(element('p', 'section-note', `全表扫描 ${summary.fullTableScans} 次 · 临时 B-tree ${summary.temporaryBtrees} 次${temporaryBTreeDetail ? `（${temporaryBTreeDetail}）` : ''} · 自动索引 ${summary.automaticIndexes} 次`))
    if (summary.warnings.length) {
      diagnostics.append(element('div', 'diagnostic-warnings', summary.warnings.map(warning => warning === 'full-table-scan' ? '存在全表扫描' : warning === 'temporary-b-tree' ? `使用临时 B-tree${temporaryBTreeDetail ? `（${temporaryBTreeDetail}）` : ''}` : '使用自动索引').join(' · ')))
    }
    else {
      diagnostics.append(element('p', 'section-note', summary.indexes.length ? `使用索引：${summary.indexes.join(', ')}` : '未发现计划警告。'))
    }
    content.append(diagnostics)
  }
  if (state.sqlResult) { content.append(table(state.sqlResult.columns, state.sqlResult.rows)) }
  else if (!state.sqlSummary) { content.append(empty('准备运行 SQL', '查询结果和执行计划显示在这里。绑定参数会随 SQL 单独传递。')) }
  return content
}

export function historyView(context: PanelContext) {
  const state = context.state.current
  const content = element('section', 'history-view')
  const heading = element('div', 'data-toolbar')
  heading.append(element('span', 'muted', `当前数据库最近 ${state.history.length} 次 SQL 操作 · 仅保留本次会话`), element('div', 'spacer'), button('清空历史', () => { state.history = []; context.render() }, '', !state.history.length))
  content.append(heading)
  if (!state.history.length) { content.append(empty('还没有 SQL 历史', '运行查询、写入或执行计划后，记录会保留在当前数据库下。')) }
  for (const item of state.history) {
    const entry = element('article', `history-entry ${item.status}`)
    const meta = element('div', 'history-meta')
    meta.append(element('span', 'status-label', item.status === 'success' ? '成功' : '失败'), element('span', 'type-badge', item.kind.toUpperCase()), element('span', 'muted', `${new Date(item.at).toLocaleTimeString()} · ${item.elapsedMs.toFixed(1)} ms`), element('div', 'spacer'), button('回填编辑器', () => { context.state.restoreHistory(item.id); context.render() }, 'text-button'))
    entry.append(meta, element('pre', 'history-sql', item.sql), element('p', 'history-summary', item.summary))
    content.append(entry)
  }
  return content
}

export function diagnosticsView(context: PanelContext) {
  const state = context.state.current
  const content = element('section', 'diagnostics-view')
  const toolbar = element('div', 'data-toolbar')
  toolbar.append(element('span', 'muted', '迁移和外键检查只读访问当前运行实例'), element('div', 'spacer'), button('重新检查', () => context.refresh(), '', context.busy))
  content.append(toolbar)

  const migration = state.migrationDiagnostics
  content.append(element('h3', 'section-title', '迁移诊断'))
  if (!migration) {
    content.append(empty('尚未检查迁移', '点击“重新检查”读取当前数据库的迁移历史。'))
  }
  else {
    const status = migration.healthy ? '健康' : `需要关注 · ${migration.warnings.join('、')}`
    content.append(element('p', migration.healthy ? 'diagnostics-ok' : 'diagnostic-warnings', `${status} · 已应用 ${migration.applied.length} · 待执行 ${migration.pending.length} · 未知 ${migration.unknown.length} · 冲突 ${migration.conflicts.length}`))
    if (migration.pending.length) { content.append(element('p', 'section-note', `待执行：${migration.pending.map(item => `${item.version} ${item.name}`).join('、')}`)) }
    if (migration.unknown.length) { content.append(element('p', 'section-note', `未知历史：${migration.unknown.map(item => `${item.version} ${item.name}`).join('、')}`)) }
    if (migration.conflicts.length) { content.append(element('p', 'section-note', `名称冲突：${migration.conflicts.map(item => `${item.version} ${item.appliedName} → ${item.expectedName}`).join('、')}`)) }
  }

  const foreignKeys = state.foreignKeyDiagnostics
  content.append(element('h3', 'section-title', '外键诊断'))
  if (!foreignKeys) {
    content.append(empty('尚未检查外键', '点击“重新检查”读取约束开关和完整性检查结果。'))
  }
  else {
    const status = foreignKeys.healthy ? '健康' : `需要关注 · ${foreignKeys.warnings.join('、')}`
    content.append(element('p', foreignKeys.healthy ? 'diagnostics-ok' : 'diagnostic-warnings', `${status} · ${foreignKeys.enabled ? 'foreign_keys 已开启' : 'foreign_keys 已关闭'} · 约束 ${foreignKeys.constraints.length} · 违规 ${foreignKeys.violations.length}`))
    if (foreignKeys.constraints.length) {
      const rows = foreignKeys.constraints.map(item => ({
        table: item.table,
        from: item.from ?? '—',
        referencedTable: item.referencedTable,
        to: item.to ?? '—',
        onUpdate: item.onUpdate,
        onDelete: item.onDelete,
      }))
      content.append(table(['table', 'from', 'referencedTable', 'to', 'onUpdate', 'onDelete'], rows))
    }
    if (foreignKeys.violations.length) {
      content.append(element('p', 'section-note', `违规行：${foreignKeys.violations.map(item => `${item.table}#${String(item.rowid ?? '—')} → ${item.parent}`).join('、')}`))
    }
  }
  return content
}

export function fileMenu(context: PanelContext) {
  const details = element('details', 'file-menu')
  details.append(element('summary', '', '导入 / 导出'))
  const menu = element('div', 'file-menu-content')
  for (const format of ['sqlite', 'csv', 'json'] as const) {
    menu.append(button(`导出 ${format.toUpperCase()}`, () => { details.open = false; return exportFile(context, format) }, '', context.busy || (format !== 'sqlite' && !context.state.current.table)))
    menu.append(button(`导入 ${format.toUpperCase()}`, () => { details.open = false; importFile(context, format) }, '', context.busy || context.readOnly))
  }
  details.append(menu)
  return details
}
