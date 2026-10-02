import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(packageRoot, 'src/vendor/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

for (const [section, directory] of [['artifacts', 'src/vendor'], ['licenses', 'src/vendor'], ['patches', 'docker']]) {
  for (const fileName of Object.keys(manifest[section])) {
    const bytes = await readFile(path.join(packageRoot, directory, fileName))
    manifest[section][fileName] = {
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
