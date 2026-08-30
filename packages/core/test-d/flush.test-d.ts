import type { SqliteConnection, SqliteDatabase } from '..'
import { expectType } from 'tsd'
import { createSqliteDatabase } from '..'

expectType<Promise<void>>(createSqliteDatabase('demo', {} as SqliteConnection).flush())
expectType<Promise<void>>(({} as SqliteDatabase).flush())
