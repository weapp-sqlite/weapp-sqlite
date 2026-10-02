import type { SqliteDatabase, SqliteExecResult, SqliteMigrationStatus, SqliteTransaction } from '@weapp-sqlite/core'
import { expectType } from 'tsd'
// eslint-disable-next-line antfu/no-import-dist
import { execMany, getMigrationStatus, SqlitePersistenceError } from '../dist/runtime.mjs'

declare const database: SqliteDatabase
declare const transaction: SqliteTransaction
expectType<Promise<readonly SqliteExecResult[]>>(execMany(database, 'INSERT INTO notes VALUES (?)', [['one']] as const))
expectType<Promise<readonly SqliteExecResult[]>>(execMany(transaction, 'INSERT INTO notes VALUES ($body)', [{ $body: 'one' }] as const))
expectType<Promise<SqliteMigrationStatus>>(getMigrationStatus(database))
expectType<true>(new SqlitePersistenceError({ cause: new Error('save failed') }).committed)
