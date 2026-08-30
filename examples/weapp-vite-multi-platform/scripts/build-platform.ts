import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

const target = process.argv[2]
if (!target) {
  throw new Error('A build target is required.')
}

await execa('wv', ['build', '-p', target], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit' })
