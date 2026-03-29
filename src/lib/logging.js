import { EmbedBuilder } from 'discord.js';

const MOD_LOG_CHANNEL_NAME = '🔧-mod-logs';

function getComparableName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toFieldValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }

  return String(value).slice(0, 1024);
}

function getChannelLink(channel) {
  return channel ? `<#${channel.id}>` : 'sin canal';
}

function buildEmbed(title, fields, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      ...fields.map((field) => ({
        name: field.name,
        value: toFieldValue(field.value),
        inline: field.inline ?? false,
      })),
    )
    .setTimestamp();
}

export function findModLogChannel(guild) {
  const comparableTarget = getComparableName(MOD_LOG_CHANNEL_NAME);

  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased()) {
      return false;
    }

    return getComparableName(channel.name) === comparableTarget;
  }) ?? null;
}

export async function sendGuildLog(guild, title, fields = [], color = 0x3498db) {
  if (!guild) {
    return;
  }

  const logChannel = findModLogChannel(guild);

  if (!logChannel?.isTextBased()) {
    return;
  }

  await logChannel.send({
    embeds: [buildEmbed(title, fields, color)],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

export async function sendModLog(interaction, title, fields = []) {
  if (!interaction.guild) {
    return;
  }

  await sendGuildLog(
    interaction.guild,
    title,
    [
      {
        name: 'Actor',
        value: `${interaction.user.tag}\n<@${interaction.user.id}>`,
        inline: true,
      },
      {
        name: 'Comando',
        value: `/${interaction.commandName}`,
        inline: true,
      },
      {
        name: 'Canal',
        value: getChannelLink(interaction.channel),
        inline: true,
      },
      ...fields,
    ],
    0x3498db,
  );
}
