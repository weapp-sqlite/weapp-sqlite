import type { SqliteAppliedMigration, SqliteConnection, SqliteDatabase, SqliteExecResult, SqliteMigration, SqliteMigrationConflict, SqliteMigrationInfo, SqliteMigrationStatus, SqliteParameters, SqliteQueryResult, SqliteRow, SqliteTransaction } from '..'
import { expectAssignable, expectType } from 'tsd'
import { execMany, getMigrationStatus, migrate } from '..'

const transaction = {
  exec: async () => ({ changes: 1 }),
  query: async <Row extends SqliteRow>(): Promise<SqliteQueryResult<Row>> => ({ columns: [], rows: [] }),
}
const connection = { ...transaction, close: async () => {} }
const database = {
  ...connection,
  name: 'legacy',
  flush: async () => {},
  transaction: async <T>(callback: (transaction: SqliteTransaction) => Promise<T>) => callback(transaction),
}
expectAssignable<SqliteTransaction>(transaction)
expectAssignable<SqliteConnection>(connection)
expectAssignable<SqliteDatabase>(database)

const parameterSets: readonly SqliteParameters[] = [[1, 'first'], { $id: 2, $name: 'second' }] as const
expectType<Promise<readonly SqliteExecResult[]>>(execMany(database, 'INSERT INTO items VALUES (?, ?)', parameterSets))
expectType<Promise<readonly SqliteExecResult[]>>(execMany(transaction, 'INSERT INTO items VALUES (?, ?)', [[1, 'first']] as const))
expectType<Promise<SqliteMigrationStatus>>(getMigrationStatus(database))
expectType<Promise<SqliteMigrationStatus>>(getMigrationStatus(database, [] as readonly SqliteMigration[]))
expectType<Promise<number[]>>(migrate(database, [] as readonly SqliteMigration[]))
expectType<boolean>({} as SqliteMigrationStatus['tablePresent'])
expectType<readonly SqliteAppliedMigration[]>({} as SqliteMigrationStatus['applied'])
expectType<readonly SqliteMigrationInfo[]>({} as SqliteMigrationStatus['pending'])
expectType<readonly SqliteAppliedMigration[]>({} as SqliteMigrationStatus['unknown'])
expectType<readonly SqliteMigrationConflict[]>({} as SqliteMigrationStatus['conflicts'])
