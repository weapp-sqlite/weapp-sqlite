# Repository Guidelines

## Scope

This repository contains the optional SQLite runtime for weapp-sqlite projects
multi-platform projects. Keep the host-neutral protocol in
`packages/core` and host or engine-specific code in separate packages.

- `packages/core`: async connections, serialized transactions, errors,
  and migrations. It must not import browser, mini-program, Node, or WASM APIs.
- `packages/wasm`: the injectable WASM engine adapter and persistence
  callback boundary. It must not assume a particular storage host.

Do not add platform-specific behavior to core. Add a separate adapter package
when a host needs native APIs, filesystem rules, or a different engine.

## Commands

Use Node.js 24.22.1 and pnpm 12.14.0 for repository development. The repoctl
6.0.1 toolchain supports `^22.23.4 || ^24.22.1 || >=26.12.1`; public runtime
packages retain their own existing Node.js engine requirements. Git hooks are
managed by Lefthook 2.2.2 and installed by `pnpm install`.

```bash
pnpm install
pnpm validate
pnpm docs:test
pnpm --filter @weapp-sqlite/core test
pnpm --filter @weapp-sqlite/wasm test
```

Run `pnpm change` for every user-visible package change. Changeset summaries
must be written in Chinese. Do not commit `dist`, coverage, `.turbo`, or
workspace `node_modules` output.

## Release and documentation channels

Use repoctl's release and documentation commands through the configured
workflows. Stable releases retain pnpm's full workspace version calculation,
including private dependency propagation; private workspaces are never published.
Keep the complete Git history and the release source/checkpoint regression tests.

Nightly runs from `main` daily at 00:00 UTC (08:00 Asia/Shanghai) and uses the
native `snapshot-nightly` npm tag. Do not rename it to `nightly`, advance `latest`,
or consume changesets for snapshots.

The website site has a `preview` channel at `preview.sqlite.weapp.dev` and a
`stable` channel at `sqlite.weapp.dev`. Preview follows `main`; stable requires
a complete stable release baseline. `docs:build` and `docs:test` are local
verification entrypoints. The `docs:deploy:preview` and `docs:deploy:stable`
scripts are repoctl deployment hooks for validated artifacts, not independent
build-and-deploy commands. See `RELEASE.md` for credentials, rollout, and recovery.

## Style

Use TypeScript ESM, two-space indentation, named exports, and ESLint for
formatting. Do not use Prettier. Keep public APIs asynchronous and preserve
parameter binding rather than interpolating SQL values into strings.

## Testing

Every public API change needs unit coverage and a `tsd` type assertion. Core
tests should use deterministic fake connections. Engine adapters should also
run an integration test against the real engine when practical. Host-specific
storage and mini-program IDE behavior require separate adapter tests; do not
claim cross-platform support based only on Node tests.
