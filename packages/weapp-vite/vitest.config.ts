import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@weapp-sqlite/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@weapp-sqlite/debug': fileURLToPath(new URL('../debug/src/index.ts', import.meta.url)),
      '@weapp-sqlite/miniprogram': fileURLToPath(new URL('../miniprogram/src/index.ts', import.meta.url)),
      '@weapp-sqlite/wasm': fileURLToPath(new URL('../wasm/src/index.ts', import.meta.url)),
      '@weapp-sqlite/web': fileURLToPath(new URL('../web/src/index.ts', import.meta.url)),
    },
  },
})
