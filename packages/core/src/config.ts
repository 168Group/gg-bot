import { z } from 'zod';
import { snowflake } from '../../module-sdk/src/browser.js';

const ids = z.string().default('').transform(value => value.split(',').map(s => s.trim()).filter(Boolean)).pipe(z.array(snowflake));
const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  STORAGE_PROVIDER: z.enum(['pocketbase', 'postgres']).default('pocketbase'),
  DATABASE_URL: z.string().url().optional(),
  POCKETBASE_URL: z.string().url().optional(),
  POCKETBASE_SERVICE_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  DISCORD_GUILD_ID: snowflake,
  DASHBOARD_ORIGIN: z.string().url().transform(s => new URL(s).origin),
  OWNER_USER_IDS: ids, DASHBOARD_ADMIN_ROLE_IDS: ids, DASHBOARD_VIEWER_ROLE_IDS: ids,
  BOT_NAME: z.string().min(1).max(40).default('OMO Bot'),
  COMMUNITY_NAME: z.string().min(1).max(60).default('My Community'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BOT_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001)
});
export type Config = z.infer<typeof base>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = base.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(x => x.path.join('.')).join(', ')}`);
  if (result.data.STORAGE_PROVIDER === 'postgres' && !result.data.DATABASE_URL) throw new Error('Configure DATABASE_URL for PostgreSQL.');
  if (result.data.STORAGE_PROVIDER === 'pocketbase' && (!result.data.POCKETBASE_URL || !result.data.POCKETBASE_SERVICE_KEY)) throw new Error('Configure POCKETBASE_URL and POCKETBASE_SERVICE_KEY.');
  if (result.data.NODE_ENV === 'production' && (!result.data.DASHBOARD_ORIGIN.startsWith('https://') || env.OMO_DEMO)) {
    throw new Error('Production requires HTTPS and forbids fixture mode.');
  }
  return result.data;
}
export function requireSecret(name: string, env = process.env): string {
  const value = env[name];
  if (!value || value === 'REPLACE_ME' || value.startsWith('GENERATE_')) throw new Error(`Configure ${name} before starting this service.`);
  return value;
}
