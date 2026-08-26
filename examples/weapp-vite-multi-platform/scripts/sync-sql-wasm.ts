import { copyFile, mkdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sqlJsEntry = require.resolve('sql.js')
const assets = ['sql-wasm.wasm', 'sql-wasm-browser.wasm'] as const
const destinationDirectory = path.resolve(import.meta.dirname, '../.generated/public/assets')

await mkdir(destinationDirectory, { recursive: true })

for (const asset of assets) {
  const source = path.join(path.dirname(sqlJsEntry), asset)
  const destination = path.join(destinationDirectory, asset)
  await copyFile(source, destination)

  const sourceSize = (await stat(source)).size
  const destinationSize = (await stat(destination)).size
  if (sourceSize === 0 || sourceSize !== destinationSize) {
    throw new Error(`SQLite WASM asset copy failed: source=${sourceSize}, destination=${destinationSize}`)
  }
}

console.log(JSON.stringify({ assets, destinationDirectory }))
