import type { SqliteParameters } from '@weapp-sqlite/core'
import type {
  SqliteDebugColumn,
  SqliteDebugFilter,
  SqliteDebugForeignKeyDiagnostics,
  SqliteDebugIndex,
  SqliteDebugMigrationDiagnostics,
  SqliteDebugPage,
  SqliteDebugQueryAnalysis,
  SqliteDebugTable,
  SqliteDebugTableCapabilities,
  SqliteDebugUndoState,
} from '@weapp-sqlite/debug'

export interface SqlHistoryEntry {
  readonly id: number
  readonly sql: string
  readonly parameters: string
  readonly kind: 'query' | 'execute' | 'explain' | 'analyze'
  readonly status: 'success' | 'error'
  readonly elapsedMs: number
  readonly summary: string
  readonly at: number
}

export interface DatabaseState {
  tab: 'data' | 'schema' | 'sql' | 'history' | 'diagnostics'
  tables: readonly SqliteDebugTable[]
  table: string
  columns: readonly SqliteDebugColumn[]
  indexes: readonly SqliteDebugIndex[]
  capabilities?: SqliteDebugTableCapabilities
  page?: SqliteDebugPage
  search: string
  filters: SqliteDebugFilter[]
  orderColumn: string
  orderDirection: 'asc' | 'desc'
  offset: number
  limit: number
  selectedRows: Set<number>
  sql: string
  parameters: string
  sqlResult?: { columns: readonly string[], rows: readonly Record<string, unknown>[] }
  sqlSummary: string
  plan: PlanNode[] | undefined
  analysis: SqliteDebugQueryAnalysis | undefined
  history: SqlHistoryEntry[]
  migrationDiagnostics?: SqliteDebugMigrationDiagnostics
  foreignKeyDiagnostics?: SqliteDebugForeignKeyDiagnostics
  undo: SqliteDebugUndoState
  error: string
  notice: string
}

export interface PlanNode {
  readonly id: number
  readonly parent: number
  readonly detail: string
  readonly depth: number
}

export interface RequestTicket {
  readonly generation: number
  readonly lane: string
  readonly sequence: number
  readonly key: string
}

export class WorkspaceState {
  runtimeId = ''
  databaseName = ''
  private generation = 0
  private readonly databases = new Map<string, DatabaseState>()
  private readonly sequences = new Map<string, number>()
  private historyId = 0

  get key() { return JSON.stringify([this.runtimeId, this.databaseName]) }

  get current(): DatabaseState {
    let state = this.databases.get(this.key)
    if (!state) {
      state = {
        tab: 'data',
        tables: [],
        table: '',
        columns: [],
        indexes: [],
        search: '',
        filters: [],
        orderColumn: '',
        orderDirection: 'asc',
        offset: 0,
        limit: 50,
        selectedRows: new Set(),
        sql: 'SELECT name, type FROM sqlite_schema ORDER BY name',
        parameters: '[]',
        sqlSummary: '',
        plan: undefined,
        analysis: undefined,
        history: [],
        undo: { available: false },
        error: '',
        notice: '',
      }
      this.databases.set(this.key, state)
    }
    return state
  }

  select(runtimeId: string, databaseName: string) {
    this.invalidate()
    this.runtimeId = runtimeId
    this.databaseName = databaseName
    return this.current
  }

  selectTable(table: string) {
    this.invalidate()
    Object.assign(this.current, {
      table,
      page: undefined,
      columns: [],
      indexes: [],
      capabilities: undefined,
      filters: [],
      search: '',
      orderColumn: '',
      offset: 0,
      selectedRows: new Set<number>(),
    })
  }

  invalidate() { this.generation++; this.sequences.clear() }

  begin(lane: string): RequestTicket {
    const sequence = (this.sequences.get(lane) ?? 0) + 1
    this.sequences.set(lane, sequence)
    return { generation: this.generation, sequence, key: this.key, lane }
  }

  accepts(ticket: RequestTicket) {
    return ticket.generation === this.generation && ticket.key === this.key
      && this.sequences.get(ticket.lane) === ticket.sequence
  }

  record(state: DatabaseState, entry: Omit<SqlHistoryEntry, 'id' | 'at'>) {
    state.history.unshift({ ...entry, id: ++this.historyId, at: Date.now() })
    state.history.length = Math.min(state.history.length, 50)
  }

  restoreHistory(id: number) {
    const entry = this.current.history.find(item => item.id === id)
    if (!entry) { return }
    this.current.sql = entry.sql
    this.current.parameters = entry.parameters
    this.current.tab = 'sql'
  }
}

/** A cycle or missing parent must not hang the execution-plan view. */
export function planNodes(rows: readonly Record<string, unknown>[]): PlanNode[] {
  const nodes = rows.map(row => ({ id: Number(row['id']), parent: Number(row['parent']), detail: String(row['detail'] ?? '') }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  return nodes.map((node) => {
    let parent = byId.get(node.parent)
    let depth = 0
    const visited = new Set([node.id])
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id)
      depth++
      parent = byId.get(parent.parent)
    }
    return { ...node, depth }
  })
}

export function formatValue(value: unknown): string {
  if (value == null) { return 'NULL' }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) { return `BLOB · ${value.byteLength} bytes` }
  return String(value)
}

export function stringifyEditable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') { return { $bigint: item.toString() } }
    if (item instanceof Uint8Array) { return { $blob: Array.from(item) } }
    return item
  }, 2)
}

export function parseEditable(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (Object.keys(record).length === 1 && typeof record['$bigint'] === 'string') { return BigInt(record['$bigint']) }
      if (Object.keys(record).length === 1 && Array.isArray(record['$blob'])) {
        const bytes = record['$blob'] as unknown[]
        if (!bytes.every(byte => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) { throw new TypeError('$blob 必须是 0–255 的整数数组。') }
        return Uint8Array.from(bytes as number[])
      }
    }
    return value
  })
}

export function parseParameters(text: string): SqliteParameters {
  const value = parseEditable(text.trim() || '[]')
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) { throw new TypeError('绑定参数必须是 JSON 数组或命名参数对象。') }
  for (const scalar of Object.values(value)) {
    if (scalar !== null && typeof scalar !== 'string' && typeof scalar !== 'number' && typeof scalar !== 'bigint' && !(scalar instanceof Uint8Array)) { throw new TypeError('参数只支持字符串、数字、NULL、{$bigint: "…"} 或 {$blob: [0, 255]}。') }
  }
  return value as SqliteParameters
}
