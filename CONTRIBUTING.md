# Contributing to weapp-sqlite

We welcome bug fixes, documentation, tests, and focused proposals for the SQLite runtime and its host adapters.

## Development setup

1. Use Node.js 24.22.1 and pnpm 12.14.0. The repository toolchain supports `^22.23.4 || ^24.22.1 || >=26.12.1`.
2. Run `pnpm install`; it installs the Lefthook 2.2.2 Git hooks.
3. Create a focused branch from `main`.
4. Keep host-neutral APIs in `packages/core` and host or engine behavior in the corresponding adapter.
5. Add unit coverage and a `tsd` assertion for public API changes. Run real engine or host acceptance checks when the affected boundary requires them.

Before opening a pull request, run:

```bash
pnpm validate
pnpm docs:test
```

`pnpm validate` includes the release source regressions and public package tarball checks. Documentation changes also need a successful `pnpm docs:build`. Platform claims require the corresponding host evidence; a Node test alone does not establish mini-program compatibility.

Use Conventional Commits. Create a change intent with `pnpm change` for every user-visible package change and write its summary in Chinese. Tooling-only or documentation-only changes do not need a fabricated package release.

## Repository tooling

repoctl 6.0.1 manages shared tooling, release orchestration, and preview/stable documentation channels. Review `repo upgrade --dry-run --json` before applying managed asset updates. Preserve the project's dependency compatibility policy, custom CI checks, and release recovery tests when merging template changes. Use ESLint for formatting; do not introduce Prettier.

Stable versions are prepared through release PRs. The daily snapshot uses the npm tag `snapshot-nightly`; it does not consume change intents or replace `latest`. See [RELEASE.md](./RELEASE.md) for channel behavior, website rollout, and recovery.

Report bugs or propose features in [weapp-sqlite issues](https://github.com/weapp-sqlite/weapp-sqlite/issues). Follow [SECURITY.md](./SECURITY.md) for vulnerability reports.
