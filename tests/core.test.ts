import { describe, it, expect } from 'vitest';
import { validateRegistry } from '../packages/core/src/registry.js';
import { ModuleHost } from '../packages/core/src/host.js';
import { exampleModule } from '../modules/example/bot.js';
import { loggingDefinition } from '../modules/logging/manifest.js';
import { TokenVault } from '../packages/core/src/crypto.js';
import { accessFor } from '../packages/core/src/access.js';
import { readConfig } from '../packages/core/src/config.js';
import type { ModuleState } from '../packages/module-sdk/src/browser.js';
import type { BotModule, Observation } from '../packages/module-sdk/src/server.js';

const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: 'postgres', DATABASE_URL: 'postgresql://localhost/test', DISCORD_GUILD_ID: '100000000000000001', OWNER_USER_IDS: '100000000000000002', DASHBOARD_ADMIN_ROLE_IDS: '100000000000000003', DASHBOARD_VIEWER_ROLE_IDS: '100000000000000004', DASHBOARD_ORIGIN: 'http://localhost:3000' });
describe('configured staff access', () => {
  it('requires membership even for the owner and grants no access by default', () => {
    expect(accessFor(config, '100000000000000002', [], false)).toBeNull();
    expect(accessFor(config, '100000000000000002', [], true)).toBe('owner');
    expect(accessFor(config, 'stranger', [], true)).toBeNull();
    expect(accessFor(config, 'staff', ['100000000000000003'], true)).toBe('admin');
    expect(accessFor(config, 'staff', ['100000000000000004'], true)).toBe('viewer');
  });
  it('rejects fixture mode and HTTP in production', () => {
    expect(() => readConfig({ ...config, NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
describe('registry and lifecycle', () => {
  it('validates duplicate IDs, commands, dependencies, cycles and API compatibility', () => {
    const example = exampleModule();
    expect(() => validateRegistry([example, example])).toThrow('Duplicate module');
    expect(() => validateRegistry([{ ...example, manifest: { ...example.manifest, dependencies: ['missing'] } }])).toThrow('Missing module');
    expect(() => validateRegistry([{ ...example, manifest: { ...example.manifest, dependencies: ['example'] } }])).toThrow('cycle');
    expect(() => validateRegistry([example, { ...loggingDefinition, commands: ['example ping'], commandDefinitions: [{name:'example ping', description:'Conflict',access:'viewer'}] }])).toThrow('Duplicate command');
    expect(() => validateRegistry([{ ...example, manifest: { ...example.manifest, apiVersion: 9 } } as unknown as BotModule])).toThrow();
  });
  it('applies greeting revisions, unregisters on disable, and leaves the last valid revision active', async () => {
    let state: ModuleState = { moduleId: 'example', enabled: true, appliedEnabled: false, settings: { greeting: 'One' }, appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null };
    const host = new ModuleHost('guild', [exampleModule()], {
      async getModule() { return state; },
      async acknowledge(_, next) { state = { ...state, appliedRevision: next.desiredRevision, appliedEnabled: next.enabled }; },
      async reject(_, __, message) { state.applyError = message; }
    }, { info() {}, error() {} });
    await host.sync(); expect(await host.command('example ping')).toBe('One');
    state = { ...state, desiredRevision: 2, settings: { greeting: '' } };
    await host.sync(); expect(state.appliedRevision).toBe(1); expect(await host.command('example ping')).toBe('One');
    state = { ...state, desiredRevision: 3, settings: { greeting: 'Two' } };
    await host.sync(); expect(await host.command('example ping')).toBe('Two');
    state = { ...state, desiredRevision: 4, enabled: false };
    await host.sync(); expect(await host.command('example ping')).toContain('disabled'); expect(state.appliedEnabled).toBe(false);
    await host.stop();
  });
  it('drains in-flight handlers before acknowledging disable and cleans a failed start', async () => {
    let enabled = true, drained = false, cleaned = false, acknowledged = false;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const module: BotModule = { ...exampleModule(), async start(context) {
      context.track(() => { cleaned = true; });
      context.onObservation(async () => { await pending; drained = true; });
    } };
    const host = new ModuleHost('guild', [module], {
      async getModule() { return { moduleId: 'example', enabled, appliedEnabled: false, settings: { greeting: 'hi' }, appliedSettings: {}, desiredRevision: enabled ? 1 : 2, appliedRevision: 0, applyError: null }; },
      async acknowledge(_, next) { if (!next.enabled) { expect(drained).toBe(true); acknowledged = true; } }, async reject() {}
    }, { info() {}, error() {} });
    await host.sync();
    const dispatch = host.dispatch({ guildId: 'guild' } as Observation);
    enabled = false;
    const disable = host.sync(); expect(acknowledged).toBe(false);
    release(); await dispatch; await disable; expect(cleaned).toBe(true); expect(acknowledged).toBe(true);
    let disposed = false;
    const broken: BotModule = { ...exampleModule(), async start(context) { context.track(() => { disposed = true; }); throw new Error('failed'); } };
    enabled = true;
    const brokenHost = new ModuleHost('guild', [broken], { async getModule() { return { moduleId: 'example', enabled, appliedEnabled: false, settings: { greeting: 'hi' }, appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null }; }, async acknowledge() {}, async reject() {} }, { info() {}, error() {} });
    await brokenHost.sync(); expect(disposed).toBe(true);
  });
});
it('encrypts OAuth material and authenticates ciphertext', () => {
  const vault = new TokenVault('a'.repeat(64)), token = { access_token: 'a-secret-value' };
  const encrypted = vault.encrypt(token);
  expect(encrypted).not.toContain(token.access_token); expect(vault.decrypt(encrypted)).toEqual(token);
  expect(() => new TokenVault('b'.repeat(64)).decrypt(encrypted)).toThrow();
  expect(vault.csrf('one')).not.toEqual(vault.csrf('two'));
});
