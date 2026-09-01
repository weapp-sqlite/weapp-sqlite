import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import initializeSqlJs from './vendor/sql-wasm-lite.js'

export const initSqlJsLite = initializeSqlJs as SqlJsInitializer

export default initSqlJsLite
