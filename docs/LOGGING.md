# Activity logging

The bundled logging module records channel creation, updates and deletion; message edits and deletion; member nickname changes; member role additions/removals; and voice channel joins/leaves. Moving between voice channels creates a leave and a join, each checked against its own exclusions. Mute/deafen changes do not create logs. Voice audio is never recorded.

New messages do not create database events or Discord logs. Bulk deletion creates one event per deleted message. Embed-only, pin and reaction updates do not count as message edits. Role logging concerns roles assigned to members, not creation or deletion of server roles. Audit attribution is unfinished: the member or message author is the subject, not proof of who changed or deleted it.

## Enable or upgrade

1. In the Discord Developer Portal, open the application's Bot settings and enable **Server Members Intent** and **Message Content Intent**. The installed logging module requests these even when its switches are off. Discord may require approval for privileged intents on verified applications. See [Gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents).
2. Stop the old bot worker, then deploy matching bot and dashboard builds. Keep one bot worker per guild. This logging update uses the existing generic event storage: no database schema migration or PocketHost hook upload is required when upgrading the existing module foundation.
3. Existing logging settings automatically upgrade from version 1 to 2, preserving destinations, exclusions, retention, accent and channel switches. The six new event switches start **off** on existing installations. Fresh installations have all switches selected, with the module itself disabled until configured and enabled.
4. In **Activity logging > Routing**, select the desired events, choose a private text destination and save. Enable the module from Modules if needed and wait for its applied revision to match. Use Preview log to inspect synthetic examples without sending them.
5. Use Diagnostics to send a delivery test, then check a test channel with a message edit/deletion, nickname change, role assignment/removal and voice join/leave. These live Discord acceptance checks remain necessary after deployment.

The bot needs access to observed channels and View Channel, Send Messages, Embed Links and Read Message History in the logging destination. Guild Messages and Guild Voice States are requested automatically alongside Guilds. No permission to read an audit log is evidence of confirmed attribution in this version.

## Message content and retention

While message logging is active, the collector keeps at most 1,000 recent messages in memory for up to 30 minutes to compare edits and recover deleted text. The SDK's separate message cache is disabled. Excluded channels/categories, the log destination, other guilds and DMs do not populate the comparison cache. Known messages authored by this bot retain only enough metadata to suppress their logs. Policy changes, disconnects, shutdown and restarts clear the cache.

Snapshots keep at most 4,000 content characters and ten attachment IDs/names. Files are not downloaded and attachment URLs are not stored. Only an edit or deletion persists a message observation. That stored text uses the configured event retention period, 7 to 90 days, default 30. Shortening retention also shortens existing deadlines. Database expiry does not delete log posts already delivered to Discord.

Discord deletion packets contain IDs rather than deleted content. Old messages, cache eviction and downtime can therefore produce logs with unavailable content or authors. The collector never invents missing text or fetches deleted messages. See [Gateway events](https://docs.discord.com/developers/events/gateway-events). Rendered Discord fields abbreviate long content; bounded captured snapshots remain in dashboard details.

Member comparison uses Discord's cached member baseline, loaded at startup. If no baseline exists, the bot records a coverage gap instead of claiming a nickname or role changed. Activity during initialization, downtime or queue overflow cannot be reconstructed. Check Diagnostics for recorded gaps; absence of a gap does not guarantee complete coverage.

Member join and leave alerts are not implemented yet. Roles assigned after an observed join can produce role-change logs. Roles already present in the initial member snapshot are a baseline, not evidence of a subsequent assignment, and are not reported as changes.

## Exclusions and queued delivery

Channel/category exclusions apply before capture and again before delivery. Message threads also honor exclusions on their parent channel and category when that scope is known. Voice moves are evaluated per channel. Member nickname/role events are guild-wide and have no channel scope.

Disabling an event type cancels its unsent deliveries when processed, and policy changes clear the comparison cache. Already stored observations stay until their retention deadline. Excluding the log destination from message collection also prevents feedback from logging its own edits/deletions. Durable retries use the existing delivery marker; external delivery is not guaranteed exactly once.
