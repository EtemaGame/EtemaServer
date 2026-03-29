import { ChannelType } from 'discord.js';
import { getAutomodConfig } from './automod-config.js';
import { getWelcomeConfig } from './welcome-config.js';

const WELCOME_NAME_HINTS = ['welcome', 'bienvenida', 'bienvenidos'];

function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isWelcomeTextChannel(channel) {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

function compareChannelPriority(channel) {
  const normalized = normalizeForMatch(channel.name);

  if (normalized === 'welcome' || normalized === 'bienvenida' || normalized === 'bienvenidos') {
    return 0;
  }

  if (WELCOME_NAME_HINTS.some((hint) => normalized.includes(hint))) {
    return 1;
  }

  return 2;
}

export function buildWelcomeMessage(template, values) {
  return String(template)
    .replaceAll('{user}', values.userMention)
    .replaceAll('{server}', values.serverName)
    .replaceAll('{memberCount}', String(values.memberCount));
}

export function findWelcomeChannel(guild, config) {
  if (!guild) {
    return null;
  }

  const configuredChannel = config.channelId
    ? guild.channels.cache.get(config.channelId) ?? null
    : null;

  if (isWelcomeTextChannel(configuredChannel)) {
    return configuredChannel;
  }

  const candidates = guild.channels.cache
    .filter((channel) => isWelcomeTextChannel(channel))
    .sort((left, right) => compareChannelPriority(left) - compareChannelPriority(right));

  const detected = candidates.find((channel) => compareChannelPriority(channel) < 2);
  return detected ?? null;
}

async function shouldSkipWelcome(member) {
  if (!member.guild || member.user.bot) {
    return true;
  }

  const automodConfig = await getAutomodConfig(member.guild.id);

  if (
    !automodConfig.enabled
    || !automodConfig.joinGuard.enabled
    || automodConfig.joinGuard.action !== 'kick'
  ) {
    return false;
  }

  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const minAgeMs = automodConfig.joinGuard.minAccountAgeHours * 60 * 60 * 1000;

  return accountAgeMs < minAgeMs;
}

function getMessageValues(member) {
  return {
    userMention: `<@${member.id}>`,
    serverName: member.guild.name,
    memberCount: member.guild.memberCount,
  };
}

export async function sendWelcomeMessage(member, options = {}) {
  if (await shouldSkipWelcome(member)) {
    return { sent: false, reason: 'skip' };
  }

  const config = options.config ?? await getWelcomeConfig(member.guild.id);

  if (!config.enabled && !options.ignoreEnabled) {
    return { sent: false, reason: 'disabled' };
  }

  const channel = findWelcomeChannel(member.guild, config);

  if (!channel?.isTextBased()) {
    return { sent: false, reason: 'channel-not-found' };
  }

  const content = buildWelcomeMessage(config.messageTemplate, getMessageValues(member));
  const finalContent = options.prefix ? `${options.prefix}\n${content}` : content;

  await channel.send({
    content: finalContent,
    allowedMentions: {
      parse: [],
      roles: [],
      users: [member.id],
      repliedUser: false,
    },
  });

  return {
    sent: true,
    channel,
    content: finalContent,
  };
}

export function attachWelcomeMessages(client) {
  client.on('guildMemberAdd', (member) => {
    void sendWelcomeMessage(member).catch((error) => {
      console.error('[welcome:member-add]', error);
    });
  });
}
