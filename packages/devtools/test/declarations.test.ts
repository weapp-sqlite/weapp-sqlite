import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function runNode(args: string[], cwd: string) {
  try {
    return await execFileAsync(process.execPath, args, { cwd })
  }
  catch (error) {
    const failure = error as Error & { stdout?: string, stderr?: string }
    throw new Error([failure.message, `Working directory: ${cwd}`, failure.stdout, failure.stderr].filter(Boolean).join('\n'), { cause: error })
  }
}

it('preserves Devframe definitions and RPC augmentation for real CJS and ESM consumers', async () => {
  const consumer = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-devtools-types-'))
  try {
    const installedPackage = path.join(consumer, 'node_modules/@weapp-sqlite/devtools')
    await mkdir(installedPackage, { recursive: true })
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    const packageJson = await readFile(path.join(packageRoot, 'package.json'), 'utf8')
    await writeFile(path.join(installedPackage, 'package.json'), packageJson)
    const { dependencies } = JSON.parse(packageJson) as { dependencies: Record<string, string> }
    // Flatten the package links before crossing a Windows drive boundary;
    // junctions for a whole node_modules directory lose relative workspace links.
    for (const name of Object.keys(dependencies)) {
      const target = await realpath(path.join(packageRoot, 'node_modules', name))
      const installedDependency = path.join(installedPackage, 'node_modules', name)
      await mkdir(path.dirname(installedDependency), { recursive: true })
      await symlink(target, installedDependency, 'junction')
      const manifest = JSON.parse(await readFile(path.join(installedDependency, 'package.json'), 'utf8')) as { name: string }
      expect(manifest.name).toBe(name)
      expect(await realpath(installedDependency)).toBe(target)
    }
    await symlink(await realpath(path.join(packageRoot, 'node_modules/devframe')), path.join(consumer, 'node_modules/devframe'), 'junction')
    expect(await realpath(path.join(consumer, 'node_modules/devframe'))).toBe(await realpath(path.join(installedPackage, 'node_modules/devframe')))
    const installedTypes = path.join(consumer, 'node_modules/@types')
    await mkdir(installedTypes)
    // Resolve pnpm's package link before exposing it to the consumer, including
    // when the temporary directory is on another Windows drive.
    await symlink(await realpath(path.join(workspaceRoot, 'node_modules/@types/node')), path.join(installedTypes, 'node'), 'junction')
    const consumerRequire = createRequire(path.join(consumer, 'package.json'))
    const nodeTypesPackage = consumerRequire.resolve('@types/node/package.json')
    await readFile(path.join(path.dirname(nodeTypesPackage), 'index.d.ts'), 'utf8')
    await runNode([require.resolve('tsdown/run'), '--out-dir', path.join(installedPackage, 'dist'), '--log-level', 'silent'], packageRoot)
    await Promise.all(['index.d.cts', 'index.d.mts', 'devframe.d.cts', 'devframe-rpc.d.mts'].map(file => readFile(path.join(installedPackage, 'dist', file), 'utf8')))
    const source = await readFile(path.join(packageRoot, 'test-d/consumer.cts'), 'utf8')
    await writeFile(path.join(consumer, 'consumer.cts'), source)
    await writeFile(path.join(consumer, 'consumer.mts'), source)
    // Node16 retains the strict ESM/CJS declaration boundary on newer TypeScript
    // versions, matching NodeNext consumers on TypeScript 5.6.
    const result = await runNode([require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'node16', '--target', 'es2022', '--types', 'node', 'consumer.cts', 'consumer.mts'], consumer)
    expect(result.stdout).toBe('')
  }
  finally {
    await rm(consumer, { recursive: true, force: true })
  }
}, 30_000)
