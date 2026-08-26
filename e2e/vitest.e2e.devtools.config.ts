import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
})
