import type { AcceptanceSqliteStorage } from '../src'
import {
  createMemoryStorage,
  createStringStorage,
  resetSqliteAcceptance,
  runSqliteAcceptance,
  runSqliteDemo,
  verifySqliteAcceptance,
} from '../src'

describe('shared framework demo service', () => {
  it('runs migrations and persists the result through injected storage', async () => {
    const values = new Map<string, string>()
    const storage = createStringStorage({
      load: async name => values.get(name),
      save: async (name, value) => {
        values.set(name, value)
      },
    })

    await expect(runSqliteDemo({ storage })).resolves.toEqual({
      migrationVersions: [1, 2],
      rows: [{ id: 1, body: 'SQLite works across frameworks' }],
    })
    expect(values.get('weapp-sqlite-demo')).toBeTruthy()
  })

  it('provides a reusable memory storage for demos without a host API', async () => {
    await expect(runSqliteDemo({ storage: createMemoryStorage() })).resolves.toMatchObject({
      migrationVersions: [1, 2],
    })
  })

  it('verifies migration, transactions, and persisted reopen state', async () => {
    const files = new Map<string, Uint8Array>()
    const storage: AcceptanceSqliteStorage = {
      load: async name => files.get(name),
      save: async (name, data) => {
        files.set(name, Uint8Array.from(data))
      },
      remove: async (name) => {
        files.delete(name)
      },
    }
    const options = { storage, databaseName: 'acceptance-test' }

    await resetSqliteAcceptance(options)
    await expect(runSqliteAcceptance(options)).resolves.toMatchObject({ passed: true, migrationVersions: [1, 2] })
    await expect(verifySqliteAcceptance(options)).resolves.toMatchObject({ passed: true, migrationVersions: [1, 2] })
  })
})
