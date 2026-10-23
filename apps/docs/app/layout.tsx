import { Provider } from '@/components/provider';
import { docsDeployment } from '@/lib/deployment';
import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  metadataBase: docsDeployment.url,
  robots: docsDeployment.isPreview
    ? { index: false, follow: false, noarchive: true }
    : { index: true, follow: true },
  title: {
    default: 'weapp-sqlite',
    template: '%s | weapp-sqlite',
  },
  description: '面向小程序与 Web 的可插拔 SQLite driver。',
  icons: {
    icon: [
      { url: '/weapp-sqlite-icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  },
  openGraph: {
    type: 'website',
    siteName: 'weapp-sqlite',
    locale: 'zh_CN',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {docsDeployment.isPreview && (
          <aside className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-sm" aria-label="预览文档提示">
            这是未发布的预览文档，内容可能与正式版本不同。{' '}
            <a className="font-medium underline underline-offset-4" href="https://sqlite.weapp.dev/">
              查看正式文档
            </a>
          </aside>
        )}
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
