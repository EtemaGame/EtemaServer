import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { sendGuildLog } from './logging.js';

function isLogChannel(channel) {
  const name = String(channel?.name ?? '')
    .normalize('NFKC')
    .toLowerCase();

  return name.includes('mod-logs') || name.includes('spam-logs');
}

function getExcerpt(content) {
  if (!content) {
    return 'sin texto';
  }

  return String(content).slice(0, 900);
}

function getUserTag(user) {
  return user?.tag ?? `${user?.username ?? 'desconocido'}#????`;
}

async function findRecentAuditEntry(guild, type, targetId) {
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    return null;
  }

  const auditLogs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);

  return auditLogs?.entries.find((entry) => {
    if (entry.target?.id !== targetId) {
      return false;
    }

    return Date.now() - entry.createdTimestamp <= 20_000;
  }) ?? null;
}

async function handleMemberAdd(member) {
  const accountAgeHours = Math.max(
    0,
    Math.floor((Date.now() - member.user.createdTimestamp) / 3_600_000),
  );

  await sendGuildLog(member.guild, 'Miembro entro', [
    {
      name: 'Usuario',
      value: `${getUserTag(member.user)}\n<@${member.id}>`,
      inline: true,
    },
    {
      name: 'Cuenta creada',
      value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
      inline: true,
    },
    {
      name: 'Edad de cuenta',
      value: `${accountAgeHours} hora(s)`,
      inline: true,
    },
  ], 0x2ecc71);
}

async function handleMemberRemove(member) {
  const kickEntry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  const action = kickEntry ? 'expulsado' : 'salio';
  const actor = kickEntry?.executor ? `${getUserTag(kickEntry.executor)}\n<@${kickEntry.executor.id}>` : null;

  await sendGuildLog(member.guild, 'Miembro salio', [
    {
      name: 'Usuario',
      value: `${getUserTag(member.user)}\n<@${member.id}>`,
      inline: true,
    },
    {
      name: 'Accion',
      value: action,
      inline: true,
    },
    ...(actor ? [{ name: 'Actor', value: actor, inline: true }] : []),
  ], kickEntry ? 0xe67e22 : 0x95a5a6);
}

async function handleBanAdd(ban) {
  const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  const fields = [
    {
      name: 'Usuario',
      value: `${getUserTag(ban.user)}\n<@${ban.user.id}>`,
      inline: true,
    },
  ];

  if (entry?.executor) {
    fields.push({
      name: 'Actor',
      value: `${getUserTag(entry.executor)}\n<@${entry.executor.id}>`,
      inline: true,
    });
  }

  if (entry?.reason) {
    fields.push({
      name: 'Motivo',
      value: entry.reason,
    });
  }

  await sendGuildLog(ban.guild, 'Usuario baneado', fields, 0xe74c3c);
}

async function handleBanRemove(ban) {
  const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
  const fields = [
    {
      name: 'Usuario',
      value: `${getUserTag(ban.user)}\n<@${ban.user.id}>`,
      inline: true,
    },
  ];

  if (entry?.executor) {
    fields.push({
      name: 'Actor',
      value: `${getUserTag(entry.executor)}\n<@${entry.executor.id}>`,
      inline: true,
    });
  }

  await sendGuildLog(ban.guild, 'Ban removido', fields, 0x3498db);
}

async function handleMessageDelete(message) {
  if (!message.inGuild() || !message.guild || !message.author || message.author.bot || isLogChannel(message.channel)) {
    return;
  }

  await sendGuildLog(message.guild, 'Mensaje eliminado', [
    {
      name: 'Usuario',
      value: `${getUserTag(message.author)}\n<@${message.author.id}>`,
      inline: true,
    },
    {
      name: 'Canal',
      value: `<#${message.channelId}>`,
      inline: true,
    },
    {
      name: 'Contenido',
      value: getExcerpt(message.content),
    },
  ], 0xf39c12);
}

async function handleMessageUpdate(oldMessage, newMessage) {
  if (!newMessage.inGuild() || !newMessage.guild || !newMessage.author || newMessage.author.bot || isLogChannel(newMessage.channel)) {
    return;
  }

  const before = String(oldMessage.content ?? '');
  const after = String(newMessage.content ?? '');

  if (!before || before === after) {
    return;
  }

  await sendGuildLog(newMessage.guild, 'Mensaje editado', [
    {
      name: 'Usuario',
      value: `${getUserTag(newMessage.author)}\n<@${newMessage.author.id}>`,
      inline: true,
    },
    {
      name: 'Canal',
      value: `<#${newMessage.channelId}>`,
      inline: true,
    },
    {
      name: 'Antes',
      value: getExcerpt(before),
    },
    {
      name: 'Despues',
      value: getExcerpt(after),
    },
  ], 0x9b59b6);
}

export function attachServerLogs(client) {
  client.on('guildMemberAdd', (member) => {
    void handleMemberAdd(member).catch((error) => {
      console.error('[server-logs:member-add]', error);
    });
  });

  client.on('guildMemberRemove', (member) => {
    void handleMemberRemove(member).catch((error) => {
      console.error('[server-logs:member-remove]', error);
    });
  });

  client.on('guildBanAdd', (ban) => {
    void handleBanAdd(ban).catch((error) => {
      console.error('[server-logs:ban-add]', error);
    });
  });

  client.on('guildBanRemove', (ban) => {
    void handleBanRemove(ban).catch((error) => {
      console.error('[server-logs:ban-remove]', error);
    });
  });

  client.on('messageDelete', (message) => {
    void handleMessageDelete(message).catch((error) => {
      console.error('[server-logs:message-delete]', error);
    });
  });

  client.on('messageUpdate', (oldMessage, newMessage) => {
    void handleMessageUpdate(oldMessage, newMessage).catch((error) => {
      console.error('[server-logs:message-update]', error);
    });
  });
}
