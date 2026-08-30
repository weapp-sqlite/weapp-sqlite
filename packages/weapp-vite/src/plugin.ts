import type { Plugin, ResolvedConfig, ViteDevServer, WeappVitePlatform } from 'weapp-vite'
import type { WeappSqlitePluginOptions } from './types'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveWeappViteHostMeta } from 'weapp-vite'

const VIRTUAL_RUNTIME_ID = 'virtual:weapp-sqlite-runtime'
const RESOLVED_RUNTIME_ID = `\0${VIRTUAL_RUNTIME_ID}`
const SUPPORTED_TARGETS = new Set<WeappVitePlatform>(['web', 'weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs'])
const require = createRequire(import.meta.url)

function targetAsset(target: WeappVitePlatform) {
  return target === 'web' ? 'sql-wasm-browser.wasm' : 'sql-wasm.wasm'
}

function assetSource(asset: string) {
  return path.join(path.dirname(require.resolve('sql.js')), asset)
}

function runtimeExpression(target: Exclude<WeappVitePlatform, 'web'>) {
  const identifier = target === 'weapp' ? 'wx' : target === 'alipay' ? 'my' : target
  return `typeof ${identifier} === 'undefined' ? undefined : ${identifier}`
}

function webAssemblyExpression(target: Exclude<WeappVitePlatform, 'web'>) {
  return target === 'weapp'
    ? 'typeof WXWebAssembly === \'undefined\' ? undefined : WXWebAssembly'
    : 'typeof WebAssembly === \'undefined\' ? undefined : WebAssembly'
}

function virtualRuntimeSource(target: WeappVitePlatform) {
  if (target === 'web') {
    return [
      'import { createWebSqliteRuntimeAdapter } from \'@weapp-sqlite/weapp-vite/adapter\'',
      'export default createWebSqliteRuntimeAdapter({ wasmPath: \'/assets/sql-wasm-browser.wasm\' })',
    ].join('\n')
  }
  return [
    'import { createMiniProgramSqliteRuntimeAdapter } from \'@weapp-sqlite/weapp-vite/adapter\'',
    `export default createMiniProgramSqliteRuntimeAdapter({`,
    `  platform: ${JSON.stringify(target)},`,
    `  runtime: ${runtimeExpression(target)},`,
    `  webAssembly: ${webAssemblyExpression(target)},`,
    '  packageBinaryPath: \'/assets/sql-wasm.wasm\',',
    '})',
  ].join('\n')
}

function resolveTarget(config: ResolvedConfig): WeappVitePlatform {
  const meta = resolveWeappViteHostMeta(config)
  const target = meta?.platform
  if (!target || !SUPPORTED_TARGETS.has(target)) {
    throw new Error('@weapp-sqlite/weapp-vite requires a weapp-vite single-target Web or mini-program build.')
  }
  return target
}

export function weappSqlite(options: WeappSqlitePluginOptions = {}): Plugin {
  let target: WeappVitePlatform | undefined
  let asset: string | undefined
  let bytes: Uint8Array | undefined

  async function loadAsset() {
    if (!asset) {
      throw new Error('The weapp-sqlite target has not been resolved.')
    }
    return bytes ??= await readFile(assetSource(asset))
  }

  return {
    name: 'weapp-sqlite',
    enforce: 'pre',
    config() {
      return {
        define: {
          __WEAPP_SQLITE_DEBUG__: JSON.stringify(options.debug === true),
        },
      }
    },
    configResolved(config) {
      target = resolveTarget(config)
      asset = targetAsset(target)
    },
    resolveId(id) {
      if (id === VIRTUAL_RUNTIME_ID) {
        return RESOLVED_RUNTIME_ID
      }
    },
    load(id) {
      if (id === RESOLVED_RUNTIME_ID) {
        if (!target) {
          throw new Error('The weapp-sqlite runtime was loaded before the target was resolved.')
        }
        return virtualRuntimeSource(target)
      }
    },
    async buildStart() {
      if (!asset) {
        throw new Error('The weapp-sqlite build started before the target was resolved.')
      }
      this.emitFile({
        type: 'asset',
        fileName: `assets/${asset}`,
        source: await loadAsset(),
      })
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        if (!asset || request.url?.split('?', 1)[0] !== `/assets/${asset}`) {
          next()
          return
        }
        try {
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/wasm')
          response.end(await loadAsset())
        }
        catch (error) {
          next(error as Error)
        }
      })
    },
  }
}

export type { WeappSqlitePluginOptions } from './types'
