import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly private?: boolean
  readonly author?: string
  readonly homepage?: string
  readonly repository?: {
    readonly type?: string
    readonly url?: string
    readonly directory?: string
  }
  readonly bugs?: {
    readonly url?: string
  }
  readonly engines?: {
    readonly node?: string
  }
  readonly files?: readonly string[]
  readonly main?: string
  readonly module?: string
  readonly types?: string
  readonly exports?: unknown
  readonly publishConfig?: {
    readonly access?: string
    readonly registry?: string
  }
}

interface PackedFile {
  readonly path: string
}

interface PackResult {
  readonly name: string
  readonly version: string
  readonly files: readonly PackedFile[]
}

function normalizePackResult(value: PackResult | readonly PackResult[]): PackResult | undefined {
  if (Array.isArray(value)) {
    return value[0] as PackResult | undefined
  }
  return value as PackResult
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFileAsync = promisify(execFile)
const releaseMode = process.argv.includes('--release')
const repositoryUrl = 'git+https://github.com/weapp-sqlite/weapp-sqlite.git'
const homepage = 'https://github.com/weapp-sqlite/weapp-sqlite#readme'
const bugsUrl = 'https://github.com/weapp-sqlite/weapp-sqlite/issues'
const registry = 'https://registry.npmjs.org/'
const publicPackages = new Map([
  ['packages/core', '@weapp-sqlite/core'],
  ['packages/wasm', '@weapp-sqlite/wasm'],
  ['packages/sqljs', '@weapp-sqlite/sqljs'],
  ['packages/web', '@weapp-sqlite/web'],
  ['packages/miniprogram', '@weapp-sqlite/miniprogram'],
  ['packages/debug', '@weapp-sqlite/debug'],
  ['packages/weapp-vite', '@weapp-sqlite/weapp-vite'],
])

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function readManifest(directory: string) {
  const path = resolve(workspaceRoot, directory, 'package.json')
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function collectDistEntries(value: unknown, entries = new Set<string>()) {
  if (typeof value === 'string' && value.startsWith('./dist/')) {
    entries.add(value.slice(2))
  }
  else if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectDistEntries(nestedValue, entries)
    }
  }
  return entries
}

async function listWorkspacePackageDirectories(parent: string) {
  const parentPath = resolve(workspaceRoot, parent)
  const entries = await readdir(parentPath, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => `${parent}/${entry.name}`)
}

async function checkPrivateWorkspaces() {
  const directories = [
    '.',
    ...await listWorkspacePackageDirectories('apps'),
    ...await listWorkspacePackageDirectories('examples'),
  ]
  for (const directory of directories) {
    const manifest = await readManifest(directory)
    invariant(manifest.private === true, `${directory}/package.json must remain private.`)
  }
}

async function checkPublicPackage(directory: string, expectedName: string) {
  const manifest = await readManifest(directory)
  invariant(manifest.name === expectedName, `${directory} must be named ${expectedName}.`)
  invariant(manifest.private !== true, `${expectedName} must be publishable.`)
  invariant(manifest.version !== undefined, `${expectedName} must declare a version.`)
  if (releaseMode) {
    invariant(manifest.version !== '0.0.0', `${expectedName} must be versioned before publishing.`)
    invariant(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(manifest.version), `${expectedName} has an invalid release version.`)
  }
  invariant(manifest.author === 'weapp-sqlite contributors', `${expectedName} has invalid author metadata.`)
  invariant(manifest.homepage === homepage, `${expectedName} has invalid homepage metadata.`)
  invariant(manifest.repository?.type === 'git', `${expectedName} must use a git repository.`)
  invariant(manifest.repository.url === repositoryUrl, `${expectedName} has invalid repository metadata.`)
  invariant(manifest.repository.directory === directory, `${expectedName} has invalid repository directory metadata.`)
  invariant(manifest.bugs?.url === bugsUrl, `${expectedName} has invalid bugs metadata.`)
  invariant(Boolean(manifest.engines?.node), `${expectedName} must declare its Node.js engine range.`)
  invariant(manifest.publishConfig?.access === 'public', `${expectedName} must publish with public access.`)
  invariant(manifest.publishConfig.registry === registry, `${expectedName} must publish to the npm registry.`)
  invariant(manifest.files?.length === 1 && manifest.files[0] === 'dist', `${expectedName} must only declare dist in files.`)

  const outputEntries = collectDistEntries({
    exports: manifest.exports,
    main: manifest.main,
    module: manifest.module,
    types: manifest.types,
  })
  invariant(outputEntries.size > 0, `${expectedName} does not expose any dist entries.`)
  for (const entry of outputEntries) {
    await access(resolve(workspaceRoot, directory, entry))
  }

  const { stdout } = await execFileAsync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: resolve(workspaceRoot, directory),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const parsedPackResult = JSON.parse(stdout) as PackResult | readonly PackResult[]
  const packResult = normalizePackResult(parsedPackResult)
  invariant(packResult?.name === expectedName, `${expectedName} dry-run returned an unexpected package.`)
  invariant(packResult.version === manifest.version, `${expectedName} dry-run returned an unexpected version.`)

  const packedFiles = new Set(packResult.files.map(file => file.path))
  for (const requiredFile of ['LICENSE', 'README.md', 'package.json']) {
    invariant(packedFiles.has(requiredFile), `${expectedName} tarball is missing ${requiredFile}.`)
  }
  for (const entry of outputEntries) {
    invariant(packedFiles.has(entry), `${expectedName} tarball is missing ${entry}.`)
  }
  const allowedRootFiles = new Set(['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json'])
  for (const file of packedFiles) {
    invariant(file.startsWith('dist/') || allowedRootFiles.has(file), `${expectedName} tarball contains unexpected file ${file}.`)
  }

  return {
    name: expectedName,
    version: manifest.version,
    files: packedFiles.size,
  }
}

await checkPrivateWorkspaces()
const packageDirectories = await listWorkspacePackageDirectories('packages')
invariant(packageDirectories.length === publicPackages.size, 'packages/ contains an unexpected package directory.')
for (const directory of packageDirectories) {
  invariant(publicPackages.has(directory), `${directory} is not in the public package allowlist.`)
}

const results = []
for (const [directory, name] of publicPackages) {
  results.push(await checkPublicPackage(directory, name))
}

console.log(JSON.stringify({ releaseMode, packages: results }))
