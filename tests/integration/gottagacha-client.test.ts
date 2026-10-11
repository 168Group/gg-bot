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
    })).rejects.toMatchObject({ code: 'network', message: 'The event service could not be reached within its deadline. Try a refresh later.' });
    expect(calls).toBe(3); expect(Date.now() - started).toBeLessThan(3000);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
it('rejects a real HTTP redirect once without forwarding credentials or calling it a timeout', async () => {
  let calls = 0, redirected = 0;
  const server = createServer((request, response) => {
    calls++;
    if (request.url === '/unexpected-target') { redirected++; response.end('Unexpected credential destination'); return; }
    response.writeHead(307, { location: '/unexpected-target' }); response.end('PRIVATE UPSTREAM DETAILS');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const error = await fetchEvents(`gg_test_${'d'.repeat(64)}`, { startDate: '2030-05-10', endDate: '2030-05-16' }, {
      fetcher: (_url, options) => fetch(`http://127.0.0.1:${address.port}`, options), wait: async () => {}
    }).catch(error => error);
    expect(error).toMatchObject({ code: 'request', message: 'The event API endpoint redirected. The integration endpoint needs an update.' });
    expect(String(error)).not.toContain('PRIVATE'); expect(calls).toBe(1); expect(redirected).toBe(0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
