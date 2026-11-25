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
      name: 'typescript',
      reason: 'tsdown 0.23.7 的 rolldown-plugin-dts 依赖 Volar 2，当前要求 TypeScript <7',
    },
  ],
  'apps/docs': [
    {
      name: 'eslint',
      reason: 'eslint-config-next 16 当前依赖的 react/import/jsx-a11y 插件仍要求 ESLint 9',
    },
    {
      name: 'typescript',
      reason: '文档站 Volar 2 当前要求 TypeScript <7，升级前需等待上游支持',
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
      reason: 'Taro 4.3.3 plugin-framework-react 的 peer dependency 要求 Vite ^4，当前使用该主版本的最新安全补丁',
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
      '@dcloudio/uni-app-plus',
      '@dcloudio/uni-components',
      '@dcloudio/uni-h5',
      '@dcloudio/uni-mp-alipay',
      '@dcloudio/uni-mp-baidu',
      '@dcloudio/uni-mp-harmony',
      '@dcloudio/uni-mp-jd',
      '@dcloudio/uni-mp-kuaishou',
      '@dcloudio/uni-mp-lark',
      '@dcloudio/uni-mp-qq',
      '@dcloudio/uni-mp-toutiao',
      '@dcloudio/uni-mp-weixin',
      '@dcloudio/uni-mp-xhs',
      '@dcloudio/uni-quickapp-webview',
      '@dcloudio/uni-automator',
      '@dcloudio/uni-cli-shared',
      '@dcloudio/uni-stacktracey',
      '@dcloudio/vite-plugin-uni',
    ].map(name => ({
      name,
      reason: 'uni-app 使用官方 vue3 通道，所有 @dcloudio 包必须保持同一发布批次',
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
      reason: 'uni-app 当前 alpha 批次固定使用 Vite 5.2.8、Vue 3.4.21 和对应的 plugin-vue；升级需切换并验证完整发布批次',
    })),
  ],
}
