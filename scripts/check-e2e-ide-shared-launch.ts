import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { repositoryRoot } from './acceptance-paths'

const testPath = path.join(repositoryRoot, 'e2e/ide/sqlite.acceptance.test.ts')
const source = await readFile(testPath, 'utf8')
const launcherCount = source.match(/new Launcher\(/g)?.length ?? 0

if (launcherCount !== 1 || !source.includes('beforeAll') || !source.includes('afterAll')) {
  throw new Error('The DevTools acceptance suite must share exactly one Launcher at describe scope.')
}
if (!source.includes('reLaunch(\'/pages/index/index\')')) {
  throw new Error('The DevTools acceptance suite must use reLaunch for page transitions.')
}

console.log(JSON.stringify({ file: testPath, launcherCount, shared: true }))
