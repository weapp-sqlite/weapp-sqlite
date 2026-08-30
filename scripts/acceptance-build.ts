import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { acceptanceArtifactRoot, demoRoot, repositoryRoot } from './acceptance-paths'

const packageBuilds = [
  '@weapp-sqlite/core',
  '@weapp-sqlite/wasm',
  '@weapp-sqlite/web',
  '@weapp-sqlite/miniprogram',
  '@weapp-sqlite/debug',
  '@weapp-sqlite/weapp-vite',
]
const targets = ['web', 'weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs'] as const

async function runPnpm(args: string[]) {
  await execa('pnpm', args, { cwd: repositoryRoot, stdio: 'inherit' })
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    total += entry.isDirectory() ? await directoryBytes(entryPath) : (await stat(entryPath)).size
  }
  return total
}

for (const packageName of packageBuilds) {
  await runPnpm(['--filter', packageName, 'build'])
}
for (const target of targets) {
  await runPnpm(['--filter', 'weapp-sqlite-demo-weapp-vite', `build:${target}`])
}

for (const target of targets) {
  const output = path.join(demoRoot, 'dist', target)
  const files: string[] = []
  async function collect(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await collect(entryPath)
      }
      else { files.push(entryPath) }
    }
  }
  await collect(output)
  for (const file of files.filter(file => /\.(?:js|wxml|html|css|wxss)$/.test(file))) {
    const content = await readFile(file, 'utf8')
    if (/__weapp_sqlite_debug|SQLite 数据工作台|debug-sql|createSqliteDebugController|createSqliteDebugWorkspacePage|SQLITE_DEBUG_|saveFileToDisk|shareFileMessage|chooseMessageFile/.test(content)) {
      throw new Error(`Production ${target} output contains SQLite debug capability: ${file}`)
    }
  }
}

for (const target of targets) {
  const targetRoot = path.join(demoRoot, 'dist', target)
  await access(targetRoot)
  const asset = target === 'web' ? 'sql-wasm-browser.wasm' : 'sql-wasm.wasm'
  const wasmCandidates = [
    path.join(targetRoot, 'assets', asset),
    path.join(targetRoot, 'dist/assets', asset),
  ]
  let wasmFound = false
  for (const candidate of wasmCandidates) {
    try {
      await access(candidate)
      wasmFound = true
      break
    }
    catch {}
  }
  if (!wasmFound) {
    throw new Error(`Missing ${asset} in the ${target} build output.`)
  }

  const unexpectedAsset = target === 'web' ? 'sql-wasm.wasm' : 'sql-wasm-browser.wasm'
  const unexpectedCandidates = [
    path.join(targetRoot, 'assets', unexpectedAsset),
    path.join(targetRoot, 'dist/assets', unexpectedAsset),
  ]
  for (const candidate of unexpectedCandidates) {
    try {
      await access(candidate)
      throw new Error(`Unexpected ${unexpectedAsset} in the ${target} build output.`)
    }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Unexpected ')) {
        throw error
      }
    }
  }
}

const weappMainPackage = path.join(demoRoot, 'dist/weapp/dist')
const bytes = await directoryBytes(weappMainPackage)
const maximumBytes = 2 * 1024 * 1024
if (bytes > maximumBytes) {
  throw new Error(`WeChat main package exceeds 2 MiB: ${bytes} bytes.`)
}

const { commit } = await acceptanceArtifactRoot()
console.log(JSON.stringify({ commit, targets, weappMainPackageBytes: bytes }))
