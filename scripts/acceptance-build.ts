import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { acceptanceArtifactRoot, demoRoot, repositoryRoot } from './acceptance-paths'

const packageBuilds = [
  '@weapp-sqlite/core',
  '@weapp-sqlite/wasm',
  '@weapp-sqlite/sqljs',
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
  const asset = 'sql-wasm-lite.wasm'
  const wasmCandidates = [
    path.join(targetRoot, 'assets', asset),
    path.join(targetRoot, 'dist/assets', asset),
    path.join(targetRoot, 'dist/__weapp_sqlite__/assets', asset),
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
}

const weappMainPackage = path.join(demoRoot, 'dist/weapp/dist')
const appJson = JSON.parse(await readFile(path.join(weappMainPackage, 'app.json'), 'utf8')) as {
  subPackages?: Array<{ root: string }>
}
const sqliteSubpackageRoot = appJson.subPackages?.find(item => item.root === '__weapp_sqlite__')?.root
if (!sqliteSubpackageRoot) {
  throw new Error('The generated SQLite WeChat subpackage is missing from app.json.')
}
const sqliteSubpackagePath = path.join(weappMainPackage, sqliteSubpackageRoot)
const sqliteSubpackageBytes = await directoryBytes(sqliteSubpackagePath)
const maximumSubpackageBytes = 2 * 1024 * 1024
if (sqliteSubpackageBytes > maximumSubpackageBytes) {
  throw new Error(`SQLite WeChat subpackage exceeds 2 MiB: ${sqliteSubpackageBytes} bytes.`)
}

let weappMainPackageBytes = 0
for (const entry of await readdir(weappMainPackage, { withFileTypes: true })) {
  if (entry.name === sqliteSubpackageRoot) {
    continue
  }
  const entryPath = path.join(weappMainPackage, entry.name)
  weappMainPackageBytes += entry.isDirectory() ? await directoryBytes(entryPath) : (await stat(entryPath)).size
}
const maximumMainPackageBytes = 128 * 1024
if (weappMainPackageBytes > maximumMainPackageBytes) {
  throw new Error(`WeChat main package exceeds 128 KiB: ${weappMainPackageBytes} bytes.`)
}
const mainPackageFiles = await readdir(weappMainPackage, { recursive: true, withFileTypes: true })
for (const entry of mainPackageFiles) {
  const relative = path.relative(weappMainPackage, path.join(entry.parentPath, entry.name))
  if (relative === sqliteSubpackageRoot || relative.startsWith(`${sqliteSubpackageRoot}${path.sep}`)) {
    continue
  }
  if (entry.isFile() && (entry.name.endsWith('.wasm') || /sql(?:ite)?[.-].*\.js$/i.test(entry.name))) {
    throw new Error(`WeChat main package contains a SQLite engine asset: ${relative}`)
  }
}

const { commit } = await acceptanceArtifactRoot()
console.log(JSON.stringify({ commit, targets, weappMainPackageBytes, sqliteSubpackageBytes }))
