import type { IndexedDbSqliteWasmStorage } from '..'
import { expectType } from 'tsd'
import { createIndexedDbSqliteWasmStorage, createWebSqliteDebugFileAdapter } from '..'

expectType<IndexedDbSqliteWasmStorage>(createIndexedDbSqliteWasmStorage())
expectType<Promise<void>>(createIndexedDbSqliteWasmStorage().remove('demo'))
expectType<Promise<{ readonly method: 'file-system-access' | 'download', readonly fileName: string }>>(createWebSqliteDebugFileAdapter().save({ fileName: 'demo.sqlite', mimeType: 'application/vnd.sqlite3', bytes: new Uint8Array() }))
