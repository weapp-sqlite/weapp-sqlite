// eslint-disable-next-line antfu/no-import-dist
import type { SqliteDebugWorkspaceOptions } from '../dist/debug.mjs'
// eslint-disable-next-line antfu/no-import-dist
import type { WeappSqlitePluginOptions } from '../dist/plugin.mjs'
import { expectAssignable, expectType } from 'tsd'
import { weappSqlite } from '..'
// eslint-disable-next-line antfu/no-import-dist
import { defineSqliteDebugWorkspace } from '../dist/debug.mjs'

const workspace = defineSqliteDebugWorkspace({
  databases: [
    { databaseName: 'main.sqlite' },
    { databaseName: 'analytics.sqlite', enabled: true },
  ],
  defaultDatabase: 'main.sqlite',
})
expectAssignable<SqliteDebugWorkspaceOptions>(workspace)

const options: WeappSqlitePluginOptions = {
  debug: { enabled: true, devtools: true },
}
expectType<ReturnType<typeof weappSqlite>>(weappSqlite(options))
