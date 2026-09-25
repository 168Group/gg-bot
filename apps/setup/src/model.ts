import { z } from 'zod';
import { snowflake } from '../../../packages/module-sdk/src/browser.js';
const host = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:[\]-]+$/);
const secret = z.string().min(1).max(8192);
export const sftpAddress = z.object({ host, port: z.number().int().min(1).max(65535).default(2222) }).strict();
export const sftpSchema = sftpAddress.extend({ username: z.string().min(1).max(254), privateKey: secret, passphrase: z.string().max(1024).optional(), fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/), directory: z.string().regex(/^\/?[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/).max(256) }).strict();
const remoteUrl = z.string().url().refine(value => { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))); }, 'Use an HTTPS origin, or HTTP on loopback.');
export const setupInput = z.object({
  name: z.string().trim().min(1).max(60), guildId: snowflake,
  storage: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local') }).strict(),
    z.object({ kind: z.literal('remote'), url: remoteUrl, email: z.email(), password: secret, sftp: sftpSchema }).strict(),
    z.object({ kind: z.literal('postgres'), host, port: z.number().int().min(1).max(65535), database: z.string().min(1).max(128), username: z.string().min(1).max(128), password: secret, tls: z.boolean() }).strict()
  ])
}).strict();
export type SetupInput = z.infer<typeof setupInput>;
export type SftpInput = z.infer<typeof sftpSchema>;
export const discordInput = z.object({ applicationId: snowflake, botToken: secret, clientSecret: secret, ownerId: snowflake, botName: z.string().min(1).max(40).default('OMO Bot') }).strict();
export type DiscordInput = z.infer<typeof discordInput>;
export interface Profile { id: string; name: string; guildId: string; kind: 'local' | 'remote' | 'postgres'; env: Record<string, string>; createdAt: string; ready: boolean; discord?: DiscordInput }
export interface Installation { profiles: Profile[]; activeId: string | null }
export interface SetupJob { id: string; state: 'running' | 'succeeded' | 'failed'; steps: string[]; error?: string; profileId?: string }
export class SetupError extends Error {}
export function publicProfile(p: Profile) { return { id: p.id, name: p.name, guildId: p.guildId, kind: p.kind, ready: p.ready, createdAt: p.createdAt, hasDiscord: Boolean(p.discord), endpoint: p.kind === 'local' ? 'On this bot host' : p.kind === 'remote' ? p.env.POCKETBASE_URL : (() => { const u = new URL(p.env.DATABASE_URL!); return `${u.hostname}:${u.port || '5432'}${u.pathname}`; })() }; }
