import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import type {
  MiniProgramPlatform,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteWasmStorage,
  MiniProgramWebAssemblyRuntime,
} from '..'
import { expectType } from 'tsd'
import {
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
