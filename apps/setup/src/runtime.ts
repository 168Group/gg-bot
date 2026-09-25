import { installedDefinitions } from '../../../registry/definitions.js';
import { moduleSecretEnvironment } from '../../../packages/core/src/module-secrets.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { SetupError, type Profile } from './model.js';
import { Provisioner } from './provision.js';
import { syncCommands } from '../../bot/src/commands.js';
export async function freePort() { return new Promise<number>((done, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const address = s.address(); if (!address || typeof address === 'string') { s.close(); reject(new Error('No port available.')); return; } s.close(error => error ? reject(error) : done(address.port)); }); }); }
export class ManagedRuntime {
  webUrl: string | null = null;
  status: 'stopped' | 'starting' | 'running' | 'failed' = 'stopped';
  private children: ChildProcess[] = [];
  private stoppingChildren: Promise<void> | null = null;
  private stopping = false;
  constructor(private provisioner: Provisioner, private origin: string,
    private entries = { bot: 'dist/bot/main.js', web: 'dist/web/main.js' },
    private synchronize = syncCommands) {}
  async start(profile: Profile) {
    if (!profile.ready || !profile.discord) throw new SetupError('Prepare storage and save Discord credentials first.');
    await this.stop(); this.status = 'starting'; this.stopping = false;
    try {
      try { await this.synchronize(profile.discord.botToken, profile.discord.applicationId, profile.guildId, this.origin.startsWith('https:')); }
      catch { throw new SetupError('Discord connection failed. Confirm the bot token matches the application ID and invite the bot to this server.'); }
      if (profile.kind === 'local') await this.provisioner.localFor(profile);
      const webPort = await freePort(), botPort = await freePort();
      profile.env.SESSION_ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
      const common: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: this.origin.startsWith('https:') ? 'production' : 'development', ...profile.env, DISCORD_GUILD_ID: profile.guildId, COMMUNITY_NAME: profile.name, BOT_NAME: profile.discord.botName, OWNER_USER_IDS: profile.discord.ownerId, DASHBOARD_ORIGIN: this.origin, WEB_PORT: String(webPort), BOT_HEALTH_PORT: String(botPort) };
      const launch = (app: 'bot' | 'web', env: NodeJS.ProcessEnv) => {
        const child = spawn(process.execPath, [this.entries[app]], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        // Child output may include upstream errors. Surface only sanitized health/status.
        child.stdout?.resume(); child.stderr?.resume();
        child.once('error', () => { this.status = 'failed'; });
        child.once('exit', () => { if (!this.stopping) { this.status = 'failed'; this.webUrl = null; void this.stopChildren(); } });
        this.children.push(child);
      };
      const { SESSION_ENCRYPTION_KEY, ...botEnv } = common;
      launch('bot', { ...botEnv, ...moduleSecretEnvironment(installedDefinitions(common.NODE_ENV === 'production'), process.env), DISCORD_BOT_TOKEN: profile.discord.botToken });
      launch('web', { ...common, SESSION_ENCRYPTION_KEY, DISCORD_APPLICATION_ID: profile.discord.applicationId, DISCORD_CLIENT_SECRET: profile.discord.clientSecret, WEB_HOST: '127.0.0.1' });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (this.failed()) throw new SetupError('A service stopped during startup. Check Discord credentials, guild access and storage connectivity.');
        const checks = await Promise.all([webPort, botPort].map(port => fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false)));
        if (checks.every(Boolean) && !this.failed()) { this.webUrl = `http://127.0.0.1:${webPort}`; this.status = 'running'; return; }
        await new Promise(done => setTimeout(done, 500));
      }
      throw new SetupError('Services did not become ready. Check Discord credentials, guild access and storage connectivity.');
    } catch (error) { await this.stop(); this.status = 'failed'; throw error; }
  }
  private failed() { return this.status === 'failed'; }
  private async stopChildren() {
    if (this.stoppingChildren) return this.stoppingChildren;
    const children = this.children.splice(0);
    this.stoppingChildren = Promise.all(children.map(child => new Promise<void>(done => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) { done(); return; }
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM');
    }))).then(() => {});
    try { await this.stoppingChildren; } finally { this.stoppingChildren = null; }
  }
  async stop() { this.stopping = true; this.webUrl = null; await this.stopChildren(); this.status = 'stopped'; }
}
