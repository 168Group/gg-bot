import { it, expect } from 'vitest';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { localSftp } from '../helpers/sftp.js';
import { probeSftp, uploadBundle, bundleFiles } from '../../apps/setup/src/sftp.js';
it('uploads only its bundle over real SFTP, pins the server key and preserves conflicts', async () => {
  const server = await localSftp();
  try {
    const fingerprint = await probeSftp(server.host, server.port); expect(fingerprint).toMatch(/^SHA256:/); expect(server.authentications()).toBe(0);
    const input = { host: server.host, port: server.port, username: 'test', privateKey: server.privateKey, fingerprint, directory: 'instance' };
    await expect(uploadBundle({ ...input, fingerprint: `SHA256:${'a'.repeat(43)}` }, () => {})).rejects.toThrow('SFTP upload failed'); expect(server.authentications()).toBe(0);
    await writeFile(`${server.root}/instance/unrelated.txt`, 'leave me');
    await uploadBundle(input, () => {});
    for (const file of bundleFiles) expect(await readFile(`${server.root}/instance/${file}`, 'utf8')).toBe(await readFile(`infra/pocketbase/${file}`, 'utf8'));
    await uploadBundle(input, () => {});
    expect(await readFile(`${server.root}/instance/unrelated.txt`, 'utf8')).toBe('leave me');
    const first = bundleFiles[0]!; await writeFile(`${server.root}/instance/${first}`, 'existing migration');
    await expect(uploadBundle(input, () => {})).rejects.toThrow('differs from this bundle');
    expect(await readFile(`${server.root}/instance/${first}`, 'utf8')).toBe('existing migration');
    expect((await readdir(`${server.root}/instance/pb_hooks`)).some(name => name.endsWith('.upload'))).toBe(false);
  } finally { await server.stop(); }
});

it('provisions a fresh PocketBase over SFTP and applies migrations through automatic hook reload', async () => {
  const { mkdir, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const { localPocketBase } = await import('../../scripts/local-pocketbase.js');
  const { InstallationStore } = await import('../../apps/setup/src/state.js');
  const { Provisioner } = await import('../../apps/setup/src/provision.js');
  const { PocketBaseAdapter } = await import('../../packages/db/src/pocketbase.js');
  const server = await localSftp(), dir = `${server.root}/instance`;
  await mkdir(`${dir}/pb_hooks`); await mkdir(`${dir}/pb_migrations`);
  const pb = await localPocketBase({ directory: dir, envBinding: false, hooksDirectory: `${dir}/pb_hooks`, migrationsDirectory: `${dir}/pb_migrations`, watch: true });
  const store = await InstallationStore.open(await mkdtemp(`${tmpdir()}/omo-remote-install-`)), provisioner = new Provisioner(store);
  try {
    const email = 'sftp-installer@example.com', password = 'local-fixture-password-123';
    await promisify(execFile)(resolve('.local/pocketbase-bin/pocketbase'), ['superuser', 'create', email, password, `--dir=${dir}/pb_data`], { timeout: 10000 });
    const fingerprint = await probeSftp(server.host, server.port);
    const profile = await provisioner.prepare({ name: 'Remote test', guildId: '100000000000000001', storage: { kind: 'remote', url: pb.url, email, password, sftp: { host: server.host, port: server.port, username: 'fixture', privateKey: server.privateKey, directory: 'instance', fingerprint } } }, () => {});
    expect(profile.ready).toBe(true);
    const db = new PocketBaseAdapter(profile.env.POCKETBASE_URL!, profile.env.POCKETBASE_SERVICE_KEY!); await db.scope(profile.guildId).ready(); await db.close();
    expect(JSON.stringify(await store.read())).not.toContain(password); expect(JSON.stringify(await store.read())).not.toContain(server.privateKey);
  } finally { await provisioner.close(); await pb.stop(); await server.stop(); }
}, 60000);
