import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'src/vendor/manifest.json'), 'utf8'))
const maximumWasmBytes = 592_569
const maximumCombinedBytes = Math.floor(749_147 * 0.9)

let combinedBytes = 0
for (const [section, directory] of [['artifacts', 'src/vendor'], ['licenses', 'src/vendor'], ['patches', 'docker']]) {
  for (const [fileName, expected] of Object.entries(manifest[section])) {
    const bytes = await readFile(path.join(packageRoot, directory, fileName))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== expected.bytes || sha256 !== expected.sha256) {
      throw new Error(`${fileName} does not match manifest.json.`)
    }
    if (section === 'artifacts' && fileName.startsWith('sql-wasm-lite.')) {
      combinedBytes += bytes.byteLength
    }
  }
}

const wasmBytes = manifest.artifacts['sql-wasm-lite.wasm'].bytes
if (wasmBytes > maximumWasmBytes) {
  throw new Error(`Lite WASM exceeds ${maximumWasmBytes} bytes: ${wasmBytes}.`)
}
if (combinedBytes > maximumCombinedBytes) {
  throw new Error(`Lite WASM and glue exceed ${maximumCombinedBytes} bytes: ${combinedBytes}.`)
}

const builtGlue = await readFile(path.join(packageRoot, 'dist/vendor/sql-wasm-lite.js')).catch(() => undefined)
const publishedCombinedBytes = builtGlue ? combinedBytes + builtGlue.byteLength : undefined
if (publishedCombinedBytes && publishedCombinedBytes > maximumCombinedBytes) {
  throw new Error(`Published lite WASM and glue exceed ${maximumCombinedBytes} bytes: ${publishedCombinedBytes}.`)
}

process.stdout.write(`${JSON.stringify({
  wasmBytes,
  sourceCombinedBytes: combinedBytes,
  publishedCombinedBytes,
  maximumWasmBytes,
  maximumCombinedBytes,
})}\n`)
