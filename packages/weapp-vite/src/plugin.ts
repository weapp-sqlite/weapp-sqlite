import type { Plugin, ResolvedConfig, ViteDevServer, WeappVitePlatform } from 'weapp-vite'
import type { WeappVitePluginApi } from 'weapp-vite/types'
import type { SqliteWasmVariant, WeappSqlitePluginOptions, WeappSqliteWasmPackage } from './types'
import { readFileSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { resolveSqliteWasmAsset, sqliteWasmAssetName } from '@weapp-sqlite/sqljs/node'
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
const DEFAULT_WASM_SUBPACKAGE_ROOT = '__weapp_sqlite__'
const GENERATED_WASM_MARKER = 'weapp-sqlite-wasm-subpackage-v1\n'

interface DebugPageState {
  readonly directory: string
  readonly route: string
  readonly root: string
  readonly page: string
}

interface WasmSubpackageState {
  readonly cleanupDirectories: readonly string[]
  readonly loaderPath: string
  readonly root: string
  readonly runtimeImport: string
  readonly runtimeOutputPath: string
}

function cleanupWasmSubpackageSync(state: WasmSubpackageState) {
  for (const directory of state.cleanupDirectories) {
    try {
      if (readFileSync(path.join(directory, '.weapp-sqlite-generated'), 'utf8') === GENERATED_WASM_MARKER) {
        rmSync(directory, { recursive: true, force: true })
      }
    }
    catch {}
  }
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

function normalizeWasmOptions(options: WeappSqlitePluginOptions) {
  const variant = options.wasm?.variant ?? 'full'
  if (variant !== 'full' && variant !== 'lite') {
    throw new Error(`Invalid weapp-sqlite WASM variant: ${String(variant)}`)
  }
  const weappPackage = options.wasm?.weappPackage ?? 'main'
  return { variant, weappPackage }
}

function normalizePackageRoot(root: string) {
  const normalized = root.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..' || !/^[\w-]+$/.test(segment))) {
    throw new Error(`Invalid weapp-sqlite WASM subpackage root: ${root}`)
  }
  return normalized
}

function wasmSubpackageRoot(option: Exclude<WeappSqliteWasmPackage, 'main'>) {
  return normalizePackageRoot(option.mode === 'generated-subpackage' ? option.root ?? DEFAULT_WASM_SUBPACKAGE_ROOT : option.root)
}

async function ensureOwnedDirectory(directory: string) {
  const markerPath = path.join(directory, '.weapp-sqlite-generated')
  const marker = await readFile(markerPath, 'utf8').catch(() => undefined)
  if (marker !== undefined && marker !== GENERATED_WASM_MARKER) {
    throw new Error(`The generated SQLite WASM marker is invalid: ${markerPath}`)
  }
  if (marker === undefined) {
    const entries = await readdir(directory).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    })
    if (entries.length > 0) {
      throw new Error(`The generated SQLite WASM path conflicts with user files: ${directory}`)
    }
  }
  await mkdir(directory, { recursive: true })
  await writeFile(markerPath, GENERATED_WASM_MARKER)
}

async function assertGeneratedSubpackageAppConfig(projectRoot: string, srcRoot: string) {
  const appConfigPath = path.join(projectRoot, srcRoot, 'app.json.ts')
  const source = await readFile(appConfigPath, 'utf8').catch((error) => {
    throw new Error(`Generated SQLite WASM subpackages require app.json.ts: ${appConfigPath}`, { cause: error })
  })
  if (!source.includes('weapp-vite/auto-routes')) {
    throw new Error('Generated SQLite WASM subpackages require app.json.ts to use weapp-vite/auto-routes.')
  }
}

async function generateWasmSubpackage(
  projectRoot: string,
  srcRoot: string,
  packageOption: Exclude<WeappSqliteWasmPackage, 'main'>,
  variant: SqliteWasmVariant,
): Promise<WasmSubpackageState> {
  const root = wasmSubpackageRoot(packageOption)
  const sourceRoot = path.resolve(projectRoot, srcRoot)
  const packageDirectory = packageOption.mode === 'generated-subpackage'
    ? path.join(sourceRoot, root)
    : path.join(sourceRoot, root, '__weapp_sqlite__')
  const loaderDirectory = path.join(sourceRoot, '__weapp_sqlite_loader__')
  await ensureOwnedDirectory(packageDirectory)
  await ensureOwnedDirectory(loaderDirectory)

  const runtimePath = path.join(packageDirectory, 'runtime.ts')
  const loaderPath = path.join(loaderDirectory, 'index.ts')
  let runtimeImport = path.relative(loaderDirectory, runtimePath).replaceAll('\\', '/')
  if (!runtimeImport.startsWith('.')) {
    runtimeImport = `./${runtimeImport}`
  }
  await writeFile(runtimePath, [
    `import initializer from '@weapp-sqlite/sqljs/${variant}'`,
    'export default initializer',
    '',
  ].join('\n'))
  await writeFile(loaderPath, [
    'import type { SqlJsInitializer } from \'@weapp-sqlite/wasm\'',
    'let initializerPromise: Promise<SqlJsInitializer> | undefined',
    'export function loadSqliteInitializer() {',
    `  return initializerPromise ??= require.async(${JSON.stringify(runtimeImport)}).then((module: { default?: SqlJsInitializer }) => module.default ?? module as unknown as SqlJsInitializer)`,
    '}',
    '',
  ].join('\n'))

  if (packageOption.mode === 'generated-subpackage') {
    const pageDirectory = path.join(packageDirectory, '__entry__')
    await mkdir(pageDirectory, { recursive: true })
    await Promise.all([
      writeFile(path.join(pageDirectory, 'index.ts'), 'Page({})\n'),
      writeFile(path.join(pageDirectory, 'index.wxml'), '<view />\n'),
      writeFile(path.join(pageDirectory, 'index.scss'), ''),
      writeFile(path.join(pageDirectory, 'index.json'), '{"navigationStyle":"custom"}\n'),
    ])
  }

  return {
    cleanupDirectories: [packageDirectory, loaderDirectory],
    loaderPath,
    root,
    runtimeImport,
    runtimeOutputPath: path.relative(sourceRoot, runtimePath).replaceAll('\\', '/').replace(/\.ts$/, '.js'),
  }
}

function rewriteWasmSubpackageLoader(code: string, chunkFileName: string, state: WasmSubpackageState) {
  let outputImport = path.posix.relative(path.posix.dirname(chunkFileName), state.runtimeOutputPath)
  if (!outputImport.startsWith('.')) {
    outputImport = `./${outputImport}`
  }
  for (const sourceImport of [state.runtimeImport, state.runtimeImport.replace(/\.ts$/, '.js')]) {
    for (const quote of ['"', '\'']) {
      code = code.replaceAll(`require.async(${quote}${sourceImport}${quote})`, `require.async(${quote}${outputImport}${quote})`)
    }
  }
  return code
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

function targetAsset(target: WeappVitePlatform, variant: SqliteWasmVariant) {
  return sqliteWasmAssetName(variant, target === 'web' ? 'web' : 'miniprogram')
}

function assetSource(target: WeappVitePlatform, variant: SqliteWasmVariant) {
  return resolveSqliteWasmAsset(variant, target === 'web' ? 'web' : 'miniprogram')
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

function virtualRuntimeSource(
  target: WeappVitePlatform,
  variant: SqliteWasmVariant,
  assetPath: string,
  loaderPath?: string,
) {
  const engine = variant === 'full' ? 'sql.js-wasm' : 'sql.js-wasm-lite'
  const initializerImport = loaderPath
    ? [`import { loadSqliteInitializer } from ${JSON.stringify(loaderPath)}`]
    : [`import initializer from '@weapp-sqlite/sqljs/${variant}'`]
  if (target === 'web') {
    return [
      'import { createWebSqliteRuntimeAdapterWithInitializer } from \'@weapp-sqlite/weapp-vite/advanced\'',
      ...initializerImport,
      'export default createWebSqliteRuntimeAdapterWithInitializer({',
      `  engine: ${JSON.stringify(engine)},`,
      '  initializer,',
      `  wasmPath: ${JSON.stringify(assetPath)},`,
      '})',
    ].join('\n')
  }
  return [
    'import { createMiniProgramSqliteRuntimeAdapterWithInitializer } from \'@weapp-sqlite/weapp-vite/advanced\'',
    ...initializerImport,
    `export default createMiniProgramSqliteRuntimeAdapterWithInitializer({`,
    `  engine: ${JSON.stringify(engine)},`,
    ...(loaderPath ? ['  loadInitializer: loadSqliteInitializer,'] : ['  initializer,']),
    `  platform: ${JSON.stringify(target)},`,
    `  runtime: ${runtimeExpression(target)},`,
    `  webAssembly: ${webAssemblyExpression(target)},`,
    `  packageBinaryPath: ${JSON.stringify(assetPath)},`,
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

function compilerFromConfig(config: ResolvedConfig) {
  const contextPlugin = config.plugins.find(plugin => plugin.name === 'weapp-vite:context') as (Plugin & { readonly api?: WeappVitePluginApi }) | undefined
  return contextPlugin?.api?.ctx
}

async function registerGeneratedWasmSubpackage(config: ResolvedConfig, state: WasmSubpackageState) {
  const compiler = compilerFromConfig(config)
  const weapp = compiler?.configService.weappViteConfig
  if (!compiler || !weapp) {
    throw new Error('Generated SQLite WASM subpackages require the weapp-vite compiler context.')
  }
  weapp.autoRoutes = debugAutoRoutes(weapp.autoRoutes, state.root)
  weapp.subPackages = { ...weapp.subPackages, [state.root]: weapp.subPackages?.[state.root] ?? {} }
  compiler.autoRoutesService.markDirty()
  await compiler.autoRoutesService.ensureFresh()
  compiler.scanService.markDirty()
  await compiler.scanService.loadAppEntry()
}

async function validateExistingWasmSubpackage(config: ResolvedConfig, root: string) {
  const compiler = compilerFromConfig(config)
  if (!compiler) {
    throw new Error('Existing SQLite WASM subpackages require the weapp-vite compiler context.')
  }
  const app = await compiler.scanService.loadAppEntry()
  const subPackages = [
    ...(Array.isArray(app.json.subPackages) ? app.json.subPackages : []),
    ...(Array.isArray(app.json.subpackages) ? app.json.subpackages : []),
  ] as Array<{ root?: string, independent?: boolean }>
  const matched = subPackages.find(item => typeof item.root === 'string' && normalizePackageRoot(item.root) === root)
  if (!matched) {
    throw new Error(`The SQLite WASM subpackage root is missing from app.json.subPackages: ${root}`)
  }
  if (matched.independent === true) {
    throw new Error(`SQLite WASM cannot be delivered through an independent subpackage: ${root}`)
  }
}

export function weappSqlite(options: WeappSqlitePluginOptions = {}): Plugin {
  const debug = normalizeDebugOptions(options)
  const wasm = normalizeWasmOptions(options)
  let target: WeappVitePlatform | undefined
  let asset: string | undefined
  let emittedAssetPath: string | undefined
  let bytes: Uint8Array | undefined
  let debugPage: DebugPageState | undefined
  let wasmSubpackage: WasmSubpackageState | undefined
  let cleanupWasmOnExit: (() => void) | undefined
  let cleanupWasmTimer: ReturnType<typeof setTimeout> | undefined
  let projectRoot = process.cwd()
  let sourceRoot = 'src'

  async function loadAsset() {
    if (!asset) {
      throw new Error('The weapp-sqlite target has not been resolved.')
    }
    if (!target) {
      throw new Error('The weapp-sqlite target has not been resolved.')
    }
    return bytes ??= await readFile(assetSource(target, wasm.variant))
  }

  function ownWasmSubpackage(state: WasmSubpackageState) {
    wasmSubpackage = state
    const cleanup = () => {
      if (wasmSubpackage) {
        cleanupWasmSubpackageSync(wasmSubpackage)
        wasmSubpackage = undefined
      }
      if (cleanupWasmTimer) {
        clearTimeout(cleanupWasmTimer)
        cleanupWasmTimer = undefined
      }
      process.off('exit', cleanup)
      cleanupWasmOnExit = undefined
    }
    cleanupWasmOnExit = cleanup
    process.once('exit', cleanup)
  }

  return {
    name: 'weapp-sqlite',
    enforce: 'post',
    async config(userConfig) {
      const config = userConfig as typeof userConfig & { root?: string, weapp?: { srcRoot?: string, autoRoutes?: unknown, subPackages?: Record<string, unknown> } }
      projectRoot = path.resolve(config.root ?? process.cwd())
      sourceRoot = config.weapp?.srcRoot ?? 'src'
      const weapp = config.weapp ??= {}
      if (debug.enabled) {
        debugPage = await generateDebugPage(projectRoot, sourceRoot, debug.route, debug.configFile)
        weapp.autoRoutes = debugAutoRoutes(weapp.autoRoutes, debugPage.root)
        weapp.subPackages = { ...weapp.subPackages, [debugPage.root]: weapp.subPackages?.[debugPage.root] ?? {} }
      }
      if (wasm.weappPackage !== 'main' && wasm.weappPackage.mode === 'generated-subpackage') {
        const root = wasmSubpackageRoot(wasm.weappPackage)
        await assertGeneratedSubpackageAppConfig(projectRoot, sourceRoot)
        ownWasmSubpackage(await generateWasmSubpackage(projectRoot, sourceRoot, wasm.weappPackage, wasm.variant))
        weapp.autoRoutes = debugAutoRoutes(weapp.autoRoutes, root)
        weapp.subPackages = { ...weapp.subPackages, [root]: weapp.subPackages?.[root] ?? {} }
      }
      return {
        define: { __WEAPP_SQLITE_DEBUG__: JSON.stringify(debug.enabled) },
        ...(weapp.autoRoutes === undefined && weapp.subPackages === undefined
          ? {}
          : {
              weapp: {
                ...(weapp.autoRoutes === undefined ? {} : { autoRoutes: weapp.autoRoutes }),
                ...(weapp.subPackages === undefined ? {} : { subPackages: weapp.subPackages }),
              },
            }),
      }
    },
    async configResolved(config) {
      target = resolveTarget(config)
      asset = targetAsset(target, wasm.variant)
      emittedAssetPath = `/assets/${asset}`
      if (target === 'weapp' && wasm.weappPackage !== 'main') {
        const root = wasmSubpackageRoot(wasm.weappPackage)
        if (wasm.weappPackage.mode === 'existing-subpackage') {
          await validateExistingWasmSubpackage(config, root)
          ownWasmSubpackage(await generateWasmSubpackage(projectRoot, sourceRoot, wasm.weappPackage, wasm.variant))
        }
        if (!wasmSubpackage) {
          throw new Error('The generated SQLite WASM subpackage was not prepared before target resolution.')
        }
        emittedAssetPath = `/${wasmSubpackage.root}/assets/${asset}`
        if (wasm.weappPackage.mode === 'generated-subpackage') {
          await registerGeneratedWasmSubpackage(config, wasmSubpackage)
        }
      }
      else if (wasmSubpackage && cleanupWasmOnExit) {
        cleanupWasmOnExit()
        const compiler = compilerFromConfig(config)
        compiler?.autoRoutesService.markDirty()
        await compiler?.autoRoutesService.ensureFresh()
        compiler?.scanService.markDirty()
        await compiler?.scanService.loadAppEntry()
      }
      if (debugPage) {
        await applyDebugRoutesToCompiler(config, debugPage)
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_RUNTIME_ID) {
        return RESOLVED_RUNTIME_ID
      }
      if (id === '@weapp-sqlite/sqljs/full' || id === '@weapp-sqlite/sqljs/lite') {
        return require.resolve(id)
      }
    },
    load(id) {
      if (id === RESOLVED_RUNTIME_ID) {
        if (!target) {
          throw new Error('The weapp-sqlite runtime was loaded before the target was resolved.')
        }
        if (!emittedAssetPath) {
          throw new Error('The weapp-sqlite asset path has not been resolved.')
        }
        return virtualRuntimeSource(target, wasm.variant, emittedAssetPath, wasmSubpackage?.loaderPath)
      }
    },
    async buildStart() {
      if (!asset) {
        throw new Error('The weapp-sqlite build started before the target was resolved.')
      }
      this.emitFile({
        type: 'asset',
        fileName: emittedAssetPath?.replace(/^\/+/, '') ?? `assets/${asset}`,
        source: await loadAsset(),
      })
    },
    generateBundle(_outputOptions, bundle) {
      if (!wasmSubpackage) {
        return
      }
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          output.code = rewriteWasmSubpackageLoader(output.code, output.fileName, wasmSubpackage)
        }
      }
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        if (!asset || !emittedAssetPath || request.url?.split('?', 1)[0] !== emittedAssetPath) {
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
      if (debugPage) {
        const markerPath = path.join(debugPage.directory, '.weapp-sqlite-generated')
        const marker = await readFile(markerPath, 'utf8').catch(() => undefined)
        if (marker === GENERATED_PAGE_MARKER) {
          await rm(debugPage.directory, { recursive: true, force: true })
        }
        debugPage = undefined
      }
      if (wasmSubpackage && cleanupWasmOnExit && !cleanupWasmTimer) {
        cleanupWasmTimer = setTimeout(cleanupWasmOnExit, 30_000)
        cleanupWasmTimer.unref?.()
      }
    },
  }
}

export type {
  SqliteWasmVariant,
  WeappSqliteDebugAppConfigOptions,
  WeappSqliteDebugPageOptions,
  WeappSqliteDebugPluginOptions,
  WeappSqlitePluginOptions,
  WeappSqliteWasmPackage,
} from './types'
