import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

const target = process.argv[2]
if (!target) {
  throw new Error('A build target is required.')
}

const sourcePath = path.resolve(import.meta.dirname, '../src/pages/index/index.wxml')
const stylePath = path.resolve(import.meta.dirname, '../src/pages/index/index.scss')
const source = await readFile(sourcePath, 'utf8')
const style = await readFile(stylePath, 'utf8')
const debugEnabled = process.env['WEAPP_SQLITE_DEBUG'] === '1'
const productionSource = source.replace(/\s*<!-- weapp-sqlite-debug:start -->[\s\S]*?<!-- weapp-sqlite-debug:end -->\s*/g, '\n')
const productionStyle = style.replace(/\s*\/\* weapp-sqlite-debug:start \*\/[\s\S]*?\/\* weapp-sqlite-debug:end \*\/\s*/g, '\n')

if (!debugEnabled) {
  await writeFile(sourcePath, productionSource)
  await writeFile(stylePath, productionStyle)
}
try {
  await execa('wv', ['build', '-p', target], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit' })
}
finally {
  if (!debugEnabled) {
    await writeFile(sourcePath, source)
    await writeFile(stylePath, style)
  }
}
