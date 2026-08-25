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

Use Node.js 22.12+ and pnpm 11:

```bash
pnpm install
pnpm validate
pnpm --filter @weapp-sqlite/core test
pnpm --filter @weapp-sqlite/wasm test
```

Run `pnpm change` for every user-visible package change. Changeset summaries
must be written in Chinese. Do not commit `dist`, coverage, `.turbo`, or
workspace `node_modules` output.

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
