import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { repositoryRoot } from './acceptance-paths'

async function collectTestPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      paths.push(...await collectTestPaths(entryPath))
    }
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      paths.push(entryPath)
    }
  }
  return paths.sort()
}

const testPaths = await collectTestPaths(path.join(repositoryRoot, 'e2e/ide'))
const reports = []

for (const testPath of testPaths) {
  const source = await readFile(testPath, 'utf8')
  if (!source.includes('@weapp-vite/miniprogram-automator') && !source.includes('new Launcher(')) {
    continue
  }
  const launcherCount = source.match(/new Launcher\(/g)?.length ?? 0
  if (launcherCount !== 1 || !source.includes('beforeAll') || !source.includes('afterAll')) {
    throw new Error(`${testPath} must share exactly one Launcher at describe scope.`)
  }
  const afterAllStart = source.indexOf('afterAll')
  const firstTestStart = source.indexOf('\nit(', afterAllStart)
  const teardown = source.slice(afterAllStart, firstTestStart === -1 ? undefined : firstTestStart)
  if (!teardown.includes('disconnect(')) {
    throw new Error(`${testPath} must disconnect the automator transport during teardown.`)
  }
  const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  if (/miniProgram\??\.(?:close|quit)\s*\(/.test(executableSource) || /Tool\.close|closeIde/.test(executableSource)) {
    throw new Error(`${testPath} must not close the user's DevTools session; use disconnect() instead.`)
  }
  if (!source.includes('reLaunch(\'/pages/index/index\')')) {
    throw new Error(`${testPath} must use reLaunch for page transitions.`)
  }
  reports.push({ file: testPath, launcherCount, shared: true })
}

console.log(JSON.stringify(reports))
