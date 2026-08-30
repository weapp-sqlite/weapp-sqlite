import { sqliteAcceptanceMigrations } from '@weapp-sqlite/demo-shared'
import { defineSqliteDebugWorkspace } from '@weapp-sqlite/weapp-vite/debug'
import { DATABASE_NAME } from './sqlite'

export default defineSqliteDebugWorkspace({
  databaseName: DATABASE_NAME,
  migrations: sqliteAcceptanceMigrations,
  enabled: true,
  limits: {
    maxRows: 500,
    maxImportBytes: 16 * 1024 * 1024,
    maxExportBytes: 16 * 1024 * 1024,
    maxUndoBytes: 16 * 1024 * 1024,
  },
})
