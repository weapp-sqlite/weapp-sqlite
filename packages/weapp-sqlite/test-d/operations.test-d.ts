import type { SqliteDatabase, SqliteExecResult, SqliteMigrationStatus } from '@weapp-sqlite/core'
import { expectType } from 'tsd'
// eslint-disable-next-line antfu/no-import-dist
import { execMany, getMigrationStatus, SqlitePersistenceError } from '../dist/runtime.mjs'

declare const database: SqliteDatabase
expectType<Promise<readonly SqliteExecResult[]>>(execMany(database, 'INSERT INTO notes VALUES (?)', [['one']] as const))
expectType<Promise<SqliteMigrationStatus>>(getMigrationStatus(database, []))
expectType<true>(new SqlitePersistenceError({ cause: new Error('save failed') }).committed)
