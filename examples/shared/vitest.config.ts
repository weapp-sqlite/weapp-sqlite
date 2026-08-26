import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@weapp-sqlite/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@weapp-sqlite/wasm': path.resolve(import.meta.dirname, '../../packages/wasm/src/index.ts'),
    },
  },
  test: { environment: 'node', globals: true },
})
