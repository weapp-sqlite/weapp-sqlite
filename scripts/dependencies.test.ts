/* eslint-disable test/no-import-node-test -- Dependency updater regressions run independently of workspace builds. */
import type { OutdatedDependencies } from './dependencies'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addOutdatedDependent,
  classifySpecifier,
  findDeclaredDependency,
  nextExactSpecifier,
  replaceDependencySpecifier,
} from './dependencies'

test('matches pnpm outdated names with version and dependency type suffixes', () => {
  const declared = { '@types/react': '^19.3.1' }

  assert.deepEqual(findDeclaredDependency(declared, '@types/react@19.3.1 (dev)'), {
    name: '@types/react',
    specifier: '^19.3.1',
  })
})

test('matches npm aliases reported by their target package name', () => {
  const declared = { 'fumadocs-ui': 'npm:@fumadocs/base-ui@16.19.7' }

  assert.deepEqual(findDeclaredDependency(declared, '@fumadocs/base-ui'), {
    name: 'fumadocs-ui',
    specifier: 'npm:@fumadocs/base-ui@16.19.7',
  })
})

test('keeps current and latest versions per dependent package', () => {
  const outdated: OutdatedDependencies = {}

  addOutdatedDependent(outdated, { name: '@types/react', specifier: '^18.3.31' }, {
    current: '18.3.31',
    latest: '19.3.2',
  }, '/workspace/examples/taro')
  addOutdatedDependent(outdated, { name: '@types/react', specifier: '^19.3.1' }, {
    current: '19.3.1',
    latest: '19.3.2',
  }, '/workspace/apps/docs')

  assert.deepEqual(outdated['@types/react']?.dependentPackages.map(({ current, latest, location }) => ({ current, latest, location })), [
    { current: '18.3.31', latest: '19.3.2', location: '/workspace/examples/taro' },
    { current: '19.3.1', latest: '19.3.2', location: '/workspace/apps/docs' },
  ])
})

test('preserves specifier kinds when calculating exact upgrades', () => {
  assert.equal(classifySpecifier('^1.0.0'), 'range')
  assert.equal(classifySpecifier('1.0.0'), 'exact')
  assert.equal(classifySpecifier('npm:pkg@1.0.0'), 'alias')
  assert.equal(nextExactSpecifier('1.0.0', '1.0.0', '2.0.0'), '2.0.0')
  assert.equal(nextExactSpecifier('npm:pkg@1.0.0', '1.0.0', '2.0.0'), 'npm:pkg@2.0.0')
  assert.equal(nextExactSpecifier('^1.0.0', '1.0.0', '2.0.0'), undefined)
})

test('rewrites only the requested package specifier', () => {
  const source = '{\n  "alpha": "1.0.0",\n  "beta": "1.0.0"\n}\n'

  assert.equal(replaceDependencySpecifier(source, 'beta', '1.0.0', '2.0.0'), '{\n  "alpha": "1.0.0",\n  "beta": "2.0.0"\n}\n')
})
