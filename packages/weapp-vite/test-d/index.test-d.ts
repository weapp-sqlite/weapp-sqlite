import type { SqliteMigration, SqliteTransaction } from '@weapp-sqlite/core'
// eslint-disable-next-line antfu/no-import-dist
import type { SqliteRuntimeAdapter } from '../dist/adapter.mjs'
// eslint-disable-next-line antfu/no-import-dist
import type { SqliteRuntimeInfo } from '../dist/runtime.mjs'
import { expectAssignable, expectType } from 'tsd'
import { weappSqlite } from '..'
// eslint-disable-next-line antfu/no-import-dist
import { createSqliteDebugController, defineSqliteDebugWorkspace } from '../dist/debug.mjs'
// eslint-disable-next-line antfu/no-import-dist
import { getSqliteRuntimeInfo, getSqliteTarget, openSqlite, removeSqlite } from '../dist/runtime.mjs'

const migrations: readonly SqliteMigration[] = [{
  version: 1,
  name: 'create_notes',
  up: async (transaction: SqliteTransaction) => transaction.exec('CREATE TABLE notes (body TEXT)').then(() => undefined),
}]

expectAssignable<object>(weappSqlite())
expectAssignable<object>(weappSqlite({ debug: { enabled: true, page: { route: '__debug/index/index', configFile: './src/sqlite-debug.config.ts' } } }))
expectAssignable<object>(weappSqlite({ wasm: { variant: 'lite', weappPackage: 'main' } }))
expectAssignable<object>(weappSqlite({ wasm: { variant: 'full', weappPackage: { mode: 'generated-subpackage' } } }))
expectAssignable<object>(weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: 'shared' } } }))
expectType<string>(defineSqliteDebugWorkspace({ databaseName: 'demo.sqlite' }).databaseName)
expectType<Promise<import('@weapp-sqlite/core').SqliteDatabase>>(openSqlite({ name: 'app.sqlite', migrations }))
expectType<Promise<void>>(removeSqlite({ name: 'app.sqlite' }))
expectType<'web' | 'weapp' | 'alipay' | 'tt' | 'swan' | 'jd' | 'xhs'>(getSqliteTarget())
expectType<Promise<SqliteRuntimeInfo>>(getSqliteRuntimeInfo())
expectType<import('@weapp-sqlite/debug').SqliteDebugController>(createSqliteDebugController({
  databaseName: 'app.sqlite',
  migrations,
  enabled: true,
}))

declare const adapter: SqliteRuntimeAdapter
expectType<Promise<import('@weapp-sqlite/core').SqliteDatabase>>(openSqlite({ name: 'custom', adapter }))
