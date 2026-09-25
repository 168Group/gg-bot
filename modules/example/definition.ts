import { z } from 'zod';
import type { ModuleDefinition } from '../../packages/module-sdk/src/server.js';
export const exampleDefinition = {
  manifest: { id: 'example', name: 'Example module', version: '0.1.0', apiVersion: 1 as const,
    description: 'Development-only proof of the module contract.', dependencies: [] as string[], requiredIntents: [], requiredBotPermissions: [], settingsVersion: 1 },
  settingsSchema: z.object({ greeting: z.string().min(1).max(100) }).strict(),
  defaultSettings: { greeting: 'Hello from your server!' }, commands: ['example ping'],
  commandDefinitions: [{ name: 'example ping', description: 'Read this module’s greeting', access: 'member' }],
  jobSchemas: { remember: z.object({}).strict() }
} satisfies ModuleDefinition;
export { exampleDefinition as definition };
