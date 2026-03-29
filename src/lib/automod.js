import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getAutomodConfig } from './automod-config.js';
import { registerAutomodStrike } from './automod-state.js';

const SPAM_LOG_CHANNEL_NAME = '🔧-spam-logs';
const messageHistory = new Map();

function getComparableName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function getGuildMemberKey(message) {
  return `${message.guildId}:${message.author.id}`;
}

function getNow() {
  return Date.now();
}

function getSpamLogChannel(guild) {
  const comparableTarget = getComparableName(SPAM_LOG_CHANNEL_NAME);

  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased()) {
      return false;
    }

    return getComparableName(channel.name) === comparableTarget;
  }) ?? null;
}

function getMessageExcerpt(content) {
  if (!content) {
    return 'sin texto';
  }

  return content.slice(0, 900);
}

function isStaffLike(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild)
    || member.permissions.has(PermissionFlagsBits.ManageMessages)
    || member.permissions.has(PermissionFlagsBits.ModerateMembers);
}

function shouldIgnoreMessage(message, config) {
  if (!message.inGuild() || !message.guild || !message.member) {
    return true;
  }

  if (message.author.bot || message.system || message.webhookId) {
    return true;
  }

  if (!config.enabled) {
    return true;
  }

  if (config.exemptUserIds.includes(message.author.id)) {
    return true;
  }

  if (config.ignoredChannelIds.includes(message.channelId)) {
    return true;
  }

  if (message.member.roles.cache.some((role) => config.ignoredRoleIds.includes(role.id))) {
    return true;
  }

  if (message.member.id === message.guild.ownerId) {
    return true;
  }

  if (isStaffLike(message.member)) {
    return true;
  }

  return false;
}

function detectBlockedWord(content, blockedWords) {
  const normalizedContent = normalizeForMatch(content);

  for (const word of blockedWords) {
    const normalizedWord = normalizeForMatch(word);

    if (normalizedWord && normalizedContent.includes(normalizedWord)) {
      return word;
    }
  }

  return null;
}

function containsLink(content) {
  return /(https?:\/\/|www\.|discord\.gg\/|discordapp\.com\/invite\/)/i.test(content);
}

function addMessageToHistory(message) {
  const key = getGuildMemberKey(message);
  const now = getNow();
  const normalized = normalizeForMatch(message.content).replace(/\s+/g, ' ').trim();
  const existing = messageHistory.get(key) ?? [];

  existing.push({
    timestamp: now,
    normalized,
    id: message.id,
  });

  const trimmed = existing.filter((entry) => now - entry.timestamp <= 60_000);
  messageHistory.set(key, trimmed);

  return trimmed;
}

function detectFlood(history, floodConfig) {
  const now = getNow();
  const withinWindow = history.filter(
    (entry) => now - entry.timestamp <= floodConfig.windowSeconds * 1000,
  );

  if (withinWindow.length >= floodConfig.maxMessages) {
    return {
      type: 'flood',
      detail: `${withinWindow.length} mensajes en ${floodConfig.windowSeconds}s`,
    };
  }

  const duplicates = new Map();
  const withinDuplicateWindow = history.filter(
    (entry) => now - entry.timestamp <= floodConfig.duplicateWindowSeconds * 1000,
  );

  for (const entry of withinDuplicateWindow) {
    if (!entry.normalized) {
      continue;
    }

    duplicates.set(entry.normalized, (duplicates.get(entry.normalized) ?? 0) + 1);
  }

  for (const [messageText, count] of duplicates) {
    if (count >= floodConfig.duplicateMessages) {
      return {
        type: 'duplicate',
        detail: `${count} repeticiones de "${messageText.slice(0, 60)}"`,
      };
    }
  }

  return null;
}

async function sendSpamLog(guild, payload) {
  const logChannel = getSpamLogChannel(guild);

  if (!logChannel?.isTextBased()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(payload.color ?? 0xe67e22)
    .setTitle(payload.title)
    .addFields(
      ...payload.fields.map((field) => ({
        name: field.name,
        value: String(field.value ?? 'n/a').slice(0, 1024),
        inline: field.inline ?? false,
      })),
    )
    .setTimestamp();

  await logChannel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

function resolveEscalatedTimeoutMinutes(config, strikeCount, fallbackMinutes) {
  if (!config.escalation.enabled) {
    return fallbackMinutes;
  }

  const ladder = config.escalation.timeoutMinutes.filter(
    (minutes) => Number.isInteger(minutes) && minutes >= 1 && minutes <= 40_320,
  );

  if (!ladder.length) {
    return fallbackMinutes;
  }

  return ladder[Math.min(strikeCount - 1, ladder.length - 1)];
}

async function applyAutomodAction(message, ruleLabel, action, timeoutMinutes, deleteMessage = true, config = null) {
  const results = [];
  let escalation = null;

  if (deleteMessage && message.deletable) {
    await message.delete().catch(() => null);
    results.push('mensaje eliminado');
  }

  if (action === 'timeout' && message.member?.moderatable) {
    let appliedTimeoutMinutes = timeoutMinutes;

    if (config?.escalation?.enabled) {
      const strike = await registerAutomodStrike(
        message.guildId,
        message.author.id,
        'message-timeout',
        config.escalation.resetHours,
      );

      appliedTimeoutMinutes = resolveEscalatedTimeoutMinutes(config, strike.count, timeoutMinutes);
      escalation = {
        count: strike.count,
        resetHours: config.escalation.resetHours,
        appliedTimeoutMinutes,
      };
    }

    await message.member
      .timeout(appliedTimeoutMinutes * 60_000, `Automod: ${ruleLabel}`)
      .catch(() => null);
    results.push(`timeout ${appliedTimeoutMinutes}m`);
  }

  return {
    results,
    escalation,
  };
}

async function handleMessageAutomod(message) {
  const config = await getAutomodConfig(message.guildId);

  if (shouldIgnoreMessage(message, config)) {
    return;
  }

  const violations = [];
  const blockedWord = detectBlockedWord(message.content, config.blockedWords);

  if (blockedWord) {
    violations.push({
      label: 'Palabra bloqueada',
      detail: blockedWord,
      action: 'timeout',
      timeoutMinutes: 60,
      deleteMessage: true,
    });
  }

  if (config.links.mode !== 'allow' && containsLink(message.content)) {
    violations.push({
      label: 'Link detectado',
      detail: config.links.mode === 'staff' ? 'solo staff puede enviar links' : 'links bloqueados',
      action: config.links.mode === 'block' ? 'timeout' : 'delete',
      timeoutMinutes: 30,
      deleteMessage: true,
    });
  }

  if (config.flood.enabled) {
    const history = addMessageToHistory(message);
    const floodViolation = detectFlood(history, config.flood);

    if (floodViolation) {
      violations.push({
        label: floodViolation.type === 'flood' ? 'Flood detectado' : 'Spam repetido',
        detail: floodViolation.detail,
        action: config.flood.action,
        timeoutMinutes: config.flood.timeoutMinutes,
        deleteMessage: config.flood.deleteMessage,
      });
    }
  }

  if (violations.length === 0) {
    return;
  }

  const primaryViolation = violations[0];
  const actionOutcome = await applyAutomodAction(
    message,
    primaryViolation.label,
    primaryViolation.action,
    primaryViolation.timeoutMinutes,
    primaryViolation.deleteMessage,
    config,
  );

  const fields = [
    {
      name: 'Usuario',
      value: `${message.author.tag}\n<@${message.author.id}>`,
      inline: true,
    },
    {
      name: 'Canal',
      value: `<#${message.channelId}>`,
      inline: true,
    },
    {
      name: 'Detalle',
      value: primaryViolation.detail,
    },
    {
      name: 'Accion',
      value: actionOutcome.results.join(', ') || 'solo log',
      inline: true,
    },
    {
      name: 'Mensaje',
      value: getMessageExcerpt(message.content),
    },
  ];

  if (actionOutcome.escalation) {
    fields.splice(4, 0, {
      name: 'Escalado',
      value: `Falta #${actionOutcome.escalation.count}\nTimeout: ${actionOutcome.escalation.appliedTimeoutMinutes}m\nReinicio: ${actionOutcome.escalation.resetHours}h`,
      inline: true,
    });
  }

  await sendSpamLog(message.guild, {
    title: primaryViolation.label,
    color: 0xe74c3c,
    fields,
  });
}

async function handleJoinGuard(member) {
  if (!member.guild) {
    return;
  }

  const config = await getAutomodConfig(member.guild.id);

  if (!config.enabled || !config.joinGuard.enabled) {
    return;
  }

  if (config.exemptUserIds.includes(member.id)) {
    return;
  }

  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const minAgeMs = config.joinGuard.minAccountAgeHours * 60 * 60 * 1000;

  if (accountAgeMs >= minAgeMs) {
    return;
  }

  const actionResults = [];

  if (config.joinGuard.action === 'timeout' && member.moderatable) {
    await member.timeout(
      config.joinGuard.timeoutMinutes * 60_000,
      'Automod: cuenta demasiado nueva',
    ).catch(() => null);
    actionResults.push(`timeout ${config.joinGuard.timeoutMinutes}m`);
  }

  if (config.joinGuard.action === 'kick' && member.kickable) {
    await member.kick('Automod: cuenta demasiado nueva').catch(() => null);
    actionResults.push('expulsado');
  }

  await sendSpamLog(member.guild, {
    title: 'Join guard',
    color: 0xf1c40f,
    fields: [
      {
        name: 'Usuario',
        value: `${member.user.tag}\n<@${member.id}>`,
        inline: true,
      },
      {
        name: 'Edad de cuenta',
        value: `${Math.max(0, Math.floor(accountAgeMs / 3_600_000))} hora(s)`,
        inline: true,
      },
      {
        name: 'Minimo requerido',
        value: `${config.joinGuard.minAccountAgeHours} hora(s)`,
        inline: true,
      },
      {
        name: 'Accion',
        value: actionResults.join(', ') || 'solo log',
      },
    ],
  });
}

export function attachAutomod(client) {
  client.on('messageCreate', (message) => {
    void handleMessageAutomod(message).catch((error) => {
      console.error('[automod:message]', error);
    });
  });

  client.on('guildMemberAdd', (member) => {
    void handleJoinGuard(member).catch((error) => {
      console.error('[automod:join]', error);
    });
  });
}
