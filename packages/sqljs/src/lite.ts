import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import initializeSqlJs from './vendor/sql-wasm-lite.js'

export const initSqlJsLite: SqlJsInitializer = options => initializeSqlJs({
  ...options,
  locateFile: options?.locateFile ?? ((file, prefix = '') => `${prefix}../assets/${file === 'sql-wasm.wasm' ? 'sql-wasm-lite.wasm' : file}`),
})

export default initSqlJsLite
