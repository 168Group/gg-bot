# GottaGacha events

Downstream-only module for gg-bot. Created with `pnpm module:create gottagacha-events`. Default mode is disconnected and runtime enablement is off. Sources are explicitly selected fixture previews or documented API read-only browsing. No network request occurs on startup, settings application or a Discord command. Live reads require an administrator to request a refresh.

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

The supplied events integration guide establishes `https://gottagacha.com/api/v1/events` as the authenticated GET endpoint. Public reference: [API docs](https://gottagacha.com/api/docs). The guide includes privacy fields missing from the public OpenAPI Event schema; this adapter requires explicit `isPrivate` and `isActive` booleans and fails closed when they are missing.

For a separately authorized rollout, issue a least-privilege key with only `events:read`. Configure `OMO_MODULE_GOTTAGACHA_EVENTS_GG_API_KEY` privately on the **bot** service using the SDK's declared `GG_API_KEY` secret. Do not put its value in chat, dashboard settings, jobs, records or the dashboard service. Both `gg_test_` and `gg_live_` keys access the same database; the test prefix does not provide a sandbox. Fixture mode requires no key.

Enable the module, select **GottaGacha API (read-only)**, save, and wait for applied settings. An administrator can then choose **Refresh from GottaGacha**. The worker requests today through six days ahead in America/Detroit, always supplying both inclusive date bounds so the API expands recurring events. It sends no `limit`: the API applies that option to database rows before expansion. There is no documented cursor or detail GET endpoint. `meta.total` counts source rows, not occurrences, so the dashboard describes returned public occurrences without claiming complete pagination.

The adapter accepts at most 1 MiB and 1,000 occurrences per response. Missing fields, duplicates and dates outside the requested range reject the entire response. Private and inactive events are filtered before persistence. Only public title, date/time, location, IDs and update timestamp are projected, with at most 40 occurrences and 24 KB of event data. Descriptions, creator IDs, zones and private booking content are never retained. A bounded display is labeled as a selection. Occurrence identity is `id:eventDate`, preserving multiple occurrences of a recurring series.

Each GET has a ten-second deadline including the response body, at most three attempts and a 35-second overall deadline. Only network and 5xx read failures retry, with bounded backoff. Authentication/scope/schema failures do not retry. HTTP 429 honors numeric `Retry-After` and persists a cooldown of at least one minute. Every refresh has a persisted one-minute minimum cooldown, even across process restarts/settings changes. Revision checks and optimistic record updates fence stale jobs and concurrent refreshes. A job replay reuses its saved result.

A refresh clears the old public projection before network work. Failure or an interrupted job leaves events unavailable. Successful results remain visible for at most five minutes and are hidden after a settings revision change or venue date rollover. The single scoped public cache record remains stored until replaced; expiry controls display, not record deletion. Dashboard reads and `/events upcoming` use only this cache. Times remain venue-local America/Detroit wall times, without inventing UTC offsets at DST transitions. Cancelled events disappear from the list, so absence is never treated as proof of cancellation. Manual refreshes deliberately avoid background polling while the PocketHost request-budget gate remains open.

## Dashboard secret configuration

Requested behavior: an owner can save or replace the API key from a secret control in this module’s dashboard, see a mask by default, and explicitly Show or Hide its value. Stored values must be encrypted; routine settings/status responses must contain only configured/source metadata. Revealed plaintext should clear on hide, navigation and a short timeout, without entering browser persistence or shared query caches. The next event refresh must use an updated key.

This control is **not implemented yet**. The existing SDK only reads module secrets from the bot environment. Shared encrypted storage, save/reveal APIs and reusable UI have been requested from the separate OMOBot task. Until reviewed upstream support is merged and integrated, use the documented environment variable privately on the bot service. Do not paste a key into ordinary dashboard settings or chat.

## Unresolved API capabilities

The documented POST creates a public active event with a null creator. PATCH changes an event and DELETE cancels its entire series. The module implements none of these writes. Create requests have **no idempotency support**; a saved Discord-message-to-event mapping cannot reconcile a response lost before its event ID is saved. Confirm a supported uncertain-create reconciliation mechanism before implementing retryable publishing.

RSVP is deferred to a later Discord-native feature. It can use Discord identity and module-scoped occurrence records without requiring a GottaGacha member API. Capacity rules, visibility and event changes will be specified when that feature is requested. Cross-system member linkage or RSVP synchronization remains out of scope; obtain that API contract only if such synchronization is later requested. Staff draft preview parsing remains fixture-only and does not imply that API publishing is configured.

## Remaining gates

The merged PocketHost recovery update uses 30-second worker polling, so settings and jobs may take roughly 30 seconds plus processing time. Before deploying an additional module, verify the remote request budget. Source review of the existing loop estimates about 1,080 idle requests/hour with logging plus this installed module (including lease renewal), above the host's observed 1,000/hour per-IP cap before dashboard/event traffic. This estimate still needs instrumentation. Generic batching/headroom is requested upstream; local fixture verification does not establish deployment capacity.

Live announcements depend on upstream reusable delivery/reconciliation support. Preview records cannot replace it. Discord-native RSVP is deferred and does not block this read-only slice. Event creation needs a reviewable exact draft revision, expiring explicit confirmation, a rechecked staff role/channel and an idempotent job whose uncertain result is reconciled before retry. Deployment and real publishing require separate authorization.
