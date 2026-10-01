# Verification record

Updated 2026-10-01. Pinned environment: Node 24.21.0, pnpm 10.34.5, PocketBase 0.40.4 and PostgreSQL 17.10.0. No production credentials or real Discord account were used.

## Foundation results

Typecheck, lint, production build and PocketHost bundle generation passed, along with 18 unit tests, 53 integration tests and eight desktop/mobile browser tests. The same foundation passed the GitHub Actions workflow on Linux before public-release preparation. Local browser screenshots were visually reviewed.

Integration tests start actual isolated PostgreSQL, PocketBase and SSH/SFTP processes. Coverage includes guild/module isolation, optimistic revisions, data expiry/restart, settings upgrades, job scheduling/dispatch, worker ownership, stale claim fencing, OAuth/session storage, protected routes, encrypted installation state, first-install provisioning and service supervision. Discord identity and sends are simulated.

Browser tests cover sign-in protection, routing settings, diagnostics, real queued fixture jobs, persistent module results, enable/disable behavior and setup. The example form preserves unsaved drafts during polling; mobile overflow checks use the visible viewport. Production and fixture builds are separate, and E2E builds both before launching services.

## Public-release verification

After adding Apache 2.0 licensing, dependency notices, generic community defaults and public documentation, the full checks passed again: typecheck, lint, production build, PocketHost bundle, 18 unit tests, 53 integration tests and eight desktop/mobile browser tests. License/notice files in the backend and both dashboard builds were compared byte-for-byte against their source files. Workspace manifests declare Apache-2.0. The release uses a clean root commit and GitHub noreply author metadata; the previous internal history is not part of the public repository. A targeted credential/path scan found no real credentials or local personal paths in the publication tree; test fixture values and third-party copyright attribution remain intentional. This is not a claim of a complete security audit.

## Reproduce

### Channel log formatting regression

The 2026-09-29 baseline passed typecheck, lint, 18 unit tests and the production build. Six new regression cases failed under the old renderer, reproducing raw snapshot output for create/delete, missing changed-field and permission rendering, missing-data behavior and noisy delivery-test output.

After the fix, typecheck, lint, 28 unit tests, 53 real database/integration tests and eight desktop/mobile browser tests passed. Final text/overflow refinements were checked again with typecheck, lint, 28 unit tests, production/fixture builds and the two routing-preview browser cases. Screenshots: `test-results/log-preview-desktop.png` and `test-results/log-preview-mobile.png` (local, ignored). The running dashboard previews readable channel metadata and overwrite counts with no raw Before/After JSON, empty reason or horizontal page overflow.

Regression coverage includes removed/added overwrites, Allowed/Denied/Inherited transitions, permission reordering, missing/invalid snapshots, cleared settings, meaningful optional settings, escaping and mention suppression, long payload limits, retained raw evidence, saved accent colors and the exact delivery marker suffix. Database/schema and delivery transport behavior were not changed. Existing Discord messages retain their old formatting. Actual Discord client rendering and the downstream hosted rollout remain unverified.

The first integration attempt was blocked by sandbox local-listener restrictions (`EPERM: listen EPERM: operation not permitted 127.0.0.1`) and was interrupted. Rerunning with local process/network permission passed all 53 tests.

An immediate browser rerun reproduced the existing demo shutdown issue from ROADMAP.md: the previous lease had not expired, failed startup left an orphaned local PocketBase child, and Playwright could not start its web server. The confirmed test child was stopped and the lease allowed to expire before retrying; the singleton protection was not bypassed.

### Message, member and voice logging

The 2026-09-30 baseline passed typecheck, lint, 28 unit tests and the production build. The completed update passed typecheck, lint, 52 unit tests, 61 actual database/integration tests and ten desktop/mobile browser tests. Production and fixture builds passed. The provider suite exercises both PostgreSQL and the unchanged PocketBase hook bundle.

Collector tests cover ordinary-message suppression, edits, attachment changes, single/bulk deletions, unavailable content, count/TTL bounds, policy/cache resets, excluded channels/categories, own-bot suppression, unrelated updates, nickname removal, role-set comparison, missing member baselines, voice moves and per-side exclusions. Renderer checks cover all nine events, mention suppression, escaping, long-field limits, bounded role lists and honest missing data. Settings tests prove version-1 upgrades retain prior values and keep the new switches off.

Provider tests additionally persist/filter/deliver each supported event, reject excluded or disabled observations, cancel already queued events when their channel becomes excluded, and migrate stored settings once on both databases. Browser tests save/reload switches, preview all six new events, filter their stored fixtures and inspect details. The initial new browser cases failed because an exact label selector included wrapped option text; explicit accessible names fixed it. The full ten-test rerun passed. No test servers were left intentionally running.

Local screenshots `test-results/activity-message.edited-desktop.png`, `test-results/activity-member.roles.updated-mobile.png` and `test-results/activity-voice.left-mobile.png` were visually reviewed. Additional per-event screenshots were captured during the suite. These show the running dashboard's synthetic preview, not a live Discord client. A real Gateway session with the new intents, live member fetching, Discord delivery and the downstream rollout remain unverified.

### Downstream merge verification

The deployment fork was checked before merging upstream (typecheck, lint and 18 unit tests passed), then again after resolving the runtime/build conflicts. The combined version passed typecheck, lint, 52 unit tests, 61 real provider/integration tests, production/fixture builds and ten desktop/mobile browser tests. Railway startup retry and command synchronization remain included. The first PostgreSQL attempt failed with a missing `libicudata.68.dylib` link in the fresh dependency installation. Running the pinned package’s approved postinstall restored its symlinks and the full integration suite passed. No application patch was needed for that environment failure.

### GottaGacha events foundation

Before source changes, the clean downstream checkout at logging PR #4 passed typecheck, lint, 52 unit tests, 61 integration tests and the production build. The initial shell lacked the pinned toolchain/dependencies, and sandboxed local listeners could not run the integration suite; after using Node 24.21.0, pnpm 10.34.5 and the checksum-verified PocketBase 0.40.4 binary with local listener permission, the baseline passed.

The foundation passes typecheck, lint, 58 unit tests, 65 actual PostgreSQL/PocketBase integration tests, production/fixture builds and all 12 desktop/mobile browser tests. New coverage includes fixture filtering/cancellation, replay and concurrent dedupe, partial persistence recovery, malformed-page rejection, bounded draft parsing and TTL, guild/channel/staff authorization, revoked capabilities on disable, stale settings jobs, CSRF, viewer restrictions and no outbound fetch. Minute-precision ISO input initially failed a regression test and now normalizes seconds before timezone validation.

The first events browser cases failed because the test queried Enable before the module card loaded. Waiting for the card corrected the test. An immediate rerun reproduced the already documented lease-expiry failure and left a confirmed local PocketBase test child; stopping that child and allowing expiry restored the full suite without changing ownership protections. The second-refresh assertion was then tightened to wait for the new job rather than cached completion text; both targeted desktop/mobile cases passed again.

Screenshots `test-results/gg-events-desktop.png` and `test-results/gg-events-mobile.png` were visually reviewed. The page labels samples, distinguishes preview readiness from API connection, shows never-sent announcements, explains draft expiry and blocks publishing. No horizontal overflow was observed. Tests use synthetic identity and local storage, not live API/Discord acceptance. No new storage migration or hook upload is needed.

### Events foundation with merged incident recovery

Reviewed and merged downstream PR #5 (`df430287`) after the fixture foundation commit. Both handoff verification additions were retained during the sole documentation conflict; downstream module registrations, Railway manifests, startup retries, command synchronization and OAuth diagnostics remain intact. Registry synchronization, typecheck, lint, 69 unit tests, 66 real integration tests, production/fixture builds and all 12 desktop/mobile browser tests passed on the combined branch.

The base task reported successful live bot/dashboard readiness after its separate incident deployment. This task performed no production deployment. Readiness is not proof of sustained two-module capacity: nominal source-level counting suggests about 1,080 idle storage requests/hour with two installed modules before dashboard/events. Upstream budget instrumentation/batching is requested and remains a deployment gate. This estimate is not a measured load test.

### Documented GottaGacha API reads

The supplied events integration guide was reviewed alongside the public OpenAPI document. Baseline `pnpm check` passed before edits. Reviewed gg-bot PR #6 (`9b8c291c`) was merged separately as `7f9e14e`, preserving downstream registrations and both incident fixes. The production-registry collector regression was adjusted to initialize every installed module. The merged baseline passed before API implementation.

The read-only slice passes typecheck, lint, 81 unit tests, 69 integration tests on actual PostgreSQL/PocketBase and the production build. Production/fixture builds and all 14 desktop/mobile browser cases passed. Adapter checks cover fixed-origin GET/auth headers, both date bounds, recurrence identity, explicit privacy flags, malformed/oversized responses, bounded public projection, HTTP errors, retry limits and sanitized error messages. A real local HTTP server sends headers but never finishes its response body; all three bounded attempts abort. No request was made to the authenticated live API.

Provider/host checks cover missing declared secrets, no reads during settings application, scoped job execution/replay, viewer and CSRF denial, wrong-guild commands, disabled modules and stale snapshot suppression. Commands and dashboard reads never fetch the external API. Unit checks also cover optimistic concurrency, persistent cooldowns across settings changes, invalidation before refresh, failure states and Detroit date/DST boundaries. Existing fixture/draft behavior remains covered.

Browser presentation fixtures explicitly label synthetic public events. The new cases verify venue-local display, cooldown expiry and hiding an expired snapshot even when repeated server responses remain unchanged. Screenshot review found settings-card clipping from the long secret variable name despite no page-level horizontal overflow. The layout and fixture-only draft guidance were refined, with an additional control-within-card assertion. After these refinements, registry synchronization, typecheck, lint, production/fixture builds and all four targeted desktop/mobile events cases passed. Both final API screenshots were visually reviewed: the secret variable wraps within the settings card and the cooldown has its own line. Screenshots are local ignored artifacts at `test-results/gg-events-api-desktop.png` and `test-results/gg-events-api-mobile.png`.

This is local acceptance only. No credentialed API call, real Discord announcement, event write, hosted rollout or new storage migration/hook upload was performed. Announcements, member authorization/RSVP, uncertain-create reconciliation and the PocketHost request-budget gate remain outstanding.

### Commands

Install the pinned toolchain and frozen dependencies. Run `pnpm pocketbase:install`, `pnpm exec playwright install chromium`, `pnpm check`, `pnpm pocketbase:bundle`, then `pnpm test:e2e`. Local listeners and child processes must be permitted. Do not rebuild frontend assets while tests are using them.

PocketBase startup tests intercept attempted browser commands and verify the committed headless hook suppresses installer tabs on startup/restart. A terminal process-group interruption can still prevent demo lease cleanup; wait for lease expiry and inspect orphaned children rather than repeatedly restarting or bypassing ownership checks.

## Limits

Passing tests do not establish exactly-once external delivery, full event-family coverage, live Discord/PocketHost permissions, hosted latency, container operation, TLS, load recovery or backup restoration. Version-aware upgrades of existing remote bundles, cross-provider transfers, installation-directory locking and durable setup-job recovery remain incomplete. See ROADMAP.md and SETUP.md.

## PocketHost request-budget release

Baseline before edits: typecheck, lint, 63 unit tests, 64 integration tests and production build passed. After implementation, typecheck, lint, 68 unit tests, 70 integration tests, production/fixture builds, 12 desktop/mobile browser tests and the PocketHost bundle pass. No live credentials or Discord sends were used for these checks.

The new request harness drives the actual PocketBase adapter, independent lease timer, ModuleHost, WorkerCycle, logging worker and Fastify/Auth with simulated time and HTTP responses. It counts every serialized request in that workload, including startup and shutdown. Results: 325 requests for one idle module, 328 for two, and 912 for two plus 100 changes and 60 authenticated workspace loads. The active workload peaks at 27 requests/10 seconds. This is not an actual hosted one-hour load test; independent real-provider tests establish queue, session and storage behavior.

Real PostgreSQL/PocketBase regressions cover combined module/heartbeat snapshots, due/delayed/expired jobs, no premature claiming, event/config preparation, stale claim tokens, settings disable during Discord validation, session touch without reviving expiry, protected workspace access and revoked membership. PocketBase ownership tests fence the new worker operations. Unit tests also cover old-hook refusal and late successful renewal arriving after the local deadline.

Browser tests verify a single shared workspace request on load, one request per accelerated minute for three minutes despite multiple mounted consumers, explicit refresh, and preservation of dirty logging drafts. Full fixture flows still pass for logging, modules and setup. Reviewed mobile screenshot: `test-results/workspace-budget-mobile.png`; desktop equivalent is also available locally. These are ignored artifacts.

Only operations.js needs replacement on the hosted instance; migrations are unchanged. Bundle manifest includes trafficProtocol 1 and file SHA-256 hashes. Comet reported the Mac locked, so live hook upload, client deployment and sustained hosted quota observation remain pending. Do not deploy current clients against old hooks.

### Downstream events integration of the request-budget release

Verified GitHub merge state for OMOBot PR #5 (`7a1f05b`) and gg-bot PR #7 (`4971c27`). The events branch baseline passed 81 unit and 69 integration tests plus typecheck/lint/build before merging. The reviewed merge preserves the module, Railway manifests, startup retry, command synchronization, OAuth diagnostics and both logging fixes. Documentation conflicts retain downstream identity and feature status; task routing stays local.

The incoming budget harness first failed because it assumed the upstream registry's one/two-module sizes; the new workspace provider assertion likewise assumed only logging/example. The harness now explicitly selects the one/two-module production workload, and workspace assertions use installed definitions. The combined branch passes 86 unit tests, 75 actual PostgreSQL/PocketBase integration tests, typecheck, lint, production/fixture builds, bundle generation and all 16 desktop/mobile browser tests.

Downstream HTTP measurements are 325/328 for one/two idle modules, and 913 with peak 28/10 seconds for the simulated active workload. The additional demo registry initialization accounts for the difference from the upstream 912/27 measurement. These are local simulated workloads, not hosted capacity acceptance.

The events dashboard consumes shared workspace settings and no longer polls its cached API snapshot separately. Browser checks confirm no independent settings reads, a single initial API snapshot read through expiry, preserved unsaved settings and successful fixture jobs with explicit workspace refresh. Final desktop/mobile API screenshots were visually reviewed. The current combined release requires trafficProtocol:1 hooks. Hosted capability and sustained health remain unverified here; no deployment was performed. The pending secret-vault release has additional migration/key requirements and is not part of this merge.

## Declared module secrets

Baseline before edits: typecheck, lint, 68 unit tests, 70 integration tests and production build passed. The completed feature passes typecheck, lint, 68 unit tests, 80 integration tests, production/fixture builds, 16 desktop/mobile browser tests and PocketHost bundle generation. The first browser run had two navigation assertions read the old DOM before the React route transition finished; waiting for the destination heading corrected those assertions, and the complete suite passed afterward.

Ten new real-provider cases test ciphertext at rest; authenticated guild/module/name binding; unknown names; concurrent creation/replacement/deletion; monotonic tombstones; explicit environment restoration; missing/wrong encryption keys; corrupted ciphertext; per-job rotation/deletion behavior; and owner-only, fresh-membership/CSRF-protected endpoints. Metadata and job results are checked for absence of synthetic credentials. Managed-runtime tests verify encrypted-profile persistence and retry after a failed key save before starting children.

Desktop/mobile tests cover masked defaults with zero automatic reveal requests, cleared password inputs after saving, explicit Show/Hide, 30-second expiry, navigation clearing, ignored late responses after Hide/close, deletion/fallback controls and absence from browser persistence. Reviewed screenshot: `test-results/module-secret-mobile.png`; desktop equivalent is available locally. Tests use synthetic credentials only. No community API behavior or production deployment was included.

PocketBase requires the new module-secret migration and matching hooks; PostgreSQL requires migration 0004. Clients check secretsProtocol:1. Bot/web must receive the same dedicated MODULE_SECRET_ENCRYPTION_KEY. Changing that encryption key does not rewrap old ciphertext. The base budget's simulated idle/workload counts remain unchanged; interactive secret management and async reads add explicitly requested storage calls.

### Downstream events integration of declared secrets

Verified the merged upstream PR #6 at `7914f055` before integrating. The downstream baseline passed typecheck, lint, 86 unit tests, 75 integration tests and the production build. The combined implementation passes `pnpm check` with 86 unit and 87 actual PostgreSQL/PocketBase integration tests, plus production/fixture builds and PocketHost bundle generation.

New provider regressions first failed on both databases because the old events module retained its environment key and ignored stored replacements. The module now resolves the declared secret after claiming each refresh and invalidating the old cache. Tests verify stored precedence, next-job rotation without settings changes/restart, disabled and malformed values preventing outbound reads, unavailable cache on failure, and explicit restoration of the environment fallback. Fixtures use synthetic values and no credentialed API calls.

The full 22-case browser run passed 21 cases, including every secret-control case on desktop and mobile. The mobile logging navigation case failed because the global page bucket returned HTTP 429 for a dynamic JavaScript import and a font. This was confirmed in the Playwright network trace, not attributed to a slow selector. A fresh mobile-only run passed all 11 mobile cases; all 11 desktop cases passed in the original run. The combined suite is still affected by this generic asset/page rate-limit issue, requested upstream and tracked in ROADMAP.md. No runtime limit was weakened or generic fix duplicated downstream.

Reviewed desktop/mobile secret-control screenshots from the running local dashboard, including `test-results/gg-events-secret-mobile.png`. Events-page coverage verifies password entry, no automatic reveal, cleared input and masked value after save, explicit Show/Hide, masking after reload, no value in ordinary settings responses and unchanged event-source settings. Shared controls additionally cover timed/navigation clearing, late reveal responses and browser persistence. No deployment, real secret or live event write was used.
