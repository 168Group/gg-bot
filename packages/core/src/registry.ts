import { commandDefinitions, validateCapabilities } from './module-commands.js';
import { manifestSchema } from '../../module-sdk/src/browser.js';
import type { ModuleDefinition } from '../../module-sdk/src/server.js';
export function validateRegistry<T extends ModuleDefinition>(modules: T[]): T[] {
  const ids = new Map<string, T>();
  const commands = new Set<string>();
  for (const module of modules) {
    const manifest = manifestSchema.parse(module.manifest);
    if (ids.has(manifest.id)) throw new Error(`Duplicate module: ${manifest.id}`);
    module.settingsSchema.parse(module.defaultSettings);
    validateCapabilities(module); commandDefinitions(module);
    for (const command of module.commands) {
      if (commands.has(command)) throw new Error(`Duplicate command: ${command}`);
      commands.add(command);
    }
    ids.set(manifest.id, module);
  }
  const sorted: T[] = [], visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Module dependency cycle: ${id}`);
    if (visited.has(id)) return;
    const module = ids.get(id);
    if (!module) throw new Error(`Missing module dependency: ${id}`);
    visiting.add(id);
    for (const dependency of module.manifest.dependencies) visit(dependency);
    visiting.delete(id); visited.add(id); sorted.push(module);
  };
  for (const id of ids.keys()) visit(id);
  return sorted;
}
