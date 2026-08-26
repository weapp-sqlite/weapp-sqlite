import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { demoRoot } from './acceptance-paths'

const host = '127.0.0.1'
const port = Number(process.env['ACCEPTANCE_WEB_PORT'] ?? 4173)
const root = path.join(demoRoot, 'dist/web')
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}

const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url ?? '/', `http://${host}`).pathname)
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
    const candidate = path.resolve(root, relativePath)
    if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) {
      response.writeHead(400).end('Invalid path')
      return
    }
    let filePath = candidate
    try {
      if (!(await stat(filePath)).isFile()) {
        filePath = path.join(root, 'index.html')
      }
    }
    catch {
      filePath = path.join(root, 'index.html')
    }
    response.setHeader('Content-Type', contentTypes[path.extname(filePath)] ?? 'application/octet-stream')
    createReadStream(filePath).pipe(response)
  }
  catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, host, () => console.log(`Acceptance Web server: http://${host}:${port}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
