import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TokenVault } from '../../../packages/core/src/crypto.js';
import type { Installation } from './model.js';
export class InstallationStore {
  private constructor(readonly directory: string, readonly accessKey: string, private vault: TokenVault) {}
  static async open(directory: string) {
    directory = resolve(directory); await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
    async function key(name: string) {
      const path = `${directory}/${name}`;
      try { await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await chmod(path, 0o600); return (await readFile(path, 'utf8')).trim();
    }
    return new InstallationStore(directory, await key('access.key'), new TokenVault(await key('encryption.key')));
  }
  async read(): Promise<Installation> {
    try { return this.vault.decrypt<Installation>(await readFile(`${this.directory}/profiles.enc`, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [], activeId: null }; throw new Error('Installation state could not be decrypted. Restore the matching encryption key.', { cause: error }); }
  }
  async save(state: Installation) {
    const temp = `${this.directory}/${randomUUID()}.tmp`;
    await writeFile(temp, this.vault.encrypt(state), { mode: 0o600, flag: 'wx' });
    await rename(temp, `${this.directory}/profiles.enc`);
  }
}
