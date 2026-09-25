import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
export async function localPostgres(options: { directory?: string; port?: number } = {}) {
  const port = options.port ?? await new Promise<number>((resolvePort, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const address = server.address(); if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate port.')); return; }
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
  const directory = options.directory ? resolve(options.directory) : await mkdtemp(`${tmpdir()}/omo-pg-`);
  await mkdir(directory, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: directory, port, user: 'omo', password: 'local_fixture_only', persistent: Boolean(options.directory),
    postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  await pg.initialise(); await pg.start();
  return { url: `postgresql://omo:local_fixture_only@127.0.0.1:${port}/postgres`, stop: () => pg.stop() };
}
