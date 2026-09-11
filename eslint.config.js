import { defineEslintConfig } from 'repoctl/tooling'

export default await defineEslintConfig({
  // The docs app owns its ESLint 9 flat config while the workspace uses ESLint 10.
  ignores: ['packages/sqljs/src/vendor/sql-wasm-lite.js', 'apps/docs/**'],
})
