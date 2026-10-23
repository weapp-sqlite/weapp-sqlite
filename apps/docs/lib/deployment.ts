const channel = process.env.REPO_DOCS_CHANNEL ?? 'preview';

if (channel !== 'preview' && channel !== 'stable') {
  throw new Error(`Unsupported documentation channel: ${channel}`);
}

export const docsDeployment = {
  channel,
  isPreview: channel === 'preview',
  url: new URL(process.env.REPO_DOCS_URL ?? (
    channel === 'stable'
      ? 'https://sqlite.weapp.dev'
      : 'https://preview.sqlite.weapp.dev'
  )),
};
