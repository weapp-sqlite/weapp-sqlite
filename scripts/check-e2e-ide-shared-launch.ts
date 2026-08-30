import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { repositoryRoot } from './acceptance-paths'

const testPaths = [
  path.join(repositoryRoot, 'e2e/ide/sqlite.acceptance.test.ts'),
  path.join(repositoryRoot, 'e2e/ide/sqlite.debug.test.ts'),
]
const reports = []

for (const testPath of testPaths) {
  const source = await readFile(testPath, 'utf8')
  const launcherCount = source.match(/new Launcher\(/g)?.length ?? 0
  if (launcherCount !== 1 || !source.includes('beforeAll') || !source.includes('afterAll')) {
    throw new Error(`${testPath} must share exactly one Launcher at describe scope.`)
  }
  if (!source.includes('reLaunch(\'/pages/index/index\')')) {
    throw new Error(`${testPath} must use reLaunch for page transitions.`)
  }
  reports.push({ file: testPath, launcherCount, shared: true })
}

console.log(JSON.stringify(reports))
