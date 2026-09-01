import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import initializeSqlJs from 'sql.js'

export const initSqlJsFull = initializeSqlJs as SqlJsInitializer

export default initSqlJsFull
