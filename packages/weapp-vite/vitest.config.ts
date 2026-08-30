import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@weapp-sqlite/core': new URL('../core/src/index.ts', import.meta.url).pathname,
      '@weapp-sqlite/debug': new URL('../debug/src/index.ts', import.meta.url).pathname,
      '@weapp-sqlite/miniprogram': new URL('../miniprogram/src/index.ts', import.meta.url).pathname,
      '@weapp-sqlite/wasm': new URL('../wasm/src/index.ts', import.meta.url).pathname,
      '@weapp-sqlite/web': new URL('../web/src/index.ts', import.meta.url).pathname,
    },
  },
})
