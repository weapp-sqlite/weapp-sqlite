import { sqliteAcceptanceMigrations } from '@weapp-sqlite/demo-shared'
import { createSqliteDebugController } from '@weapp-sqlite/weapp-vite/debug'
import { getSqliteDatabasePath } from '@weapp-sqlite/weapp-vite/runtime'
import { DATABASE_NAME } from './sqlite'

export async function createPlatformSqliteDebugController() {
  return createSqliteDebugController({
    databaseName: DATABASE_NAME,
    migrations: sqliteAcceptanceMigrations,
    enabled: true,
  })
}

export async function getPlatformSqliteDebugFilePath() {
  return getSqliteDatabasePath(DATABASE_NAME)
}
