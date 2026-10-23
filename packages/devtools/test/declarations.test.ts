import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
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

it('preserves Devframe definitions and RPC augmentation for real CJS and ESM consumers', async () => {
  const consumer = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-devtools-types-'))
  try {
    const installedPackage = path.join(consumer, 'node_modules/@weapp-sqlite/devtools')
    await mkdir(installedPackage, { recursive: true })
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    await copyFile(path.join(packageRoot, 'package.json'), path.join(installedPackage, 'package.json'))
    await symlink(path.join(packageRoot, 'node_modules'), path.join(installedPackage, 'node_modules'), 'junction')
    await symlink(await realpath(path.join(packageRoot, 'node_modules/devframe')), path.join(consumer, 'node_modules/devframe'), 'junction')
    await symlink(path.join(workspaceRoot, 'node_modules/@types'), path.join(consumer, 'node_modules/@types'), 'junction')
    await execFileAsync(process.execPath, [require.resolve('tsdown/run'), '--out-dir', path.join(installedPackage, 'dist'), '--log-level', 'silent'], { cwd: packageRoot })
    const source = await readFile(path.join(packageRoot, 'test-d/consumer.cts'), 'utf8')
    await writeFile(path.join(consumer, 'consumer.cts'), source)
    await writeFile(path.join(consumer, 'consumer.mts'), source)
    // Node16 retains the strict ESM/CJS declaration boundary on newer TypeScript
    // versions, matching NodeNext consumers on TypeScript 5.6.
    const result = await execFileAsync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'node16', '--target', 'es2022', '--types', 'node', 'consumer.cts', 'consumer.mts'], { cwd: consumer })
    expect(result.stdout).toBe('')
  }
  finally {
    await rm(consumer, { recursive: true, force: true })
  }
}, 30_000)
