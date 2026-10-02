import path from 'node:path'
import process from 'node:process'
import { build } from 'vite'

async function main() {
  await build({
    configFile: false,
    root: path.resolve(import.meta.dirname, 'client'),
    base: './',
    build: { outDir: path.resolve(import.meta.dirname, 'dist/client'), emptyOutDir: true },
  })
}

void main().catch((error: unknown) => {
  void error
  process.exitCode = 1
})
