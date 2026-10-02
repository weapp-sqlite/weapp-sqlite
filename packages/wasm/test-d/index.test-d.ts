import type { SqliteWasmStorage, SqlJsDatabase, SqlJsExecutionResult, SqlJsInitializer, SqlJsResult } from '..'
import { expectAssignable, expectNotAssignable, expectType } from 'tsd'
import { createSqliteWasmDriver } from '..'

expectType<string>(createSqliteWasmDriver({} as SqlJsInitializer, { storage: {} as SqliteWasmStorage }).kind)
expectType<Uint8Array>(({} as SqlJsDatabase).exportSnapshot())
expectType<SqlJsExecutionResult | undefined>(({} as SqlJsDatabase).execWithMetadata?.('SELECT 1'))
expectType<readonly SqlJsResult[]>(({} as SqlJsExecutionResult).results)
expectType<boolean>(({} as SqlJsExecutionResult).readOnly)
expectAssignable<SqlJsDatabase>({} as Omit<SqlJsDatabase, 'execWithMetadata'>)
expectNotAssignable<SqlJsDatabase>({} as Omit<SqlJsDatabase, 'exportSnapshot'>)
