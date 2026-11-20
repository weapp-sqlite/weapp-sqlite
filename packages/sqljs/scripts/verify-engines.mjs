import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Structural assertion: every decoder construction in a glue artifact — `new
// TextDecoder` and its `new globalThis.TextDecoder` spelling — must sit in the
// same expression, directly behind a `globalThis.TextDecoder` guard, so a host
// without that global falls back to the decoder emscripten ships instead of
// throwing. Nothing here reads a reference artifact, a fixture, or the network.
const artifactNames = ['sql-wasm.js', 'sql-wasm-lite.js', 'sql-wasm-browser.js']
const guardAdjacency = /globalThis\s*\.\s*TextDecoder\s*(?:&&|\?)\s*$/
// Both the bare and the `globalThis.`-prefixed spelling construct the decoder, so
// both are construction points that a guard has to cover.
const constructionPattern = /\bnew\s+(?:globalThis\s*\.\s*)?TextDecoder\b/g
// Match offsets are character offsets, so the lookbehind window is measured in
// UTF-16 code units rather than bytes.
const guardWindowLength = 200
const adjacencyAssertion = 'text-decoder-guard-adjacent'
const presenceAssertion = 'text-decoder-guarded-construction-present'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = path.join(packageRoot, 'src/vendor')

function constructionOffsets(source) {
  return [...source.matchAll(constructionPattern)].map(match => match.index)
}

function isGuarded(source, offset) {
  const window = source.slice(Math.max(0, offset - guardWindowLength), offset)
  return guardAdjacency.test(window)
}

async function inspectArtifact(fileName) {
  const source = await readFile(path.join(vendorRoot, fileName), 'utf8')
  const offsets = constructionOffsets(source)
  const unguarded = offsets.filter(offset => !isGuarded(source, offset))
  if (unguarded.length > 0) {
    return unguarded.map(offset => `${fileName}: ${adjacencyAssertion}: unguarded TextDecoder construction at character offset ${offset}`)
  }
  if (offsets.length === 0) {
    return [`${fileName}: ${presenceAssertion}: no guarded TextDecoder construction`]
  }
  return []
}

const violations = []
for (const fileName of artifactNames) {
  violations.push(...await inspectArtifact(fileName))
}

if (violations.length === 0) {
  process.stdout.write(`verify-engines: ${artifactNames.length} artifact(s) guard TextDecoder\n`)
}
else {
  for (const violation of violations) {
    process.stdout.write(`${violation}\n`)
  }
  process.stdout.write(`verify-engines: ${violations.length} violation(s) across ${artifactNames.length} artifact(s)\n`)
  process.exitCode = 1
}
