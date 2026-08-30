declare module 'virtual:weapp-sqlite-runtime' {
  import type { SqliteRuntimeAdapter } from './types'

  const adapter: SqliteRuntimeAdapter
  export default adapter
}
