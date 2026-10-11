import { createHash } from 'node:crypto';
import { HttpError } from '../../packages/core/src/access.js';
import type { ModuleData } from '../../packages/module-sdk/src/services.js';
import { fixtureEventSchema, fixtureEvents, previewText, type AnnouncementPreview, type FixtureSnapshot } from './fixtures.js';
import { z } from 'zod';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const isConflict = (error: unknown) => error instanceof HttpError && error.code === 'REVISION_CONFLICT';

export async function refreshFixtures(data: ModuleData, input: unknown = fixtureEvents, now = Date.now()) {
  const events = z.array(fixtureEventSchema).max(20).parse(input);
  if (new Set(events.map(event => event.id)).size !== events.length) throw new Error('Fixture IDs must be unique.');
  let created = 0;
  for (const event of events) {
    const key = `preview:${digest(JSON.stringify([event.id, event.revision, event.status]))}`;
    const value: AnnouncementPreview = { source: 'fixture', event, text: previewText(event), createdAt: new Date(now).toISOString() };
    if (await data.get(key)) continue;
    try { await data.put(key, value, 0, 7 * 86400000); created++; }
    catch (error) { if (!isConflict(error) || !await data.get(key)) throw error; }
  }
  // Publish the snapshot only after all previews are durable. A partial run can be replayed.
  const snapshot: FixtureSnapshot = { source: 'fixture', events, refreshedAt: new Date(now).toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await data.get('fixture-snapshot');
    try { await data.put('fixture-snapshot', snapshot, previous?.revision ?? 0, 7 * 86400000); return created; }
    catch (error) { if (!isConflict(error) || attempt === 2) throw error; }
  }
  throw new Error('Fixture refresh could not finish.');
}
