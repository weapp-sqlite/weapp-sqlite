import type { MetadataRoute } from 'next';
import { docsDeployment } from '@/lib/deployment';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: docsDeployment.isPreview
      ? { userAgent: '*', disallow: '/' }
      : { userAgent: '*', allow: '/' },
  };
}
