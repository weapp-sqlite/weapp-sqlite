import { createSqliteDebugController } from '@weapp-sqlite/debug'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import { acceptanceOptions } from './sqlite'

export async function createPlatformSqliteDebugController() {
  const { host, options } = await acceptanceOptions()
  return createSqliteDebugController({
    databaseName: options.databaseName,
    openDatabase: () => openSqliteWasmDatabase(host.initializer, options.databaseName, {
      storage: host.storage,
      locateFile: options.locateFile,
    }),
    storage: host.storage,
    enabled: true,
    runtime: Object.fromEntries(Object.entries(host.environment).filter(([, value]) => value !== undefined)),
  })
}

export async function getPlatformSqliteDebugFilePath() {
  const { host, options } = await acceptanceOptions()
  const storage = host.storage as typeof host.storage & { getDatabasePath?: (name: string) => string }
  return storage.getDatabasePath?.(options.databaseName)
}
