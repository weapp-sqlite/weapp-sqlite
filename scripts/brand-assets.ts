import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// The two editable SVG sources are the only geometry used by every variant.
const root = new URL('../', import.meta.url)
const check = process.argv.includes('--check')
const ink = '#08141d'
const white = '#ffffff'

function content(svg: string): string {
  return svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--.*?-->/gs, '').trim()
}

function svg(viewBox: string, title: string, description: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${description}</desc>
  ${body}
</svg>
`
}

const symbol = content(await readFile(new URL('assets/source/symbol.svg', root), 'utf8'))
const wordmarkSource = await readFile(new URL('assets/source/wordmark.svg', root), 'utf8')
const wordmark = content(wordmarkSource)
const bounds = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(wordmarkSource)
if (!bounds) {
  throw new Error('The wordmark source must have a zero-origin viewBox')
}
const wordmarkWidth = Number(bounds[1])
const wordmarkHeight = Number(bounds[2])
const description = 'Two interlocking data blocks with an S-shaped channel for SQLite'
const icon = svg('0 0 64 64', 'weapp-sqlite icon', description, symbol)
const avatar = svg('0 0 512 512', 'weapp-sqlite avatar', description, `<rect width="512" height="512" rx="112" fill="${ink}"/>
  <g transform="translate(64 64) scale(6)">${symbol}</g>`)

function lockup(color: string, monochrome: boolean): string {
  const mark = monochrome ? symbol.replace(/#[\da-f]{6}/gi, color) : symbol
  return svg(`0 0 ${(wordmarkWidth + 96).toFixed(3)} 80`, 'weapp-sqlite', description, `<g transform="translate(8 8)">${mark}</g>
  <g transform="translate(88 ${((80 - wordmarkHeight) / 2).toFixed(3)})">${wordmark.replaceAll('currentColor', color)}</g>`)
}

const outputs = new Map<string, string | Buffer>([
  ['assets/weapp-sqlite-icon.svg', icon],
  ['assets/weapp-sqlite-avatar.svg', avatar],
  ['assets/weapp-sqlite-logo-horizontal.svg', lockup(ink, false)],
  ['assets/weapp-sqlite-logo-monochrome.svg', lockup(ink, true)],
  ['assets/weapp-sqlite-logo-reversed.svg', lockup(white, true)],
  ['apps/docs/public/weapp-sqlite-icon.svg', icon],
  ['apps/docs/public/weapp-sqlite-avatar.svg', avatar],
])

for (const [path, source, size] of [
  ['assets/weapp-sqlite-avatar.png', avatar, 512],
  ['apps/docs/public/favicon-16.png', icon, 16],
  ['apps/docs/public/favicon-32.png', icon, 32],
  ['apps/docs/public/apple-touch-icon.png', avatar, 180],
] as const) {
  outputs.set(path, await sharp(Buffer.from(source)).resize(size, size).png().toBuffer())
}

const stale: string[] = []
for (const [path, data] of outputs) {
  const target = new URL(path, root)
  if (check) {
    const actual = await readFile(target).catch(() => undefined)
    if (!actual?.equals(Buffer.from(data))) {
      stale.push(path)
    }
  }
  else {
    await mkdir(new URL('.', target), { recursive: true })
    await writeFile(target, data)
  }
}
if (stale.length) {
  throw new Error(`Brand assets are out of date. Run pnpm brand:generate:\n${stale.join('\n')}`)
}
console.log(`${check ? 'Checked' : 'Generated'} ${outputs.size} brand assets in ${fileURLToPath(root)}`)
