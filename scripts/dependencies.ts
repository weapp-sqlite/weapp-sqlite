import { spawn } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { dependencyPins } from './dependency-policy'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface OutdatedDependent {
  location: string
  name: string
  specifier: string
}

interface OutdatedDependency {
  current: string
  dependentPackages: OutdatedDependent[]
  latest: string
}

type SpecifierKind = 'alias' | 'exact' | 'range' | 'workspace'

interface CommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const workspaceGroups = ['apps', 'examples', 'packages']

function runPnpm(args: string[], inheritOutput = false): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: repositoryRoot,
      stdio: inheritOutput ? 'inherit' : 'pipe',
    })
    const stdout: string[] = []
    const stderr: string[] = []

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => stdout.push(chunk as string))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => stderr.push(chunk as string))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stderr: stderr.join(''),
        stdout: stdout.join(''),
      })
    })
  })
}

async function getWorkspaceDirectories(): Promise<string[]> {
  const directories = ['.']

  for (const group of workspaceGroups) {
    const entries = await readdir(path.join(repositoryRoot, group), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        directories.push(`${group}/${entry.name}`)
      }
    }
  }

  return directories.sort()
}

async function readManifest(directory: string): Promise<PackageManifest> {
  const source = await readFile(path.join(repositoryRoot, directory, 'package.json'), 'utf8')
  return JSON.parse(source) as PackageManifest
}

function findDeclaredDependency(
  declared: Record<string, string>,
  reportedName: string,
): { name: string, specifier: string } | undefined {
  const specifier = declared[reportedName]
  if (specifier) {
    return { name: reportedName, specifier }
  }

  for (const [name, aliasSpecifier] of Object.entries(declared)) {
    if (aliasSpecifier.startsWith(`npm:${reportedName}@`)) {
      return { name, specifier: aliasSpecifier }
    }
  }

  return undefined
}

function classifySpecifier(specifier: string): SpecifierKind {
  if (specifier.startsWith('workspace:')) {
    return 'workspace'
  }
  if (specifier.startsWith('^') || specifier.startsWith('~')) {
    return 'range'
  }
  if (specifier.startsWith('npm:')) {
    return 'alias'
  }
  return 'exact'
}

async function getOutdatedDependencies(): Promise<Record<string, OutdatedDependency>> {
  const outdated: Record<string, OutdatedDependency> = {}
  for (const directory of await getWorkspaceDirectories()) {
    const result = await runPnpm(['--dir', directory, 'outdated', '--format', 'json'])
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr || `pnpm outdated 执行失败（${directory}），退出码：${result.exitCode}`)
    }
    if (result.stdout.trim() === '') {
      continue
    }
    let report: Record<string, { current?: string, latest?: string }>
    try {
      report = JSON.parse(result.stdout) as Record<string, { current?: string, latest?: string }>
    }
    catch (error) {
      throw new Error(`无法解析 pnpm outdated 输出（${directory}）`, { cause: error })
    }
    const manifest = await readManifest(directory)
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    }
    for (const [dependency, details] of Object.entries(report)) {
      if (!details.current || !details.latest || details.current === details.latest) {
        continue
      }
      const declaredDependency = findDeclaredDependency(declared, dependency)
      if (!declaredDependency || classifySpecifier(declaredDependency.specifier) === 'workspace') {
        continue
      }
      const entry = outdated[declaredDependency.name] ??= { current: details.current, latest: details.latest, dependentPackages: [] }
      entry.dependentPackages.push({
        location: path.resolve(repositoryRoot, directory),
        name: declaredDependency.name,
        specifier: declaredDependency.specifier,
      })
      entry.current = details.current
      entry.latest = details.latest
    }
  }
  return outdated
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nextExactSpecifier(specifier: string, current: string, latest: string): string | undefined {
  const kind = classifySpecifier(specifier)
  if (kind === 'alias' && specifier.endsWith(`@${current}`)) {
    return `${specifier.slice(0, -current.length)}${latest}`
  }
  if (kind === 'exact' && specifier === current) {
    return latest
  }
  return undefined
}

function replaceDependencySpecifier(source: string, name: string, from: string, to: string): string {
  const pattern = new RegExp(`("${escapeRegExp(name)}":\\s*")${escapeRegExp(from)}(")`)
  const next = source.replace(pattern, `$1${to}$2`)
  if (next === source) {
    throw new Error(`未能在 package.json 中将 ${name} 从 ${from} 更新为 ${to}`)
  }
  return next
}

function getPin(directory: string, dependency: string) {
  return dependencyPins[directory]?.find(pin => pin.name === dependency)
}

function relativePackageLocation(location: string): string {
  const relative = path.relative(repositoryRoot, location)
  return relative === '' ? '.' : relative
}

function reportOutdatedDependencies(outdated: Record<string, OutdatedDependency>): void {
  const upgrades: string[] = []
  const held: string[] = []

  for (const [dependency, details] of Object.entries(outdated).sort(([left], [right]) => left.localeCompare(right))) {
    for (const dependent of details.dependentPackages) {
      const directory = relativePackageLocation(dependent.location)
      const pin = getPin(directory, dependency)
      const summary = `${directory}: ${dependency} ${details.current} -> ${details.latest}`
      if (pin) {
        held.push(`${summary} (${pin.reason})`)
      }
      else {
        upgrades.push(summary)
      }
    }
  }

  console.log('可升级依赖：')
  console.log(upgrades.length === 0 ? '  无' : upgrades.map(item => `  - ${item}`).join('\n'))
  console.log('\n受兼容策略保护：')
  console.log(held.length === 0 ? '  无' : held.map(item => `  - ${item}`).join('\n'))
}

async function updateDependencies(): Promise<void> {
  const outdated = await getOutdatedDependencies()
  const upgradesByDirectory = new Map<string, OutdatedDependent[]>()
  let rewrittenExactSpecifier = false

  for (const [dependency, details] of Object.entries(outdated)) {
    for (const dependent of details.dependentPackages) {
      const directory = relativePackageLocation(dependent.location)
      if (getPin(directory, dependency)) {
        continue
      }
      const upgrades = upgradesByDirectory.get(directory) ?? []
      upgrades.push(dependent)
      upgradesByDirectory.set(directory, upgrades)
    }
  }

  for (const directory of [...upgradesByDirectory.keys()].sort()) {
    const manifest = await readManifest(directory)
    const upgrades = upgradesByDirectory.get(directory) ?? []
    const rangeDependencies = upgrades
      .filter(dependent => classifySpecifier(dependent.specifier) === 'range')
      .map(dependent => dependent.name)
    const exactUpgrades = upgrades.filter(dependent => classifySpecifier(dependent.specifier) !== 'range')

    console.log(`\n更新 ${directory} (${manifest.name})`)

    if (rangeDependencies.length > 0) {
      const result = await runPnpm(['--dir', directory, 'update', '--latest', ...rangeDependencies], true)
      if (result.exitCode !== 0) {
        throw new Error(`更新 ${directory} 失败，退出码：${result.exitCode}`)
      }
    }

    if (exactUpgrades.length === 0) {
      continue
    }

    const manifestPath = path.join(repositoryRoot, directory, 'package.json')
    let source = await readFile(manifestPath, 'utf8')
    for (const dependent of exactUpgrades) {
      const details = outdated[dependent.name]
      if (!details) {
        throw new Error(`找不到 ${directory} 中 ${dependent.name} 的过期信息`)
      }
      const nextSpecifier = nextExactSpecifier(dependent.specifier, details.current, details.latest)
      if (!nextSpecifier) {
        throw new Error(`无法在保持原范围的前提下更新 ${directory} 的 ${dependent.name}（${dependent.specifier}）`)
      }
      source = replaceDependencySpecifier(source, dependent.name, dependent.specifier, nextSpecifier)
      console.log(`  ${dependent.name} ${dependent.specifier} -> ${nextSpecifier}`)
    }
    await writeFile(manifestPath, source)
    rewrittenExactSpecifier = true
  }

  if (rewrittenExactSpecifier) {
    const result = await runPnpm(['install'], true)
    if (result.exitCode !== 0) {
      throw new Error(`刷新 pnpm-lock.yaml 失败，退出码：${result.exitCode}`)
    }
  }
}

const command = process.argv[2] ?? 'check'

if (command === 'check') {
  reportOutdatedDependencies(await getOutdatedDependencies())
}
else if (command === 'update') {
  await updateDependencies()
  reportOutdatedDependencies(await getOutdatedDependencies())
}
else {
  throw new Error(`未知命令：${command}。可用命令：check、update`)
}
