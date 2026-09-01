import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/full.ts', './src/lite.ts', './src/node.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  copy: [
    { from: './src/vendor/sql-wasm-lite.wasm', to: './dist/assets' },
    { from: './src/vendor/manifest.json', to: './dist' },
    { from: ['./src/vendor/LICENSE.sql.js', './src/vendor/LICENSE.sqlite.md'], to: './dist/licenses' },
  ],
  failOnWarn: false,
})
