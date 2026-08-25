import type { SqliteWasmStorage, SqlJsInitializer } from '..'
import { expectType } from 'tsd'
import { createSqliteWasmDriver } from '..'

expectType<string>(createSqliteWasmDriver({} as SqlJsInitializer, { storage: {} as SqliteWasmStorage }).kind)
