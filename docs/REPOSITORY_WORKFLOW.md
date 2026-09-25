# Shared upstream and community bots

`omo-bot` contains the reusable OMOBot framework, setup dashboard, storage providers and general-purpose modules. A downstream `community-bot` repository contains the community deployment and its specific modules. Publishing either repository stores source code; running the bot still requires a Node host, configured storage and Discord credentials.

For a public downstream, fork OMOWorlds/omo-bot on GitHub and clone that fork. Keep `origin` pointing at the downstream repository and add OMOWorlds/omo-bot as `upstream`. Public GitHub forks are public. For private integrations, create a separate private repository and push a clone of the upstream history into it; keep the same two-remotes arrangement. This preserves the shared history needed for future merges without putting private modules in a public fork. Follow Apache 2.0's license and notice requirements when distributing derivatives.

Inside the downstream checkout, run `pnpm module:create community-events`, then build the integration in that package. Its registration belongs in the downstream `modules/installed.json`. Keep tokens, runtime profiles, database files and deployment keys out of both repositories; configure each deployment privately through setup and server-side secrets. Each running deployment retains its own guild binding and database.

Shared bug fixes belong in `omo-bot` first. Bring them into a clean downstream working tree on an update branch:

```sh
git fetch upstream
git switch -c update-omobot
git merge upstream/main
pnpm install --frozen-lockfile
pnpm module:sync
pnpm check
pnpm test:e2e
```

Review any catalog conflicts, regenerate registry files and test before merging the update into the downstream main branch. Source updates do not automatically upgrade a running database or PocketHost hook bundle; follow the setup/provider deployment instructions. The current installer refuses to overwrite differing remote bundle files.

References: [GitHub forks](https://docs.github.com/en/pull-requests/reference/forks), [template repository history](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template), [module authoring](MODULES.md).
