import { readFileSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'

export async function readGeneratedText(file: string) {
  try {
    return await readFile(file, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function writeGeneratedText(file: string, content: string) {
  if (await readGeneratedText(file) !== content) {
    await writeFile(file, content)
  }
}

export async function ensureGeneratedDirectory(directory: string, marker: string) {
  const markerPath = `${directory}/.weapp-sqlite-generated`
  const existing = await readGeneratedText(markerPath)
  if (existing !== undefined && existing !== marker) {
    throw new Error(`The generated SQLite WASM marker is invalid: ${markerPath}`)
  }
  if (existing === undefined) {
    const entries = await readdir(directory).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    })
    if (entries.length > 0) {
      throw new Error(`The generated SQLite WASM path conflicts with user files: ${directory}`)
    }
  }
  await mkdir(directory, { recursive: true })
  await writeGeneratedText(markerPath, marker)
}

export async function removeGeneratedDirectory(directory: string, marker: string) {
  if (await readGeneratedText(`${directory}/.weapp-sqlite-generated`) === marker) {
    await rm(directory, { recursive: true, force: true })
  }
}

function removeGeneratedDirectorySync(directory: string, marker: string) {
  let existing: string
  try {
    existing = readFileSync(`${directory}/.weapp-sqlite-generated`, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  if (existing === marker) {
    rmSync(directory, { recursive: true, force: true })
  }
}

interface GeneratedSourceOwner {
  readonly directories: ReadonlyMap<string, string>
  cleanup: () => Promise<void>
  scheduleCleanup: () => void
  detach: () => void
  settled: () => Promise<void>
}

const sourceOwners = new Map<string, GeneratedSourceOwner>()

/** 同一 loader 的后续配置代接管全部已拥有目录，旧构建只能撤销自己的计时器和退出订阅。 */
export async function ownGeneratedSources(key: string, directories: readonly string[], marker: string): Promise<GeneratedSourceOwner> {
  let previous = sourceOwners.get(key)
  while (previous) {
    await previous.settled()
    if (sourceOwners.get(key) === previous) {
      previous.detach()
      break
    }
    previous = sourceOwners.get(key)
  }
  const ownedDirectories = new Map(previous?.directories)
  for (const directory of directories) {
    ownedDirectories.set(directory, marker)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let cleaning: Promise<void> | undefined
  let owner: GeneratedSourceOwner
  let onExit: () => void
  const isCurrent = () => sourceOwners.get(key) === owner
  const detach = () => {
    if (isCurrent()) {
      sourceOwners.delete(key)
    }
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    process.off('exit', onExit)
  }
  onExit = () => {
    if (!isCurrent()) {
      return
    }
    try {
      for (const [directory, directoryMarker] of ownedDirectories) {
        removeGeneratedDirectorySync(directory, directoryMarker)
      }
      detach()
    }
    catch (error) {
      process.emitWarning(error instanceof Error ? error : new Error(String(error)))
    }
  }
  owner = {
    directories: ownedDirectories,
    detach,
    async settled() { await cleaning },
    async cleanup() {
      if (!isCurrent()) {
        return
      }
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      if (!cleaning) {
        cleaning = (async () => {
          for (const [directory, directoryMarker] of ownedDirectories) {
            await removeGeneratedDirectory(directory, directoryMarker)
          }
          detach()
        })().finally(() => { cleaning = undefined })
      }
      await cleaning
    },
    scheduleCleanup() {
      if (!isCurrent() || timer) {
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        onExit()
      }, 30_000)
      timer.unref?.()
    },
  }
  sourceOwners.set(key, owner)
  process.once('exit', onExit)
  return owner
}
