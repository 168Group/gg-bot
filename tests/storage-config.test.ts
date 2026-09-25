import { it, expect } from 'vitest';
import { readConfig } from '../packages/core/src/config.js';
import { PocketBaseAdapter } from '../packages/db/src/pocketbase.js';
const common = { DISCORD_GUILD_ID: '100000000000000001', DASHBOARD_ORIGIN: 'http://localhost:3000', POCKETBASE_URL: 'https://example.pockethost.io', POCKETBASE_SERVICE_KEY: 'a'.repeat(64) };
it('defaults to PocketBase without requiring a PostgreSQL URL', () => {
  const config = readConfig(common); expect(config.STORAGE_PROVIDER).toBe('pocketbase'); expect(config.DATABASE_URL).toBeUndefined();
});
it('requires the selected backend and never substitutes PostgreSQL for missing PocketBase', () => {
  expect(() => readConfig({ ...common, POCKETBASE_URL: undefined, DATABASE_URL: 'postgresql://localhost/omo' })).toThrow('POCKETBASE_URL');
  expect(() => readConfig({ ...common, STORAGE_PROVIDER: 'postgres' })).toThrow('DATABASE_URL');
  expect(readConfig({ ...common, STORAGE_PROVIDER: 'postgres', DATABASE_URL: 'postgresql://localhost/omo' }).STORAGE_PROVIDER).toBe('postgres');
});
it('rejects production fixtures, remote HTTP and credentials in a PocketBase URL', () => {
  expect(() => readConfig({ ...common, NODE_ENV: 'production', DASHBOARD_ORIGIN: 'https://dashboard.example.com', OMO_DEMO: 'true' })).toThrow('forbids fixture');
  expect(() => new PocketBaseAdapter('http://example.com', common.POCKETBASE_SERVICE_KEY)).toThrow('HTTPS');
  expect(() => new PocketBaseAdapter('https://user:password@example.com', common.POCKETBASE_SERVICE_KEY)).toThrow('without credentials');
  expect(() => new PocketBaseAdapter('https://example.com', 'short')).toThrow('64 hexadecimal');
});
