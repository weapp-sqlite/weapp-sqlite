import { defineEslintConfig } from 'repoctl/tooling'

export default await defineEslintConfig(
  {
    // The docs app owns its ESLint 9 flat config while the workspace uses ESLint 10.
    ignores: ['packages/sqljs/src/vendor/*.js', 'apps/docs/**'],
  },
  {
    files: ['packages/devtools/**/*.{ts,tsx}'],
    rules: {
      // Devframe protocol plumbing keeps a few short lifecycle statements together.
      'style/max-statements-per-line': 'off',
    },
  },
)
