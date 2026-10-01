import { z } from 'zod';
import type { ModuleData } from '../../packages/module-sdk/src/services.js';
import { digest, isConflict } from './service.js';
export type Draft = {
  source: 'fixture'; id: string; authorId: string; channelId: string; createdAt: string; expiresAt: string;
  fields: { title?: string; startsAt?: string; timezone?: string; location?: string };
  issues: string[]; state: 'review-only';
};
const fieldNames = { title: 'title', starts: 'startsAt', timezone: 'timezone', location: 'location' } as const;
export function parseDraft(content: string, now = Date.now()): Pick<Draft, 'fields' | 'issues'> {
  const fields: Draft['fields'] = {}, issues: string[] = [];
  if (content.length > 4000 || !/^event:\s*/i.test(content)) return { fields, issues: ['Start with event: and use at most 4,000 characters.'] };
  for (const line of content.replace(/^event:\s*/i, '').split('\n').filter(line => line.trim())) {
    const match = /^(title|starts|timezone|location):\s*(.+)$/i.exec(line.trim());
    if (!match) { issues.push('Use one labeled field per line: Title, Starts, Timezone, Location.'); continue; }
    const name = fieldNames[match[1]!.toLowerCase() as keyof typeof fieldNames];
    if (fields[name] !== undefined) { issues.push(`Provide ${match[1]!.toLowerCase()} only once.`); continue; }
    const value = match[2]!.trim(), max = name === 'location' ? 160 : name === 'title' ? 120 : 80;
    if (value.length > max) { issues.push(`${match[1]} must be at most ${max} characters.`); continue; }
    fields[name] = value;
  }
  for (const name of Object.values(fieldNames)) if (!fields[name]) issues.push(`Add ${name === 'startsAt' ? 'starts' : name}.`);
  if (fields.startsAt) fields.startsAt = fields.startsAt.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, '$1:00$2');
  const validStart = fields.startsAt && z.iso.datetime({ offset: true }).safeParse(fields.startsAt).success;
  if (fields.startsAt && !validStart) issues.push('Starts must be an ISO date and time with an explicit UTC offset, such as 2030-05-10T18:00:00-04:00.');
  if (validStart && Date.parse(fields.startsAt!) <= now) issues.push('Choose a future start time.');
  if (fields.timezone) {
    try {
      if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(fields.timezone)) throw new Error('IANA zone required');
      const format = new Intl.DateTimeFormat('sv-SE', { timeZone: fields.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      if (validStart) {
        const parts = Object.fromEntries(format.formatToParts(new Date(fields.startsAt!)).map(part => [part.type, part.value]));
        const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
        const supplied = fields.startsAt!.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '').split('.')[0]!;
        if (local !== supplied) issues.push('The start time offset does not match the timezone. Review daylight saving time.');
      }
    } catch { issues.push('Use a valid IANA timezone, such as America/Detroit.'); }
  }
  return { fields, issues: [...new Set(issues)] };
}
export async function saveDraft(data: ModuleData, input: { id: string; userId: string; channelId: string; content: string }, now = Date.now()) {
  const id = digest(input.id).slice(0, 32), key = `draft:${id}`;
  const previous = await data.get<Draft>(key);
  if (previous) return previous.value;
  const draft: Draft = { source: 'fixture', id, authorId: input.userId, channelId: input.channelId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), state: 'review-only', ...parseDraft(input.content, now) };
  try { await data.put(key, draft, 0, 86400000); return draft; }
  catch (error) { if (!isConflict(error)) throw error; const saved = await data.get<Draft>(key); if (!saved) throw error; return saved.value; }
}
export function renderDraft(draft: Draft) {
  return `FIXTURE DRAFT • Review only\n${Object.entries(draft.fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${draft.issues.length ? draft.issues.join('\n') : 'Parsed details are ready for review.'}\nReview ID: ${draft.id}\nExpires: ${draft.expiresAt}\nPublishing is unavailable until the API contract and explicit confirmation flow are implemented.`;
}
