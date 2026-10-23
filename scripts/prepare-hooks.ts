import { spawnSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ci = process.env['CI']?.trim().toLowerCase()
const hooks = process.env['LEFTHOOK']?.trim().toLowerCase()

if (ci && ci !== 'false' && ci !== '0') {
  console.log('Skipping Git hook installation in CI.')
}
else if (hooks === '0' || hooks === 'false') {
  console.log('Skipping Git hook installation because LEFTHOOK is disabled.')
}
else if (!lstatSync(path.join(root, '.git'), { throwIfNoEntry: false })) {
  // A source archive can be nested inside another checkout. Never install its hooks.
  console.log('Skipping Git hook installation outside a Git checkout.')
}
else {
  const require = createRequire(import.meta.url)
  const result = spawnSync(process.execPath, [require.resolve('lefthook/bin/index.js'), 'install'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) {
    throw result.error
  }
  if (result.signal) {
    throw new Error(`Git hook installation terminated with ${result.signal}.`)
  }
  process.exitCode = result.status ?? 1
}
