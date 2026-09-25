import { syncModules } from './module-tools.js';
await syncModules();
import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
for (const app of ['bot', 'web', 'setup']) {
  await mkdir(`dist/${app}`, { recursive: true });
  await build({ entryPoints: [`apps/${app}/src/main.ts`], outfile: `dist/${app}/main.js`, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true, define: { 'process.env.NODE_ENV': '"production"' } });
}
await build({ entryPoints: ['packages/db/src/migrate-cli.ts'], outfile: 'dist/migrate.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' });
await writeFile('dist/BUILD_INFO.json', JSON.stringify({ version: '0.1.0', builtAt: new Date().toISOString(), capabilities: ['channel.created', 'channel.updated', 'channel.deleted'] }, null, 2));
for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await copyFile(file, `dist/${file}`);
