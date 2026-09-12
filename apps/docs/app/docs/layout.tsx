import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <div className="docs-shell min-h-screen">
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
      </DocsLayout>
    </div>
  );
}
