# GottaGacha events

Downstream-only module for gg-bot. Created with `pnpm module:create gottagacha-events`. Default mode is disconnected and runtime enablement is off. The only available source is an explicitly selected fixture source. No live API endpoint, authentication scheme, member mapping or write contract is assumed.

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

## API contract gate

Ask the API owner for a documentation location or sanitized specification covering:

- Confirmed environments/base origins, versioning, exact list/detail/create/change endpoints and methods.
- Authentication: service credentials, scopes/audience, rotation, per-member delegation and staff permissions. No credentials in chat, settings, records or jobs.
- Event field types, required/optional/null semantics, stable IDs/revisions, visibility, capacity, location, start/end, recurrence and published/draft/cancelled states.
- Pagination order, cursor lifetime, page limits, rate limits, complete-snapshot guarantees and delta/webhook signatures.
- Updates, cancellation/deletion tombstones, revisions, out-of-order handling and correction/reannouncement policy.
- Timezone source, IANA zones versus offsets, DST ambiguity and all-day semantics.
- Verified Discord-to-member linkage, consent, account unlinking/revocation, action authorization and RSVP semantics.
- Create/update authorization, validation responses, idempotency key scope/TTL, conflict behavior and reconciliation after a timeout.

Provide sanitized examples for list pages, empty results, changes/cancellations, unauthorized/rate-limited responses, create success, duplicate create and uncertain create reconciliation. Confirm allowed public fields before exposing data to guild members.

`requiredSecrets` deliberately remains empty until the documented authentication contract determines the actual requirements. Then declare server-side secret names through the SDK and configure values privately on the bot service; never pass them to the dashboard. There is no network client in this foundation. Future reads require deadlines, bounded retries/pages/bytes and schema validation; writes require confirmed idempotency and explicit revision-bound staff confirmation.

## Remaining gates

Live announcements depend on upstream reusable delivery/reconciliation support. Preview records cannot replace it. Member actions depend on verified API identity and authorization. Event creation needs a reviewable exact draft revision, expiring explicit confirmation, a rechecked staff role/channel and an idempotent job whose uncertain result is reconciled before retry. Deployment and real publishing require separate authorization.
