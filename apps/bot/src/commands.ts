import { REST, Routes, ApplicationCommandOptionType } from 'discord.js';
import { installedDefinitions } from '../../../registry/definitions.js';
import { validateRegistry } from '../../../packages/core/src/registry.js';
import { commandDefinitions } from '../../../packages/core/src/module-commands.js';
import type { ModuleDefinition, CommandDefinition } from '../../../packages/module-sdk/src/server.js';
export function buildCommands(modules: ModuleDefinition[]) {
  const definitions: CommandDefinition[] = [
    {name:'bot status',description:'Show bot status',access:'viewer'},
    {name:'bot dashboard',description:'Open the private dashboard',access:'viewer'},
    ...validateRegistry(modules).flatMap(commandDefinitions)
  ];
  const types = {string:ApplicationCommandOptionType.String,integer:ApplicationCommandOptionType.Integer,boolean:ApplicationCommandOptionType.Boolean,channel:ApplicationCommandOptionType.Channel};
  const groups = new Map<string, {name:string;description:string;options:unknown[]}>();
  for (const command of definitions) {
    const [group,subcommand] = command.name.split(' ') as [string,string];
    const entry = groups.get(group) ?? {name:group,description:`${group} commands`,options:[]};
    entry.options.push({type:ApplicationCommandOptionType.Subcommand,name:subcommand,description:command.description,
      options:[...(command.options ?? [])].sort((a,b)=>Number(!!b.required)-Number(!!a.required)).map(o => ({type:types[o.type],name:o.name,description:o.description,required:o.required ?? false,...(o.type==='string' ? {max_length:2000}: {})}))
    });
    if (entry.options.length > 25) throw new Error('A Discord command group can contain at most 25 subcommands.');
    groups.set(group,entry);
  }
  if (groups.size > 100) throw new Error('Too many guild commands.');
  return [...groups.values()];
}
export async function syncCommands(token: string, applicationId: string, guildId: string, production: boolean) {
  const commands = buildCommands(installedDefinitions(production));
  const rest = new REST({ version:'10',timeout:10000,retries:0,rejectOnRateLimit:()=>true }).setToken(token);
  const application = await rest.get(Routes.oauth2CurrentApplication()) as {id:string};
  if (application.id !== applicationId) throw new Error('Bot token and application ID do not match.');
  await rest.put(Routes.applicationGuildCommands(applicationId,guildId),{body:commands});
}
