# Guided installation

The managed launcher serves an owner setup console before any database or Discord login exists. The original separate bot/web environment-based deployment still works.

## Start locally

Use Node 24.21.0 and pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open the terminal's setup URL (normally `http://localhost:3000/setup`) and enter its installation access key. If the fixture demo already uses port 3000, stop that demo first or set `SETUP_PORT=3004` before starting. No `.env` is needed for this workflow.

The installation key is separate from Discord staff access. Ordinary dashboard users cannot provision infrastructure. The launcher binds loopback by default. Do not put the access key into a URL or public logs. It is shown in the host terminal so the installation owner can unlock the console.

Managed local PocketBase startup explicitly disables its automatic installer-tab launch. It does not open a browser for each fresh database or restart; use the printed setup URL for the actual bot console.

## Choose storage

**On this host:** enter the community name and Discord guild ID, then Prepare storage. The launcher downloads the pinned PocketBase binary when missing, verifies the official archive checksum, starts it on loopback, applies committed migrations, verifies the contract and saves a profile. macOS/Linux x64 and arm64 are supported; `unzip` is required for a new download. Local means the machine/container running the bot, not the visitor's computer.

**Your PocketBase:** enter the HTTPS origin, PocketBase superadmin email/password and SFTP host/port/username, instance folder and SSH private key. For PocketHost, the preset is `ftp.pockethost.io:2222`; username is your PocketHost email and folder is the instance name. Use an instance-scoped registered Ed25519 deploy key. An optional passphrase supports encrypted keys. Check the SFTP server and confirm its fingerprint before deployment.

The installer uploads only its seven bundled files using temporary files and rename, then waits for automatic hook reload. PocketBase applies migrations on restart; a superuser-authenticated route binds the private instance to its guild and a generated runtime key. Superadmin and SFTP credentials are discarded after the job. Environment-based `OMO_STORAGE_KEY` / `OMO_GUILD_ID` remains supported; a wizard-created binding lives in a private database table instead, avoiding manual host Secrets entry.

A PocketBase superadmin password cannot itself upload executable hooks. Registering the SFTP key with your host is a prerequisite; the installer does not currently log into your PocketHost account to create keys or instances. A host with hook watching disabled will need its restart control; setup reports this instead of claiming success. PocketHost account-specific reload and permissions remain unverified. See [PocketHost SFTP](https://pockethost.io/docs/ftp) and [PocketBase migrations](https://pocketbase.io/docs/js-migrations/).

Existing differing files are never overwritten by this first-install wizard. Identical files make retries safe; a conflicting migration/hook reports a conflict. Upgrading an existing older bundle requires the deployment procedure in POCKETHOST.md until version-aware upgrade support is added.

**PostgreSQL:** enter host/IP, port, existing database name, username/password and TLS preference. The provided database role must have schema migration and runtime access; the installer does not create a PostgreSQL server, database or separate role. TLS defaults on with certificate verification. Committed migrations run transactionally and are checksum-checked on rerun. The same role remains in the encrypted runtime profile.

## Connect Discord and activate

Select a ready storage profile. Enter the Discord application ID, bot token, OAuth client secret, your owner user ID and a display name. Register the displayed OAuth callback in the Discord Developer Portal, and invite the bot to the intended guild with its required permissions. These Discord account actions remain under your control.

Save the connection and select Activate. Activation checks that the token belongs to the supplied application, synchronizes guild slash commands, and starts separate bot/web child processes. Bot credentials go only to bot; OAuth/session credentials go only to web. The launcher forwards dashboard requests to the web service on the same public origin. Both readiness probes must pass before setup reports success.

Preparing another profile leaves the active connection alone. Activating stops the previous managed processes first. **Selecting another provider does not transfer settings, logs or queued deliveries.** The checkbox explicitly chooses to use the target database's own data. Original databases/profiles are retained; data export/import is a separate unfinished feature. Failed activation leaves services stopped with an error, rather than starting two workers or silently selecting another database.

The selected active profile resumes when the managed launcher restarts. Setup progress is in-memory; interrupted operations must be retried. A generated PocketBase key is saved before the upload so a partial remote setup can finish with the same binding. Keep one launcher per installation directory.

## Configuration and backup

The default directory is ignored `.local/installation` (override `SETUP_DATA_DIR`). It contains private access/encryption keys, an encrypted profiles file and managed local PocketBase databases. Directories use mode 0700; credential files use 0600. Browser APIs return profile summaries, never saved passwords/keys. The installation key stays in page memory and is cleared on lock/reload.

Back up the whole protected installation directory, including its encryption key, using a consistent database backup procedure. Losing the encryption key makes saved profiles unrecoverable. Existing database backup/restore precautions still apply.

## Container deployment

`infra/compose.managed.yaml` packages the manager, its child services and optional local PocketBase together with a persistent volume. Set `DASHBOARD_ORIGIN` and `DASHBOARD_DOMAIN` in your deployment environment, build, and start it. `SETUP_HOST=0.0.0.0` requires an HTTPS origin; the included Caddy service supplies TLS. Obtain the installation key from the service's private startup logs.

Container images and a real hosted deployment have not been run in this session. The managed Compose manifest is supplied and syntax-checked. The existing separate-process Compose templates remain available for environment-managed deployments.
