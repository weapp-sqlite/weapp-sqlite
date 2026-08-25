import { createStringStorage, runSqliteDemo } from '@weapp-sqlite/demo-shared'

interface WechatStorageApi {
  getStorage: (options: { key: string, success: (result: { data: string }) => void, fail: () => void }) => void
  setStorage: (options: { key: string, data: string, success: () => void, fail: () => void }) => void
}

const host = globalThis as typeof globalThis & { wx?: WechatStorageApi }

export function runPlatformSqliteDemo() {
  const storage = host.wx
    ? createStringStorage({
        load: name => new Promise((resolve) => {
          host.wx?.getStorage({ key: name, success: result => resolve(result.data), fail: () => resolve(undefined) })
        }),
        save: (name, value) => new Promise((resolve, reject) => {
          host.wx?.setStorage({ key: name, data: value, success: () => resolve(), fail: reject })
        }),
      })
    : undefined
  return storage
    ? runSqliteDemo({ storage, locateFile: file => `/assets/${file}` })
    : runSqliteDemo({ locateFile: file => `/assets/${file}` })
}
