import { describe, it, expect, vi } from 'vitest';
import { ModuleHost } from '../../../packages/core/src/host.js';
import { HttpError } from '../../../packages/core/src/access.js';
import type { ModuleData, ModuleRecord, ModuleResources } from '../../../packages/module-sdk/src/services.js';
import type { ModuleState } from '../../../packages/module-sdk/src/browser.js';
import type { ModulePackageServices } from '../../../packages/core/src/module-package.js';
import { definition } from '../definition.js';
import { createBot } from '../bot.js';
import { fixtureEvents, upcoming } from '../fixtures.js';
import { refreshFixtures } from '../service.js';
import { parseDraft, saveDraft } from '../drafts.js';
const now = Date.parse('2029-01-01T00:00:00Z');
const valid = 'event:\nTitle: Sample game night\nStarts: 2030-05-10T18:00:00-04:00\nTimezone: America/Detroit\nLocation: Sample space';
function memory() {
  const records = new Map<string, ModuleRecord>(), expiry = new Map<string, number | undefined>();
  const data: ModuleData = {
    async get<T>(key: string) { return structuredClone(records.get(key) ?? null) as ModuleRecord<T> | null; },
    async list() { return { records: [...records.values()], nextCursor: null }; },
    async put<T>(key: string, value: T, revision: number, ttl?: number) {
      if ((records.get(key)?.revision ?? 0) !== revision) throw new HttpError(409, 'REVISION_CONFLICT', 'Conflict');
      const record = { key, value, revision: revision + 1, updatedAt: new Date(now).toISOString() }; records.set(key, record); expiry.set(key, ttl); return record;
    },
    async delete(key) { return records.delete(key); }
  };
  return { data, records, expiry };
}
describe('GottaGacha fixture foundation', () => {
  it('starts disconnected, declares no guessed secret, and filters past/cancelled samples', () => {
    expect(definition.defaultSettings).toEqual({ mode: 'disconnected', staffChannelIds: [] });
    expect(definition.manifest.requiredSecrets).toEqual([]);
    expect(upcoming(fixtureEvents, now)).toHaveLength(2);
    expect(upcoming(fixtureEvents, Date.parse('2030-05-11T20:00:00Z'))).toEqual([]);
  });
  it('deduplicates replay and concurrent refreshes; changes and cancellations produce distinct previews', async () => {
    const { data, records } = memory();
    await Promise.all([refreshFixtures(data, fixtureEvents, now), refreshFixtures(data, fixtureEvents, now)]);
    expect([...records.keys()].filter(key => key.startsWith('preview:'))).toHaveLength(3);
    expect(await refreshFixtures(data, fixtureEvents, now)).toBe(0);
    expect(await refreshFixtures(data, [{ ...fixtureEvents[0]!, revision: 2, status: 'cancelled' }], now)).toBe(1);
    expect([...records.values()].filter(record => record.key.startsWith('preview:'))).toHaveLength(4);
  });
  it('replays partial persistence, propagates non-conflict errors and rejects malformed pages before writes', async () => {
    const { data, records } = memory(), put = data.put.bind(data);
    let calls = 0;
    data.put = async (...args) => { if (++calls === 2) throw new Error('storage offline'); return put(...args); };
    await expect(refreshFixtures(data, fixtureEvents, now)).rejects.toThrow('storage offline');
    expect(records.has('fixture-snapshot')).toBe(false);
    expect(await refreshFixtures(data, fixtureEvents, now)).toBe(2);
    expect(records.has('fixture-snapshot')).toBe(true);
    const size = records.size;
    await expect(refreshFixtures(data, [{ ...fixtureEvents[0], startsAt: 'tomorrow' }], now)).rejects.toThrow();
    await expect(refreshFixtures(data, [fixtureEvents[0], fixtureEvents[0]], now)).rejects.toThrow('unique');
    expect(records.size).toBe(size);
  });
  it('parses explicit fields and rejects ambiguous, duplicate, missing, past and mismatched times', () => {
    expect(parseDraft(valid, now).issues).toEqual([]);
    expect(parseDraft(valid.replace('18:00:00', '18:00'), now).issues).toEqual([]);
    expect(parseDraft(valid.replace('2030-05-10T18:00:00-04:00', 'Friday at 6'), now).issues.join(' ')).toContain('explicit UTC offset');
    expect(parseDraft(valid.replace('-04:00', '-05:00'), now).issues.join(' ')).toContain('does not match');
    expect(parseDraft(valid + '\nTitle: duplicate\nPublish immediately!', now).issues).toHaveLength(2);
    expect(parseDraft('event:', now).issues).toHaveLength(4);
    expect(parseDraft(valid, Date.parse('2031-01-01')).issues.join(' ')).toContain('future');
    expect(parseDraft(valid.replace('America/Detroit', 'Not/AZone'), now).issues.join(' ')).toContain('IANA');
    expect(parseDraft(valid.replace('America/Detroit', '-04:00'), now).issues.join(' ')).toContain('IANA');
    expect(parseDraft('event:' + 'x'.repeat(4000), now).fields).toEqual({});
    expect(parseDraft(valid.replace('Sample game night', 'a'.repeat(121)), now).issues.join(' ')).toContain('120');
  });
  it('keeps draft replay stable, retains only structured fields and gives drafts a 24-hour TTL', async () => {
    const { data, records, expiry } = memory();
    const input = { id: 'message-1', userId: 'staff', channelId: 'channel', content: valid + '\nDo not persist this raw instruction.' };
    const draft = await saveDraft(data, input, now);
    expect(await saveDraft(data, { ...input, content: 'event:changed' }, now + 1000)).toEqual(draft);
    expect([...expiry.values()]).toEqual([86400000]);
    expect(JSON.stringify([...records.values()])).not.toContain('Do not persist');
    expect(draft.state).toBe('review-only');
    expect(draft.expiresAt).toBe(new Date(now + 86400000).toISOString());
  });
  it('honors guild, admin and channel boundaries, stale jobs, disable and no outbound fetch', async () => {
    const { data, records } = memory();
    let state: ModuleState = { moduleId: definition.manifest.id, enabled: true, appliedEnabled: false, settings: { mode: 'fixtures', staffChannelIds: ['100000000000000010'] }, appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null };
    const resources: ModuleResources = { data, jobs: { enqueue: vi.fn() } };
    const host = new ModuleHost('guild', [createBot({ validateDestination: vi.fn(), store: {} } as unknown as ModulePackageServices)], {
      async getModule() { return state; }, resources: () => resources,
      async acknowledge(_id, next) { state = { ...next, appliedEnabled: next.enabled, appliedRevision: next.desiredRevision }; },
      async reject() { throw new Error('Unexpected settings failure'); }
    }, { info() {}, error() {} });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be used'));
    try {
      await host.sync();
      const message = { guildId: 'guild', userId: 'staff', channelId: '100000000000000010', access: 'admin' as const, options: {}, id: 'message', content: valid, reply: vi.fn() };
      await host.message({ ...message, guildId: 'other' });
      await host.message({ ...message, access: 'viewer' });
      await host.message({ ...message, channelId: '100000000000000011' });
      await host.message({ ...message, content: 'ordinary message' });
      expect(records.size).toBe(0);
      await host.message(message); expect(message.reply).toHaveBeenCalledOnce(); expect(records.size).toBe(1);
      await host.job(definition.manifest.id, { id: 'job', type: 'refresh-fixtures', payload: { revision: 1 }, attempt: 1 });
      expect(await host.command('events upcoming', { ...message, access: null })).toContain('FIXTURE MODE');
      expect(await host.command('events draft', { ...message, access: 'viewer' })).toContain('does not have access');
      state = { ...state, desiredRevision: 2 }; await host.sync();
      await expect(host.job(definition.manifest.id, { id: 'old', type: 'refresh-fixtures', payload: { revision: 1 }, attempt: 2 })).rejects.toThrow('Settings changed');
      state = { ...state, desiredRevision: 3, enabled: false }; await host.sync();
      await host.message({ ...message, id: 'disabled' }); expect(message.reply).toHaveBeenCalledOnce();
      expect(await host.command('events upcoming', message)).toContain('disabled');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { await host.stop(); fetchSpy.mockRestore(); }
  });
});
