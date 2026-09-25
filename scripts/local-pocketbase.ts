import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { PocketBaseAdapter } from '../packages/db/src/pocketbase.js';

export async function localPocketBase(options: { directory?: string; port?: number; guildId?: string; key?: string; binary?: string; envBinding?: boolean; hooksDirectory?: string; migrationsDirectory?: string; watch?: boolean } = {}) {
  const port = options.port ?? await new Promise<number>((done, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const address = server.address(); if (!address || typeof address === 'string') { server.close(); reject(new Error('No port available.')); return; }
      server.close(error => error ? reject(error) : done(address.port));
    });
  });
  const directory = options.directory ? resolve(options.directory) : await mkdtemp(`${tmpdir()}/omo-pb-`);
  await mkdir(directory, { recursive: true });
  const hooksDirectory = resolve(options.hooksDirectory ?? 'infra/pocketbase/pb_hooks');
  const headlessSource = resolve('infra/pocketbase/pb_hooks/000_omo_headless.pb.js');
  const headlessTarget = `${hooksDirectory}/000_omo_headless.pb.js`;
  // Even fresh SFTP test instances need this before their very first serve/reload.
  await mkdir(hooksDirectory, { recursive: true });
  const headless = await readFile(headlessSource);
  if (headlessTarget !== headlessSource) {
    try { await writeFile(headlessTarget, headless, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!(await readFile(headlessTarget)).equals(headless)) throw new Error('Refusing to start PocketBase without the expected headless hook.');
  }
  const guildId = options.guildId ?? '100000000000000001', key = options.key ?? randomBytes(32).toString('hex'), url = `http://127.0.0.1:${port}`;
  const driver = new PocketBaseAdapter(url, key);
  let processHandle: ReturnType<typeof spawn> | undefined;
  const start = async () => {
    processHandle = spawn(resolve(options.binary ?? process.env.POCKETBASE_BINARY ?? '.local/pocketbase-bin/pocketbase'), [
      'serve', `--dir=${directory}/pb_data`, `--hooksDir=${hooksDirectory}`, `--migrationsDir=${resolve(options.migrationsDirectory ?? 'infra/pocketbase/pb_migrations')}`,
      `--http=127.0.0.1:${port}`, `--hooksWatch=${options.watch ?? false}`
    ], { env: { ...process.env, OMO_STORAGE_KEY: options.envBinding === false ? '' : key, OMO_GUILD_ID: options.envBinding === false ? '' : guildId }, stdio: ['ignore', 'pipe', 'pipe'] });
    let bootError = false;
    processHandle.once('error', () => { bootError = true; });
    // Startup output can contain a PocketBase installer token. Never relay it.
    processHandle.stdout?.resume(); processHandle.stderr?.resume();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (bootError || processHandle.exitCode !== null || processHandle.signalCode !== null) throw new Error('PocketBase failed to start. Run pnpm pocketbase:install and check migrations/hooks.');
      try {
        if (options.envBinding === false) { const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) }); if (!health.ok) throw new Error('Starting'); }
        else await driver.call(guildId, 'ready', {});
        return;
      } catch { await new Promise(done => setTimeout(done, 100)); }
    }
    await stop();
    throw new Error('PocketBase storage hooks did not become ready. Check the pinned version and hook bundle.');
  };
  const stop = async () => {
    const child = processHandle; if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(done => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM');
    });
  };
  await start();
  return { url, key, guildId, directory, driver, stop, restart: async () => { await stop(); await start(); } };
}
