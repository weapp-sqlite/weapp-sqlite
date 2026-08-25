import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://sqlite.icebreaker.top'),
  title: {
    default: 'weapp-sqlite',
    template: '%s | weapp-sqlite',
  },
  description: '面向小程序与 Web 的可插拔 SQLite driver。',
  openGraph: {
    type: 'website',
    siteName: 'weapp-sqlite',
    locale: 'zh_CN',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
