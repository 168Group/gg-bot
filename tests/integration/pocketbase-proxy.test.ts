import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { PocketBaseAdapter } from '../../packages/db/src/pocketbase.js';

it('handles real HTTP proxy failures and stops requesting during a host cooldown', async () => {
  let status = 502, requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(status, { 'Content-Type': 'text/html', 'Retry-After': '60' });
    response.end('<html>Private proxy failure details</html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const db = new PocketBaseAdapter(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'a'.repeat(64));
    await expect(db.call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_PROTOCOL', message: expect.stringContaining('HTTP 502') });
    status = 429;
    await expect(db.call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_RATE_LIMIT' });
    await expect(db.call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_RATE_LIMIT' });
    expect(requests).toBe(2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
