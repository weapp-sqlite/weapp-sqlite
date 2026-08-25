import type { SqliteConnection, SqliteDatabase, SqliteDriver, SqliteMigration } from '..'
import { expectType } from 'tsd'
import { createSqliteDatabase, migrate } from '..'

expectType<SqliteDatabase>(createSqliteDatabase('demo', {} as SqliteConnection))
expectType<Promise<number[]>>(migrate({} as SqliteDatabase, [] as SqliteMigration[]))
expectType<string>({} as SqliteDriver['kind'])
