import { readConfig, requireSecret } from '../packages/core/src/config.js';
import { syncCommands } from '../apps/bot/src/commands.js';
const config = readConfig();
await syncCommands(requireSecret('DISCORD_BOT_TOKEN'), requireSecret('DISCORD_APPLICATION_ID'), config.DISCORD_GUILD_ID, config.NODE_ENV === 'production');
console.info('Guild slash commands synchronized.');
