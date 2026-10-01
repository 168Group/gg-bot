# Module authoring

The current package contract, scaffolding commands and examples are documented in [MODULES.md](MODULES.md). Start there when adding a module.

## PocketHost traffic budget

The host polls installed settings and due-job availability together, so merely installing another module adds no recurring HTTP requests. Module handlers still pay for their own record calls, enqueue/claim/finish operations and external API work. Prefer explicit user refresh and cached data over automatic per-page polling. Declare job schemas only for supported handlers; disablement and ownership still gate execution. Base workspace data is shared through `useWorkspace` / `workspaceQueryKey` in the dashboard; invalidate that key after changes to module state rather than restoring the retired independent modules/status polling loops.

Use the workload harness in tests/pockethost-budget.test.ts and the limits in docs/POCKETHOST.md before adding background work. The standard hosted allowance is finite; do not promise a new module can poll continuously without measuring its combined bot/dashboard traffic. Both providers must implement any new named storage operation, and hook-dependent clients must verify capability before rollout.
