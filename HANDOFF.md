# Implementation handoff

Updated 2026-09-30. OMOBot is a modular, self-hostable Discord bot by OMOWorlds, released under Apache 2.0. One deployment serves one configured guild. README is the public entry point; ROADMAP records unfinished work.

## Current implementation

The workspace separates the Discord bot, Fastify dashboard API, React dashboard and managed setup launcher. PocketBase is the primary storage provider; PostgreSQL implements the same typed operations. Direct SQLite support and cross-provider data transfer remain deferred.

Trusted build-time module packages provide definitions, bot handlers, protected API routes and dashboard pages. `pnpm module:create <id>` scaffolds a package and updates the generated registries. Modules have namespaced JSON records, delayed jobs, command/intent metadata, selected-channel message subscriptions, declared secrets and sequential settings migrations. See docs/MODULES.md. Installation requires a rebuild/restart; dashboard enablement and configuration are runtime actions.

Logging covers channel creation/updates/deletion, message edits/deletions (including bulk deletion), member nicknames and role assignment/removal, and voice joins/leaves. Voice moves produce a leave and a join. Ordinary messages create no persistent log entries. Durable delivery, diagnostics, exclusions and retention cover these events. Remaining event families and confirmed audit attribution are unfinished. See docs/LOGGING.md for deployment and content-retention details. The example module demonstrates a persisted background task and is excluded from production registration.

Discord channel logs now use readable summaries for creation/deletion and changed-property fields for updates. Permission updates show role/member overwrite transitions with bounded overflow summaries. Empty reasons and default optional settings are omitted; unknown actors remain explicit. Full raw snapshots are retained in dashboard event details. The routing preview shares the delivery renderer. The activity update adds typed renderers and dashboard switches, filters and previews. No database schema migration or PocketHost bundle update is needed; settings automatically migrate to version 2. Existing installations retain their configuration with all six new event switches off. Existing Discord messages are not rewritten.

The guided setup launcher provisions local PocketBase, uploads a first-install PocketBase hook bundle over SFTP, or migrates an existing PostgreSQL database. Activation verifies Discord credentials, synchronizes commands and supervises separate bot/web services. Real Discord and hosted PocketHost deployment acceptance remain outstanding.

## Verified state

The foundation passed typecheck, lint, builds, 18 unit tests, 53 real database/integration tests and eight desktop/mobile browser tests locally and in GitHub Actions before public-release preparation. See docs/VERIFICATION.md. No production credentials were used.

The channel-formatting fix passed local typecheck, lint, production/fixture builds, 28 unit tests, 53 database/integration tests and eight browser tests. Final renderer refinements were checked again with the unit suite and the two desktop/mobile routing-preview tests. Local screenshots were reviewed; a real Discord send and Railway deployment were not performed.

The activity-logging update passed typecheck, lint, 52 unit tests, 61 database/integration tests, production/fixture builds and ten desktop/mobile browser tests. Preview screenshots were reviewed. The initial new browser cases failed on an exact label selector; explicit accessible names fixed the selectors and the full suite then passed. Discord Gateway payloads and sends are simulated, not live acceptance.

## Load-bearing details

- Enable Server Members and Message Content privileged intents in the Discord application before starting this version, even when new event switches are off. Deploy matching bot and dashboard builds. No storage bundle change accompanies this update.
- The raw Gateway collector runs before discord.js updates member/voice caches. Preserve that ordering. Member baseline fetching is bounded to 15 seconds; missing baselines record gaps instead of fabricated changes.
- Discord.js MessageManager caching is explicitly disabled. The logging collector alone holds up to 1,000 messages for 30 minutes, with 4,000 content characters and ten attachment names per snapshot. Cache state clears on applied-policy changes, disconnect and shutdown; only edits/deletions persist content under event retention. Module message subscribers still receive live message content.
- Message/voice subjects are not channel IDs. Exclusion checks must use channelId, category and snapshot containerId (for thread parents), both before collection and before delivery. The existing PocketBase hooks persist generic events; the delivery worker performs the additional exclusion/event-switch recheck.
- Use the pinned Node/pnpm versions. Runtime profiles, `.env`, databases, dependencies, builds and screenshots are ignored by Git.
- Keep migrations immutable. PocketBase uses private `omo_` SQL tables behind authenticated hooks, not public collections. Upload the complete hook/migration bundle.
- Keep the delivery marker at the end of the log embed footer: transport retry reconciliation uses `endsWith(marker)`. Formatting changes must preserve mention suppression and Discord's field/aggregate text limits.
- PocketBase has a 60-second worker lease renewed every 10 seconds; mutations validate ownership and claim tokens. PostgreSQL uses a session advisory lock. Neither provider makes external Discord/API writes exactly once.
- Bound external requests and make jobs idempotent. Trusted in-process handlers must settle; the host cannot forcibly cancel arbitrary module code.
- Production and fixture frontends use `dist/dashboard` and `dist/dashboard-demo`. Do not rebuild served assets during browser tests.
- Existing differing remote hook/migration files are refused. Automatic version-aware upgrades, provider data transfer and PocketHost account/instance creation are not implemented.
- Keep one managed launcher per installation directory. Back up its encryption key and encrypted profiles together.
- The committed headless PocketBase hook suppresses automatic installer tabs before first startup, including tests. Do not remove it. Useful browser previews are separate from this behavior.
- A process-group demo interruption can stop PocketBase before lease release. Immediate restarts may fail until lease expiry, and failed demo startup can leave a child process. See ROADMAP; never bypass the singleton lock.

## Next work

Finish the live Discord/PocketHost acceptance check, expand logging and audit correlation, and harden deployment recovery. Build community-specific integrations only against confirmed API contracts, keeping private settings and credentials outside the repository.
