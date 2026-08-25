import { createMemoryStorage, createStringStorage, runSqliteDemo } from '../src'

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
})
