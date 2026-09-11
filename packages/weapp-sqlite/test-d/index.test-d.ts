import type { SqliteDatabase } from '@weapp-sqlite/core'
import { expectAssignable, expectType } from 'tsd'
// eslint-disable-next-line antfu/no-import-dist
import { weappSqlite } from '../dist/index.mjs'
// eslint-disable-next-line antfu/no-import-dist
import { getSqliteTarget, openSqlite, removeSqlite } from '../dist/runtime.mjs'

expectAssignable<object>(weappSqlite())
expectType<Promise<SqliteDatabase>>(openSqlite({ name: 'app.sqlite' }))
expectType<Promise<void>>(removeSqlite({ name: 'app.sqlite' }))
expectType<'web' | 'weapp' | 'alipay' | 'tt' | 'swan' | 'jd' | 'xhs'>(getSqliteTarget())
