# Deploy on Railway

One Railway project runs three services built from this repository: **pocketbase** (storage, with a persistent volume), **web** (the public dashboard) and **bot** (the private Discord worker). The web and bot services build the same image from `infra/Dockerfile` and differ only in start command and variables. PocketBase builds from `infra/Dockerfile.pocketbase`, which bakes the committed hook and migration bundle into the image, so nothing is uploaded over SFTP.

The bot must run as exactly one replica: it holds a renewable per-guild lease in PocketBase and a second worker exits on startup.

If you would rather keep storage on PocketHost or use PostgreSQL, see the end of this page. The web and bot variables are the same apart from the storage lines.

## 1. Create the Discord application

Do this first: two of the variables below come from it.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select **New Application**. Name it after your bot.
2. **General Information**: copy **Application ID**. This is `DISCORD_APPLICATION_ID`.
3. **OAuth2**: select **Reset Secret** and copy the client secret. This is `DISCORD_CLIENT_SECRET`. Leave the **Redirects** list for now; you add the URL after Railway gives the web service a domain.
4. **Bot**: select **Reset Token** and copy it. This is `DISCORD_BOT_TOKEN`. It is shown once.
5. **Bot** → **Privileged Gateway Intents**: none are required for the bundled logging module, which only needs the `Guilds` intent. Enable **Message Content Intent** only if a module you install declares `GuildMessages` and `MessageContent`.
6. **Bot** → uncheck **Public Bot** unless you want other servers to be able to invite it. Each deployment serves one guild anyway.
7. **Installation**: set **Install Link** to **None**. You will use the invite URL below instead.

Get the two Discord IDs from the Discord client: enable **Settings → Advanced → Developer Mode**, then right-click the server → **Copy Server ID** (`DISCORD_GUILD_ID`) and right-click your own name → **Copy User ID** (`OWNER_USER_IDS`). Optional staff roles are copied the same way from **Server Settings → Roles** for `DASHBOARD_ADMIN_ROLE_IDS` and `DASHBOARD_VIEWER_ROLE_IDS`.

Invite the bot to the guild with the scopes and permissions the logging module needs (View Channels, Send Messages, Embed Links, Read Message History):

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=84992&guild_id=GUILD_ID
```

Replace `APPLICATION_ID` and `GUILD_ID`. The `applications.commands` scope is required or the slash commands will not register.

## 2. Generate the two keys you own

Both are random 32-byte values written as 64 hex characters:

```sh
openssl rand -hex 32   # storage key: OMO_STORAGE_KEY on pocketbase, POCKETBASE_SERVICE_KEY on web and bot
openssl rand -hex 32   # SESSION_ENCRYPTION_KEY on web only
```

The storage key is what the web and bot services present to PocketBase; the instance binds itself to it and to the guild ID on first start and refuses a different key or guild afterwards. The session key encrypts dashboard sessions; rotating it signs every dashboard user out.

## 3. Create the Railway services

1. Create a project from the GitHub repository. Railway proposes services; you need three from the same repository, named `pocketbase`, `web` and `bot`. Add a missing one with **Create → GitHub Repo** and pick the repository again. If you choose other names, adjust the `${{pocketbase.RAILWAY_PUBLIC_DOMAIN}}` and `${{web.RAILWAY_PUBLIC_DOMAIN}}` references below.
2. For each service open **Settings → Config-as-code** and set the config file path: `infra/railway.pocketbase.json`, `infra/railway.web.json` and `infra/railway.bot.json`. Leave **Root Directory** empty; both Dockerfiles copy from the repository root. If Railway ignores the file before the first deploy, also set `RAILWAY_DOCKERFILE_PATH` on that service (`infra/Dockerfile.pocketbase` for pocketbase, `infra/Dockerfile` for web and bot).
3. On **pocketbase** open **Settings → Volumes** (or right-click the service → **Attach Volume**) and mount a volume at `/pb_data`. Without it the database is wiped on every deploy.
4. On **pocketbase** open **Settings → Networking → Public Networking** and generate a domain. When asked for the port, enter `8090`. The storage adapter requires HTTPS for any host other than localhost, and Railway terminates TLS only on public domains.
5. On **web** generate a domain the same way with port `3000`. The bot service needs no domain.

The config files set the start commands, one replica, the restart policies, health checks on PocketBase (`/api/health`) and web (`/health/ready`), and two pre-deploy commands: `node dist/migrate.js` on web, which verifies the PocketBase schema is reachable, and `node dist/sync-commands.js` on bot, which registers the guild slash commands. Both run automatically before every deploy with that service's variables. The pocketbase config also limits rebuilds to changes under `infra/pocketbase`, so application commits do not restart storage.

## 4. Variables

Open each service's **Variables** tab, choose **Raw Editor**, paste the block and replace the `<...>` placeholders. Everything else is a literal value or a Railway reference that resolves at deploy time. Do not quote values.

### pocketbase

```
PORT=8090
OMO_STORAGE_KEY=<storage key>
OMO_GUILD_ID=<server id>
```

### web

```
NODE_ENV=production
STORAGE_PROVIDER=pocketbase
POCKETBASE_URL=https://${{pocketbase.RAILWAY_PUBLIC_DOMAIN}}
POCKETBASE_SERVICE_KEY=<storage key>
WEB_HOST=0.0.0.0
WEB_PORT=3000
PORT=3000
WEB_TRUST_PROXY=1
DASHBOARD_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
DISCORD_GUILD_ID=<server id>
DISCORD_APPLICATION_ID=<application id>
DISCORD_CLIENT_SECRET=<oauth2 client secret>
SESSION_ENCRYPTION_KEY=<session key>
OWNER_USER_IDS=<your user id>
DASHBOARD_ADMIN_ROLE_IDS=
DASHBOARD_VIEWER_ROLE_IDS=
BOT_NAME=<bot display name, up to 40 characters>
COMMUNITY_NAME=<community name, up to 60 characters>
```

### bot

```
NODE_ENV=production
STORAGE_PROVIDER=pocketbase
POCKETBASE_URL=https://${{pocketbase.RAILWAY_PUBLIC_DOMAIN}}
POCKETBASE_SERVICE_KEY=<storage key>
DASHBOARD_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
DISCORD_GUILD_ID=<server id>
DISCORD_APPLICATION_ID=<application id>
DISCORD_BOT_TOKEN=<bot token>
OWNER_USER_IDS=<your user id>
DASHBOARD_ADMIN_ROLE_IDS=
DASHBOARD_VIEWER_ROLE_IDS=
BOT_NAME=<same as web>
COMMUNITY_NAME=<same as web>
```

Why each non-obvious value is what it is:

| Variable | Reason |
| --- | --- |
| `OMO_STORAGE_KEY` and `OMO_GUILD_ID` on pocketbase | The hooks read these from the environment and bind the instance. They must equal `POCKETBASE_SERVICE_KEY` and `DISCORD_GUILD_ID` exactly. |
| `PORT=8090` on pocketbase | The container command listens on `PORT`; the domain routes to the same port. |
| `POCKETBASE_URL` | Must be an `https://` origin with no path. Railway's public domain gives that. |
| `WEB_HOST=0.0.0.0` | The dashboard API binds loopback by default. Railway's proxy cannot reach it there. |
| `WEB_PORT` and `PORT` both `3000` | The app listens on `WEB_PORT`; Railway routes the domain to `PORT`. Keeping them equal and matching the domain's port avoids a guess. |
| `WEB_TRUST_PROXY=1` | Behind Railway every request has the proxy's IP. Trusting the proxy lets per-user rate limits work instead of one shared bucket. |
| `DASHBOARD_ORIGIN` | Must be `https://` in production. The OAuth redirect is derived from it, so it must match the Discord portal exactly. The bot uses it for the `/bot dashboard` command. |
| `DISCORD_APPLICATION_ID` on bot | The command-sync pre-deploy step checks the token belongs to this application. |
| `DISCORD_BOT_TOKEN` only on bot, `DISCORD_CLIENT_SECRET` and `SESSION_ENCRYPTION_KEY` only on web | The two services never share the other's secret. Both hold the storage key. |
| `OWNER_USER_IDS`, role ID lists | Comma-separated Discord snowflakes. Owners always have admin access; the two role lists are optional. |
| `BOT_HEALTH_PORT`, `BOT_HEALTH_HOST`, `DATABASE_URL` | Not set. The bot's health endpoint stays on loopback, Railway does not health-check the bot (see below), and PostgreSQL variables are unused with PocketBase. |

## 5. Register the callback and deploy

1. Deploy **pocketbase** first and wait until it is healthy. Its log should show the migrations applying and the server listening. A misspelled key or guild ID here shows up later as `Storage service is not configured` from the web and bot services.
2. After the web domain exists, go to the Discord portal → **OAuth2 → Redirects** and add exactly `https://<web domain>/auth/discord/callback`, then save.
3. Deploy **web**. The pre-deploy step should print `PocketBase schema is ready.` and the service should pass its health check.
4. Deploy **bot**. The pre-deploy step should print `Guild slash commands synchronized.` and the bot should then connect.
5. Open `https://<web domain>`, sign in with the owner account, choose a private text channel under Logging, save routing, enable the module under Modules and send a test from Diagnostics. Run `/bot status` in Discord.

## Things to know

- **Bot redeploys.** `overlapSeconds` is `0` in the bot config so the old worker stops and releases its lease before the new one starts. Expect a few seconds of downtime per deploy. Do not add a health check or raise replicas on the bot; a second worker cannot take the lease and would keep crashing.
- **PocketBase is reachable from the internet.** The storage routes require the storage key and refuse other guilds. The admin UI has no superuser (the headless hook never runs the installer), so it cannot be logged into. Keep it that way unless you create a superuser deliberately; rotate the storage key by changing it on all three services at once only on a fresh instance, because a bound instance refuses a new key.
- **Backups.** Everything lives in the `/pb_data` volume. Use Railway's volume backups, and test a restore into a fresh service before relying on them.
- **PocketBase version.** The Dockerfile pins `0.40.4`, the version the repository's contract tests run against. Change the `POCKETBASE_VERSION` build argument only after running the integration tests against the new version.
- **Custom domain.** When you attach one to the web service, set `DASHBOARD_ORIGIN` on both web and bot to that `https://` origin and update the Discord redirect. Old sessions become invalid. A custom domain on pocketbase means updating `POCKETBASE_URL` on web and bot.
- **Rotating Discord secrets.** A new bot token or client secret only needs the variable updated and a redeploy.
- **New modules.** After adding a module that declares intents or permissions, re-invite the bot with the new permissions and enable any privileged intent in the portal. The next bot deploy re-syncs the commands. A module that ships PocketBase migrations needs a pocketbase redeploy too.

### PocketHost instead of the pocketbase service

Skip the pocketbase service and run only web and bot on Railway. The instance must carry this repository's hook and migration bundle; a plain PocketHost instance has neither, and every storage call then fails with `PocketBase storage access failed`. No superuser is involved: the bundle adds a custom route that the storage key authenticates.

1. In PocketHost, create a dedicated instance and pin its PocketBase version to `0.40.4`, the version the repository's contract tests run against.
2. Under **Account → Keys**, register an Ed25519 public key scoped to that instance.
3. Locally, run `pnpm install --frozen-lockfile` and `pnpm pocketbase:bundle`. The bundle lands in `dist/pockethost/pb_hooks` and `dist/pockethost/pb_migrations`.
4. Connect over SFTP to `ftp.pockethost.io`, port `2222`, username your PocketHost account email, with that key. Open the folder named after the instance and upload the four files into its `pb_hooks` and the three files into its `pb_migrations`, keeping the layout flat. `sftp -P 2222 -i ~/.ssh/<key> <account email>@ftp.pockethost.io` works from a terminal.
5. In the instance's **Secrets**, add `OMO_STORAGE_KEY` (the storage key) and `OMO_GUILD_ID` (the server ID).
6. Restart the instance from the PocketHost dashboard so the migrations apply and the hooks load.
7. Set `POCKETBASE_URL` on web and bot to the instance's `https://` origin, preferably its permanent UUID hostname, and `POCKETBASE_SERVICE_KEY` to the storage key. Every other variable is unchanged.

Verify from your own machine before deploying the app services:

```sh
curl -s -w "\nHTTP %{http_code}\n" -X POST https://<instance>.pockethost.io/api/omo/v1/ready \
  -H 'Content-Type: application/json' -H 'X-OMO-Storage-Key: <storage key>' \
  -d '{"guildId":"<server id>","input":{}}'
```

| Response | Cause |
| --- | --- |
| `{"data":{"protocol":1}}` | Storage is ready. |
| 404 "The requested resource wasn't found." | The hook bundle is not loaded. Check the upload paths and restart the instance. |
| 503 "Storage service is not configured." | `OMO_STORAGE_KEY` or `OMO_GUILD_ID` is missing from Secrets, or the instance has not restarted since they were added. |
| 401 "Storage access denied." | The Secret differs from `POCKETBASE_SERVICE_KEY`. |
| 403 "This storage instance belongs to another server." | `OMO_GUILD_ID` differs from `DISCORD_GUILD_ID`. |

The same check works against a Railway-hosted pocketbase service. The application logs print the same generic message for all four failures, so use the curl response to tell them apart.

### PostgreSQL instead of PocketBase

Skip the pocketbase service and add Railway's PostgreSQL template (service name `Postgres`). On web set `STORAGE_PROVIDER=postgres`, `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}`; on bot set `STORAGE_PROVIDER=postgres` and `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Drop the `POCKETBASE_*` lines. The web pre-deploy command then applies the SQL migrations.
