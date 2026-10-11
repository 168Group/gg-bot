# GottaGacha events

Downstream-only module for gg-bot. Created with `pnpm module:create gottagacha-events`. Default mode is disconnected and runtime enablement is off. Sources are explicitly selected fixture previews or documented API read-only browsing. Enabled API mode queues an initial refresh and refreshes hourly without an open dashboard. Discord commands only read the cache. Fixture/disconnected modes never fetch the API.

## Try the safe foundation

Build both services. In Modules, enable GottaGacha events. Open its page, select Fixture preview and save. After settings apply, refresh sample events. `/events upcoming` shows labeled samples; repeated refreshes retain one announcement preview per sample ID/revision/status for seven days. These previews are never sent to Discord. This retention-limited preview mechanism is not production delivery deduplication.

Optionally choose staff text channels. Admins/owners can send:

```text
event:
Title: Sample game night
Starts: 2030-05-10T18:00:00-04:00
Timezone: America/Detroit
Location: Sample gathering space
```

The parser requires labeled lines, an explicit timezone and matching offset. It reports missing/ambiguous fields rather than guessing. Only parsed fields and validation issues are retained for 24 hours, with author/channel IDs for review. Unrecognized raw text is not stored. Replayed message IDs reuse the same draft. Use `/events draft id:<review-id>` or the admin-only dashboard list. These are fixture drafts with no publishing path. Ordinary channel messages are ignored.

## Documented API read-only browsing

The supplied events integration guide establishes `/api/v1/events` as the authenticated GET endpoint. The client uses `https://www.gottagacha.com/api/v1/events`: a credential-free check on 2026-10-11 confirmed the documented apex hostname returns HTTP 307 to this canonical hostname. Calling it directly avoids forwarding credentials through redirects. Any further redirect is rejected once with an endpoint error, without exposing the Location header or response body. Public reference: [API docs](https://www.gottagacha.com/api/docs). The guide includes privacy fields missing from the public OpenAPI Event schema; this adapter requires explicit `isPrivate` and `isActive` booleans and fails closed when they are missing.

For a separately authorized rollout, issue a least-privilege key with only `events:read`. An owner can save it through **Manage secrets** on this module’s page or Modules card, using the declared `GG_API_KEY` field. Alternatively, keep `OMO_MODULE_GOTTAGACHA_EVENTS_GG_API_KEY` privately on the bot service as an explicit environment fallback. Do not put values in chat, ordinary settings, jobs or records. Both `gg_test_` and `gg_live_` keys access the same database; the test prefix does not provide a sandbox. Fixture mode requires no key.

Enable the module, select **GottaGacha API (read-only)**, save, and wait for applied settings. The bot refreshes automatically at startup and hourly; no additional setting is needed. An administrator can also choose **Refresh from GottaGacha** for urgent changes. The worker requests today through six days ahead in America/Detroit, always supplying both inclusive date bounds so the API expands recurring events. It sends no `limit`: the API applies that option to database rows before expansion. There is no documented cursor or detail GET endpoint. `meta.total` counts source rows, not occurrences, so the dashboard describes returned public occurrences without claiming complete pagination.

The adapter accepts at most 1 MiB and 1,000 occurrences per response. Missing fields, duplicates and dates outside the requested range reject the entire response. Private and inactive events are filtered before persistence. Only public title, date/time, location, IDs and update timestamp are projected, with at most 40 occurrences and 24 KB of event data. Descriptions, creator IDs, zones and private booking content are never retained. A bounded display is labeled as a selection. Occurrence identity is `id:eventDate`, preserving multiple occurrences of a recurring series.

Each GET has a ten-second deadline including the response body, at most three attempts and a 35-second overall deadline. Only network and 5xx read failures retry, with bounded backoff. Authentication/scope/schema failures do not retry. HTTP 429 honors numeric `Retry-After` and persists a cooldown of at least one minute. Every refresh has a persisted one-minute minimum cooldown, even across process restarts/settings changes. Revision checks and optimistic record updates fence stale jobs and concurrent refreshes. A job replay reuses its saved result.

A refresh clears the old public projection before network work. Failure or an interrupted job leaves events unavailable. Successful results remain visible for at most 75 minutes, allowing a 15-minute worker delay beyond the hourly interval, and are hidden after a settings revision change. At venue midnight, yesterday's events are filtered while the actual cached date range remains visible until the next refresh. The single scoped public cache record remains stored until replaced; expiry controls display, not record deletion. Dashboard reads and `/events upcoming` use only this cache and show when it was checked. Times remain venue-local America/Detroit wall times, without inventing UTC offsets at DST transitions. Cancelled events disappear from the list, so absence is never treated as proof of cancellation. Changes can lag until the next successful refresh. The page shares the framework workspace snapshot for settings and checks the public cache every five minutes while visible and active. A local timer hides expired events between checks.

The module schedules durable jobs for the current and next UTC hour with idempotency keys containing the settings revision and hour. A tracked timer replenishes them hourly; DST does not alter elapsed cadence. Restart reuses the current hour's job, including its completed/failed result, and resumes future scheduling without replaying missed hours. Each automatic job expires one hour after its due time. A queue outage gets at most three attempts spaced a minute apart, then the next hourly attempt. API failures cannot break the schedule. Disabling the module, changing source or stopping the worker disposes the timer and waits for any enqueue in flight. Previously queued jobs cannot fetch under a new settings revision. Manual and automatic jobs share the persisted cooldown and concurrency checks.

## Dashboard secret configuration

An owner can save or replace the key from **API key → Manage secrets** on the events page, or from the module’s card. The field uses a password input, clears after saving, and displays a mask for the stored value. **Show** explicitly requests the value; **Hide**, closing the control, navigation, hiding the tab and a 30-second timer clear it. Admin/viewer access alone cannot manage or reveal secrets. Ordinary settings and status responses never contain the value.

The shared framework encrypts the value with AES-256-GCM, bound to guild/module/declared name. Bot and dashboard must receive the same dedicated `MODULE_SECRET_ENCRYPTION_KEY` before storing or using dashboard values. See [module secret configuration and rollout](../../docs/MODULE_SECRETS.md). Keep the encryption key separate from the database and session key. Changing it does not re-encrypt existing values.

Each manual or automatic refresh resolves `await context.secrets.get('GG_API_KEY')` after claiming the refresh and clearing its old public cache. No credential is retained between jobs or fetched directly by the scheduler. A replacement applies to the next job; a request already running may finish with the previous value. **Delete and disable** blocks even an existing environment key. **Use environment** explicitly restores fallback; the dashboard cannot reveal that separate process's environment value and reports its availability as unknown. Corrupt ciphertext or encryption problems fail closed. Missing/disabled/invalid-format keys produce a sanitized unavailable-cache result without contacting the event API. The module can be enabled and configured before the key is supplied; an active module is not proof that its API credential works.

## Unresolved API capabilities

The documented POST creates a public active event with a null creator. PATCH changes an event and DELETE cancels its entire series. The module implements none of these writes. Create requests have **no idempotency support**; a saved Discord-message-to-event mapping cannot reconcile a response lost before its event ID is saved. Confirm a supported uncertain-create reconciliation mechanism before implementing retryable publishing.

RSVP is deferred to a later Discord-native feature. It can use Discord identity and module-scoped occurrence records without requiring a GottaGacha member API. Capacity rules, visibility and event changes will be specified when that feature is requested. Cross-system member linkage or RSVP synchronization remains out of scope; obtain that API contract only if such synchronization is later requested. Staff draft preview parsing remains fixture-only and does not imply that API publishing is configured.

## Remaining gates

The merged request-budget framework uses one combined 30-second worker poll and independent 20-second lease renewal. Settings and jobs may take roughly 30 seconds plus processing time; use Refresh workspace to check applied settings sooner than the one-minute dashboard refresh. The old 1,080/hour idle estimate is superseded by instrumented workload tests in docs/POCKETHOST.md. Additional event jobs, fixture previews, dashboard interactions, viewers and failures still consume requests and need a realistic deployment budget. The current clients require the module-secret storage migration, matching hooks, readiness with trafficProtocol:1 and secretsProtocol:1, and a shared encryption key for dashboard-stored values before deployment. This task has not verified hosted capabilities or sustained health. The earlier budget hook-only rollout does not cover this release.

Live announcements depend on upstream reusable delivery/reconciliation support. Preview records cannot replace it. Discord-native RSVP is deferred and does not block this read-only slice. Event creation needs a reviewable exact draft revision, expiring explicit confirmation, a rechecked staff role/channel and an idempotent job whose uncertain result is reconciled before retry. Deployment and real publishing require separate authorization.
