# Implementation handoff

Updated 2026-09-24. OMOBot is a modular, self-hostable Discord bot by OMOWorlds, released under Apache 2.0. One deployment serves one configured guild. README is the public entry point; ROADMAP records unfinished work.

## Current implementation

The workspace separates the Discord bot, Fastify dashboard API, React dashboard and managed setup launcher. PocketBase is the primary storage provider; PostgreSQL implements the same typed operations. Direct SQLite support and cross-provider data transfer remain deferred.

Trusted build-time module packages provide definitions, bot handlers, protected API routes and dashboard pages. `pnpm module:create <id>` scaffolds a package and updates the generated registries. Modules have namespaced JSON records, delayed jobs, command/intent metadata, selected-channel message subscriptions, declared secrets and sequential settings migrations. See docs/MODULES.md. Installation requires a rebuild/restart; dashboard enablement and configuration are runtime actions.

Logging currently covers channel creation, edits and deletion, with durable delivery, diagnostics, exclusions and retention. Full message/member/role/voice/moderation coverage and confirmed audit attribution are unfinished. The example module demonstrates a persisted background task and is excluded from production registration.

The guided setup launcher provisions local PocketBase, uploads a first-install PocketBase hook bundle over SFTP, or migrates an existing PostgreSQL database. Activation verifies Discord credentials, synchronizes commands and supervises separate bot/web services. Real Discord and hosted PocketHost deployment acceptance remain outstanding.

## Verified state

The foundation passed typecheck, lint, builds, 18 unit tests, 53 real database/integration tests and eight desktop/mobile browser tests locally and in GitHub Actions before public-release preparation. See docs/VERIFICATION.md. No production credentials were used.

## Load-bearing details

- Use the pinned Node/pnpm versions. Runtime profiles, `.env`, databases, dependencies, builds and screenshots are ignored by Git.
- Keep migrations immutable. PocketBase uses private `omo_` SQL tables behind authenticated hooks, not public collections. Upload the complete hook/migration bundle.
- PocketBase has a 60-second worker lease renewed every 10 seconds; mutations validate ownership and claim tokens. PostgreSQL uses a session advisory lock. Neither provider makes external Discord/API writes exactly once.
- Bound external requests and make jobs idempotent. Trusted in-process handlers must settle; the host cannot forcibly cancel arbitrary module code.
- Production and fixture frontends use `dist/dashboard` and `dist/dashboard-demo`. Do not rebuild served assets during browser tests.
- Existing differing remote hook/migration files are refused. Automatic version-aware upgrades, provider data transfer and PocketHost account/instance creation are not implemented.
- Keep one managed launcher per installation directory. Back up its encryption key and encrypted profiles together.
- The committed headless PocketBase hook suppresses automatic installer tabs before first startup, including tests. Do not remove it. Useful browser previews are separate from this behavior.
- A process-group demo interruption can stop PocketBase before lease release. Immediate restarts may fail until lease expiry, and failed demo startup can leave a child process. See ROADMAP; never bypass the singleton lock.

## Next work

Finish the live Discord/PocketHost acceptance check, expand logging and audit correlation, and harden deployment recovery. Build community-specific integrations only against confirmed API contracts, keeping private settings and credentials outside the repository.
