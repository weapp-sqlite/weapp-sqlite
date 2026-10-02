import type { SqliteDebugSession, SqliteDebugSessionScope } from '@weapp-sqlite/debug'
import type { DatabaseEntry, RegistryEntry } from './runtime-registry'
import type { OpenSqliteOptions, SqliteRuntimeAdapter } from './types'
import { SqliteDebugError } from '@weapp-sqlite/debug'
import {
  assertActive,
  assertDatabaseName,
  closeActive,
  enqueue,
  ensureActive,
  openPhysicalDatabase,
  registry,
  registryEntry,
} from './runtime-registry'

async function replaceSnapshot(name: string, entry: RegistryEntry, active: DatabaseEntry, bytes: Uint8Array | undefined) {
  const current = assertActive(entry, active)
  await current.flush()
  const previous = await active.adapter.loadSnapshot(name)
  await current.close()
  active.current = undefined
  active.revision++
  try {
    if (bytes === undefined) {
      await active.adapter.remove(name)
    }
    else {
      await active.adapter.saveSnapshot(name, Uint8Array.from(bytes))
    }
    active.current = await openPhysicalDatabase(name, active.adapter, active.migrations, true)
  }
  catch (error) {
    try {
      if (previous === undefined) {
        await active.adapter.remove(name)
      }
      else {
        await active.adapter.saveSnapshot(name, previous)
      }
      active.current = await openPhysicalDatabase(name, active.adapter, active.migrations, true)
    }
    catch (rollbackError) {
      active.failure = new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'Snapshot replacement and recovery both failed. Close and reopen the database to recover.', {
        cause: new AggregateError([error, rollbackError], 'SQLite snapshot replacement recovery failed.'),
      })
      throw active.failure
    }
    throw new SqliteDebugError('SQLITE_DEBUG_IMPORT_FAILED', 'The SQLite replacement failed; the previous snapshot was restored.', { cause: error })
  }
}

export function createSqliteDebugSessionWithAdapter(options: OpenSqliteOptions, defaultAdapter: SqliteRuntimeAdapter): SqliteDebugSession {
  assertDatabaseName(options.name)
  const name = options.name
  let entry: RegistryEntry | undefined
  let active: DatabaseEntry | undefined
  let closed = false

  return {
    runExclusive(operation) {
      entry ??= registryEntry(name)
      const ownedEntry = entry
      return enqueue(name, ownedEntry, async () => {
        if (closed) {
          throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'The debug session is closed.')
        }
        if (!active) {
          const adapter = options.adapter ?? ownedEntry.active?.adapter ?? defaultAdapter
          const migrations = options.migrations ?? ownedEntry.active?.migrations ?? []
          active = await ensureActive(name, ownedEntry, adapter, migrations.map(migration => ({ ...migration })))
          active.debugSessions++
        }
        const owned = active
        assertActive(ownedEntry, owned)
        let scopeActive = true
        function database() {
          if (!scopeActive) {
            throw new SqliteDebugError('SQLITE_DEBUG_DISABLED', 'The debug operation scope is no longer active.')
          }
          return assertActive(ownedEntry, owned)
        }
        const scoped: SqliteDebugSessionScope['database'] = {
          name,
          exec(sql, parameters) {
            const current = database()
            owned.revision++
            return current.exec(sql, parameters)
          },
          query(sql, parameters) { return database().query(sql, parameters) },
          transaction(callback) {
            const current = database()
            owned.revision++
            return current.transaction(callback)
          },
          flush() { return database().flush() },
        }
        try {
          return await operation({
            database: scoped,
            get revision() { return owned.revision },
            async loadSnapshot() {
              await database().flush()
              const bytes = await owned.adapter.loadSnapshot(name)
              return bytes === undefined ? undefined : Uint8Array.from(bytes)
            },
            async replaceSnapshot(bytes) {
              database()
              await replaceSnapshot(name, ownedEntry, owned, bytes)
            },
          })
        }
        finally {
          scopeActive = false
        }
      }).catch((error: unknown) => {
        // Initialization failure may have released this registry entry.
        if (!active && registry.get(name) !== ownedEntry) {
          entry = undefined
        }
        throw error
      })
    },
    async close() {
      if (!entry) {
        closed = true
        return
      }
      const ownedEntry = entry
      await enqueue(name, ownedEntry, async () => {
        if (closed) {
          return
        }
        if (active && !active.closed && active.debugSessions === 1 && !active.ownedByApplication) {
          await closeActive(ownedEntry, active)
        }
        if (active) {
          active.debugSessions--
        }
        closed = true
      })
    },
  }
}
