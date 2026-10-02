interface Server {
  readonly url: string
  readonly runtimeEndpoint: string
  readonly runtimeToken: string
  close: () => Promise<void>
}

/** 一个构建实例只拥有一个调试服务，watch 重建复用同一连接凭证。 */
export function createSqliteDevtoolsHost(start = async (): Promise<Server> => {
  try {
    const { startSqliteDevtoolsServer } = await import('@weapp-sqlite/devtools')
    return await startSqliteDevtoolsServer({ allowWrite: true })
  }
  catch (error) {
    throw new Error('SQLite DevTools could not start. Install @weapp-sqlite/devtools and rebuild its client assets.', { cause: error })
  }
}) {
  let pending: Promise<Server> | undefined
  let closed = false
  let closing: Promise<void> | undefined
  return {
    start() {
      if (closed) {
        return Promise.reject(new Error('The SQLite DevTools host has been closed.'))
      }
      return pending ??= start().catch((error) => {
        pending = undefined
        throw error
      })
    },
    close() {
      closed = true
      return closing ??= (async () => {
        const server = await pending?.catch(() => undefined)
        await server?.close()
      })()
    },
  }
}
