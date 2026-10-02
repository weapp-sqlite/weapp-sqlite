import type { SqliteConnection, SqliteDatabase, SqliteDriver, SqliteMigration } from '..'
import { expectType } from 'tsd'
import { createSqliteDatabase, migrate, SqlitePersistenceError } from '..'

expectType<SqliteDatabase>(createSqliteDatabase('demo', {} as SqliteConnection))
expectType<Promise<number[]>>(migrate({} as SqliteDatabase, [] as SqliteMigration[]))
expectType<string>({} as SqliteDriver['kind'])
expectType<true>(new SqlitePersistenceError({ cause: new Error('save') }).committed)
expectType<unknown>(new SqlitePersistenceError({ cause: new Error('save') }).cause)
