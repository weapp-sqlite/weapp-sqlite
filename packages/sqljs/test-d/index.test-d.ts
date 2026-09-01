import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import { expectType } from 'tsd'
// eslint-disable-next-line antfu/no-import-dist
import initSqlJsFull, { initSqlJsFull as namedFull } from '../dist/full.mjs'
// eslint-disable-next-line antfu/no-import-dist
import initSqlJsLite, { initSqlJsLite as namedLite } from '../dist/lite.mjs'
// eslint-disable-next-line antfu/no-import-dist
import { resolveSqliteWasmAsset, sqliteWasmAssetName } from '../dist/node.mjs'

expectType<SqlJsInitializer>(initSqlJsFull)
expectType<SqlJsInitializer>(namedFull)
expectType<SqlJsInitializer>(initSqlJsLite)
expectType<SqlJsInitializer>(namedLite)
expectType<'sql-wasm-lite.wasm' | 'sql-wasm-browser.wasm' | 'sql-wasm.wasm'>(sqliteWasmAssetName('lite', 'web'))
expectType<string>(resolveSqliteWasmAsset('full', 'miniprogram'))
