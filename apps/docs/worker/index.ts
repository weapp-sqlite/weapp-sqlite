interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetFetcher
}

interface WorkerHandler {
  fetch(request: Request, env: Env): Promise<Response>
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === 'sqlite.icebreaker.top') {
      url.hostname = 'sqlite.weapp.dev'
      return Promise.resolve(Response.redirect(url.toString(), 301))
    }

    return env.ASSETS.fetch(request)
  },
} satisfies WorkerHandler
