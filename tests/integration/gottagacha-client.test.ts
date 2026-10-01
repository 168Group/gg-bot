import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { fetchEvents } from '../../modules/gottagacha-events/client.js';
it('aborts an HTTP response that sends headers but never finishes its body, with bounded read retries', async () => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const started = Date.now();
    await expect(fetchEvents(`gg_test_${'d'.repeat(64)}`, { startDate: '2030-05-10', endDate: '2030-05-16' }, {
      fetcher: (_url, options) => fetch(`http://127.0.0.1:${address.port}`, options), timeoutMs: 100, wait: async () => {}
    })).rejects.toMatchObject({ code: 'network' });
    expect(calls).toBe(3); expect(Date.now() - started).toBeLessThan(3000);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
