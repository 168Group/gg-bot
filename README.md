# OMOBot

An open-source, self-hostable Discord bot and staff dashboard by OMOWorlds. Configure the name, guild and staff access for your community. Each deployment serves one Discord guild.

**Current milestone:** pluggable module packages with scoped data, background jobs, command metadata and a working scaffold; channel creation/update/deletion logging, durable delivery, Discord OAuth, staff authorization, configurable routing/exclusions/metadata retention, diagnostics, and a development example module. Full message/member/role/voice/moderation logging is still unfinished. See [HANDOFF.md](HANDOFF.md) and [ROADMAP.md](ROADMAP.md).

## Set up your own bot in the browser

Run `pnpm build` then `pnpm start` (after installing the pinned dependencies). Open the setup URL and enter the installation key from the terminal. Choose managed local PocketBase, deploy to your own PocketBase over SFTP, or connect PostgreSQL. The wizard applies migrations, stores an encrypted profile and lets you configure Discord and activate the services. No application `.env` editing is needed on this path.

See [guided setup](docs/SETUP.md) for credentials, host prerequisites and provider switching. The bot does not yet transfer data between providers. Existing PocketHost instances need an SFTP deployment key; a host with automatic hook reload disabled may need its restart control.

## Try the local PocketBase demo

Use Node **24.21.0** (`nvm use`) and pnpm **10.34.5**. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm pocketbase:install
pnpm build:demo
pnpm demo
```

Open **http://localhost:3000/auth/demo**. The fixture console uses actual PocketBase storage on localhost:8091, but no Discord connection or real message sends. Its database persists in ignored `.local/demo-pocketbase`. Stop with Ctrl+C. Demo authentication is prohibited in production.

The demo includes the example module; production builds omit its dashboard page and production registries omit its API/bot module.

## Add server-specific modules

Run `pnpm module:create community-events` to scaffold and register a package with its own bot handlers, API and page. Use `pnpm module:add <id>` for an existing local package and `pnpm module:remove <id>` to remove it from a deployment while retaining its data. Rebuild/restart, then configure and enable it through Modules.

See [the module authoring guide](docs/MODULES.md) for data, delayed jobs, permissions, secrets, settings upgrades and custom integrations. Each deployment chooses packages in `modules/installed.json`; these are trusted build-time packages.

Keep shared improvements in `omo-bot` and community-specific modules in downstream repositories. See [the repository workflow](docs/REPOSITORY_WORKFLOW.md) for preserving shared history and bringing upstream updates into each bot.

## Choose storage

`STORAGE_PROVIDER=pocketbase` is the default and recommended path for our PocketHost instances. Upload the small hook/migration bundle and configure an instance key. Follow [PocketHost setup](docs/POCKETHOST.md).

`STORAGE_PROVIDER=postgres` keeps PostgreSQL 17 supported. Set `DATABASE_URL` and a separate `MIGRATION_DATABASE_URL`, then run `pnpm db:migrate`. Existing databases upgrade through additive committed migrations. The storage refactor invalidates previously unscoped dashboard sessions; sign in again.

Both backends use the same application and module behavior. Selecting a provider does **not** copy existing data. Standalone SQLite and cross-provider data migration are deferred.

## Connect a test Discord server

1. Copy `.env.example` to `.env`, fill the deployment values privately, and configure the selected storage backend.
2. Create a dedicated Discord test application. Register `http://localhost:3000/auth/discord/callback` exactly for local development. The OAuth scopes are `identify` and `guilds.members.read`.
3. Invite the bot to the configured guild with View Channels, Send Messages, Embed Links and Read Message History where needed. The bundled logging collector requests `Guilds`; additional installed modules declare their own intents and permissions. Enable any required privileged intents in the developer portal.
4. Run `pnpm db:migrate` (PostgreSQL migration or PocketBase schema verification), then `pnpm discord:commands:sync` explicitly.
5. Run `pnpm dev`. Open http://localhost:3000. Vite proxies API/OAuth to Fastify on localhost:3002; bot health is localhost:3001. This keeps login and CSRF on one browser origin.
6. Sign in with an approved owner/admin account, choose a private text destination, save routing, enable Logging in Modules, wait for acknowledgement, and send a test from Diagnostics.

Bot and web services run separately. Only the bot service receives `DISCORD_BOT_TOKEN`; only web receives the OAuth secret and session encryption key. The browser receives neither those values nor database credentials.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Integration tests start isolated actual PostgreSQL/PocketBase processes on loopback. They do not use your remote Docker host or production database. `pnpm pocketbase:install` is required first. Browser tests build the fixture frontend into `dist/dashboard-demo`, start a PocketBase fixture console on port 3100 with storage on 8092, and run a separate setup manager on 3200. Production frontend output remains in `dist/dashboard`.

For a production build use `pnpm build`, not `build:demo`. Docker Compose templates exist for [PocketHost](infra/compose.pockethost.yaml) and [PostgreSQL](infra/compose.yaml); image deployment and live Discord verification are not yet certified. Exact verification status is in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## License and hosting

OMOBot is licensed under [Apache 2.0](LICENSE). You may self-host it free of license fees, modify it, build private custom modules and offer commercial hosting, subject to the license terms. Preserve required notices when redistributing it. Infrastructure costs are your responsibility.

OMOWorlds may offer optional paid managed hosting, updates, backups and support. No hosted service is being announced as available with this release. The self-hosted code remains available under its license. The license does not grant rights to imply OMOWorlds endorsement or use its trademarks beyond the license's terms.

Dependencies and bundled fonts retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). The package manifest's `private: true` prevents accidental npm publication; it does not restrict self-hosting or the source license.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md) to report vulnerabilities privately.
