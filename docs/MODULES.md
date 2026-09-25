# Building modules for OMOBot

OMOBot runs trusted local TypeScript packages. Each deployment selects its own packages in `modules/installed.json`; each server's staff can configure and enable the installed modules in the dashboard. A community event integration can live in `modules/community-events` and be omitted from every other deployment. This is a build-time package system, not a sandbox or a runtime ZIP uploader.

## Create, install and remove

Use Node from `.nvmrc` and the pinned pnpm version:

```sh
pnpm module:create community-events
pnpm typecheck
pnpm build
```

The create command generates a working package, adds it to `modules/installed.json`, and regenerates the bot, API, dashboard and definition registries. It refuses existing directories and unsafe/duplicate names. The generated example has a greeting command, settings form, background job and persisted task result. Replace these with your feature's behavior.

To install an existing trusted package, copy its folder into `modules/<id>` and run `pnpm module:add <id>`. Run `pnpm module:remove <id>` to remove it from the deployment selection; this retains its source and database records. Rebuild and restart both bot and web after either operation. Disable dependents and the module in the dashboard before removing it. Resynchronize guild commands with `pnpm discord:commands:sync` for environment-based deployments; the managed launcher's activation synchronizes commands automatically.

`pnpm module:sync` regenerates registries after manually editing the catalog. Build runs it automatically. Generated registry files are not hand-editable extension points. Keep the package ID equal to its directory and manifest ID. Each package must export:

- `definition.ts`: `definition`, containing browser-safe metadata, settings schema/defaults, command descriptors, job schemas, and optional settings migrations. Never import server code or secret values here: dashboard builds use this file.
- `bot.ts`: `createBot(services)` returning a `BotModule`. Register handlers in `start`; validate settings before swapping them in `applySettings`; clean up in `stop`. Ordinary modules use the narrower resources passed to `start`. The factory's trusted host services support specialized modules such as logging.
- `api.ts`: `registerApi(api)`. Routes are automatically prefixed with `/api/modules/<id>` and protected by the application's staff authorization and CSRF rules.
- `web.tsx`: default React page. The installed package automatically gets a Modules card and navigation entry. Read configuration through the protected API; do not put credentials in browser code.

The development example is excluded from production registration. `pnpm build:demo` puts its frontend in `dist/dashboard-demo`; production remains in `dist/dashboard`. `pnpm test:e2e` builds both frontends before running headless tests (setup uses the production frontend).

## Scoped data

Bot handlers receive `context.data`; API handlers receive `data` in their route context. Both bind the guild and module ID on the server:

```ts
const previous = await context.data.get<{ cursor: string }>('event-cursor');
await context.data.put('event-cursor', { cursor: nextCursor }, previous?.revision ?? 0);
```

Revision `0` creates a record; updates and deletes require the current revision. Concurrent/stale writes return 409. Reload and resolve the conflict rather than blindly overwriting. Keys are 1–160 characters, JSON values are at most 32 KiB, and optional TTLs are 1 second–90 days. `list({prefix, cursor, limit})` returns `records` and `nextCursor` (maximum 100 per page). Expired records are hidden and cleaned up. Records are for ordinary integration state; large event archives or relational workloads may need a deliberately designed repository.

Namespaces prevent accidental collisions; trusted package code can access the host process and is not isolated from malicious code. API schemas must not accept caller-supplied guild/module scope. Keep credentials out of settings, records, job payloads, results and logs.

## Jobs and external APIs

Declare each type in `definition.jobSchemas`, then register it with `context.onJob(type, handler)`. Enqueue with:

```ts
await context.jobs.enqueue('refresh-events', { cursor }, idempotencyKey, {
  delayMs: 60_000,
  ttlMs: 300_000,
});
```

Jobs are scoped by guild/module/idempotency key, persisted by either provider, and dispatched only to active registered modules. Delay is 0–30 days; TTL is 1 second–90 days after the due time (default five minutes). A disabled module's work waits until re-enabled or expires. Removed modules cannot consume queued work. Payload schemas are validated again at dispatch. Exceptions produce a safe failed job result; they do not expose the exception or payload to the dashboard.

Handlers receive `id`, `type`, `payload` and `attempt`. A process interruption can cause another attempt after the claim lease expires. Use `job.id` as the external API idempotency key, or reconcile the external result before repeating a write. Exactly-once external writes are not guaranteed. Handler errors are terminal for that job; retry deliberately with a new request. Periodic polling can enqueue its next delayed job with a stable idempotency key; seed/resume that chain in module startup.

Use explicit network deadlines, for example `fetch(url, { signal: AbortSignal.timeout(15_000), ... })`, and validate responses. Handlers should finish well within the 90-second job lease. In-process code cannot be forcibly stopped safely; a handler that never settles can block the serialized host. Track timers/listeners with `context.track()` and clear them on disable.

The dashboard can read job state at `/api/jobs/<id>`. That endpoint omits private payloads and claim tokens. `api.route(..., true, true)` marks a 202 Accepted execution route that requires enabled, applied, current settings. Configuration/history routes remain available when a module is disabled, allowing staff to set it up.

## Commands and messages

Declare names in `commands` and matching descriptions/access/options in `commandDefinitions`. Names have two parts, such as `events list`; options support string, integer, boolean and channel values. Register the handler with `context.onCommand(name, handler)`; it receives the invoking guild/user/channel, approved staff access and parsed options.

Access levels are `member` (a confirmed member of this deployment's guild), `viewer` (approved dashboard staff), and `admin` (approved admin/owner). Commands check access centrally and stop after module disable is acknowledged. The core `bot` group is reserved. Installed definitions generate the guild command registration; there is no per-module edit to the command-sync script.

`requiredIntents` declares the Discord gateway intent union, and `requiredBotPermissions` declares bot permissions. Unknown values fail validation. Enable any needed privileged intents in the Discord developer portal before restarting. The startup connection requests intents for installed packages, even when a package is disabled, so toggling a module does not require reconnecting.

For a designated plain-text staff channel, declare `GuildMessages` and `MessageContent`, then register:

```ts
context.onMessage({ channelIds: () => settings.staffChannelIds, access: 'admin' }, async message => {
  // Parse a draft here. Validate it and require a separate authorized confirmation before publishing.
  await message.reply('Draft saved. Review the details before publishing.');
});
```

The host restricts dispatch to subscribed channels and the configured guild, ignores bot/webhook messages, re-fetches membership for authorization, and suppresses mentions in its reply helper. Message content is not persisted by the host; the module chooses its own bounded draft storage/retention. A language-model parser must treat message content as input, never as authority to bypass permissions or publish automatically.

See [Discord intents](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx) and [application commands](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/application-commands.mdx).

## Secrets and settings upgrades

Declare `manifest.requiredSecrets: ['API_TOKEN']`. For a module named `community-events`, configure `OMO_MODULE_COMMUNITY_EVENTS_API_TOKEN` on the bot host and read it with `context.secret('API_TOKEN')`. The managed launcher forwards only declared installed-module secrets to the bot child, not the web child. Do external API work in bot jobs and expose safe results through records/status endpoints.

Increment `manifest.settingsVersion` and provide sequential pure `settingsMigrations` keyed by the old version. The initializer validates the final result and upgrades desired settings with a compare-and-swap; applied settings retain their previous version until the worker successfully applies the change. Missing migrations and stored versions newer than the installed package fail startup rather than resetting settings. Preserve migration functions for every version you support.

New shared database functionality uses additive PostgreSQL/PocketBase migrations. Never edit an applied migration. The current PocketHost installer still refuses differing uploaded bundle files; updating an existing installation requires an explicit controlled upgrade, not repeatedly clicking Prepare storage.

## Example extension: community events

Keep the integration in one package with its own API credential and configured event/staff channels. A sensible first release would read upcoming events, expose member commands to browse them, and post updates using idempotent jobs. Add staff draft creation next: plain text → structured draft → validation and preview → authorized confirmation → API create request. Participation/RSVP actions depend on the API's identity and permission model.

This integration is not built yet. Its endpoints, authentication, event schema, pagination/update cursor, member identity mapping, write permissions and idempotency behavior must be supplied and verified first. No endpoint contract is guessed by the framework.
