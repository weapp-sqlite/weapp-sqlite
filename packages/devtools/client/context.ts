import type { SqliteDebugController } from '@weapp-sqlite/debug'
import type { WorkspaceState } from './state'

export interface PanelContext {
  readonly state: WorkspaceState
  readonly readOnly: boolean
  readonly busy: boolean
  render: () => void
  refresh: () => Promise<void>
  refreshTable: () => Promise<void>
  request: <K extends Exclude<keyof SqliteDebugController, 'close'>>(method: K, ...args: Parameters<SqliteDebugController[K]>) => Promise<Awaited<ReturnType<SqliteDebugController[K]>>>
  perform: (label: string, action: () => Promise<void>) => Promise<void>
  runSql: (kind: 'query' | 'execute' | 'explain' | 'analyze') => Promise<void>
}
