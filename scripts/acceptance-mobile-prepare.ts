import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { acceptanceArtifactRoot, assertCleanRepository, demoRoot, repositoryRoot } from './acceptance-paths'

await assertCleanRepository()
const { commit, root } = await acceptanceArtifactRoot()
const mobileRoot = path.join(root, 'mobile')
await mkdir(mobileRoot, { recursive: true })

const environments = ['ios-min', 'ios-latest', 'android-min', 'android-latest'] as const
for (const target of environments) {
  const report = {
    schemaVersion: 1,
    commit,
    target,
    passed: false,
    device: { model: '', osVersion: '', wechatVersion: '', sdkVersion: '' },
    checks: {
      reset: false,
      firstRun: false,
      migration: false,
      parameterBinding: false,
      transactionCommit: false,
      transactionRollback: false,
      processRelaunch: false,
      persistence: false,
    },
    screenshots: { first: '', persisted: '' },
    notes: '',
  }
  await writeFile(path.join(mobileRoot, `${target}.json`), `${JSON.stringify(report, null, 2)}\n`)
}

const qrOutput = path.join(mobileRoot, 'preview-qr.png')
const infoOutput = path.join(mobileRoot, 'preview-info.json')
await execa('pnpm', [
  '--filter',
  'weapp-sqlite-demo-weapp-vite',
  'exec',
  'wv',
  'preview',
  '--project',
  path.join(demoRoot, 'dist/weapp'),
  '--qr-format',
  'image',
  '--qr-output',
  qrOutput,
  '--info-output',
  infoOutput,
  '--non-interactive',
], { cwd: repositoryRoot, stdio: 'inherit' })

console.log(JSON.stringify({ commit, mobileRoot, qrOutput, environments }))
