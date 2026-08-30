import type { SqliteConnection } from '@weapp-sqlite/core'
import type {
  SqliteDebugColumn,
  SqliteDebugController,
  SqliteDebugExecutionResult,
  SqliteDebugMigrationStatus,
  SqliteDebugPage,
  SqliteDebugQueryResult,
  SqliteDebugSnapshotMetadata,
  SqliteDebugTable,
} from '..'
import { expectType } from 'tsd'
import { createSqliteDebugController } from '..'

const controller = createSqliteDebugController({
  databaseName: 'demo',
  openDatabase: async () => ({ } as SqliteConnection & never),
  storage: { load: async () => undefined, save: async () => undefined, remove: async () => undefined },
  enabled: true,
})
expectType<SqliteDebugController>(controller)
expectType<Promise<readonly SqliteDebugTable[]>>(controller.listTables())
expectType<Promise<readonly SqliteDebugColumn[]>>(controller.describeTable('notes'))
expectType<Promise<SqliteDebugPage>>(controller.readTable('notes', { limit: 50, offset: 0 }))
expectType<Promise<SqliteDebugQueryResult>>(controller.query('SELECT * FROM notes WHERE id = ?', [1]))
expectType<Promise<SqliteDebugExecutionResult>>(controller.execute('DELETE FROM notes WHERE id = ?', [1], { allowWrite: true }))
expectType<Promise<SqliteDebugMigrationStatus>>(controller.getMigrationStatus())
expectType<Promise<void>>(controller.resetDatabase())
expectType<Promise<Uint8Array>>(controller.exportDatabase().then(snapshot => snapshot.bytes))
expectType<Promise<SqliteDebugSnapshotMetadata>>(controller.importDatabase(new Uint8Array(), { replace: true }))
expectType<Promise<void>>(controller.close())
