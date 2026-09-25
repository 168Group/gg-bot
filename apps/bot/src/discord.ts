import { Client, ChannelType, PermissionFlagsBits, DiscordAPIError, type GuildChannel } from 'discord.js';
import { DestinationError, type DeliveryTransport } from '../../../modules/logging/bot/delivery.js';
export const destinationPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
export function discordTransport(client: Client, guildId: string): DeliveryTransport {
  const channel = async (id: string) => {
    const result = await client.channels.fetch(id);
    if (!result || result.type !== ChannelType.GuildText || result.guildId !== guildId) throw new DestinationError(true);
    if (!result.permissionsFor(client.user!)?.has(destinationPermissions)) throw new DestinationError(true);
    return result;
  };
  const safe = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      if (error instanceof DestinationError) throw error;
      throw new DestinationError(error instanceof DiscordAPIError && [403, 404].includes(error.status));
    }
  };
  return {
    validate: id => safe(async () => { await channel(id); }),
    find: (id, marker) => safe(async () => {
      const messages = await (await channel(id)).messages.fetch({ limit: 100 });
      return messages.find(message => message.author.id === client.user!.id && message.embeds.some(embed => embed.footer?.text.endsWith(marker)))?.id ?? null;
    }),
    send: (id, payload, marker) => safe(async () => (await (await channel(id)).send({ ...payload, nonce: marker, enforceNonce: true })).id)
  };
}
export function channelData(channel: GuildChannel): Record<string, unknown> {
  const overwrites = [...channel.permissionOverwrites.cache.values()].sort((a, b) => a.id.localeCompare(b.id)).map(overwrite => ({
    id: overwrite.id, type: overwrite.type, allow: overwrite.allow.toArray().sort(), deny: overwrite.deny.toArray().sort()
  }));
  return { name: channel.name, type: ChannelType[channel.type], parentId: channel.parentId, position: channel.rawPosition,
    ...('topic' in channel ? { topic: channel.topic } : {}), ...('nsfw' in channel ? { nsfw: channel.nsfw } : {}),
    ...('rateLimitPerUser' in channel ? { slowmode: channel.rateLimitPerUser } : {}), overwrites };
}
