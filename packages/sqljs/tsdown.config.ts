import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/full.ts', './src/full-browser.ts', './src/lite.ts', './src/node.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  inputOptions: {
    external: [/^\.\/vendor\/sql-wasm(?:-browser|-lite)?\.js$/],
  },
  copy: [
    { from: './src/vendor/*.wasm', to: './dist/assets' },
    { from: ['./src/vendor/*.js', './src/vendor/package.json'], to: './dist/vendor' },
    { from: './src/vendor/manifest.json', to: './dist' },
    { from: ['./src/vendor/LICENSE.sql.js', './src/vendor/LICENSE.sqlite.md'], to: './dist/licenses' },
  ],
  failOnWarn: false,
})
