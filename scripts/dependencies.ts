import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
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

interface OutdatedDependency {
  current: string
  dependentPackages: Array<{
    location: string
    name: string
  }>
  latest: string
}

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

async function getOutdatedDependencies(): Promise<Record<string, OutdatedDependency>> {
  const result = await runPnpm(['outdated', '--recursive', '--format', 'json'])

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || `pnpm outdated 执行失败，退出码：${result.exitCode}`)
  }

  return result.stdout === ''
    ? {}
    : JSON.parse(result.stdout) as Record<string, OutdatedDependency>
}

function getDirectDependencies(manifest: PackageManifest): string[] {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ]

  return [...new Set(sections.flatMap(section => Object.entries(section ?? {}))
    .filter(([, specifier]) => !specifier.startsWith('workspace:'))
    .map(([name]) => name))].sort()
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
  const directoriesWithUpgrades = new Set(Object.entries(outdated).flatMap(([dependency, details]) =>
    details.dependentPackages
      .map(dependent => relativePackageLocation(dependent.location))
      .filter(directory => !getPin(directory, dependency)),
  ))

  for (const directory of await getWorkspaceDirectories()) {
    if (!directoriesWithUpgrades.has(directory)) {
      continue
    }

    const manifest = await readManifest(directory)
    const dependencies = getDirectDependencies(manifest)
      .filter(dependency => !getPin(directory, dependency))

    if (dependencies.length === 0) {
      continue
    }

    console.log(`\n更新 ${directory} (${manifest.name})`)
    const result = await runPnpm(['--dir', directory, 'update', '--latest', ...dependencies], true)
    if (result.exitCode !== 0) {
      throw new Error(`更新 ${directory} 失败，退出码：${result.exitCode}`)
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
