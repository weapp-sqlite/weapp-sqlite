import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

export const repositoryRoot = path.resolve(import.meta.dirname, '..')
export const demoRoot = path.join(repositoryRoot, 'examples/weapp-vite-multi-platform')

export async function currentCommit() {
  const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
  return result.stdout.trim()
}

export async function assertCleanRepository() {
  const result = await execa('git', ['status', '--porcelain'], { cwd: repositoryRoot })
  if (result.stdout.trim()) {
    throw new Error('Formal acceptance evidence requires a clean Git worktree so every report belongs to the recorded commit.')
  }
}

export async function acceptanceArtifactRoot() {
  const commit = await currentCommit()
  const configuredRoot = process.env['ACCEPTANCE_ARTIFACT_DIR']
  const root = configuredRoot
    ? path.resolve(repositoryRoot, configuredRoot)
    : path.join(repositoryRoot, 'artifacts/acceptance', commit)
  await mkdir(root, { recursive: true })
  return { commit, root }
}
