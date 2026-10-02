import { defineProject } from 'vitest/config'

export default defineProject({
  test: { name: '@weapp-sqlite/devtools', include: ['test/**/*.test.ts', 'client/**/*.test.ts'], testTimeout: 15000 },
})
