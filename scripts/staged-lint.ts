import process from 'node:process'
import { execa } from 'execa'

// Read NUL-delimited Git paths rather than interpolating filenames into a shell.
// The docs app owns ESLint 9; all other workspaces use the root ESLint 10.
const { stdout } = await execa('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
const files = stdout.split('\0').filter(file => /\.(?:[cm]?[jt]sx?|vue|astro|json|mdx?|html|ya?ml)$/i.test(file))
const docs = files.filter(file => file.startsWith('apps/docs/')).map(file => file.slice('apps/docs/'.length))
const root = files.filter(file => !file.startsWith('apps/docs/'))

for (const [cwd, paths] of [[process.cwd(), root], ['apps/docs', docs]] as const) {
  if (paths.length) {
    await execa('pnpm', ['exec', 'eslint', '--fix', '--no-warn-ignored', '--', ...paths], { cwd, stdio: 'inherit' })
  }
}
