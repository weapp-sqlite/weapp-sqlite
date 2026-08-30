import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import type {
  MiniProgramPlatform,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteWasmStorage,
  MiniProgramWebAssemblyRuntime,
} from '..'
import { expectType } from 'tsd'
import {
  createMiniProgramSqliteDebugFileAdapter,
  createMiniProgramSqliteWasmStorage,
  createMiniProgramSqlJsInitializer,
  probeMiniProgramSqliteCapabilities,
} from '..'

const platform: MiniProgramPlatform = 'weapp'
const storage = createMiniProgramSqliteWasmStorage({ platform, runtime: {} })
expectType<MiniProgramSqliteWasmStorage>(storage)
expectType<string | undefined>(storage.getDatabasePath?.('demo'))
expectType<Promise<MiniProgramSqliteCapabilityReport>>(probeMiniProgramSqliteCapabilities({ platform, runtime: {} }))

declare const webAssembly: MiniProgramWebAssemblyRuntime
declare const initializer: Parameters<typeof createMiniProgramSqlJsInitializer>[0]['initializer']
expectType<SqlJsInitializer>(createMiniProgramSqlJsInitializer({
  platform,
  runtime: {},
  webAssembly,
  packageBinaryPath: '/assets/sql-wasm.wasm',
  initializer,
}))
expectType<Promise<{ readonly method: 'save-file-to-disk' | 'share-file-message', readonly fileName: string }>>(createMiniProgramSqliteDebugFileAdapter({ platform, runtime: {} }).save({ fileName: 'demo.sqlite', mimeType: 'application/vnd.sqlite3', bytes: new Uint8Array() }))
