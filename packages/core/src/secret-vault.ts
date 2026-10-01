import { z } from 'zod';
import type { GuildStore } from '../../db/src/index.js';
import type { ModuleDefinition } from '../../module-sdk/src/server.js';
import type { SecretMetadata } from '../../module-sdk/src/browser.js';
import type { SecretRecord } from '../../db/src/contracts.js';
import { TokenVault } from './crypto.js';
import { HttpError } from './access.js';
import { moduleSecretKey } from './module-secrets.js';
export const secretValue = z.string().min(1).max(4096).refine(value => Buffer.byteLength(value) <= 4096);
const unavailable = () => new HttpError(503, 'MODULE_SECRET_UNAVAILABLE', 'Module secret unavailable. Check the shared encryption key and storage configuration.');
export class ModuleSecrets {
  constructor(private store: GuildStore, private module: ModuleDefinition, private env: NodeJS.ProcessEnv = process.env) {}
  private declared(name: string) {
    if (!(this.module.manifest.requiredSecrets ?? []).includes(name)) throw new HttpError(404, 'NOT_FOUND', 'Declared module secret not found.');
  }
  private context(name: string) { return JSON.stringify(['omo-module-secret-v1', this.store.guildId, this.module.manifest.id, name]); }
  private vault() {
    const key = this.env.MODULE_SECRET_ENCRYPTION_KEY;
    if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw unavailable();
    return new TokenVault(key);
  }
  private async record(name: string) {
    this.declared(name);
    return this.store.call('secretGet', { moduleId: this.module.manifest.id, name });
  }
  private metadataFor(name: string, row: SecretRecord | null): SecretMetadata {
    const source = row?.mode ?? 'environment';
    return { name, source, configured: source === 'environment' ? null : source === 'stored', revision: row?.revision ?? 0, canReveal: source === 'stored' };
  }
  async metadata(name: string) { return this.metadataFor(name, await this.record(name)); }
  private decrypt(name: string, ciphertext: string | null) {
    try { return secretValue.parse(this.vault().decrypt(ciphertext ?? '', this.context(name))); }
    catch { throw unavailable(); }
  }
  /** Read per job/action. Never cache a credential across work units. */
  async get(name: string): Promise<string> {
    const row = await this.record(name);
    if (row?.mode === 'stored') return this.decrypt(name, row.ciphertext);
    if (row?.mode === 'disabled') throw new HttpError(409, 'MODULE_SECRET_DISABLED', 'Module secret is disabled. Ask an owner to configure it.');
    const value = this.env[moduleSecretKey(this.module.manifest.id, name)];
    if (!value) throw new HttpError(409, 'MODULE_SECRET_MISSING', 'Configure this module secret in the dashboard or bot environment.');
    return value;
  }
  async reveal(name: string, revision: number) {
    const row = await this.record(name);
    if ((row?.revision ?? 0) !== revision) throw new HttpError(409, 'REVISION_CONFLICT', 'Secret changed. Refresh its status before revealing.');
    if (row?.mode !== 'stored') throw new HttpError(409, 'MODULE_SECRET_NOT_STORED', 'Only dashboard-stored secrets can be revealed.');
    return this.decrypt(name, row.ciphertext);
  }
  async replace(name: string, expected: number, value: string) {
    this.declared(name);
    const ciphertext = this.vault().encrypt(secretValue.parse(value), this.context(name));
    return this.write(name, expected, 'stored', ciphertext);
  }
  async disable(name: string, expected: number) { return this.write(name, expected, 'disabled', null); }
  async environment(name: string, expected: number) { return this.write(name, expected, 'environment', null); }
  private async write(name: string, expected: number, mode: SecretRecord['mode'], ciphertext: string | null) {
    this.declared(name);
    const row = await this.store.call('secretSet', { moduleId: this.module.manifest.id, name, expected, mode, ciphertext });
    return this.metadataFor(name, row);
  }
}
