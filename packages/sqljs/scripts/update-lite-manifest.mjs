import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(packageRoot, 'src/vendor/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

for (const fileName of Object.keys(manifest.artifacts)) {
  const bytes = await readFile(path.join(packageRoot, 'src/vendor', fileName))
  manifest.artifacts[fileName] = {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
