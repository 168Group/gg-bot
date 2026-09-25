import { z } from 'zod';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { ModuleDefinition, CommandDefinition } from '../../module-sdk/src/server.js';
import type { Access } from '../../module-sdk/src/browser.js';
const name = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const commandSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31} [a-z][a-z0-9-]{0,31}$/),
  description: z.string().min(1).max(100), access: z.enum(['member','viewer','admin']),
  options: z.array(z.object({ name, description:z.string().min(1).max(100),type:z.enum(['string','integer','boolean','channel']),required:z.boolean().optional() }).strict()).max(25).optional()
}).strict();
export function commandDefinitions(module: ModuleDefinition): CommandDefinition[] {
  const definitions = module.commandDefinitions ?? module.commands.map(name => ({ name, description: `${module.manifest.name}: ${name.split(' ')[1]}`, access: 'viewer' as const }));
  const parsed = definitions.map(c => commandSchema.parse(c));
  if (parsed.length !== module.commands.length || new Set(parsed.map(c => c.name)).size !== parsed.length || parsed.some(c => !module.commands.includes(c.name))) throw new Error(`${module.manifest.id}: command metadata does not match declared commands.`);
  for (const command of parsed) {
    if (command.name.startsWith('bot ')) throw new Error('The bot command group is reserved.');
    const options = command.options ?? [];
    if (new Set(options.map(o => o.name)).size !== options.length) throw new Error('Duplicate command option.');
  }
  return parsed;
}
export function commandAllowed(required: CommandDefinition['access'], access: Access | null) {
  return required === 'member' || required === 'viewer' && access !== null || required === 'admin' && (access === 'admin' || access === 'owner');
}
export function validateCapabilities(module: ModuleDefinition) {
  for (const intent of module.manifest.requiredIntents) if (!(intent in GatewayIntentBits) || typeof GatewayIntentBits[intent as keyof typeof GatewayIntentBits] !== 'number') throw new Error(`${module.manifest.id}: unknown Discord intent ${intent}.`);
  for (const permission of module.manifest.requiredBotPermissions) if (!(permission in PermissionFlagsBits)) throw new Error(`${module.manifest.id}: unknown Discord permission ${permission}.`);
}
export function requiredIntents(modules: ModuleDefinition[]) {
  const intents = new Set<number>([GatewayIntentBits.Guilds]);
  for (const module of modules) { validateCapabilities(module); for (const intent of module.manifest.requiredIntents) intents.add(GatewayIntentBits[intent as keyof typeof GatewayIntentBits]); }
  return [...intents];
}
