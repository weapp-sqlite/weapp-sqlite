import { fileURLToPath } from 'node:url'

export type SqliteWasmVariant = 'full' | 'lite'
export type SqliteWasmAssetTarget = 'web' | 'miniprogram'

export function sqliteWasmAssetName(variant: SqliteWasmVariant, target: SqliteWasmAssetTarget) {
  if (variant === 'lite') {
    return 'sql-wasm-lite.wasm'
  }
  return target === 'web' ? 'sql-wasm-browser.wasm' : 'sql-wasm.wasm'
}

export function resolveSqliteWasmAsset(variant: SqliteWasmVariant, target: SqliteWasmAssetTarget) {
  return fileURLToPath(new URL(`./assets/${sqliteWasmAssetName(variant, target)}`, import.meta.url))
}
