import type { MonorepoConfig } from 'repoctl'

const documentationPackages = {
  '@weapp-sqlite/core': 'packages/core',
  '@weapp-sqlite/debug': 'packages/debug',
  '@weapp-sqlite/devtools': 'packages/devtools',
  '@weapp-sqlite/miniprogram': 'packages/miniprogram',
  '@weapp-sqlite/sqljs': 'packages/sqljs',
  '@weapp-sqlite/wasm': 'packages/wasm',
  '@weapp-sqlite/weapp-vite': 'packages/weapp-vite',
  '@weapp-sqlite/web': 'packages/web',
  'weapp-sqlite': 'packages/weapp-sqlite',
}

const documentationReleaseInputs = Object.fromEntries(
  Object.entries(documentationPackages).map(([name, directory]) => [name, [
    `${directory}/**`,
    'tsconfig.json',
    '!**/README*',
    '!**/CHANGELOG*',
    '!**/docs/**',
    '!**/test/**',
    '!**/test-d/**',
    '!**/fixtures/**',
    '!**/*.test.*',
    '!**/*.spec.*',
  ]]),
)

export default {
  commands: {
    release: {
      nightly: { provider: 'npm', schedule: '0 0 * * *' },
      qualityScripts: ['build', 'check:publish', 'lint', 'typecheck', 'tsd', 'test', 'test:release'],
    },
    docs: {
      sites: {
        website: {
          packages: Object.keys(documentationPackages),
          releaseInputs: documentationReleaseInputs,
          buildScript: 'docs:build',
          preview: {
            deployScript: 'docs:deploy:preview',
            url: 'https://preview.sqlite.weapp.dev',
          },
          stable: {
            deployScript: 'docs:deploy:stable',
            url: 'https://sqlite.weapp.dev',
          },
          patchPaths: [
            'apps/docs/content/docs/**/*.{md,mdx}',
            'apps/docs/public/**/*.{png,jpg,jpeg,webp,avif,gif,svg,ico}',
          ],
        },
      },
    },
    create: {
      defaultTemplate: 'tsdown',
      renameJson: false,
    },
    clean: {
      autoConfirm: false,
      includePrivate: true,
    },
    upgrade: {
      skipOverwrite: false,
      mergeTargets: true,
    },
  },
  tooling: {
    commitlint: {
      extends: ['@commitlint/config-conventional'],
    },
    eslint: {
      ignores: ['**/fixtures/**'],
    },
    stylelint: {
      rules: {},
    },
    vitest: {
      includeWorkspaceRootConfig: false,
      coverageExclude: ['**/dist/**'],
      coverageSkipFull: true,
    },
    vitestProject: {
      globals: true,
      testTimeout: 60_000,
    },
  },
} satisfies MonorepoConfig
