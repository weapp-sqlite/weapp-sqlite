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
    return env.ASSETS.fetch(request)
  },
} satisfies WorkerHandler
