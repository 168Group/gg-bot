import { z } from 'zod';
import type { GuildStore } from './index.js';
import type { ModuleRecord, ModuleResources } from '../../module-sdk/src/services.js';
import type { ModuleDefinition } from '../../module-sdk/src/server.js';
import { HttpError } from '../../core/src/access.js';
const moduleId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const key = z.string().min(1).max(160);
const expected = z.number().int().min(0).max(2147483646);
const ttlMs = z.number().int().min(1000).max(90 * 86400000).optional();
const value = z.unknown().refine(v => {
  try { const encoded = JSON.stringify(v); return encoded !== undefined && Buffer.byteLength(encoded) <= 32768; } catch { return false; }
}, 'Use a JSON value no larger than 32 KiB.');
export const resourceSchemas = {
  recordGet: z.object({ moduleId, key }).strict(),
  recordList: z.object({ moduleId, prefix: z.string().max(160), cursor: z.string().max(160), limit: z.number().int().min(1).max(100) }).strict(),
  recordPut: z.object({ moduleId, key, value, expected, ttlMs }).strict(),
  recordDelete: z.object({ moduleId, key, expected: expected.min(1) }).strict(),
  moduleUpgrade: z.object({ id: moduleId, expected: expected.min(1), fromVersion: z.number().int().positive(), toVersion: z.number().int().positive(), settings: value }).strict(),
  jobEnqueue: z.object({ moduleId, type: z.string().regex(/^[a-z][a-z0-9.-]{0,49}$/), payload: value, key: z.string().min(1).max(100), options: z.object({ delayMs: z.number().int().min(0).max(30 * 86400000).optional(), ttlMs }).strict().optional() }).strict()
};
export function moduleResources(store: GuildStore, id: string): ModuleResources {
  moduleId.parse(id);
  return {
    data: {
      async get<T>(name: string) { return await store.call('recordGet', resourceSchemas.recordGet.parse({ moduleId: id, key: name })) as ModuleRecord<T> | null; },
      list(options = {}) { return store.call('recordList', resourceSchemas.recordList.parse({ moduleId: id, prefix: options.prefix ?? '', cursor: options.cursor ?? '', limit: options.limit ?? 50 })); },
      async put<T>(name: string, input: T, revision: number, expiry?: number) { return await store.call('recordPut', resourceSchemas.recordPut.parse({ moduleId: id, key: name, value: input, expected: revision, ttlMs: expiry })) as ModuleRecord<T>; },
      delete(name, revision) { return store.call('recordDelete', resourceSchemas.recordDelete.parse({ moduleId: id, key: name, expected: revision })); }
    },
    jobs: { enqueue(type, payload, key, options) { return store.call('jobEnqueue', resourceSchemas.jobEnqueue.parse({ moduleId: id, type, payload, key, options })); } }
  };
}
export async function upgradeSettings(store: GuildStore, module: ModuleDefinition) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await store.getModule(module.manifest.id), from = state.settingsVersion ?? 1, target = module.manifest.settingsVersion;
    if (from > target) throw new Error(`${module.manifest.id}: stored settings are newer than this package. Upgrade the package before starting.`);
    if (from === target) return;
    let settings: unknown = structuredClone(state.settings);
    for (let version = from; version < target; version++) {
      const migrate = module.settingsMigrations?.[version];
      if (!migrate) throw new Error(`${module.manifest.id}: missing settings migration ${version} to ${version + 1}.`);
      settings = migrate(settings);
    }
    settings = module.settingsSchema.parse(settings);
    try { await store.call('moduleUpgrade', { id: module.manifest.id, expected: state.desiredRevision, fromVersion: from, toVersion: target, settings }); return; }
    catch (error) { if (!(error instanceof HttpError && error.code === 'REVISION_CONFLICT')) throw error; }
  }
  throw new Error(`${module.manifest.id}: settings changed during upgrade. Retry startup.`);
}
