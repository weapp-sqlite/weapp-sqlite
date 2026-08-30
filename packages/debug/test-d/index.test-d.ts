import type { SqliteConnection } from '@weapp-sqlite/core'
import type {
  SqliteDebugColumn,
  SqliteDebugController,
  SqliteDebugExecutionResult,
  SqliteDebugImportPreview,
  SqliteDebugIndex,
  SqliteDebugMigrationStatus,
  SqliteDebugPage,
  SqliteDebugQueryResult,
  SqliteDebugSnapshotMetadata,
  SqliteDebugTable,
  SqliteDebugTableArtifact,
  SqliteDebugTableCapabilities,
  SqliteDebugTableImportResult,
  SqliteDebugUndoState,
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
expectType<Promise<SqliteDebugTableCapabilities>>(controller.getTableCapabilities('notes'))
expectType<Promise<readonly SqliteDebugIndex[]>>(controller.listIndexes('notes'))
expectType<Promise<SqliteDebugPage>>(controller.readTable('notes', { filters: [{ column: 'body', operator: 'contains', value: 'x' }], orderBy: [{ column: 'id', direction: 'desc' }] }))
expectType<Promise<void>>(controller.createTable('notes', [{ name: 'id', type: 'INTEGER', primaryKey: true }], { allowWrite: true }))
expectType<Promise<SqliteDebugExecutionResult>>(controller.insertRow('notes', { id: 1 }, { allowWrite: true }))
expectType<Promise<SqliteDebugExecutionResult>>(controller.updateRow('notes', { kind: 'rowid', value: 1 }, { id: 2 }, { allowWrite: true }))
expectType<Promise<SqliteDebugExecutionResult>>(controller.deleteRows('notes', [{ kind: 'rowid', value: 1 }], { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<void>>(controller.renameTable('notes', 'entries', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<void>>(controller.dropTable('notes', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<SqliteDebugExecutionResult>>(controller.truncateTable('notes', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<void>>(controller.addColumn('notes', { name: 'body', type: 'TEXT' }, { allowWrite: true }))
expectType<Promise<void>>(controller.renameColumn('notes', 'body', 'content', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<void>>(controller.dropColumn('notes', 'body', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<void>>(controller.createIndex('notes', 'notes_body_idx', [{ name: 'body', direction: 'asc' }], { allowWrite: true, unique: true }))
expectType<Promise<void>>(controller.dropIndex('notes', 'notes_body_idx', { allowWrite: true, confirmTable: 'notes' }))
expectType<Promise<SqliteDebugTableArtifact>>(controller.exportTable('notes', { format: 'csv' }))
expectType<Promise<SqliteDebugImportPreview>>(controller.previewTableImport({ format: 'json', bytes: '{}' }))
expectType<Promise<SqliteDebugTableImportResult>>(controller.importTable({ format: 'csv', bytes: '' }, { tableName: 'notes', mode: 'append', allowWrite: true }))
expectType<boolean>(controller.getUndoState().available)
expectType<SqliteDebugUndoState>(controller.getUndoState())
expectType<Promise<void>>(controller.undoLastDestructiveChange())
expectType<Promise<SqliteDebugQueryResult>>(controller.query('SELECT * FROM notes WHERE id = ?', [1]))
expectType<Promise<SqliteDebugExecutionResult>>(controller.execute('DELETE FROM notes WHERE id = ?', [1], { allowWrite: true }))
expectType<Promise<SqliteDebugMigrationStatus>>(controller.getMigrationStatus())
expectType<Promise<void>>(controller.resetDatabase())
expectType<Promise<Uint8Array>>(controller.exportDatabase().then(snapshot => snapshot.bytes))
expectType<Promise<SqliteDebugSnapshotMetadata>>(controller.importDatabase(new Uint8Array(), { replace: true }))
expectType<Promise<void>>(controller.close())
