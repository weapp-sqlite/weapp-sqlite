import path from 'node:path'
import process from 'node:process'
import { weappSqlite } from '@weapp-sqlite/weapp-vite'
import { defineConfig } from 'weapp-vite'

const debugEnabled = process.env['WEAPP_SQLITE_DEBUG'] === '1'

export default defineConfig({
  plugins: [weappSqlite({ debug: debugEnabled })],
  resolve: {
    alias: {
      '@weapp-sqlite/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@weapp-sqlite/wasm': path.resolve(import.meta.dirname, '../../packages/wasm/src/index.ts'),
      '@weapp-sqlite/web': path.resolve(import.meta.dirname, '../../packages/web/src/index.ts'),
      '@weapp-sqlite/miniprogram': path.resolve(import.meta.dirname, '../../packages/miniprogram/src/index.ts'),
      '@weapp-sqlite/debug': path.resolve(import.meta.dirname, '../../packages/debug/src/index.ts'),
      '@weapp-sqlite/weapp-vite/runtime': path.resolve(import.meta.dirname, '../../packages/weapp-vite/src/runtime.ts'),
      '@weapp-sqlite/weapp-vite/debug': path.resolve(import.meta.dirname, '../../packages/weapp-vite/src/debug.ts'),
      '@weapp-sqlite/weapp-vite/adapter': path.resolve(import.meta.dirname, '../../packages/weapp-vite/src/adapter.ts'),
      '@weapp-sqlite/weapp-vite': path.resolve(import.meta.dirname, '../../packages/weapp-vite/src/plugin.ts'),
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
