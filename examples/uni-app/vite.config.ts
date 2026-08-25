import uniModule from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'

const uni = typeof uniModule === 'function'
  ? uniModule
  : (uniModule as unknown as { default: typeof uniModule }).default

export default defineConfig({
  plugins: [uni()],
})
