import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://sqlite.weapp.dev'),
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
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
