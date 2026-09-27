# Deploy on Railway

One Railway project runs three services: a **Postgres** database, the **web** dashboard (public) and the **bot** worker (private). Both application services build the same image from `infra/Dockerfile` and differ only in start command and variables. The bot must run as exactly one replica: the storage layer holds a per-guild singleton lock and a second worker exits on startup.

Storage on Railway uses `STORAGE_PROVIDER=postgres` because the Postgres template is one click. PocketHost still works; see the end of this page.

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

## 2. Generate the secret you own

`SESSION_ENCRYPTION_KEY` is a random 32-byte value, written as 64 hex characters:

```sh
openssl rand -hex 32
```

Generate it once and use the same value for the web service only. Rotating it signs every dashboard user out.

## 3. Create the Railway services

1. Create a project from the GitHub repository. Railway proposes services; keep two application services and name them `web` and `bot`. If you choose other names, adjust the `${{web.RAILWAY_PUBLIC_DOMAIN}}` reference below.
2. Add a database with **Create → Database → Add PostgreSQL**. Its default service name is `Postgres`, which the references below use.
3. For each application service open **Settings → Config-as-code** and set the config file path: `infra/railway.web.json` for web and `infra/railway.bot.json` for bot. Leave **Root Directory** empty; the Dockerfile copies from the repository root. If Railway ignores the file before the first deploy, also set the variable `RAILWAY_DOCKERFILE_PATH=infra/Dockerfile` on both services.
4. On the **web** service open **Settings → Networking → Public Networking** and generate a domain. When asked for the port, enter `3000`. The bot service needs no domain.

The config files set the start commands, one replica, the restart policy, the web health check on `/health/ready`, and two pre-deploy commands: `node dist/migrate.js` (web, applies PostgreSQL migrations) and `node dist/sync-commands.js` (bot, registers the guild slash commands). Both run automatically before every deploy with that service's variables.

## 4. Variables

Open each service's **Variables** tab, choose **Raw Editor**, paste the block and replace the `<...>` placeholders. Everything else is a literal value or a Railway reference that resolves at deploy time. Do not quote values.

### web

```
NODE_ENV=production
STORAGE_PROVIDER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}
WEB_HOST=0.0.0.0
WEB_PORT=3000
PORT=3000
WEB_TRUST_PROXY=1
DASHBOARD_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
DISCORD_GUILD_ID=<server id>
DISCORD_APPLICATION_ID=<application id>
DISCORD_CLIENT_SECRET=<oauth2 client secret>
SESSION_ENCRYPTION_KEY=<output of openssl rand -hex 32>
OWNER_USER_IDS=<your user id>
DASHBOARD_ADMIN_ROLE_IDS=
DASHBOARD_VIEWER_ROLE_IDS=
BOT_NAME=<bot display name, up to 40 characters>
COMMUNITY_NAME=<community name, up to 60 characters>
```

### bot

```
NODE_ENV=production
STORAGE_PROVIDER=postgres
DATABASE_URL=${{Postgres.DATABASE_URL}}
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
| `WEB_HOST=0.0.0.0` | The dashboard API binds loopback by default. Railway's proxy cannot reach it there. |
| `WEB_PORT` and `PORT` both `3000` | The app listens on `WEB_PORT`; Railway routes the domain to `PORT`. Keeping them equal and matching the domain's port avoids a guess. |
| `WEB_TRUST_PROXY=1` | Behind Railway every request has the proxy's IP. Trusting the proxy lets per-user rate limits work instead of one shared bucket. |
| `DASHBOARD_ORIGIN` | Must be `https://` in production. The OAuth redirect is derived from it, so it must match the Discord portal exactly. The bot uses it for the `/bot dashboard` command. |
| `DATABASE_URL=${{Postgres.DATABASE_URL}}` | The private-network URL. No TLS settings are needed inside the project. |
| `MIGRATION_DATABASE_URL` | Only the web pre-deploy step reads it. The same URL is fine; use a separate migration role later if you want one. |
| `DISCORD_APPLICATION_ID` on bot | The command-sync pre-deploy step checks the token belongs to this application. |
| `DISCORD_BOT_TOKEN` only on bot, `DISCORD_CLIENT_SECRET` and `SESSION_ENCRYPTION_KEY` only on web | The two services never share the other's secret. |
| `OWNER_USER_IDS`, role ID lists | Comma-separated Discord snowflakes. Owners always have admin access; the two role lists are optional. |
| `BOT_HEALTH_PORT`, `BOT_HEALTH_HOST` | Not set. The bot's health endpoint stays on loopback and Railway does not health-check the bot (see below). |

`DATABASE_URL` and `MIGRATION_DATABASE_URL` references resolve only once the Postgres service exists, so add the database before pasting.

## 5. Register the callback and deploy

1. After the web domain exists, go back to the Discord portal → **OAuth2 → Redirects** and add exactly `https://<web domain>/auth/discord/callback`, then save.
2. Deploy. Watch the web deploy log: the pre-deploy step should print `PostgreSQL migrations applied.` and the service should pass the health check. Watch the bot log: the pre-deploy step should print `Guild slash commands synchronized.` and the bot should then connect.
3. Open `https://<web domain>`, sign in with the owner account, choose a private text channel under Logging, save routing, enable the module under Modules and send a test from Diagnostics. Run `/bot status` in Discord.

## Things to know

- **Bot redeploys.** `overlapSeconds` is `0` in the bot config so the old worker stops before the new one starts; otherwise the new worker cannot take the guild lock while the old one still holds it. Expect a few seconds of downtime per deploy. Do not add a health check or raise replicas on the bot for the same reason.
- **Custom domain.** When you attach one to the web service, set `DASHBOARD_ORIGIN` on both services to that `https://` origin and update the Discord redirect. Old sessions become invalid.
- **Rotating secrets.** A new bot token or client secret only needs the variable updated and a redeploy. A new `SESSION_ENCRYPTION_KEY` signs everyone out.
- **New modules.** After adding a module that declares intents or permissions, re-invite the bot with the new permissions and enable any privileged intent in the portal. The next bot deploy re-syncs the commands.
- **PocketHost instead of Postgres.** Skip the Postgres service, set `STORAGE_PROVIDER=pocketbase`, `POCKETBASE_URL` and `POCKETBASE_SERVICE_KEY` (64 hex characters, also stored as `OMO_STORAGE_KEY` on the instance) on both services, and drop the `DATABASE_URL` lines. Follow [POCKETHOST.md](POCKETHOST.md) for the hook bundle. The web pre-deploy command then only verifies the schema.
