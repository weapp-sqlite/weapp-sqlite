import type {} from 'devframe'
import type { SqliteDevtoolsInvocation, SqliteDevtoolsReleaseSession, SqliteDevtoolsResult, SqliteDevtoolsRuntimeDescriptor } from './protocol.mjs'

// Devframe is ESM-only. Keep its augmentation in an ESM declaration even when
// the package entry is consumed through CommonJS.
declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'weapp-sqlite:list-runtimes': (ownerId?: string) => SqliteDevtoolsRuntimeDescriptor[]
    'weapp-sqlite:invoke': (input: SqliteDevtoolsInvocation) => Promise<SqliteDevtoolsResult>
    'weapp-sqlite:release-session': (input: SqliteDevtoolsReleaseSession) => Promise<SqliteDevtoolsResult>
  }
  interface DevframeRpcClientFunctions {
    'weapp-sqlite:state-updated': (runtimes: SqliteDevtoolsRuntimeDescriptor[]) => void
  }
}
