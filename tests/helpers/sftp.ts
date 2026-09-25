import { Server, utils, type SFTPWrapper } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, open, stat, lstat, realpath, chmod, rename, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
export async function localSftp() {
  const root = await realpath(await mkdtemp(`${tmpdir()}/omo-sftp-`)); await mkdir(`${root}/instance`);
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1' }, publicKeyEncoding: { format: 'pem', type: 'pkcs1' } }).privateKey;
  let authentications = 0;
  const connections = new Set<import('ssh2').Connection>();
  const server = new Server({ hostKeys: [privateKey] }, client => {
    connections.add(client); client.on('close', () => connections.delete(client)); client.on('error', () => {});
    client.on('authentication', context => { authentications++; if (context.method === 'publickey') context.accept(); else context.reject(); });
    client.on('ready', () => client.on('session', accept => accept().on('sftp', acceptSftp => {
      const sftp: SFTPWrapper = acceptSftp(), files = new Map<string, FileHandle>(); let sequence = 0;
      const path = (value: string) => { const p = resolve(root, value.replace(/^\//, '')); if (p !== root && !p.startsWith(`${root}${sep}`)) throw new Error('Outside fixture'); return p; };
      const fail = (id: number, e: unknown) => sftp.status(id, (e as NodeJS.ErrnoException).code === 'ENOENT' ? utils.sftp.STATUS_CODE.NO_SUCH_FILE : utils.sftp.STATUS_CODE.FAILURE);
      const ok = (id: number) => sftp.status(id, utils.sftp.STATUS_CODE.OK);
      sftp.on('REALPATH', (id, p) => { void realpath(path(p)).then(value => sftp.name(id, [{ filename: '/' + value.slice(root.length + 1), longname: '', attrs: { mode: 0o40700, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 } }])).catch(e => fail(id, e)); });
      for (const op of ['STAT', 'LSTAT'] as const) sftp.on(op, (id: number, p: string) => { void (op === 'STAT' ? stat(path(p)) : lstat(path(p))).then(s => sftp.attrs(id, { mode: s.mode, size: s.size, uid: s.uid, gid: s.gid, atime: s.atimeMs / 1000, mtime: s.mtimeMs / 1000 })).catch(e => fail(id, e)); });
      sftp.on('MKDIR', (id, p) => { void mkdir(path(p)).then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('SETSTAT', (id, p, attrs) => { void chmod(path(p), attrs.mode ?? 0o600).then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('RENAME', (id, from, to) => { void rename(path(from), path(to)).then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('REMOVE', (id, p) => { void unlink(path(p)).then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('OPEN', (id, p, flags) => { void open(path(p), flags & utils.sftp.OPEN_MODE.WRITE ? 'w' : 'r').then(file => { const handle = String(++sequence); files.set(handle, file); sftp.handle(id, Buffer.from(handle)); }).catch(e => fail(id, e)); });
      sftp.on('READ', (id, h, offset, length) => { const file = files.get(h.toString()); if (!file) return fail(id, {}); const b = Buffer.alloc(length); void file.read(b, 0, length, offset).then(({ bytesRead }) => bytesRead ? sftp.data(id, b.subarray(0, bytesRead)) : sftp.status(id, utils.sftp.STATUS_CODE.EOF)).catch(e => fail(id, e)); });
      sftp.on('WRITE', (id, h, offset, data) => { const file = files.get(h.toString()); if (!file) return fail(id, {}); void file.write(data, 0, data.length, offset).then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('CLOSE', (id, h) => { const file = files.get(h.toString()); files.delete(h.toString()); if (!file) return fail(id, {}); void file.close().then(() => ok(id)).catch(e => fail(id, e)); });
      sftp.on('close', () => { for (const file of files.values()) void file.close(); });
    })));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
  return { root, privateKey, host: '127.0.0.1', port: address.port, authentications: () => authentications, stop: async () => { for (const c of connections) c.end(); await new Promise<void>(done => server.close(() => done())); } };
}
