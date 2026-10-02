import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
import { acceptanceArtifactRoot, assertCleanRepository, demoRoot, repositoryRoot } from './acceptance-paths'

const platforms = ['weapp'] as const
const operatingSystems = ['ios', 'android'] as const
const devtoolsCliPath = process.env['WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH']?.trim()

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
        debugWorkspace: false,
        tableCrud: false,
        shareFileMessageExport: false,
        chooseMessageFileImport: false,
        undo: false,
      },
      screenshots: { first: '', persisted: '' },
      notes: '',
    }
    await writeFile(
      path.join(platformRoot, `${operatingSystem}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    )
  }

  const previewArgs = [
    'preview',
    '--project',
    path.join(demoRoot, `dist/${platform}`),
    '--qr-format',
    'image',
    '--qr-output',
    path.join(platformRoot, 'preview-qr.png'),
    '--info-output',
    path.join(platformRoot, 'preview-info.json'),
  ]
  if (devtoolsCliPath) {
    await execa(devtoolsCliPath, previewArgs, { cwd: repositoryRoot, stdio: 'inherit' })
  }
  else {
    await execa('pnpm', [
      '--filter',
      'weapp-sqlite-demo-weapp-vite',
      'exec',
      'wv',
      'ide',
      ...previewArgs,
      '--non-interactive',
    ], { cwd: repositoryRoot, stdio: 'inherit' })
  }
}

console.log(JSON.stringify({ commit, mobileRoot, platforms, operatingSystems }))
