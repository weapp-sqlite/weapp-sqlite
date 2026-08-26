import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { argv } from 'node:process'

const require = createRequire(import.meta.url)
const sqlJsEntry = require.resolve('sql.js')
const target = argv[2] ?? 'weapp'
const asset = target === 'web' ? 'sql-wasm-browser.wasm' : 'sql-wasm.wasm'
const destinationDirectory = path.resolve(import.meta.dirname, '../.generated/public/assets')

await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

const source = path.join(path.dirname(sqlJsEntry), asset)
const destination = path.join(destinationDirectory, asset)
await copyFile(source, destination)

const sourceSize = (await stat(source)).size
const destinationSize = (await stat(destination)).size
if (sourceSize === 0 || sourceSize !== destinationSize) {
  throw new Error(`SQLite WASM asset copy failed: source=${sourceSize}, destination=${destinationSize}`)
}

console.log(JSON.stringify({ asset, destinationDirectory, target }))
