import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { acceptanceArtifactRoot, assertCleanRepository, demoRoot, repositoryRoot } from './acceptance-paths'

const platforms = ['weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs'] as const
const operatingSystems = ['ios', 'android'] as const

await assertCleanRepository()
const { commit, root } = await acceptanceArtifactRoot()
const mobileRoot = path.join(root, 'mobile')

for (const platform of platforms) {
  const platformRoot = path.join(mobileRoot, platform)
  await mkdir(platformRoot, { recursive: true })
  for (const operatingSystem of operatingSystems) {
    const report = {
      schemaVersion: 2,
      commit,
      target: platform,
      operatingSystem,
      passed: false,
      device: { model: '', osVersion: '', hostAppVersion: '', sdkVersion: '' },
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
    await writeFile(
      path.join(platformRoot, `${operatingSystem}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    )
  }

  await execa('pnpm', [
    '--filter',
    'weapp-sqlite-demo-weapp-vite',
    'exec',
    'wv',
    'preview',
    '--project',
    path.join(demoRoot, `dist/${platform}`),
    '--qr-format',
    'image',
    '--qr-output',
    path.join(platformRoot, 'preview-qr.png'),
    '--info-output',
    path.join(platformRoot, 'preview-info.json'),
    '--non-interactive',
  ], { cwd: repositoryRoot, stdio: 'inherit' })
}

console.log(JSON.stringify({ commit, mobileRoot, platforms, operatingSystems }))
