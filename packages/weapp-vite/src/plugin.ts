import type { Plugin, ResolvedConfig, ViteDevServer, WeappVitePlatform } from 'weapp-vite'
import type { WeappVitePluginApi } from 'weapp-vite/types'
import type { WeappSqlitePluginOptions } from './types'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { resolveWeappViteHostMeta } from 'weapp-vite'
import {
  GENERATED_PAGE_MARKER,
  workspacePageJson,
  workspacePageScript,
  workspacePageStyle,
  workspacePageTemplate,
} from './workspace-template'

const VIRTUAL_RUNTIME_ID = 'virtual:weapp-sqlite-runtime'
const RESOLVED_RUNTIME_ID = `\0${VIRTUAL_RUNTIME_ID}`
const SUPPORTED_TARGETS = new Set<WeappVitePlatform>(['web', 'weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs'])
const require = createRequire(import.meta.url)
const DEFAULT_DEBUG_ROUTE = '__weapp_sqlite_debug/index/index'
const DEFAULT_DEBUG_CONFIG = './src/sqlite-debug.config.ts'

interface DebugPageState {
  readonly directory: string
  readonly route: string
  readonly root: string
  readonly page: string
}

function normalizeDebugOptions(options: WeappSqlitePluginOptions) {
  if (typeof options.debug === 'object') {
    return {
      enabled: options.debug.enabled,
      route: options.debug.page?.route ?? DEFAULT_DEBUG_ROUTE,
      configFile: options.debug.page?.configFile ?? DEFAULT_DEBUG_CONFIG,
    }
  }
  return { enabled: options.debug === true, route: DEFAULT_DEBUG_ROUTE, configFile: DEFAULT_DEBUG_CONFIG }
}

function normalizeRoute(route: string) {
  const normalized = route.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')
  if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[\w-]+$/.test(segment))) {
    throw new Error(`Invalid weapp-sqlite debug page route: ${route}`)
  }
  return normalized
}

async function generateDebugPage(projectRoot: string, srcRoot: string, routeValue: string, configFile: string): Promise<DebugPageState> {
  const route = normalizeRoute(routeValue)
  const segments = route.split('/')
  const root = segments[0] as string
  const page = segments.slice(1).join('/')
  const directory = path.resolve(projectRoot, srcRoot, ...segments.slice(0, -1))
  const baseName = segments.at(-1) as string
  const markerPath = path.join(directory, '.weapp-sqlite-generated')
  const configPath = path.resolve(projectRoot, configFile)
  await readFile(configPath, 'utf8').catch((error) => {
    throw new Error(`The weapp-sqlite debug workspace config does not exist: ${configPath}`, { cause: error })
  })
  let marker: string | undefined
  try {
    marker = await readFile(markerPath, 'utf8')
  }
  catch {}
  if (marker !== undefined && marker !== GENERATED_PAGE_MARKER) {
    throw new Error(`The generated debug page marker is invalid: ${markerPath}`)
  }
  if (marker === undefined) {
    try {
      if ((await readdir(directory)).length > 0) {
        throw new Error(`The weapp-sqlite debug route conflicts with user files: ${directory}`)
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
  await mkdir(directory, { recursive: true })
  const scriptPath = path.join(directory, `${baseName}.ts`)
  let configImport = path.relative(directory, configPath).replaceAll('\\', '/')
  if (!configImport.startsWith('.')) {
    configImport = `./${configImport}`
  }
  await Promise.all([
    writeFile(markerPath, GENERATED_PAGE_MARKER),
    writeFile(scriptPath, workspacePageScript(configImport)),
    writeFile(path.join(directory, `${baseName}.wxml`), workspacePageTemplate),
    writeFile(path.join(directory, `${baseName}.scss`), workspacePageStyle),
    writeFile(path.join(directory, `${baseName}.json`), workspacePageJson),
  ])
  return { directory, route, root, page }
}

function debugAutoRoutes(existing: unknown, root: string) {
  const record = existing && typeof existing === 'object' ? existing as { include?: string | RegExp | readonly (string | RegExp)[] } : {}
  const current = record.include === undefined ? ['pages/**'] : Array.isArray(record.include) ? [...record.include] : [record.include]
  const include = [...current, `${root}/**`]
  return { ...record, enabled: true, include: [...new Set(include)] }
}

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

async function applyDebugRoutesToCompiler(config: ResolvedConfig, state: DebugPageState) {
  const contextPlugin = config.plugins.find(plugin => plugin.name === 'weapp-vite:context') as (Plugin & { readonly api?: WeappVitePluginApi }) | undefined
  const compiler = contextPlugin?.api?.ctx
  const weapp = compiler?.configService.weappViteConfig
  if (!weapp) {
    return
  }
  weapp.autoRoutes = debugAutoRoutes(weapp.autoRoutes, state.root)
  weapp.subPackages = { ...weapp.subPackages, [state.root]: weapp.subPackages?.[state.root] ?? {} }
  compiler.autoRoutesService.markDirty()
  await compiler.autoRoutesService.ensureFresh()
  compiler.scanService.markDirty()
  await compiler.scanService.loadAppEntry()
}

export function weappSqlite(options: WeappSqlitePluginOptions = {}): Plugin {
  const debug = normalizeDebugOptions(options)
  let target: WeappVitePlatform | undefined
  let asset: string | undefined
  let bytes: Uint8Array | undefined
  let debugPage: DebugPageState | undefined

  async function loadAsset() {
    if (!asset) {
      throw new Error('The weapp-sqlite target has not been resolved.')
    }
    return bytes ??= await readFile(assetSource(asset))
  }

  return {
    name: 'weapp-sqlite',
    enforce: 'post',
    async config(userConfig) {
      if (debug.enabled) {
        const config = userConfig as typeof userConfig & { root?: string, weapp?: { srcRoot?: string, autoRoutes?: unknown, subPackages?: Record<string, unknown> } }
        const projectRoot = path.resolve(config.root ?? process.cwd())
        debugPage = await generateDebugPage(projectRoot, config.weapp?.srcRoot ?? 'src', debug.route, debug.configFile)
        const weapp = config.weapp ??= {}
        weapp.autoRoutes = debugAutoRoutes(weapp.autoRoutes, debugPage.root)
        weapp.subPackages = { ...weapp.subPackages, [debugPage.root]: weapp.subPackages?.[debugPage.root] ?? {} }
        return {
          define: { __WEAPP_SQLITE_DEBUG__: JSON.stringify(true) },
          weapp: {
            autoRoutes: weapp.autoRoutes,
            subPackages: weapp.subPackages,
          },
        }
      }
      return {
        define: {
          __WEAPP_SQLITE_DEBUG__: JSON.stringify(debug.enabled),
        },
      }
    },
    async configResolved(config) {
      target = resolveTarget(config)
      asset = targetAsset(target)
      if (debugPage) {
        await applyDebugRoutesToCompiler(config, debugPage)
      }
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
    async closeBundle() {
      if (!debugPage) {
        return
      }
      const markerPath = path.join(debugPage.directory, '.weapp-sqlite-generated')
      const marker = await readFile(markerPath, 'utf8').catch(() => undefined)
      if (marker === GENERATED_PAGE_MARKER) {
        await rm(debugPage.directory, { recursive: true, force: true })
      }
      debugPage = undefined
    },
  }
}

export type { WeappSqliteDebugAppConfigOptions, WeappSqliteDebugPageOptions, WeappSqliteDebugPluginOptions, WeappSqlitePluginOptions } from './types'
