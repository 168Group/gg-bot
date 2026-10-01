# Module authoring

The current package contract, scaffolding commands and examples are documented in [MODULES.md](MODULES.md). Start there when adding a module.

## PocketHost traffic budget

The host polls installed settings and due-job availability together, so merely installing another module adds no recurring HTTP requests. Module handlers still pay for their own record calls, enqueue/claim/finish operations and external API work. Prefer explicit user refresh and cached data over automatic per-page polling. Declare job schemas only for supported handlers; disablement and ownership still gate execution. Base workspace data is shared through `useWorkspace` / `workspaceQueryKey` in the dashboard; invalidate that key after changes to module state rather than restoring the retired independent modules/status polling loops.

Use the workload harness in tests/pockethost-budget.test.ts and the limits in docs/POCKETHOST.md before adding background work. The standard hosted allowance is finite; do not promise a new module can poll continuously without measuring its combined bot/dashboard traffic. Both providers must implement any new named storage operation, and hook-dependent clients must verify capability before rollout.

## Dashboard-managed credentials

Declare `manifest.requiredSecrets`, then read `await context.secrets.get(name)` at the start of each job or request. The getter resolves a dashboard override first, fails closed on corruption/key errors, honors disabled tombstones, and uses the bot environment only when fallback is explicitly selected or no override has ever existed. Do not cache values between jobs. The legacy synchronous `context.secret(name)` remains environment-only and must be replaced to support the dashboard controls. See [MODULE_SECRETS.md](MODULE_SECRETS.md) for owner permissions, reusable controls, encryption keys and rollout dependencies.
