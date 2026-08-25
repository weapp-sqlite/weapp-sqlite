declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface UniStorageOptions {
  key: string
  data?: unknown
  success?: (result: { data?: unknown }) => void
  fail?: () => void
}

declare const uni: {
  getStorage: (options: UniStorageOptions) => void
  setStorage: (options: UniStorageOptions) => void
}
