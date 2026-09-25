# Contributing to OMOBot

Use Node from `.nvmrc` and the pinned pnpm version. Read README, HANDOFF and ROADMAP before changing behavior. Open an issue to discuss substantial features, then submit focused pull requests with relevant tests.

Run `pnpm install --frozen-lockfile`, `pnpm pocketbase:install` and `pnpm exec playwright install chromium`. Run `pnpm check` and `pnpm test:e2e` before submitting. Tests start local PostgreSQL/PocketBase services; use a dedicated Discord test server for live checks. Never use production credentials in tests.

Keep ordinary server-specific integrations in module packages. Add immutable database migrations; do not edit an applied migration. Keep both storage providers working and document incomplete or unverified behavior honestly. Review third-party notices whenever dependency versions change; `pnpm licenses list --prod` lists the runtime dependency inventory; `pnpm licenses:generate` refreshes THIRD_PARTY_NOTICES.md after reviewing any supplemental upstream texts.

Never commit tokens, passwords, deployment keys, `.env` files, databases or private installation profiles. Only example configuration belongs in Git. Configure a GitHub noreply commit email if you do not want to publish a personal email address.

Unless explicitly agreed otherwise, contributions intentionally submitted for inclusion are provided under the project's Apache 2.0 license. Submit only work you have the right to contribute. No copyright assignment is required.
