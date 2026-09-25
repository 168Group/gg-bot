import type { ModuleDefinition } from '../../module-sdk/src/server.js';
export function moduleSecretKey(moduleId: string, name: string) { return `OMO_MODULE_${moduleId.replaceAll('-', '_').toUpperCase()}_${name}`; }
/** Forward only explicitly declared module secrets to the bot child, never to the dashboard. */
export function moduleSecretEnvironment(modules: ModuleDefinition[], source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(modules.flatMap(module => (module.manifest.requiredSecrets ?? []).flatMap(name => {
    const key=moduleSecretKey(module.manifest.id,name), value=source[key];
    return value ? [[key,value]] : [];
  })));
}
