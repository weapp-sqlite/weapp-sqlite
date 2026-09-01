import { defineEslintConfig } from 'repoctl/tooling'

export default await defineEslintConfig({
  ignores: ['packages/sqljs/src/vendor/sql-wasm-lite.js'],
})
