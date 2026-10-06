# Dashboard-managed module secrets

Module credentials have their own encrypted storage, separate from settings, module records, jobs and logs. Only configured owners who remain members of the configured guild can manage them. Admin and viewer roles do not grant secret access.

## Module contract

Declare names in `manifest.requiredSecrets`, using uppercase names such as `API_KEY`. In each job, command or request that needs a credential, call:

```ts
const key = await context.secrets.get('API_KEY');
```

Read once per work unit and do not retain the key in module-wide state. A replacement takes effect on the next read without restarting the worker. An already-running request may finish with the value it already read. Do not include credentials in settings, records, payloads, results, observations, replies, errors or logger calls. Module packages are trusted server code, not a sandbox.

`context.secret(name)` remains the legacy synchronous, environment-only API. Existing modules must adopt `context.secrets.get(name)` to honor dashboard overrides and deletions. Required-secret declarations describe available names; they do not automatically prevent a module starting when a key is missing.

Precedence for the asynchronous API:

1. A stored override is decrypted and returned. Missing/wrong encryption keys or corrupt ciphertext fail closed, without trying environment fallback.
2. A disabled tombstone rejects the read, even if an environment value exists.
3. No override, or explicit **Use environment**, reads `OMO_MODULE_<MODULE_ID>_<NAME>` from the bot process. Hyphens in module IDs become underscores. Missing environment values reject the read.

**Delete and disable** preserves a revisioned tombstone. This prevents stale editors from recreating deleted credentials and stops old environment keys from silently becoming active. **Use environment** is a separate explicit action. The dashboard reports environment availability as unknown, because the bot and web processes can have different environments. Environment-only values are never revealed or copied by these endpoints.

## Encryption configuration

Set the same `MODULE_SECRET_ENCRYPTION_KEY` on both bot and web services: a separate random 32-byte key encoded as 64 hexadecimal characters. Do not reuse the session encryption key. It is optional for environment-only credentials, but required to save or decrypt stored values.

Encryption uses AES-256-GCM with a random nonce and associated data binding each value to its guild, module and declared name. Only ciphertext, source mode and revision enter the secret table. Metadata reads do not decrypt values. Empty secrets and values over 4,096 UTF-8 bytes are rejected.

Managed setup generates the key and keeps it in the encrypted local installation profile before launching services, then supplies it to both children. Separately deployed services need the identical key configured by the operator. Back up the key securely alongside protected data backups. Losing it makes existing ciphertext unrecoverable; changing it does not re-encrypt stored values. Automated encryption-key rotation is not implemented. API credential rotation through the dashboard is supported independently.

## Dashboard control and API

Owner module cards show **Manage secrets** when the installed manifest declares names. The reusable `ModuleSecretsPanel` and `ModuleSecretControl` exports live in `apps/dashboard/src/ModuleSecrets.tsx`; community module pages can use them too.

Controls initially load only metadata. Revealing requires an explicit POST, fresh membership/owner authorization, CSRF and the expected revision. Values stay only in transient component state, never React Query/mutation caches, localStorage, sessionStorage or URLs. Hide, close/navigation, page hiding and a 30-second reveal timer clear the value; late responses after hiding or unmounting are ignored. Replacement inputs are password fields and clear when submitted. Requests time out after 15 seconds; a timed-out save may have committed, so reload metadata before retrying with a revision.

Endpoints use the deployment's guild scope, not a caller-supplied guild:

- `GET /api/module-secrets/:moduleId`: declared names with `source`, `configured`, `revision`, `canReveal`. `configured` is null for environment mode, whose availability is unknown.
- `PUT /api/module-secrets/:moduleId/:name`: `{ revision, value }` replaces the stored value.
- `DELETE /api/module-secrets/:moduleId/:name`: `{ revision }` disables it.
- `POST /api/module-secrets/:moduleId/:name/environment`: `{ revision }` explicitly restores environment fallback.
- `POST /api/module-secrets/:moduleId/:name/reveal`: `{ revision }` returns `{ value }` for a stored override only.

All responses are `Cache-Control: no-store`. Writes and reveal require fresh Discord membership checks and CSRF; all endpoints require owner access. Unknown modules, undeclared names and stale revisions are rejected. A database change and an external API call cannot be atomic, so modules must still use their normal idempotency/authorization rules.

## Upgrade sequence

This capability follows the request-budget release and requires additional storage changes. It must not be deployed using that release's hook-only procedure.

- PostgreSQL: apply `packages/db/migrations/0004_module_secrets.sql` through the existing migration runner.
- PocketBase/PocketHost: deploy `pb_migrations/1790851200_module_secrets.js` plus the matching updated `pb_hooks/operations.js`, then restart/apply migrations using the documented host workflow. Preserve previous migrations unchanged.
- Confirm authenticated readiness returns `protocol: 1`, `trafficProtocol: 1` and `secretsProtocol: 1`. New clients refuse missing capabilities. Updated storage remains compatible with previous clients.
- Configure the identical dedicated key on bot/web, then deploy matching client builds. Existing environment-only modules continue to work, but only modules using the asynchronous getter honor the new controls.

No production deployment is part of the implementation request. The initial SFTP wizard still refuses differing files; use the explicit upgrade procedure. Do not roll back by dropping the secret table or losing the encryption key. Each async getter adds one storage request; metadata, editing and reveal add on-demand requests. They introduce no idle polling. Include these requests in PocketHost workload budgets.
