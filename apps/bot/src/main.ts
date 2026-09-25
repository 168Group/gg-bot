import { readConfig, requireSecret } from '../../../packages/core/src/config.js';
import { startBot } from './runtime.js';
const stop = await startBot(readConfig(), requireSecret('DISCORD_BOT_TOKEN'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
