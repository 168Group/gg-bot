import type { LogEvent } from '../shared/settings.js';
const titles: Record<string, string> = { 'channel.created': 'Channel created', 'channel.updated': 'Channel updated', 'channel.deleted': 'Channel deleted', 'logging.test': 'Delivery test' };
export function clip(text: string, limit: number): string { return text.length <= limit ? text : `${text.slice(0, limit - 15)}… [truncated]`; }
export function escapeText(value: string): string { return value.replace(/([\\`*_{}[\]()<>#|~])/g, '\\$1').replace(/@/g, '@\u200b'); }
function values(value: Record<string, unknown> | null): string {
  if (!value) return 'Not observed';
  return clip(Object.entries(value).map(([key, val]) => `${escapeText(key)}: ${escapeText(typeof val === 'string' ? val : JSON.stringify(val))}`).join('\n') || 'None', 900);
}
export function renderEvent(event: LogEvent, marker: string, accentColor: string) {
  return {
    allowedMentions: { parse: [] as ('roles' | 'users' | 'everyone')[], repliedUser: false },
    embeds: [{
      title: titles[event.type] ?? 'Activity observed', color: Number.parseInt(accentColor.slice(1), 16),
      description: `${escapeText(clip(event.subjectLabel, 150))}\nID: ${event.subjectId}`,
      fields: [
        { name: 'Before', value: values(event.before), inline: true },
        { name: 'After', value: values(event.after), inline: true },
        { name: 'Attribution', value: event.actorId ? `Actor ID: ${event.actorId}` : 'Actor unknown — no confirmed audit evidence', inline: false },
        { name: 'Reason', value: escapeText(clip(event.reason ?? 'No reason recorded', 500)), inline: false }
      ], timestamp: event.observedAt, footer: { text: `Observed time · ${marker}` }
    }]
  };
}
