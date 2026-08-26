import path from 'node:path'
import { defineConfig } from 'weapp-vite'

export default defineConfig({
  publicDir: '.generated/public',
  resolve: {
    alias: {
      '@weapp-sqlite/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@weapp-sqlite/wasm': path.resolve(import.meta.dirname, '../../packages/wasm/src/index.ts'),
      '@weapp-sqlite/web': path.resolve(import.meta.dirname, '../../packages/web/src/index.ts'),
      '@weapp-sqlite/miniprogram': path.resolve(import.meta.dirname, '../../packages/miniprogram/src/index.ts'),
    },
  },
  weapp: {
    srcRoot: 'src',
    multiPlatform: {
      enabled: true,
      targets: ['weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs'],
    },
    web: {
      enable: true,
      outDir: 'dist/web',
      pluginOptions: {
        runtime: {
          routing: { mode: 'history' },
        },
      },
    },
    generate: {
      extensions: { js: 'ts', wxss: 'scss' },
      dirs: { page: 'src/pages', component: 'src/components' },
    },
  },
  css: {
    preprocessorOptions: {
      scss: { silenceDeprecations: ['legacy-js-api', 'import'] },
    },
  },
})
