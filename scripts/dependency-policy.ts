export interface DependencyPin {
  name: string
  reason: string
}

export const dependencyPins: Record<string, DependencyPin[]> = {
  '.': [
    {
      name: 'typescript',
      reason: '@typescript-eslint 8.x 仅支持 TypeScript <6.1，且 weapp-vite 7 仍使用 TypeScript 6',
    },
    {
      name: 'tsdown',
      reason: '0.23 要求 Node.js >=22.18，仓库当前最低版本仍是 22.12',
    },
  ],
  'apps/docs': [
    {
      name: 'eslint',
      reason: 'eslint-config-next 16 的 react/import/jsx-a11y 插件尚不兼容 ESLint 10',
    },
    {
      name: 'typescript',
      reason: '与 workspace 的 TypeScript 6 编译基线保持一致',
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
      name: '@mpxjs/core',
      reason: '2.11.1 是当前最新版，且 peer dependency 要求 Vue 2.7',
    },
    {
      name: '@mpxjs/webpack-plugin',
      reason: '与 @mpxjs/core 同步维护',
    },
    {
      name: 'vue',
      reason: '@mpxjs/core 2.11.1 的 peer dependency 是 Vue ^2.7.10',
    },
    {
      name: 'webpack',
      reason: '5.110.3 与 MPX 2 的 SplitChunks 扩展不兼容，生产构建会在 chunksSet 处失败',
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
    ...[
      '@tarojs/cli',
      '@tarojs/components',
      '@tarojs/plugin-framework-react',
      '@tarojs/plugin-platform-weapp',
      '@tarojs/react',
      '@tarojs/runtime',
      '@tarojs/shared',
      '@tarojs/taro',
      '@tarojs/webpack5-runner',
      'babel-preset-taro',
    ].map(name => ({
      name,
      reason: 'Taro 依赖必须整组同版；4.2.1 是当前最新版',
    })),
    ...[
      '@types/react',
      '@types/react-dom',
      'react',
      'react-dom',
    ].map(name => ({
      name,
      reason: '@tarojs/react 4.2.1 的 peer dependency 要求 React ^18',
    })),
  ],
  'examples/uni-app': [
    ...[
      '@dcloudio/uni-app',
      '@dcloudio/uni-components',
      '@dcloudio/uni-mp-weixin',
      '@dcloudio/vite-plugin-uni',
    ].map(name => ({
      name,
      reason: 'uni-app Vue3 alpha 依赖必须使用相同发布批次',
    })),
    ...[
      '@vitejs/plugin-vue',
      'vite',
      'vue',
    ].map(name => ({
      name,
      reason: '@dcloudio/vite-plugin-uni 固定要求 Vite 5.2.8 和 Vue 3.4.21 工具链',
    })),
  ],
}
