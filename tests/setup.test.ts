import { it, expect } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { InstallationStore } from '../apps/setup/src/state.js';
import { setupInput, publicProfile, type Profile } from '../apps/setup/src/model.js';
it('persists encrypted installation credentials with private permissions and no public secret fields', async () => {
  const store = await InstallationStore.open(await mkdtemp(`${tmpdir()}/omo-setup-test-`));
  const p: Profile = { id: 'test', name: 'Test', guildId: '100000000000000001', kind: 'remote', ready: true, createdAt: 'now', env: { POCKETBASE_URL: 'https://example.com', POCKETBASE_SERVICE_KEY: 'very-private-test-secret' } };
  await store.save({ profiles: [p], activeId: null });
  expect(await readFile(`${store.directory}/profiles.enc`, 'utf8')).not.toContain('very-private');
  expect(JSON.stringify(publicProfile(p))).not.toContain('very-private');
  const reopened = await InstallationStore.open(store.directory); expect((await reopened.read()).profiles[0]?.env.POCKETBASE_SERVICE_KEY).toBe('very-private-test-secret');
  expect((await stat(`${store.directory}/profiles.enc`)).mode & 0o777).toBe(0o600);
  expect(reopened.accessKey).toBe(store.accessKey);
});
it('rejects invalid destinations and deployment traversal before setup', () => {
  const base = { name: 'Community', guildId: '100000000000000001' };
  expect(setupInput.safeParse({ ...base, storage: { kind: 'local' } }).success).toBe(true);
  expect(setupInput.safeParse({ ...base, storage: { kind: 'postgres', host: 'localhost; command', port: 5432, database: 'omo', username: 'omo', password: 'secret', tls: false } }).success).toBe(false);
  const storage = { kind: 'remote', url: 'https://example.com', email: 'test@example.com', password: 'test', sftp: { host: 'ftp.pockethost.io', port: 2222, username: 'test@example.com', privateKey: 'test', fingerprint: `SHA256:${'a'.repeat(43)}`, directory: '../pb_data' } };
  expect(setupInput.safeParse({ ...base, storage }).success).toBe(false);
  expect(setupInput.safeParse({ ...base, storage: { ...storage, url: 'http://remote.example.com', sftp: { ...storage.sftp, directory: 'instance' } } }).success).toBe(false);
});
