import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import initializeSqlJs from './vendor/sql-wasm.js'

export const initSqlJsFull: SqlJsInitializer = options => initializeSqlJs({
  ...options,
  locateFile: options?.locateFile ?? ((file, prefix = '') => `${prefix}../assets/${file}`),
})

export default initSqlJsFull
