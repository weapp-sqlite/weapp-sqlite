import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SqliteWasmVariant = 'full' | 'lite'
export type SqliteWasmAssetTarget = 'web' | 'miniprogram'

const require = createRequire(import.meta.url)

export function sqliteWasmAssetName(variant: SqliteWasmVariant, target: SqliteWasmAssetTarget) {
  if (variant === 'lite') {
    return 'sql-wasm-lite.wasm'
  }
  return target === 'web' ? 'sql-wasm-browser.wasm' : 'sql-wasm.wasm'
}

export function resolveSqliteWasmAsset(variant: SqliteWasmVariant, target: SqliteWasmAssetTarget) {
  if (variant === 'lite') {
    return fileURLToPath(new URL('./assets/sql-wasm-lite.wasm', import.meta.url))
  }
  return path.join(path.dirname(require.resolve('sql.js')), sqliteWasmAssetName(variant, target))
}
