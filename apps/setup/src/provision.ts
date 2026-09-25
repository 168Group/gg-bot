import { randomBytes, randomUUID } from 'node:crypto';
import { localPocketBase } from '../../../scripts/local-pocketbase.js';
import { installPocketBase } from './local-binary.js';
import { PocketBaseAdapter } from '../../../packages/db/src/pocketbase.js';
import { PostgresAdapter } from '../../../packages/db/src/postgres-adapter.js';
import { migrate } from '../../../packages/db/src/migrate.js';
import { InstallationStore } from './state.js';
import { SetupError, type SetupInput, type Profile } from './model.js';
import { uploadBundle } from './sftp.js';
export async function bindPocketBase(url: string, email: string, password: string, guildId: string, key: string) {
  const login = await fetch(`${url}/api/collections/_superusers/auth-with-password`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password }) });
  if (!login.ok) throw new SetupError('PocketBase superadmin login failed. Check credentials, MFA and allowed IPs.');
  const auth = await login.json() as { token?: string }; if (!auth.token) throw new SetupError('PocketBase did not return a superadmin session.');
  const response = await fetch(`${url}/api/omo-install/bind`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: auth.token, 'content-type': 'application/json' }, body: JSON.stringify({ guildId, key }) });
  if (response.status === 404) return false;
  if (response.status === 409) throw new SetupError('This instance is already bound. Use its original saved profile or a fresh instance.');
  if (!response.ok) throw new SetupError('Instance binding failed. Check migration startup and PocketBase version.');
  return true;
}
export class Provisioner {
  private local = new Map<string, Awaited<ReturnType<typeof localPocketBase>>>();
  constructor(readonly store: InstallationStore) {}
  async localFor(profile: Profile) {
    const running = this.local.get(profile.id); if (running) return running;
    const binary = await installPocketBase();
    const pb = await localPocketBase({ directory: `${this.store.directory}/pocketbase/${profile.id}`, guildId: profile.guildId, key: profile.env.POCKETBASE_SERVICE_KEY, binary });
    this.local.set(profile.id, pb); profile.env.POCKETBASE_URL = pb.url; return pb;
  }
  async prepare(input: SetupInput, progress: (message: string) => void) {
    const state = await this.store.read();
    const existing = input.storage.kind === 'remote' ? state.profiles.find(p => p.kind === 'remote' && p.env.POCKETBASE_URL === new URL(input.storage.kind === 'remote' ? input.storage.url : '').origin) : undefined;
    if (existing && existing.guildId !== input.guildId) throw new SetupError('This saved instance belongs to another Discord server.');
    if (existing?.id === state.activeId) throw new SetupError('This instance is active. Stop it before preparing changes.');
    const profile: Profile = existing ?? { id: randomUUID(), name: input.name, guildId: input.guildId, kind: input.storage.kind, env: {}, createdAt: new Date().toISOString(), ready: false };
    if (input.storage.kind === 'postgres') {
      const s = input.storage, url = new URL('postgresql://localhost');
      url.hostname = s.host; url.port = String(s.port); url.username = s.username; url.password = s.password; url.pathname = `/${encodeURIComponent(s.database)}`; url.searchParams.set('sslmode', s.tls ? 'verify-full' : 'disable');
      profile.env = { STORAGE_PROVIDER: 'postgres', DATABASE_URL: url.toString() };
    } else {
      profile.env = { ...profile.env, STORAGE_PROVIDER: 'pocketbase', POCKETBASE_SERVICE_KEY: profile.env.POCKETBASE_SERVICE_KEY ?? randomBytes(32).toString('hex'), ...(input.storage.kind === 'remote' ? { POCKETBASE_URL: new URL(input.storage.url).origin } : {}) };
    }
    if (!existing) state.profiles.push(profile);
    // Preserve generated runtime keys before any remote side effect so retries can finish a partial install.
    profile.ready = false; await this.store.save(state);
    try {
      if (input.storage.kind === 'local') {
        progress('Installing and starting PocketBase on this host.'); await this.localFor(profile);
      } else if (input.storage.kind === 'remote') {
        progress('Connecting to the confirmed SFTP server.'); await uploadBundle(input.storage.sftp, progress);
        progress('Waiting for PocketBase to load the bundle and apply migrations.');
        const deadline = Date.now() + 45000; let bound = false;
        while (Date.now() < deadline) {
          try { bound = await bindPocketBase(profile.env.POCKETBASE_URL!, input.storage.email, input.storage.password, profile.guildId, profile.env.POCKETBASE_SERVICE_KEY!); }
          catch (error) { if (error instanceof SetupError) throw error; }
          if (bound) break;
          await new Promise(done => setTimeout(done, 1000));
        }
        if (!bound) throw new SetupError('Files uploaded, but hooks did not load. Restart the instance in your host console, then retry setup. Hosts with automatic hook reload need no manual restart.');
      } else {
        progress('Connecting to PostgreSQL and applying migrations.');
        const db = new PostgresAdapter(profile.env.DATABASE_URL!);
        try { await migrate(db); await db.scope(profile.guildId).ready(); } finally { await db.close(); }
      }
      if (profile.kind !== 'postgres') {
        progress('Verifying instance access and schema.');
        const db = new PocketBaseAdapter(profile.env.POCKETBASE_URL!, profile.env.POCKETBASE_SERVICE_KEY!);
        try { await db.scope(profile.guildId).ready(); } finally { await db.close(); }
      }
      profile.ready = true; await this.store.save(state); progress('Storage is ready. Configuration saved securely.'); return profile;
    } catch (error) {
      await this.stopLocal(profile.id);
      if (error instanceof SetupError) throw error;
      throw new SetupError(profile.kind === 'postgres' ? 'PostgreSQL setup failed. Check host, database, credentials, TLS trust and migration permissions.' : 'PocketBase setup failed. Check the server version, connectivity and local install permissions.');
    }
  }
  async stopLocal(id: string) { const pb = this.local.get(id); if (pb) { this.local.delete(id); await pb.driver.close(); await pb.stop(); } }
  async close() { for (const id of [...this.local.keys()]) await this.stopLocal(id); }
}
