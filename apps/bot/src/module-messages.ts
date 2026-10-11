import type { Message } from 'discord.js';
import { accessFor } from '../../../packages/core/src/access.js';
import type { Config } from '../../../packages/core/src/config.js';
import type { ModuleHost } from '../../../packages/core/src/host.js';

interface MessageRouting {
  config: Config;
  host: ModuleHost;
  botId: string | undefined;
  available(): boolean;
}

/** Route MessageCreate after local filtering, before making any membership request. */
export async function dispatchModuleMessage(message: Message, routing: MessageRouting): Promise<void> {
  const { config, host, botId, available } = routing;
  if (!available() || message.guildId !== config.DISCORD_GUILD_ID || !message.guild
    || message.guild.id !== config.DISCORD_GUILD_ID || message.author.bot || message.webhookId || message.content.length > 4000) return;
  // Discord's inferred reply mentions are deliberately not used here.
  const mentionsBot = Boolean(botId && (message.content.includes(`<@${botId}>`) || message.content.includes(`<@!${botId}>`)));
  if (!host.hasMessageInterest(message.channelId, mentionsBot)) return;
  const member = await message.guild.members.fetch({ user: message.author.id, force: true });
  if (!available() || member.id !== message.author.id || member.guild.id !== config.DISCORD_GUILD_ID) return;
  const access = accessFor(config, member.id, [...member.roles.cache.keys()], true);
  await host.message({ guildId: config.DISCORD_GUILD_ID, userId: member.id, channelId: message.channelId,
    access, options: {}, id: message.id, content: message.content, mentionsBot,
    reply: async text => {
      if (available()) await message.reply({ content: text.slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } });
    }
  });
}
