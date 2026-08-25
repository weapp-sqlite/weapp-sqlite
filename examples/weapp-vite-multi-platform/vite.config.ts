import { defineConfig } from 'weapp-vite'

export default defineConfig({
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
