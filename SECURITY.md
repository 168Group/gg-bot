# Security

OMOBot is pre-1.0 software. Live deployments, every logging event family and production recovery/load acceptance are not yet certified. See ROADMAP and docs/VERIFICATION.md for the tested scope. Only the current main branch receives development fixes; there is no guaranteed response time or supported release schedule yet.

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/OMOWorlds/omo-bot/security/advisories/new). Include affected versions, reproduction steps and impact. Do not publish exploit details or credentials in a public issue. If private reporting is unavailable, open an issue requesting a private contact without including vulnerability details.

Do not send live tokens or database contents. Revoke exposed credentials before reporting. Module packages run trusted code in the bot process and are not sandboxed; install only modules you trust. Keep installation access keys, database credentials and Discord tokens private, use TLS for remote services, and maintain tested backups.
