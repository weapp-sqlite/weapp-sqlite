import initSqlJs from '@weapp-sqlite/sqljs/full'
import { resolveSqliteWasmAsset } from '@weapp-sqlite/sqljs/node'
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import { createSqliteDebugController } from '@/index'

function createHarness() {
  const files = new Map<string, Uint8Array>()
  const storage = {
    load: async (name: string) => files.get(name),
    save: async (name: string, bytes: Uint8Array) => { files.set(name, Uint8Array.from(bytes)) },
    remove: async (name: string) => { files.delete(name) },
  }
  const openDatabase = () => openSqliteWasmDatabase(
    options => initSqlJs(options?.locateFile ? { locateFile: options.locateFile } : undefined),
    'performance-test',
    {
      storage,
      locateFile: () => resolveSqliteWasmAsset('full', 'miniprogram'),
    },
  )
  return { openDatabase, storage }
}

describe('query performance diagnostics', () => {
  it('reports index usage and full scans from bound SELECT plans', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({
      databaseName: 'performance-test',
      openDatabase: harness.openDatabase,
      storage: harness.storage,
      enabled: true,
    })
    try {
      await controller.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)', undefined, { allowWrite: true })
      await controller.execute('CREATE INDEX notes_body_idx ON notes(body)', undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes (body) VALUES (?), (?)', ['one', 'two'], { allowWrite: true })

      const indexed = await controller.analyzeQuery('SELECT id FROM notes WHERE body = ?', ['one'])
      expect(indexed.diagnostics.indexes).toContain('notes_body_idx')
      expect(indexed.diagnostics.fullTableScan).toBe(false)
      expect(indexed.nodes.some(node => node.kind === 'search')).toBe(true)

      const scanned = await controller.analyzeQuery('SELECT id FROM notes WHERE id + 0 = ?', [1])
      expect(scanned.diagnostics.fullTableScan).toBe(true)
      expect(scanned.diagnostics.warnings).toContain('full-table-scan')
    }
    finally {
      await controller.close()
    }
  })

  it('reports temporary B-trees without executing the SELECT', async () => {
    const harness = createHarness()
    const controller = createSqliteDebugController({
      databaseName: 'performance-test',
      openDatabase: harness.openDatabase,
      storage: harness.storage,
      enabled: true,
    })
    try {
      await controller.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)', undefined, { allowWrite: true })
      await controller.execute('INSERT INTO notes (body) VALUES (?), (?)', ['one', 'two'], { allowWrite: true })
      const analysis = await controller.analyzeQuery('SELECT id FROM notes ORDER BY body')
      expect(analysis.diagnostics.temporaryBTree).toBe(true)
      expect(analysis.diagnostics.warnings).toContain('temporary-b-tree')
      await expect(controller.query('SELECT count(*) AS total FROM notes')).resolves.toMatchObject({ rows: [{ total: 2 }] })
    }
    finally {
      await controller.close()
    }
  })
})
