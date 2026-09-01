import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/plugin.ts', './src/runtime.ts', './src/debug.ts', './src/adapter.ts', './src/advanced.ts', './src/workspace.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  deps: {
    neverBundle: [/^virtual:weapp-sqlite-runtime$/],
  },
  failOnWarn: false,
})
