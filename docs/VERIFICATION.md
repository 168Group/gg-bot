# Verification record

Updated 2026-09-30. Pinned environment: Node 24.21.0, pnpm 10.34.5, PocketBase 0.40.4 and PostgreSQL 17.10.0. No production credentials or real Discord account were used.

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

### Commands

Install the pinned toolchain and frozen dependencies. Run `pnpm pocketbase:install`, `pnpm exec playwright install chromium`, `pnpm check`, `pnpm pocketbase:bundle`, then `pnpm test:e2e`. Local listeners and child processes must be permitted. Do not rebuild frontend assets while tests are using them.

PocketBase startup tests intercept attempted browser commands and verify the committed headless hook suppresses installer tabs on startup/restart. A terminal process-group interruption can still prevent demo lease cleanup; wait for lease expiry and inspect orphaned children rather than repeatedly restarting or bypassing ownership checks.

## Limits

Passing tests do not establish exactly-once external delivery, full event-family coverage, live Discord/PocketHost permissions, hosted latency, container operation, TLS, load recovery or backup restoration. Version-aware upgrades of existing remote bundles, cross-provider transfers, installation-directory locking and durable setup-job recovery remain incomplete. See ROADMAP.md and SETUP.md.
