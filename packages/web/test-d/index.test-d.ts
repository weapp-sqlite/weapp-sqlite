import type { IndexedDbSqliteWasmStorage } from '..'
import { expectType } from 'tsd'
import { createIndexedDbSqliteWasmStorage } from '..'

expectType<IndexedDbSqliteWasmStorage>(createIndexedDbSqliteWasmStorage())
expectType<Promise<void>>(createIndexedDbSqliteWasmStorage().remove('demo'))
