import { resolve } from 'node:path'
import process from 'node:process'
import { defineConfig } from '@tarojs/cli'

const sharedSource = resolve(process.cwd(), '../shared/src')

export default defineConfig({
  projectName: 'weapp-sqlite-taro-demo',
  date: '2026-08-25',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: ['@tarojs/plugin-framework-react'],
  mini: {
    compile: {
      include: [sharedSource],
    },
    postcss: {
      pxtransform: { enable: true },
      url: { enable: true },
      cssModules: { enable: false },
    },
  },
  h5: {},
})
