# Security Policy

## Supported versions

Report security issues against the latest stable release of the affected `weapp-sqlite` package. The `snapshot-nightly` channel is intended for testing upcoming changes and does not replace a stable release.

## Reporting a vulnerability

Do not publish exploit details in a public issue. Use [weapp-sqlite's private vulnerability reporting](https://github.com/weapp-sqlite/weapp-sqlite/security/advisories/new).

Include the affected package and version, host and engine, impact, reproduction steps, and any proposed mitigation. Remove database contents, credentials, access tokens, and personal data from shared evidence. Maintainers will coordinate validation and disclosure with the reporter.

## Scope

Reports involving SQLite adapter boundaries, persistent storage, debug tools and their authentication, unsafe query handling, package publication, or documentation deployment credentials are in scope. Vulnerabilities in upstream dependencies should also be reported to their maintainers when appropriate.
