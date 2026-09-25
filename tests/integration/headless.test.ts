import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { localPocketBase } from '../../scripts/local-pocketbase.js';
import { freePort } from '../../apps/setup/src/runtime.js';

it('disables installer browser launches on fresh startup and restart, including custom hook directories', async () => {
  const directory = await mkdtemp(`${tmpdir()}/omo-headless-`), guard = `${directory}/guard`, marker = `${directory}/browser-attempt`;
  await mkdir(guard); await mkdir(`${directory}/empty-hooks`);
  for (const command of ['open', 'xdg-open', 'rundll32']) await writeFile(`${guard}/${command}`, '#!/bin/sh\nprintf blocked > "$OMO_BROWSER_LAUNCH_MARKER"\nexit 0\n', { mode: 0o700 });
  // Intercept the exact PATH-resolved executable used by the pinned PocketBase version.
  // Even the control instance cannot open a real browser.
  vi.stubEnv('PATH', `${guard}:${process.env.PATH}`); vi.stubEnv('OMO_BROWSER_LAUNCH_MARKER', marker);
  let control: ReturnType<typeof spawn> | undefined, pb: Awaited<ReturnType<typeof localPocketBase>> | undefined;
  try {
    control = spawn(resolve('.local/pocketbase-bin/pocketbase'), ['serve', `--dir=${directory}/control`, `--hooksDir=${directory}/empty-hooks`, `--http=127.0.0.1:${await freePort()}`, '--hooksWatch=false'], { stdio: 'ignore', env: process.env });
    for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise(done => setTimeout(done, 100));
    expect(await readFile(marker, 'utf8')).toBe('blocked');
    await new Promise<void>(done => { control!.once('exit', () => done()); control!.kill('SIGTERM'); }); control = undefined;
    await writeFile(marker, 'no-attempt');
    pb = await localPocketBase({ directory: `${directory}/managed`, hooksDirectory: `${directory}/managed-hooks`, envBinding: false });
    await pb.restart();
    await new Promise(done => setTimeout(done, 300));
    expect(await readFile(marker, 'utf8')).toBe('no-attempt');
    const db = new DatabaseSync(`${pb.directory}/pb_data/data.db`);
    try { expect(db.prepare('SELECT count(*) AS count FROM _superusers').get()?.count).toBe(0); } finally { db.close(); }
  } finally {
    control?.kill('SIGTERM'); await pb?.stop(); vi.unstubAllEnvs();
  }
});
