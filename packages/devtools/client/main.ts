/* eslint-disable ts/no-use-before-define */
import type { SqliteDebugController } from '@weapp-sqlite/debug'
import type { SqliteDevtoolsClient } from '../src/client'
import type { SqliteDevtoolsRuntimeDescriptor } from '../src/protocol'
import type { PanelContext } from './context'
import { connectDevtoolsClient } from '../src/client'
import { createTable } from './actions'
import { button, element, empty, select } from './dom'
import { parseParameters, planNodes, runtimeSessionChanged, snapshotSqlInput, WorkspaceState } from './state'
import { dataView, diagnosticsView, fileMenu, historyView, schemaView, sqlView } from './views'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')!

let client: SqliteDevtoolsClient | undefined
let runtimes: readonly SqliteDevtoolsRuntimeDescriptor[] = []
let status: 'connecting' | 'connected' | 'disconnected' = 'connecting'
let busy = false
const state = new WorkspaceState()
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function currentRuntime() { return runtimes.find(runtime => runtime.id === state.runtimeId) }
function runtimeDatabases(runtime?: SqliteDevtoolsRuntimeDescriptor) { return runtime?.databases ?? [] }
function runtimeLabel(runtime?: SqliteDevtoolsRuntimeDescriptor) { return runtime ? `${runtime.label} · ${runtime.platform}${runtime.readOnly ? ' · 只读' : ''}` : '未连接运行实例' }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

async function request<K extends Exclude<keyof SqliteDebugController, 'close'>>(method: K, ...args: Parameters<SqliteDebugController[K]>) {
  if (!client || !state.runtimeId || !state.databaseName) { throw new Error('尚未选择运行实例和数据库。') }
  return await client.request(state.runtimeId, state.databaseName, method, args) as Awaited<ReturnType<SqliteDebugController[K]>>
}

const context: PanelContext = {
  get state() { return state },
  get readOnly() { return currentRuntime()?.readOnly ?? true },
  get busy() { return busy },
  render,
  refresh,
  refreshTable,
  request: request as PanelContext['request'],
  perform,
  runSql,
}

function toast(message: string, error = false) {
  state.current.notice = message
  state.current.error = error ? message : ''
  render()
  if (noticeTimer) { clearTimeout(noticeTimer) }
  noticeTimer = setTimeout(() => {
    state.current.notice = ''; if (!error) { state.current.error = '' } render()
  }, 4000)
}

async function perform(label: string, action: () => Promise<void>) {
  busy = true
  state.current.error = ''
  render()
  try { await action(); toast(label) }
  catch (error) { toast(errorMessage(error), true) }
  finally { busy = false; render() }
}

async function refresh() {
  const ticket = state.begin('refresh')
  await perform('数据库已刷新', async () => {
    const [tables, migrationDiagnostics, foreignKeyDiagnostics] = await Promise.all([
      request('listTables'),
      request('getMigrationDiagnostics'),
      request('getForeignKeyDiagnostics'),
    ])
    if (!state.accepts(ticket)) { return }
    state.current.tables = tables
    state.current.migrationDiagnostics = migrationDiagnostics
    state.current.foreignKeyDiagnostics = foreignKeyDiagnostics
    const selected = tables.some(table => table.name === state.current.table) ? state.current.table : tables[0]?.name ?? ''
    state.selectTable(selected)
    await refreshTable()
  })
}

async function refreshTable() {
  if (!state.current.table) { return }
  const ticket = state.begin('table')
  const tableName = state.current.table
  await perform(`已读取 ${tableName}`, async () => {
    const [columns, capabilities, indexes, page] = await Promise.all([
      request('describeTable', tableName),
      request('getTableCapabilities', tableName),
      request('listIndexes', tableName),
      request('readTable', tableName, {
        limit: state.current.limit,
        offset: state.current.offset,
        ...(state.current.search ? { search: state.current.search } : {}),
        ...(state.current.filters.length ? { filters: state.current.filters } : {}),
        ...(state.current.orderColumn ? { orderBy: [{ column: state.current.orderColumn, direction: state.current.orderDirection }] } : {}),
      }),
    ])
    if (!state.accepts(ticket)) { return }
    Object.assign(state.current, { columns, capabilities, indexes, page, limit: page.limit, undo: await request('getUndoState') })
  })
}

async function runSql(kind: 'query' | 'execute' | 'explain' | 'analyze') {
  const current = state.current
  const input = snapshotSqlInput(current)
  const sql = input.sql
  const parameterText = input.parameters
  if (!sql) { toast('请输入 SQL。', true); return }
  const started = performance.now()
  let parameters
  try { parameters = parseParameters(parameterText) }
  catch (error) { toast(errorMessage(error), true); return }
  const ticket = state.begin('sql')
  await perform(kind === 'query' ? '查询完成' : kind === 'explain' ? '执行计划完成' : kind === 'analyze' ? '性能诊断完成' : '写入完成', async () => {
    if (kind === 'execute' && context.readOnly) { throw new Error('当前运行实例为只读模式。') }
    let summary = ''
    if (kind === 'query') {
      const result = await request('query', sql, parameters)
      if (!state.accepts(ticket)) { return }
      Object.assign(current, { sqlResult: { columns: result.columns, rows: result.rows }, plan: undefined, analysis: undefined, sqlSummary: `${result.rows.length} 行 · ${result.elapsedMs.toFixed(1)} ms` })
      summary = current.sqlSummary
    }
    else if (kind === 'explain') {
      const result = await request('query', `EXPLAIN QUERY PLAN ${sql}`, parameters)
      if (!state.accepts(ticket)) { return }
      Object.assign(current, { plan: planNodes(result.rows), analysis: undefined, sqlResult: undefined, sqlSummary: `${result.rows.length} 个计划节点 · ${result.elapsedMs.toFixed(1)} ms` })
      summary = current.sqlSummary
    }
    else if (kind === 'analyze') {
      const result = await request('analyzeQuery', sql, parameters)
      if (!state.accepts(ticket)) { return }
      Object.assign(current, {
        analysis: result,
        plan: result.nodes.map(node => ({ id: node.id, parent: node.parent, detail: node.detail, depth: node.depth })),
        sqlResult: undefined,
        sqlSummary: `${result.nodes.length} 个节点 · ${result.elapsedMs.toFixed(1)} ms`,
      })
      summary = `${current.sqlSummary} · 全表扫描 ${result.diagnostics.fullTableScans} 次`
    }
    else {
      const result = await request('execute', sql, parameters, { allowWrite: true })
      if (!state.accepts(ticket)) { return }
      Object.assign(current, { plan: undefined, analysis: undefined, sqlResult: undefined, sqlSummary: `${result.changes} 行受影响 · ${result.elapsedMs.toFixed(1)} ms` })
      summary = current.sqlSummary
      await refreshTable()
    }
    state.record(current, { sql, parameters: parameterText, kind, status: 'success', elapsedMs: performance.now() - started, summary })
  })
  if (current.error) { state.record(current, { sql, parameters: parameterText, kind, status: 'error', elapsedMs: performance.now() - started, summary: current.error }) }
}

function render() {
  const current = state.current
  root.replaceChildren()
  const shell = element('div', 'shell')
  const header = element('header', 'topbar')
  const brand = element('div', 'brand')
  brand.append(element('span', 'brand-mark', '⌁'), element('div', '', 'SQLite Workbench'), element('span', 'eyebrow', 'DEVFRAME'))
  const statusNode = element('span', `connection-status ${status}`, status === 'connected' ? '● 在线' : status === 'connecting' ? '◌ 连接中' : '○ 已断开')
  header.append(brand, statusNode)
  const runtimeControls = element('div', 'runtime-controls')
  const runtime = select('运行实例', runtimes.map(item => ({ value: item.id, label: runtimeLabel(item) })), state.runtimeId, (value) => { const item = runtimes.find(runtime => runtime.id === value); state.select(value, item?.databases[0] ?? ''); void refresh() })
  const database = select('数据库', runtimeDatabases(currentRuntime()).map(name => ({ value: name, label: name })), state.databaseName, (value) => { state.select(state.runtimeId, value); void refresh() })
  runtime.disabled = !runtimes.length || busy
  database.disabled = !state.runtimeId || busy
  runtimeControls.append(runtime, database, fileMenu(context), button('刷新', () => refresh(), '', busy || status !== 'connected'))
  header.append(runtimeControls)
  shell.append(header)
  if (status === 'disconnected') {
    shell.append(empty('等待运行实例连接', 'Devframe runtime 断开后不会重放请求。连接恢复后可安全继续操作。'))
    root.append(shell)
    return
  }
  if (!runtimes.length) {
    shell.append(empty('没有发现 SQLite 运行实例', '在应用中打开调试开关并重新加载页面。'))
    root.append(shell)
    return
  }
  const layout = element('div', 'workspace-layout')
  const sidebar = element('aside', 'sidebar')
  const sideHeading = element('div', 'sidebar-heading')
  sideHeading.append(element('span', '', '对象'), element('span', 'muted', `${current.tables.length} 个`))
  sidebar.append(sideHeading)
  const tableList = element('div', 'table-list')
  for (const tableItem of current.tables) {
    const item = button('', () => { state.selectTable(tableItem.name); void refreshTable() }, `table-item ${tableItem.name === current.table ? 'active' : ''}`)
    item.append(element('span', 'object-icon', tableItem.type === 'view' ? 'V' : 'T'), element('code', '', tableItem.name))
    tableList.append(item)
  }
  sidebar.append(tableList, button('+ 新建表', () => createTable(context), 'sidebar-create', context.readOnly || busy))
  layout.append(sidebar)
  const main = element('main', 'main-content')
  const tabs = element('nav', 'tabs')
  for (const [tab, label] of [['data', '数据'], ['schema', '结构'], ['sql', 'SQL'], ['history', '历史'], ['diagnostics', '诊断']] as const) { tabs.append(button(label, () => { current.tab = tab; render() }, `tab ${current.tab === tab ? 'active' : ''}`)) }
  main.append(tabs)
  if (current.error) { main.append(element('div', 'error-banner', current.error)) }
  if (current.notice && !current.error) { main.append(element('div', 'notice-banner', current.notice)) }
  main.append(current.tab === 'data' ? dataView(context) : current.tab === 'schema' ? schemaView(context) : current.tab === 'sql' ? sqlView(context) : current.tab === 'history' ? historyView(context) : diagnosticsView(context))
  layout.append(main)
  shell.append(layout)
  root.append(shell)
}

async function connect() {
  try {
    client = await connectDevtoolsClient()
    status = 'connected'
    client.subscribeStatus((next) => {
      status = next === 'connected' || next === 'connecting' ? next : 'disconnected'; if (status === 'disconnected') { state.invalidate() } render()
    })
    client.subscribe((next) => {
      const sessionChanged = runtimeSessionChanged(runtimes, next)
      runtimes = next
      if (sessionChanged) {
        state.invalidate()
      }
      const selected = runtimes.find(runtime => runtime.id === state.runtimeId)
      if (!selected || !selected.databases.includes(state.databaseName)) {
        state.select(selected?.id ?? runtimes[0]?.id ?? '', selected?.databases[0] ?? runtimes[0]?.databases[0] ?? '')
        if (state.runtimeId) { void refresh() }
      }
      else if (sessionChanged) {
        void refresh()
      }
      render()
    })
    runtimes = await client.listRuntimes()
    if (runtimes.length) { state.select(runtimes[0]!.id, runtimes[0]!.databases[0] ?? '') }
    render()
    if (state.runtimeId) { await refresh() }
  }
  catch (error) {
    status = 'disconnected'
    toast(errorMessage(error), true)
  }
}

window.addEventListener('beforeunload', () => client?.dispose())
render()
void connect()
