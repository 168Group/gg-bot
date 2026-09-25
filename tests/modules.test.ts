import { moduleSecretEnvironment } from '../packages/core/src/module-secrets.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ModuleHost } from '../packages/core/src/host.js';
import { requiredIntents, commandAllowed } from '../packages/core/src/module-commands.js';
import { buildCommands } from '../apps/bot/src/commands.js';
import { exampleModule } from '../modules/example/bot.js';
import { exampleDefinition } from '../modules/example/definition.js';
import { loggingDefinition } from '../modules/logging/manifest.js';
import { scaffoldModule, syncModules } from '../scripts/module-tools.js';
import { validateRegistry } from '../packages/core/src/registry.js';
import type { BotModule, CommandContext } from '../packages/module-sdk/src/server.js';
import type { ModuleState } from '../packages/module-sdk/src/browser.js';
const logger={info(){},error(){}};
const state=(id:string, enabled=true):ModuleState=>({moduleId:id,enabled,appliedEnabled:false,settings:{greeting:'Hello'},appliedSettings:{},desiredRevision:1,appliedRevision:0,applyError:null});
const member:CommandContext={guildId:'guild',userId:'member',channelId:'channel',access:null,options:{}};
function storage(states:Map<string,ModuleState>) {return {
  async getModule(id:string){return states.get(id)!;},
  async acknowledge(id:string,next:ModuleState){states.set(id,{...states.get(id)!,appliedEnabled:next.enabled,appliedRevision:next.desiredRevision});},
  async reject(id:string,_revision:number,message:string){states.get(id)!.applyError=message;}
};}
describe('module contract',()=>{
  it('passes only installed modules’ declared secrets to the bot environment',()=>{
    const module={...exampleDefinition,manifest:{...exampleDefinition.manifest,requiredSecrets:['API_TOKEN']}};
    expect(moduleSecretEnvironment([module],{OMO_MODULE_EXAMPLE_API_TOKEN:'fixture-token',OMO_MODULE_OTHER_API_TOKEN:'other',DISCORD_CLIENT_SECRET:'oauth',UNRELATED:'value'})).toEqual({OMO_MODULE_EXAMPLE_API_TOKEN:'fixture-token'});
  });
  it('generates commands and intents from metadata while rejecting invalid declarations',()=>{
    const commands=buildCommands([loggingDefinition,exampleDefinition]);
    expect(commands.map(c=>c.name)).toEqual(['bot','logging','example']);
    expect(requiredIntents([loggingDefinition,exampleDefinition])).toEqual([1]);
    expect(()=>requiredIntents([{...exampleDefinition,manifest:{...exampleDefinition.manifest,requiredIntents:['MadeUpIntent']}}])).toThrow('unknown Discord intent');
    expect(()=>validateRegistry([{...exampleDefinition,manifest:{...exampleDefinition.manifest,requiredBotPermissions:['MadeUpPermission']}}])).toThrow('unknown Discord permission');
    expect(commandAllowed('member',null)).toBe(true);expect(commandAllowed('admin','viewer')).toBe(false);expect(commandAllowed('admin','owner')).toBe(true);
  });
  it('enforces command access and guild scope, then unregisters commands on disable',async()=>{
    const states=new Map([['example',state('example')]]);
    let calls=0;
    const module:BotModule={...exampleModule(),commandDefinitions:[{name:'example ping',description:'Staff command',access:'admin'}],async start(c){c.onCommand('example ping',async input=>{calls++;return input.userId;});}};
    const host=new ModuleHost('guild',[module],storage(states),logger);await host.sync();
    expect(await host.command('example ping',member)).toContain('does not have access');
    expect(await host.command('example ping',{...member,access:'owner',guildId:'other'})).toContain('does not have access');
    expect(await host.command('example ping',{...member,access:'admin'})).toBe('member');expect(calls).toBe(1);
    states.set('example',{...states.get('example')!,enabled:false,desiredRevision:2});await host.sync();
    expect(await host.command('example ping',{...member,access:'admin'})).toContain('disabled');expect(calls).toBe(1);
  });
  it('drains commands before disable and stops dependents before their dependencies',async()=>{
    const states=new Map([['example',state('example')],['dependent',state('dependent')]]),order:string[]=[];
    let finish!:()=>void;const waiting=new Promise<void>(resolve=>{finish=resolve;});
    const parent:BotModule={...exampleModule(),async start(c){c.onCommand('example ping',async()=>{await waiting;return 'Finished';});},async stop(){order.push('parent');}};
    const child:BotModule={...exampleModule(),manifest:{...exampleDefinition.manifest,id:'dependent',dependencies:['example']},commands:[],commandDefinitions:[],async start(){},async stop(){order.push('child');}};
    const host=new ModuleHost('guild',[child,parent],storage(states),logger);await host.sync();
    const command=host.command('example ping',member);
    states.set('example',{...states.get('example')!,enabled:false,desiredRevision:2});states.set('dependent',{...states.get('dependent')!,enabled:false,desiredRevision:2});
    const stopped=host.sync();expect(order).toEqual([]);finish();expect(await command).toBe('Finished');await stopped;
    expect(order).toEqual(['child','parent']);
  });
  it('scopes plain-text handlers by channel, membership access and declared intents',async()=>{
    const states=new Map([['example',state('example')]]);let calls=0;
    const module:BotModule={...exampleModule(),manifest:{...exampleDefinition.manifest,requiredIntents:['GuildMessages','MessageContent']},async start(c){c.onMessage({channelIds:()=>['staff-events'],access:'admin'},async()=>{calls++;});}};
    const host=new ModuleHost('guild',[module],storage(states),logger);await host.sync();
    expect(host.hasMessageInterest('general')).toBe(false);
    const message={...member,id:'message',content:'Create an event',reply:async()=>{}};
    await host.message({...message,channelId:'staff-events'});await host.message({...message,channelId:'general',access:'admin'});
    await host.message({...message,channelId:'staff-events',access:'admin'});expect(calls).toBe(1);
    states.set('example',{...states.get('example')!,enabled:false,desiredRevision:2});await host.sync();
    await host.message({...message,channelId:'staff-events',access:'owner'});expect(calls).toBe(1);
  });
  it('scaffolds a package and all registries while refusing overwrites and traversal',async()=>{
    const root=await mkdtemp(`${tmpdir()}/omo-module-tools-`);await mkdir(resolve(root,'modules'));await writeFile(resolve(root,'modules/installed.json'),'[]');
    await scaffoldModule(root,'community-events');
    const definition=await readFile(resolve(root,'modules/community-events/definition.ts'),'utf8');
    expect(definition).toContain("id: 'community-events'");expect(definition).toContain('moduleDefinition');
    expect(await readFile(resolve(root,'registry/installed-bots.ts'),'utf8')).toContain("../modules/community-events/bot.js");
    expect(await readFile(resolve(root,'registry/web.ts'),'utf8')).toContain("/modules/community-events");
    for (const folder of ['apps','packages','node_modules']) await symlink(resolve(folder),resolve(root,folder),'dir');
    await symlink(resolve('modules/logging'),resolve(root,'modules/logging'),'dir');
    await writeFile(resolve(root,'package.json'),'{"type":"module"}');
    const config=JSON.parse(await readFile('tsconfig.json','utf8'));config.include=['modules','registry'];config.compilerOptions.types.push('@fastify/cookie');
    await writeFile(resolve(root,'tsconfig.json'),JSON.stringify(config));
    await promisify(execFile)(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--project',resolve(root,'tsconfig.json')],{timeout:30000}).catch(error=>{ const failure=error as {stdout?:string;message:string};throw new Error(failure.stdout ?? failure.message); });
    await expect(scaffoldModule(root,'community-events')).rejects.toThrow('already registered');
    await expect(scaffoldModule(root,'../escape')).rejects.toThrow();
    await writeFile(resolve(root,'modules/installed.json'),'[{"id":"community-events","developmentOnly":false},{"id":"community-events","developmentOnly":false}]');
    await expect(syncModules(root)).rejects.toThrow('Duplicate');
  }, 30000);
});
