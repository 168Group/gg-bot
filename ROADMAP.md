# Remaining implementation and deployment

Updated 2026-10-01. Unchecked requirements are unfinished work. The verified first slice is described in [HANDOFF.md](HANDOFF.md).

## Setup follow-through

- [ ] Verify the working SFTP installer against the a real PocketHost instance and real Discord activation. Local complete provisioning and child-process lifecycle tests pass.
- [ ] Add PocketHost account connection to create/register deployment keys, select/create instances and restart through verified provider APIs. Today users supply a registered key; automatic hook reload is tested locally.
- [ ] Add version-aware bundle upgrades. The initial wizard intentionally refuses to overwrite differing existing hooks/migrations; identical uploads are retryable.
- [ ] Add provider-to-provider export/import with queue and session semantics. Switching profiles currently selects the target database's data and keeps the old database intact.
- [ ] Add installation-directory process locking and durable setup-job recovery. Run one managed launcher per installation directory; interrupted jobs currently retry from persisted profiles and generated keys.

## Development tooling follow-up

- The events foundation browser rerun on 2026-09-30 again hit the documented lease-expiry startup failure. Process inspection identified the failed run’s orphaned local PocketBase child; it was stopped before retrying, without bypassing worker ownership.

- The demo restart/lease issue below was reproduced again during the 2026-09-29 channel-formatting preview rerun. A successful full browser suite followed by an immediate second run failed before tests with the same worker-lock error and left a PocketBase test child on port 8092. This remains separate from the logging renderer fix.
- [ ] Harden demo shutdown/restart after a terminal process-group interruption. During the theme review, two restarts of `.local/demo-pocketbase` failed at `scripts/demo.ts:21` with `Another bot worker already holds this guild lock.` after the previous demo was stopped. Process inspection found no remaining demo/PocketBase process. An isolated `.local/theme-preview` database started normally. The module verification also reproduced a startup failure leaving an orphaned PocketBase child on port 8092; stopping that confirmed test child and allowing lease expiry restored startup. Reproduce signal ordering, failed-start cleanup and lease expiry before changing the ownership logic; do not bypass the worker lock.

## Next implementation slices

- [x] Fix activity collector settings across installed module factories. Real provider regressions reproduced applied logging with zero captured deletion/role/voice events because runtime and module had separate repositories. Collection now reads the running host's accepted settings; production-registry capture, delivery and disable tests pass on both databases. Live Discord verification remains outstanding.
- [x] Replace raw channel snapshot dumps in Discord with compact create/delete summaries and changed-field updates. Permission overwrites use counts or readable state transitions; detailed evidence remains in the dashboard. Regression fixtures reproduce large overwrite arrays seen in production screenshots. Local verification is recorded in docs/VERIFICATION.md; live Discord rendering still needs checking after downstream deployment.
- [x] Add message edits/deletions (including bulk deletion), member nicknames, member role assignments/removals and voice joins/leaves. Ordinary new messages create no log records. Bounded-cache, missing-baseline, exclusion and dashboard coverage is verified locally; live Discord acceptance remains below.
- [ ] Add the remaining event families: member joins/leaves, server role creation/update/deletion, thread lifecycle and moderation. Add real Gateway reconnect/replay and ordering acceptance checks; current collector fixtures exercise cache resets and partial updates.
- [ ] Implement confirmed audit-log attribution and moderation correlation. Current records honestly show unknown attribution; no actor is inferred from proximity alone.
- [ ] Finish durable batching/digests and burst recovery. Current delivery claims and retry/nonce reconciliation pass local tests; this is not evidence for the full batching acceptance gate.
- [x] Implement the reusable module foundation: namespaced records on both providers, module-dispatched delayed jobs, command/intent declarations, sequential settings upgrades, dependency/execution guards, and package scaffolding/selection. See docs/MODULES.md. The original full bot acceptance gate still requires live verification and remaining logging coverage.
- [ ] Verify all routing changes against already leased work, including crash/restart during a destination change. Existing tests cover claim fencing, expiry, exclusions and recovery but do not establish every in-flight route-change interleaving.
- [ ] Expand dashboard acceptance to future event families, attribution states, access roles and degraded-state workflows. Current desktop/mobile coverage includes switches, previews and filters for message, nickname, member role and voice events.

## Deployment acceptance

- [ ] Batch remote worker maintenance and delivery operations and verify a realistic PocketHost traffic budget. The 2026-09-30 incident exposed an idle polling rate above the host's advertised 1,000/hour per-IP cap. Empty-queue short-circuiting and a 30-second PocketHost poll reduce traffic, but source review counts about 960/hour for logging alone (including jobClaim) and 1,080/hour with a second installed module, before extra traffic. Instrument these estimates; generic batching/headroom is requested upstream and gates any PocketHost deployment of the events module. Track host HTTP status/rate-limit errors during live acceptance. A larger host budget is still necessary for busy servers; restart loops do not fix exhausted hourly quotas.
- [ ] Verify a dedicated Discord test application/guild end to end: OAuth, command registration, membership changes, permissions, Gateway events and delivery. Configure credentials privately.
- [ ] Upload the PocketHost bundle, configure Secrets, confirm selected PocketBase version and migration startup. Official host capabilities are verified; this account's execution is not.
- [ ] Build/run the production container images and verify TLS, health probes, restart and graceful shutdown on the selected Node host. Compose manifests parse; container deployment has not run.
- [ ] Run realistic event bursts, network delays/outages, lease loss during an in-flight Discord send, long reconnect gaps and sustained observation. Local transactional correctness does not establish host throughput or loss-free Gateway recovery.
- [ ] Configure protected off-host backups and monitoring; prove restoration into a fresh instance without blindly replaying already delivered work. Current restart tests prove persistence, not backup restoration.
- [x] Verify the foundation in hosted CI: typecheck, lint, builds, 18 unit, 53 integration and eight browser tests.

## GottaGacha events (downstream)

- [x] Establish gg-bot identity, upstream boundaries, scaffolded module and fixture-only foundation. Scoped refresh jobs, preview dedupe, upcoming browsing and safe staff drafts use existing SDK capabilities. See modules/gottagacha-events/README.md.
- [x] Establish the read contract from the supplied events API guide: fixed v1 GET, bearer read scope, private bookings included, venue-local times, recurrence expansion and occurrence identity, pre-expansion limit semantics and cancellation absence. Public OpenAPI omits privacy fields; require them explicitly. Test keys share the live database. Member API/RSVP integration is deferred; uncertain-create reconciliation remains unresolved.
- [x] Implement manual API read-only refresh through scoped jobs and declared bot secrets, with strict privacy validation, seven-day window, bounded bytes/occurrences, body deadlines, read retries, persisted cooldown and a five-minute public cache. No automatic polling or live sends. Local adapter/host/provider/browser verification is recorded in docs/VERIFICATION.md; credentialed API acceptance remains outstanding.
- [ ] Integrate reusable encrypted module-secret management from OMOBot: owner-only dashboard save/replace, masked status by default, explicit Show/Hide with short-lived reveal, and updated credentials used by the next worker job. Current module secrets are environment-only; the dashboard cannot save or reveal them yet. Generic vault/API/UI support has been requested upstream. Never store plaintext in normal module settings or records.
- [ ] Integrate reviewed, merged upstream scoped announcement delivery/reconciliation. Current SDK cannot send arbitrary module announcements; a substantive request is outstanding with the base task and tracked locally. Current previews never send and their seven-day dedupe is not a production delivery ledger.
- [ ] Add Discord-native RSVP later, using verified Discord member identity and scoped occurrence records. This is deferred and does not block event browsing or announcement work. No GottaGacha member/RSVP API integration is planned now; revisit its contract only if cross-system synchronization is requested.
- [ ] Expand labeled text drafts into the agreed plain-language parser after field semantics are known. Require exact revision review, expiring explicit confirmation, fresh staff authorization and idempotent create reconciliation before any write. Current drafts are review-only and expire after 24 hours.
- [ ] Perform separately authorized live API/Discord acceptance and deployment after all contract and delivery gates pass.

## Current deployment incident

- [x] Receive the separate incident recovery result: PR #5 (`df430287`) merged, with HTTP 200 bot/dashboard readiness reported by the base task. The reviewed change is integrated here.
- [ ] Verify sustained health and the two-module request budget before any future module deployment. On 2026-09-30 the dashboard was Online and usable, but the PR #4 bot deployment was Crashed after repeated `STORAGE_PROTOCOL` initialization failures (last observed error 17:33 EDT). The base task implemented PocketHost quota/cooldown mitigation in an isolated downstream worktree; rate limiting is a leading explanation, not proof of an old 429. Preserve the merged recovery work and verify the additional module polling load. This module task does not authorize production deployment.

## Explicitly deferred

- Standalone SQLite provider. PocketBase already uses SQLite internally; a direct adapter is not yet implemented.
- Automatic provider switching and cross-provider export/import. Selecting `STORAGE_PROVIDER` does not transfer data.
- Multi-guild service hosting. Each deployment is bound to one configured guild.
