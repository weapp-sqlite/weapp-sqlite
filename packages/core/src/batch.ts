import type { SqliteDatabase, SqliteExecResult, SqliteParameters, SqliteTransaction } from './types'

/** Executes a batch atomically, or participates in the supplied transaction. */
export async function execMany(
  target: SqliteDatabase | SqliteTransaction,
  sql: string,
  parameterSets: readonly SqliteParameters[],
): Promise<readonly SqliteExecResult[]> {
  if (parameterSets.length === 0) {
    return []
  }

  async function execute(transaction: SqliteTransaction) {
    const results: SqliteExecResult[] = []
    for (const parameters of parameterSets) {
      results.push(await transaction.exec(sql, parameters))
    }
    return results
  }

  return 'transaction' in target ? target.transaction(execute) : execute(target)
}
