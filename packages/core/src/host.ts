import { moduleSecretKey } from './module-secrets.js';
import type { BotModule, Logger, ModuleConfigurationStore, Observation, CommandContext, ModuleJob, ModuleMessage, MessageSubscription } from '../../module-sdk/src/server.js';
import { commandAllowed, commandDefinitions } from './module-commands.js';
import { validateRegistry } from './registry.js';

/** All lifecycle operations and dispatch are serialized. A settings acknowledgement is a barrier. */
export class ModuleHost {
  private tail: Promise<void> = Promise.resolve();
  private handlers = new Map<string, (event: Observation) => Promise<void>>();
  private commands = new Map<string, { owner: string; run: (context: CommandContext) => Promise<string> }>();
  private jobs = new Map<string, (job: ModuleJob) => Promise<string>>();
  private messages = new Map<string, { subscription: MessageSubscription; run: (message: ModuleMessage) => Promise<void> }>();
  private cleanup = new Map<string, Array<() => void | Promise<void>>>();
  private revisions = new Map<string, number>();
  private active = new Set<string>();
  private modules: BotModule[];
  private pending = 0;
  private pendingBytes = 0;
  failures = 0;
  constructor(private guildId: string, modules: BotModule[], private store: ModuleConfigurationStore, private logger: Logger, private validateModule?: (module: BotModule) => Promise<void>) {
    this.modules = validateRegistry(modules);
  }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
  sync(): Promise<void> {
    return this.enqueue(async () => {
      const states = new Map(await Promise.all(this.modules.map(async m => [m.manifest.id, await this.store.getModule(m.manifest.id)] as const)));
      const ordered = [...this.modules].reverse().filter(m => !states.get(m.manifest.id)!.enabled).concat(this.modules.filter(m => states.get(m.manifest.id)!.enabled));
      for (const module of ordered) {
        const id = module.manifest.id;
        const state = states.get(id)!;
        if (this.revisions.get(id) === state.desiredRevision) continue;
        try {
          if (state.enabled && (state.settingsVersion ?? 1) !== module.manifest.settingsVersion) throw new Error('Settings migration required. Restart with a compatible package.');
          const settings = state.enabled ? module.settingsSchema.parse(state.settings) : state.settings;
          if (state.enabled) {
            await this.validateModule?.(module);
            for (const dep of module.manifest.dependencies) if (!this.active.has(dep)) throw new Error('Enable required modules first.');
            if (this.active.has(id)) await module.applySettings(settings, state.desiredRevision);
            else {
              this.cleanup.set(id, []);
              const unavailable = async (): Promise<never> => { throw new Error('Module resources are unavailable in this host.'); };
              const resources = this.store.resources?.(id) ?? { data: { get: unavailable, list: unavailable, put: unavailable, delete: unavailable }, jobs: { enqueue: unavailable } };
              await module.start({ ...resources, guildId: this.guildId, settings, revision: state.desiredRevision,
                logger: { info: message => this.logger.info(`${id}: ${message}`), error: message => this.logger.error(`${id}: ${message}`) },
                onObservation: handler => { this.handlers.set(id, handler); },
                onCommand: (name, run) => {
                  if (!module.commands.includes(name) || this.commands.has(name)) throw new Error('Invalid command registration.');
                  this.commands.set(name, { owner: id, run });
                },
                onJob: (type, handler) => {
                  if (!Object.hasOwn(module.jobSchemas ?? {}, type) || this.jobs.has(`${id}:${type}`)) throw new Error('Declare each job schema before registering its handler.');
                  this.jobs.set(`${id}:${type}`, handler);
                },
                onMessage: (subscription, run) => {
                  if (!module.manifest.requiredIntents.includes('GuildMessages') || !module.manifest.requiredIntents.includes('MessageContent')) throw new Error('Message handlers require GuildMessages and MessageContent intents.');
                  if (this.messages.has(id)) throw new Error('Register one message handler per module.');
                  this.messages.set(id, { subscription, run });
                },
                secret: name => {
                  if (!module.manifest.requiredSecrets?.includes(name)) throw new Error('Secret is not declared by this module.');
                  const value = process.env[moduleSecretKey(id,name)];
                  if (!value) throw new Error(`Configure the ${id} module secret ${name} on the bot host.`);
                  return value;
                },
                track: dispose => { this.cleanup.get(id)?.push(dispose); }
              });
              this.active.add(id);
            }
          } else if (this.active.has(id)) {
            if (this.modules.some(m => this.active.has(m.manifest.id) && m.manifest.dependencies.includes(id))) throw new Error('Disable dependent modules first.');
            await this.dispose(module, 'disabled');
          }
          await this.store.acknowledge(id, { ...state, settings });
          this.revisions.set(id, state.desiredRevision);
        } catch {
          if (!this.active.has(id)) await this.dispose(module, 'start failed');
          await this.store.reject(id, state.desiredRevision, 'Settings could not be applied. Check this module’s requirements, connection, and dependencies.');
        }
      }
    });
  }
  dispatch(event: Observation): Promise<void> {
    if (event.guildId !== this.guildId) return Promise.resolve();
    const bytes = Buffer.byteLength(JSON.stringify(event));
    const enqueued = Date.now();
    if (this.pending >= 1000 || this.pendingBytes + bytes > 16 * 1024 * 1024) { this.failures++; return Promise.reject(new Error('Observation buffer full.')); }
    this.pending++;
    this.pendingBytes += bytes;
    return this.enqueue(async () => {
      if (Date.now() - enqueued > 30000) { this.failures++; return; }
      for (const [id, handler] of this.handlers) {
        try { await handler(event); } catch { this.failures++; this.logger.error(`${id}: observation persistence failed; coverage incomplete`); }
      }
    }).finally(() => { this.pending--; this.pendingBytes -= bytes; });
  }
  command(name: string, context: CommandContext = { guildId: this.guildId, userId: '', channelId: null, access: 'viewer', options: {} }): Promise<string> {
    return this.enqueueValue(async () => {
      const command = this.commands.get(name);
      if (!command || !this.active.has(command.owner)) return 'This module is disabled or unavailable.';
      const module = this.modules.find(m => m.manifest.id === command.owner)!;
      const definition = commandDefinitions(module).find(c => c.name === name)!;
      if (context.guildId !== this.guildId || !commandAllowed(definition.access, context.access)) return 'Your account does not have access to this command.';
      const result = await command.run(context);
      return result.slice(0, 2000);
    });
  }
  private enqueueValue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation); this.tail = next.then(() => {}, () => {}); return next;
  }
  activeModuleIds() { return [...this.active]; }
  hasMessageInterest(channelId: string) {
    return [...this.messages].some(([id, m]) => { try { return this.active.has(id) && m.subscription.channelIds().includes(channelId); } catch { this.logger.error(`${id}: channel subscription failed`); return false; } });
  }
  message(message: ModuleMessage): Promise<void> {
    if (message.guildId !== this.guildId || !message.channelId || message.content.length > 4000) return Promise.resolve();
    return this.enqueue(async () => {
      for (const [id, entry] of this.messages) {
        if (!this.active.has(id) || !entry.subscription.channelIds().includes(message.channelId!) || !commandAllowed(entry.subscription.access, message.access)) continue;
        try { await entry.run(message); } catch { this.failures++; this.logger.error(`${id}: message handler failed`); }
      }
    });
  }
  job(moduleId: string, job: ModuleJob): Promise<string> {
    return this.enqueueValue(async () => {
      const module = this.modules.find(m => m.manifest.id === moduleId), handler = this.jobs.get(`${moduleId}:${job.type}`);
      if (!module || !handler || !this.active.has(moduleId)) throw new Error('Module job handler unavailable.');
      const payload = module.jobSchemas![job.type]!.parse(job.payload);
      return (await handler({ ...job, payload })).slice(0, 1000);
    });
  }
  private async dispose(module: BotModule, reason: string) {
    const id = module.manifest.id;
    this.handlers.delete(id); this.messages.delete(id);
    for (const key of this.jobs.keys()) if (key.startsWith(`${id}:`)) this.jobs.delete(key);
    for (const [name, command] of this.commands) if (command.owner === id) this.commands.delete(name);
    try { await module.stop(reason); } catch { this.logger.error(`${id}: stop failed`); } finally {
      for (const dispose of (this.cleanup.get(id) ?? []).reverse()) {
        try { await dispose(); } catch { this.logger.error(`${id}: cleanup failed`); }
      }
      this.cleanup.delete(id); this.active.delete(id);
    }
  }
  stop(): Promise<void> { return this.enqueue(async () => { for (const module of [...this.modules].reverse()) await this.dispose(module, 'shutdown'); }); }
}
