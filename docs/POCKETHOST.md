# PocketHost deployment guide

Last checked: 2026-09-24. Locally tested PocketBase version: **0.40.4**. Storage protocol: **1**.

PocketHost documents SFTP access to `pb_hooks` and `pb_migrations` and Secrets exposed in the PocketBase runtime. These capabilities support this adapter on a normal hosted instance without a custom binary. Account-specific deployment has not been performed.

Primary sources: [PocketHost SFTP](https://pockethost.io/docs/ftp), [Secrets](https://pockethost.io/docs/secrets), [phio CLI](https://pockethost.io/docs/phio), [PocketBase transactional migrations](https://pocketbase.io/docs/js-migrations/).

## Browser setup

The new managed launcher can upload and bind a fresh instance from the browser. Follow [SETUP.md](SETUP.md). It uses SFTP deployment credentials plus a temporary PocketBase superadmin login, and stores the generated runtime binding in a private table. The environment/Secrets procedure below remains available for separately managed bot/web services.

## One instance per Discord guild

Create/select a dedicated PocketHost instance for each bot deployment. Use its HTTPS origin, preferably the permanent UUID hostname to survive display-name changes. The custom routes reject guild IDs other than the instance's configured guild. Do not repurpose an instance for another guild by changing its ID after data exists; create a fresh instance instead.

PocketHost stores data; the Discord Gateway connection and Fastify dashboard run as separate Node services on your host. This guide does not assume PocketHost can run an arbitrary persistent Node process.

## Prepare the instance

1. Select PocketBase 0.40.4, or verify any other host-provided version against this repository's contract tests before deployment. Avoid untested version jumps.
2. Generate a random 32-byte hexadecimal storage key in a private terminal/password manager. Generate a separate 32-byte hexadecimal session encryption key. Do not use the example placeholders or put either key in source control.
3. Add these values through the instance's **Secrets** interface:
   - `OMO_STORAGE_KEY`: the storage key (64 hex characters).
   - `OMO_GUILD_ID`: the exact Discord guild snowflake.
4. Run `pnpm pocketbase:bundle`. It creates `dist/pockethost/pb_hooks`, `dist/pockethost/pb_migrations`, and a checksum manifest.
5. Upload the **contents** of those two directories into the instance's corresponding directories via SFTP or phio. Keep the layout flat: `pb_hooks/000_omo_headless.pb.js`, `pb_hooks/omo.pb.js`, `pb_hooks/operations.js`, `pb_hooks/installation.js`, `pb_migrations/1790265600_omo_storage.js`, `pb_migrations/1790265601_instance_binding.js`, and `pb_migrations/1790265602_module_resources.js`. Do not upload `.env`, `.local`, `node_modules`, or any local `pb_data`.
6. Restart the instance using PocketHost controls so committed migrations execute. Their initial rollback intentionally refuses automatic table deletion; restore a verified backup for a destructive rollback.

PocketHost's documented SFTP settings are host `ftp.pockethost.io`, port `2222`, username your account email, and an Ed25519 key registered under Account → Keys. Scope the key to the target instance. The service provides SFTP, not a remote shell. Use the current PocketHost docs for connection details and key verification.

The `omo_` tables are intentionally private SQL tables, not public PocketBase collections. They are part of the normal PocketBase data database and backups. Our dedicated staff dashboard is their application interface; no collection API rule can accidentally expose captured logs. A future operator-facing collection view can be added deliberately.

## Configure the bot and web services

Set these in each service's private environment:

```dotenv
STORAGE_PROVIDER=pocketbase
POCKETBASE_URL=https://YOUR_INSTANCE.pockethost.io
POCKETBASE_SERVICE_KEY=THE_SAME_VALUE_AS_OMO_STORAGE_KEY
DISCORD_GUILD_ID=THE_SAME_VALUE_AS_OMO_GUILD_ID
```

Also configure the Discord/application/owner/dashboard values in `.env.example`. PostgreSQL connection variables are unnecessary in this mode. `pnpm db:migrate` verifies the PocketBase schema; it does not upload migrations or remotely restart your instance.

Use `pnpm build` for production. A PocketHost-oriented Compose template is available:

```sh
docker compose --env-file .env -f infra/compose.pockethost.yaml build
docker compose --env-file .env -f infra/compose.pockethost.yaml up -d
```

Set `DASHBOARD_DOMAIN` for Caddy and use the same HTTPS origin in Discord's callback registration. The Compose file supplies only bot credentials to bot and only OAuth/session credentials to web. Both get the storage key. No PocketBase superuser password/token is needed by the runtime.

These commands are deployment instructions, not evidence that an image or your hosted instance has been deployed/tested here.

## Reliability and upgrade rules

- Each event and its initial delivery row commit in one PocketBase transaction. A failed queue insert rolls back the event.
- Settings updates compare revisions inside a transaction. A stale editor gets 409 and retains its unsaved changes.
- One bot owns a renewable 60-second instance lease. It renews every 10 seconds and fails closed on renewal failure; server-side writes verify the owner. Delivery/job claims have separate tokens and 90-second leases so an old worker cannot finalize a newer claim.
- Verify worker ownership immediately before sending. Discord posting remains at-least-once/best-effort duplicate suppression: no database can atomically commit a Discord HTTP send and a local transaction.
- Requests have bounded timeouts and never silently switch backend. Storage outages can lose uncommitted Gateway observations; coverage incidents must remain visible.
- Back up before uploads that change migrations. PocketBase migrations run transactionally. Keep the matching hooks, migration files and previous application image together for rollback analysis.
- Use PocketHost's supported backup mechanism and download/retain protected copies separately. Test a restore into a fresh instance, run cleanup, inspect representative event/settings/queue rows, and start only one worker. Do not blindly replay old delivered queues.
- Checkpoint/migration imports between PostgreSQL and PocketBase are not implemented. Keep a deployment on its selected provider until an explicit export/import tool is tested.

## Not yet verified on your account

Instance version selection, Secrets propagation, SFTP upload/restart, latency/rate limits under realistic bursts, backup restoration, real Discord login/delivery, and sustained production observation remain deployment checks. The local test suite establishes backend semantics, not PocketHost account configuration or Discord permissions.
