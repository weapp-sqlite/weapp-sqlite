import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <Image
            src="/weapp-sqlite-icon.svg"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
            className="h-7 w-7 rounded-lg"
          />
          <span className="font-mono text-sm font-semibold tracking-tight">
            {appName}<span className="ml-1 text-emerald-500">/</span>
          </span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
