import type { MiniProgramPlatform } from '@weapp-sqlite/miniprogram'
import type { SqliteRuntimeAdapter } from './types'
import initSqlJsFull from '@weapp-sqlite/sqljs/full'
import {
  createMiniProgramSqliteRuntimeAdapterWithInitializer,
  createWebSqliteRuntimeAdapterWithInitializer,
} from './advanced'

export { createSqliteWasmRuntimeAdapter } from './advanced'

export type {
  CreateSqliteWasmRuntimeAdapterOptions,
  SqliteRuntimeAdapter,
  SqliteRuntimeCapabilityReport,
  SqliteRuntimeInfo,
  SqliteRuntimeTarget,
} from './advanced'

export interface CreateWebSqliteRuntimeAdapterOptions {
  readonly wasmPath?: string
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
  readonly userAgent?: string
}

export function createWebSqliteRuntimeAdapter(options: CreateWebSqliteRuntimeAdapterOptions = {}): SqliteRuntimeAdapter {
  return createWebSqliteRuntimeAdapterWithInitializer({
    ...options,
    engine: 'sql.js-wasm',
    initializer: initSqlJsFull,
  })
}

export interface CreateMiniProgramSqliteRuntimeAdapterOptions {
  readonly platform: MiniProgramPlatform
  readonly runtime: unknown
  readonly webAssembly?: unknown
  readonly packageBinaryPath?: string
  readonly directoryName?: string
}

export function createMiniProgramSqliteRuntimeAdapter(
  options: CreateMiniProgramSqliteRuntimeAdapterOptions,
): SqliteRuntimeAdapter {
  return createMiniProgramSqliteRuntimeAdapterWithInitializer({
    ...options,
    engine: 'sql.js-wasm',
    initializer: initSqlJsFull,
  })
}
