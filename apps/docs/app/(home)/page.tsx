import Link from 'next/link';
import Image from 'next/image';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16 lg:px-8">
      <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="mb-8 flex items-center gap-4">
            <Image src="/weapp-sqlite-avatar.svg" alt="weapp-sqlite" width={64} height={64} priority />
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-fd-muted-foreground">Open source</p>
              <p className="text-sm text-fd-muted-foreground">SQLite for mini programs and Web</p>
            </div>
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-fd-foreground md:text-6xl">
            在多端小程序里，使用同一套 SQLite 业务代码
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
            weapp-sqlite 将异步数据库协议与 SQLite WASM 引擎解耦，保留宿主存储的选择权，覆盖 weapp-vite、Taro、uni-app、MPX 和 Web。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/docs" className="inline-flex h-11 items-center rounded-lg bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90">
              阅读文档
            </Link>
            <a href="https://github.com/weapp-sqlite/weapp-sqlite" className="inline-flex h-11 items-center rounded-lg border border-fd-border px-5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent">
              查看 GitHub
            </a>
          </div>
        </section>
        <section className="border border-fd-border bg-fd-card p-6 shadow-sm">
          <p className="text-sm font-medium text-fd-muted-foreground">从这里开始</p>
          <div className="mt-5 space-y-3">
            <Link href="/docs/getting-started" className="block rounded-lg border border-fd-border p-4 transition-colors hover:bg-fd-accent">
              <span className="font-medium text-fd-foreground">快速开始</span>
              <span className="mt-1 block text-sm text-fd-muted-foreground">安装 core、WASM adapter，并跑通第一条查询。</span>
            </Link>
            <Link href="/docs/multi-platform" className="block rounded-lg border border-fd-border p-4 transition-colors hover:bg-fd-accent">
              <span className="font-medium text-fd-foreground">多端接入</span>
              <span className="mt-1 block text-sm text-fd-muted-foreground">查看四套 demo 的构建命令与宿主边界。</span>
            </Link>
            <Link href="/docs/deployment" className="block rounded-lg border border-fd-border p-4 transition-colors hover:bg-fd-accent">
              <span className="font-medium text-fd-foreground">部署说明</span>
              <span className="mt-1 block text-sm text-fd-muted-foreground">了解 WASM 静态资源和 Cloudflare 静态站点部署。</span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
