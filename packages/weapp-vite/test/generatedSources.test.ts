import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { ensureGeneratedDirectory, ownGeneratedSources } from '@/plugin/generatedSources'

describe('generated source ownership', () => {
  it.each([false, true])('keeps one active owner after concurrent claims with previous owner: %s', async (hasPrevious) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sqlite-concurrent-owner-'))
    const marker = 'test-only-generated-source-owner\n'
    const owners: Awaited<ReturnType<typeof ownGeneratedSources>>[] = []
    const baseline = process.listenerCount('exit')
    try {
      await ensureGeneratedDirectory(directory, marker)
      const source = path.join(directory, 'runtime.ts')
      await writeFile(source, 'export const active = true\n')
      if (hasPrevious) {
        owners.push(await ownGeneratedSources(directory, [directory], marker))
      }
      owners.push(...await Promise.all([
        ownGeneratedSources(directory, [directory], marker),
        ownGeneratedSources(directory, [directory], marker),
        ownGeneratedSources(directory, [directory], marker),
      ]))
      expect(process.listenerCount('exit')).toBe(baseline + 1)
      for (const owner of owners.slice(0, -1)) {
        await owner.cleanup()
        await expect(readFile(source, 'utf8')).resolves.toBe('export const active = true\n')
      }
      await owners.at(-1)!.cleanup()
      await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(process.listenerCount('exit')).toBe(baseline)
    }
    finally {
      for (const owner of owners) {
        owner.detach()
      }
      await rm(directory, { recursive: true, force: true })
    }
  })
})
