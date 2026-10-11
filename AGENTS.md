# gg-bot project boundaries

This repository is `168Group/gg-bot`, the GottaGacha-specific Discord bot powered by OMOBot. The mascot is **Juunni**; the current deployment display name is **Juunnii**. Reusable OMOBot framework development belongs in `OMOWorlds/omo-bot`, maintained by a separate project/task.

- Before editing or pushing, verify the checkout and remotes. `origin` must be `168Group/gg-bot`; `upstream` is `OMOWorlds/omo-bot`. Use a `codex/` feature branch and preserve existing work.
- Read HANDOFF.md, ROADMAP.md, docs/MODULES.md, docs/REPOSITORY_WORKFLOW.md, docs/RAILWAY.md and docs/LOGGING.md before substantive work. Run baseline checks before editing and rerun appropriate checks afterward. Verify UI changes in the running local app.
- GottaGacha API data, domain rules and integrations belong in `modules/gottagacha-events` or other downstream modules. Do not add community-specific behavior to generic packages or edit the upstream checkout from this task.
- Coordinate genuinely reusable missing capabilities with the existing base task. Include a unique request ID, reply task/host, use case, smallest generic change, proposed interface, acceptance checks and blocking status. Track outstanding requests in ignored local coordination files. Keep machine paths, task IDs, private API details and secrets out of public files and requests.
- Merge reviewed, merged upstream changes on an update branch, resolve conflicts without discarding downstream work, regenerate module registries and rerun checks. Do not reset away downstream changes.
- Establish API endpoints, authentication, schemas, pagination, changes/cancellations, timezones, member identity/authorization and write/idempotency rules from documentation. Never invent endpoints or request secrets in chat. Label fixtures explicitly. Declare verified secret requirements through the SDK and configure values privately on the bot service.
- Staff drafts must remain safe until an authorized person reviews the exact parsed revision and explicitly confirms. No production deployment, branch-protection override or real event publishing is authorized by routine module work.
- Deployment uses separate Railway bot/dashboard services and PocketBase on PocketHost. Check current health before claiming the bot is running. Preserve startup retries, Railway manifests, command synchronization and OAuth diagnostics.
- Logging PR #4 merged at `9fc28d34193a71b11dc76de54094cd5ce2142f5a`. Server Members and Message Content intents were enabled on the confirmed application. Existing installations retain all six new logging switches off until configured.
- Use bounded network deadlines and retries, scoped records/jobs, existing permission checks and meaningful tests. Keep HANDOFF.md and ROADMAP.md current with evidence and deferred work. Never commit credentials or real environment files.
- Use clear, welcoming copy without em dashes. Reuse existing browser tabs.
