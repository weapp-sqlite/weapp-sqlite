export interface DependencyPin {
  name: string
  reason: string
}

export const dependencyPins: Record<string, DependencyPin[]> = {
  '.': [
    {
      name: 'lefthook',
      reason: 'lefthook 2.2.3 的 npm registry 缺少 macOS arm64 可选二进制，postinstall 无法安装',
    },
    {
      name: 'repoctl',
      reason: 'repoctl 6.6.3 的隔离消费者误执行 node: null 入口，且未通过历史发布恢复和 nightly 回归',
    },
    {
      name: 'stylelint',
      reason: 'repoctl、@icebreakers/monorepo 和当前 Stylelint 配置 peer 要求 ^17.16.0',
    },
    {
      name: 'typescript',
      reason: '@typescript-eslint 8.x 仅支持 TypeScript <6.1，且 weapp-vite 7 仍使用 TypeScript 6',
    },
    {
      name: 'tsdown',
      reason: 'tsdown 0.23 要求 Node.js >=22.18；仓库已将最低版本提升至 22.22.1',
    },
  ],
  'apps/docs': [
    {
      name: 'eslint',
      reason: 'eslint-config-next 16 的 react/import/jsx-a11y 插件尚不兼容 ESLint 10',
    },
    {
      name: 'typescript',
      reason: 'repoctl 与 typescript-eslint 当前要求 TypeScript 6.x',
    },
  ],
  'examples/mpx': [
    {
      name: '@babel/core',
      reason: 'MPX 2 使用 Babel 7 工具链',
    },
    {
      name: '@babel/preset-typescript',
      reason: '与 MPX 的 Babel 7 工具链保持一致',
    },
    {
      name: 'vue',
      reason: '@mpxjs/core 2.11.3 的 peer dependency 是 Vue ^2.7.10',
    },
    {
      name: 'webpack',
      reason: 'Webpack 5.110.3 起（含当前 latest 5.111.0）与 MPX 2 的 SplitChunks 扩展不兼容，生产构建会在 chunksSet 处失败',
    },
    {
      name: 'webpack-cli',
      reason: 'webpack-cli 7 要求 webpack-dev-server >=5，而 MPX 2 仍依赖 webpack-dev-server 4',
    },
  ],
  'examples/taro': [
    {
      name: '@babel/preset-react',
      reason: 'Taro webpack runner 的 peer dependency 要求 Babel 7',
    },
    {
      name: 'vite',
      reason: 'Taro 4.3.3 plugin-framework-react 的 peer dependency 要求 Vite ^4',
    },
    ...[
      '@types/react',
      '@types/react-dom',
      'react',
      'react-dom',
    ].map(name => ({
      name,
      reason: 'Taro 4.3.3 的 peer dependency 要求 React ^18；升级 React 前需完成整组验证',
    })),
  ],
  'examples/uni-app': [
    {
      name: '@dcloudio/types',
      reason: 'uni-app 当前发布批次的 peer dependency 精确要求 3.4.31',
    },
    ...[
      '@dcloudio/uni-app',
      '@dcloudio/uni-app-harmony',
      '@dcloudio/uni-components',
      '@dcloudio/uni-mp-weixin',
      '@dcloudio/vite-plugin-uni',
    ].map(name => ({
      name,
      reason: 'uni-app 使用官方 vue3 通道，四个包必须保持同一发布批次',
    })),
    ...[
      '@vitejs/plugin-vue',
      '@vue/compiler-dom',
      '@vue/reactivity',
      '@vue/runtime-core',
      '@vue/runtime-dom',
      'vite',
      'vue',
    ].map(name => ({
      name,
      reason: 'uni-app 使用固定的 Vue 3 alpha 批次，要求 Vite 8.2.2、plugin-vue 6.0.7 和 Vue 3.4.21；升级需切换并验证完整发布批次',
    })),
  ],
}
