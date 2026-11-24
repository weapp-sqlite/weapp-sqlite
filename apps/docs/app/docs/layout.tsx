import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { cn } from '@/lib/cn';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <div className={cn(
      'docs-shell min-h-screen',
      'dark:[--ws-paper:var(--color-fd-background)]',
      'not-dark:[&_:where(#nd-toc,[data-toc-popover])]:[--color-fd-muted-foreground:#565f5b]',
    )}>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </div>
  );
}
