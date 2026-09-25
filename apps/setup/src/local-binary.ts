import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
export async function installPocketBase(directory = resolve('.local/pocketbase-bin')) {
  const binary = process.env.POCKETBASE_BINARY ?? `${directory}/pocketbase`;
  if (existsSync(binary)) {
    const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
    if (!stdout.includes('0.40.4')) throw new Error('Managed PocketBase requires version 0.40.4.');
    return binary;
  }
  const version = '0.40.4', platform = process.platform, architecture = process.arch === 'x64' ? 'amd64' : process.arch;
  if (!['darwin', 'linux'].includes(platform) || !['amd64', 'arm64'].includes(architecture)) throw new Error('Managed PocketBase supports macOS/Linux arm64/x64.');
  const archive = `pocketbase_${version}_${platform}_${architecture}.zip`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  async function download(name: string) {
    const response = await fetch(`https://github.com/pocketbase/pocketbase/releases/download/v${version}/${name}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('PocketBase download failed.');
    return Buffer.from(await response.arrayBuffer());
  }
  const expected = (await download('checksums.txt')).toString().split('\n').find(line => line.endsWith(archive))?.split(/\s+/)[0];
  if (!expected) throw new Error('Official checksum is missing.');
  const file = `${directory}/pocketbase.zip`;
  let buffer = existsSync(file) ? await readFile(file) : Buffer.alloc(0);
  if (createHash('sha256').update(buffer).digest('hex') !== expected) { buffer = await download(archive); await writeFile(file, buffer, { mode: 0o600 }); }
  if (createHash('sha256').update(buffer).digest('hex') !== expected) throw new Error('PocketBase archive checksum mismatch.');
  await promisify(execFile)('unzip', ['-o', '-q', file, '-d', directory], { timeout: 30000 });
  await chmod(`${directory}/pocketbase`, 0o755); return `${directory}/pocketbase`;
}
