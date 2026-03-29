import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { hasOwnerOverride } from './admin.js';
import { withLeaseLock } from './lease-lock.js';
import { sendGuildLog } from './logging.js';
import { ensureVoiceRoomConfig, getVoiceRoomConfig } from './voice-room-config.js';
import {
  findVoiceRoomByOwner,
  getVoiceRoom,
  listVoiceRooms,
  removeVoiceRoom,
  saveVoiceRoom,
  updateVoiceRoom,
} from './voice-room-store.js';

const roomOwnerPermissions = {
  ViewChannel: true,
  Connect: true,
  Speak: true,
  UseVAD: true,
  MoveMembers: true,
  MuteMembers: true,
  DeafenMembers: true,
};

const creatorLock = new Set();
const PANEL_PREFIX = 'voice-room';
const LIMIT_INPUT_CUSTOM_ID = 'voice-room-limit-input';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getMemberLockKey(member) {
  return `${member.guild.id}:${member.id}`;
}

function buildRoomName(member, template) {
  const displayName = String(member.displayName ?? member.user.username ?? 'User').trim();
  const safeDisplayName = displayName || 'User';

  return template
    .replaceAll('{displayName}', safeDisplayName)
    .replaceAll('{username}', member.user.username)
    .trim()
    .slice(0, 100) || `${safeDisplayName}'s room`.slice(0, 100);
}

function getRoomLogFields(member, channel, ownerId) {
  return [
    {
      name: 'Sala',
      value: `${channel.name} (\`${channel.id}\`)`,
    },
    {
      name: 'Owner',
      value: `<@${ownerId}>`,
      inline: true,
    },
    {
      name: 'Categoria',
      value: channel.parent?.name ?? 'Sin categoria',
      inline: true,
    },
    {
      name: 'Disparado por',
      value: `${member.user.tag}\n<@${member.id}>`,
      inline: true,
    },
  ];
}

function buildPanelCustomId(action, channelId) {
  return `${PANEL_PREFIX}:${action}:${channelId}`;
}

function parsePanelCustomId(customId) {
  const [prefix, action, channelId] = String(customId ?? '').split(':');

  if (prefix !== PANEL_PREFIX || !action || !channelId) {
    return null;
  }

  return { action, channelId };
}

function getTrackedVoiceChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return null;
  }

  return channel;
}

export function getTrackedTextChannel(guild, room) {
  if (!room?.textChannelId) {
    return null;
  }

  const channel = guild.channels.cache.get(room.textChannelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
}

function isLegacyVoiceRoomTextChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) {
    return false;
  }

  const topic = String(channel.topic ?? '');
  return topic.startsWith('Temporary private chat for')
    || topic.startsWith('Chat privado temporal para');
}

function getHumanMembers(channel) {
  return channel.members.filter((member) => !member.user.bot);
}

function isRoomLocked(channel) {
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
  return everyoneOverwrite?.deny.has(PermissionFlagsBits.Connect) ?? false;
}

function canManageRoom(actor, guild, room) {
  return actor.id === room.ownerId
    || actor.id === guild.ownerId
    || hasOwnerOverride({ user: actor.user })
    || actor.permissions.has(PermissionFlagsBits.ManageChannels)
    || actor.permissions.has(PermissionFlagsBits.Administrator);
}

function buildVoiceRoomPanelEmbed(voiceChannel, textChannel, room) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Temporary Room Panel')
    .setDescription('Use these buttons to manage the room quickly without commands.')
    .addFields(
      {
        name: 'Room',
        value: `${voiceChannel.name}\n\`${voiceChannel.id}\``,
        inline: true,
      },
      {
        name: 'Owner',
        value: `<@${room.ownerId}>`,
        inline: true,
      },
      {
        name: 'Members',
        value: String(voiceChannel.members.size),
        inline: true,
      },
      {
        name: 'Limit',
        value: String(voiceChannel.userLimit || 0),
        inline: true,
      },
      {
        name: 'Locked',
        value: isRoomLocked(voiceChannel) ? 'yes' : 'no',
        inline: true,
      },
      {
        name: 'Room chat',
        value: textChannel ? `${textChannel} (legacy)` : `${voiceChannel} (built in)`,
        inline: true,
      },
    )
    .setFooter({ text: 'Claim works when the current owner is no longer inside.' })
    .setTimestamp();
}

async function getPanelHostChannel(voiceChannel, room) {
  if (!voiceChannel?.guild || !room) {
    return null;
  }

  return voiceChannel.isTextBased() ? voiceChannel : null;
}

function buildVoiceRoomPanelComponents(voiceChannel, room) {
  const locked = isRoomLocked(voiceChannel);
  const ownerInside = voiceChannel.members.has(room.ownerId);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildPanelCustomId('lock', room.channelId))
        .setLabel('Lock')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(locked),
      new ButtonBuilder()
        .setCustomId(buildPanelCustomId('unlock', room.channelId))
        .setLabel('Unlock')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!locked),
      new ButtonBuilder()
        .setCustomId(buildPanelCustomId('claim', room.channelId))
        .setLabel('Claim')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(ownerInside),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildPanelCustomId('limit-open', room.channelId))
        .setLabel('Limit')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildPanelCustomId('transfer', room.channelId))
        .setLabel('Transfer')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildVoiceRoomLimitModal(channelId, currentLimit) {
  const input = new TextInputBuilder()
    .setCustomId(LIMIT_INPUT_CUSTOM_ID)
    .setLabel('Exact user limit')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(currentLimit))
    .setPlaceholder('0 = no limit, or a number between 1 and 99')
    .setMinLength(1)
    .setMaxLength(2);

  return new ModalBuilder()
    .setCustomId(buildPanelCustomId('limit-submit', channelId))
    .setTitle('Set room limit')
    .addComponents(
      new ActionRowBuilder().addComponents(input),
    );
}

async function applyRoomOwner(channel, ownerId, reason) {
  await channel.permissionOverwrites.edit(
    ownerId,
    roomOwnerPermissions,
    { reason },
  );
}

async function clearRoomOwner(channel, ownerId, reason) {
  if (!ownerId) {
    return;
  }

  await channel.permissionOverwrites.edit(
    ownerId,
    {
      ViewChannel: null,
      Connect: null,
      Speak: null,
      UseVAD: null,
      MoveMembers: null,
      MuteMembers: null,
      DeafenMembers: null,
    },
    { reason },
  ).catch(() => null);
}

export async function ensureVoiceRoomPanel(voiceChannel, room) {
  if (!voiceChannel?.guild || !room) {
    return room;
  }

  const panelHostChannel = await getPanelHostChannel(voiceChannel, room);
  const textChannel = getTrackedTextChannel(voiceChannel.guild, room);

  if (!panelHostChannel?.isTextBased()) {
    return room;
  }

  const payload = {
    embeds: [buildVoiceRoomPanelEmbed(voiceChannel, textChannel, room)],
    components: buildVoiceRoomPanelComponents(voiceChannel, room),
    allowedMentions: { parse: [] },
  };

  let panelMessage = null;

  if (room.panelMessageId) {
    panelMessage = await panelHostChannel.messages.fetch(room.panelMessageId).catch(() => null);
  }

  if (panelMessage) {
    await panelMessage.edit(payload).catch(() => null);
    return room;
  }

  const panelLock = await withLeaseLock(
    `voice-panel-${voiceChannel.guild.id}-${room.channelId}`,
    async () => {
      const refreshedRoom = await getVoiceRoom(voiceChannel.guild.id, room.channelId);

      if (!refreshedRoom) {
        return room;
      }

      const refreshedPanelHostChannel = await getPanelHostChannel(voiceChannel, refreshedRoom);
      const refreshedTextChannel = getTrackedTextChannel(voiceChannel.guild, refreshedRoom);

      if (!refreshedPanelHostChannel?.isTextBased()) {
        return refreshedRoom;
      }

      if (refreshedRoom.panelMessageId) {
        const refreshedPanel = await refreshedPanelHostChannel.messages
          .fetch(refreshedRoom.panelMessageId)
          .catch(() => null);

        if (refreshedPanel) {
          await refreshedPanel.edit(payload).catch(() => null);
          return refreshedRoom;
        }
      }

      const createdMessage = await refreshedPanelHostChannel.send(payload).catch(() => null);

      if (!createdMessage) {
        return refreshedRoom;
      }

      await createdMessage.pin('Panel de sala temporal').catch(() => null);

      return updateVoiceRoom(voiceChannel.guild.id, refreshedRoom.channelId, (draft) => {
        draft.panelMessageId = createdMessage.id;
        draft.updatedAt = new Date().toISOString();
        return draft;
      }) ?? refreshedRoom;
    },
  );

  if (!panelLock.acquired) {
    return getVoiceRoom(voiceChannel.guild.id, room.channelId) ?? room;
  }

  return panelLock.value ?? room;
}

export async function syncVoiceRoomTextAccess(voiceChannel, room) {
  if (!voiceChannel?.guild || !room) {
    return room;
  }

  let workingRoom = room;
  const textChannel = getTrackedTextChannel(voiceChannel.guild, workingRoom);

  if (workingRoom.textChannelId) {
    if (textChannel) {
      await textChannel.delete('Desactivar chats privados separados para usar el chat integrado').catch(() => null);
    }

    workingRoom = await updateVoiceRoom(voiceChannel.guild.id, workingRoom.channelId, (draft) => {
      draft.textChannelId = null;
      draft.panelMessageId = null;
      draft.updatedAt = new Date().toISOString();
      return draft;
    }) ?? workingRoom;

  }

  const panelHostChannel = await getPanelHostChannel(voiceChannel, workingRoom);

  if (panelHostChannel?.isTextBased()) {
    return ensureVoiceRoomPanel(voiceChannel, workingRoom);
  }

  return workingRoom;
}

export async function allowVoiceRoomMember(guildId, channelId, userId) {
  return updateVoiceRoom(guildId, channelId, (draft) => {
    draft.allowedMemberIds = [...new Set([...(draft.allowedMemberIds ?? []), userId])];
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

export async function assignVoiceRoomOwner(channel, room, newOwnerId, reason) {
  if (!channel?.guild || !room) {
    return null;
  }

  if (room.ownerId && room.ownerId !== newOwnerId) {
    await clearRoomOwner(channel, room.ownerId, `${reason}: limpiar owner anterior`);
  }

  await applyRoomOwner(channel, newOwnerId, `${reason}: asignar owner`);

  const updatedRoom = await updateVoiceRoom(channel.guild.id, room.channelId, (draft) => {
    draft.ownerId = newOwnerId;
    draft.updatedAt = new Date().toISOString();
    return draft;
  });

  if (updatedRoom) {
    await syncVoiceRoomTextAccess(channel, updatedRoom);
  }

  return updatedRoom;
}

export async function getManagedRoomForMember(member) {
  const channel = member.voice.channel;

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return null;
  }

  const room = await getVoiceRoom(member.guild.id, channel.id);

  if (!room) {
    return null;
  }

  return { channel, room };
}

export async function refreshVoiceRoomPanel(voiceChannel) {
  if (!voiceChannel?.guild) {
    return null;
  }

  const room = await getVoiceRoom(voiceChannel.guild.id, voiceChannel.id);

  if (!room) {
    return null;
  }

  return ensureVoiceRoomPanel(voiceChannel, room);
}

async function deleteTrackedRoom(guild, channel, reason, actorTag = null) {
  const room = await getVoiceRoom(guild.id, channel.id);
  const deletedChannel = await channel.delete(reason).catch((error) => {
    console.error('[voice-rooms:delete-room]', error);
    return null;
  });

  if (!deletedChannel) {
    await sendGuildLog(guild, 'No se pudo eliminar sala temporal', [
      {
        name: 'Sala',
        value: `${channel.name} (\`${channel.id}\`)`,
      },
      {
        name: 'Motivo',
        value: actorTag ? `${reason}\n${actorTag}` : reason,
      },
    ], 0xe67e22);
    return;
  }

  await sendGuildLog(guild, 'Sala temporal eliminada', [
    {
      name: 'Sala',
      value: `${channel.name} (\`${channel.id}\`)`,
    },
    {
      name: 'Motivo',
      value: actorTag ? `${reason}\n${actorTag}` : reason,
    },
    {
      name: 'Texto privado',
      value: room?.textChannelId ? `<#${room.textChannelId}> (legacy)` : 'chat integrado del canal de voz',
    },
  ], 0x95a5a6);
}

async function maybeTransferOwnership(channel, room, previousOwnerId) {
  const humans = getHumanMembers(channel);

  if (humans.size === 0) {
    await deleteTrackedRoom(
      channel.guild,
      channel,
      'Sala temporal vacia',
      previousOwnerId ? `Owner anterior: <@${previousOwnerId}>` : null,
    );
    return;
  }

  if (humans.has(previousOwnerId)) {
    return;
  }

  const nextOwner = humans.first();

  if (!nextOwner || nextOwner.id === room.ownerId) {
    return;
  }

  await assignVoiceRoomOwner(channel, room, nextOwner.id, 'Transferencia automatica de sala');

  await sendGuildLog(channel.guild, 'Owner de sala transferido', [
    {
      name: 'Sala',
      value: `${channel.name} (\`${channel.id}\`)`,
    },
    {
      name: 'Antes',
      value: previousOwnerId ? `<@${previousOwnerId}>` : 'sin owner',
      inline: true,
    },
    {
      name: 'Despues',
      value: `<@${nextOwner.id}>`,
      inline: true,
    },
  ], 0x3498db);
}

async function ensureExistingOwnerRoom(member) {
  const ownedRoom = await findVoiceRoomByOwner(member.guild.id, member.id);

  if (!ownedRoom) {
    return null;
  }

  const existingChannel = getTrackedVoiceChannel(member.guild, ownedRoom.channelId);

  if (!existingChannel) {
    await removeVoiceRoom(member.guild.id, ownedRoom.channelId);
    return null;
  }

  await member.voice.setChannel(existingChannel, 'Reingreso a sala temporal propia').catch(() => null);
  return existingChannel;
}

async function createVoiceRoomForMember(member, creatorChannel, config) {
  const existingRoom = await ensureExistingOwnerRoom(member);

  if (existingRoom) {
    return existingRoom;
  }

  const parentId = config.categoryId || creatorChannel.parentId || null;
  const channel = await member.guild.channels.create({
    name: buildRoomName(member, config.roomNameTemplate),
    type: ChannelType.GuildVoice,
    parent: parentId,
    userLimit: config.defaultUserLimit ?? 0,
    bitrate: config.bitrate ?? undefined,
    reason: `Sala temporal creada para ${member.user.tag} (${member.id})`,
  });

  await applyRoomOwner(channel, member.id, 'Sala temporal: owner inicial');

  const room = {
    channelId: channel.id,
    textChannelId: null,
    panelMessageId: null,
    ownerId: member.id,
    creatorChannelId: creatorChannel.id,
    allowedMemberIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveVoiceRoom(member.guild.id, room);

  try {
    await member.voice.setChannel(channel, 'Mover a sala temporal propia');
  } catch (error) {
    await removeVoiceRoom(member.guild.id, channel.id);

    await channel.delete('No se pudo mover al owner a la sala temporal').catch(() => null);
    throw error;
  }

  await syncVoiceRoomTextAccess(channel, room);
  await sendGuildLog(member.guild, 'Sala temporal creada', getRoomLogFields(member, channel, member.id), 0x2ecc71);

  return channel;
}

async function handleCreatorJoin(newState) {
  const { guild, member, channel } = newState;

  if (!guild || !member || !channel || member.user.bot) {
    return;
  }

  const config = await getVoiceRoomConfig(guild.id);

  if (!config.enabled || !config.creatorChannelIds.includes(channel.id)) {
    return;
  }

  const lockKey = getMemberLockKey(member);

  if (creatorLock.has(lockKey)) {
    return;
  }

  creatorLock.add(lockKey);

  try {
    const creationLock = await withLeaseLock(
      `voice-create-${guild.id}-${member.id}`,
      () => createVoiceRoomForMember(member, channel, config),
    );

    if (!creationLock.acquired) {
      await sleep(1500);
      await ensureExistingOwnerRoom(member);
    }
  } finally {
    creatorLock.delete(lockKey);
  }
}

async function handlePreviousTrackedRoom(oldState) {
  const { guild, channel, id } = oldState;

  if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
    return;
  }

  const room = await getVoiceRoom(guild.id, channel.id);

  if (!room) {
    return;
  }

  await maybeTransferOwnership(channel, room, room.ownerId === id ? id : room.ownerId);

  const refreshedRoom = await getVoiceRoom(guild.id, channel.id);

  if (refreshedRoom) {
    await syncVoiceRoomTextAccess(channel, refreshedRoom);
  }
}

async function handleCurrentTrackedRoom(newState) {
  const { guild, channel } = newState;

  if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
    return;
  }

  const room = await getVoiceRoom(guild.id, channel.id);

  if (!room) {
    return;
  }

  await syncVoiceRoomTextAccess(channel, room);
}

async function pruneVoiceRoomState(client) {
  for (const guild of client.guilds.cache.values()) {
    await ensureVoiceRoomConfig(guild.id);
    const config = await getVoiceRoomConfig(guild.id);
    const rooms = await listVoiceRooms(guild.id);

    for (const room of rooms) {
      const channel = getTrackedVoiceChannel(guild, room.channelId);

      if (!channel) {
        await removeVoiceRoom(guild.id, room.channelId);
        continue;
      }

      const humans = getHumanMembers(channel);

      if (humans.size === 0) {
        await deleteTrackedRoom(guild, channel, 'Limpieza de arranque: sala vacia');
        continue;
      }

      if (!humans.has(room.ownerId)) {
        await maybeTransferOwnership(channel, room, room.ownerId);
      }

      const refreshedRoom = await getVoiceRoom(guild.id, room.channelId);

      if (refreshedRoom) {
        await syncVoiceRoomTextAccess(channel, refreshedRoom);
      }
    }

    const trackedTextIds = new Set(
      rooms
        .map((room) => room.textChannelId)
        .filter(Boolean),
    );
    const targetParentId = config.textCategoryId || config.categoryId || null;

    const orphanChannels = guild.channels.cache.filter((channel) => {
      if (!isLegacyVoiceRoomTextChannel(channel)) {
        return false;
      }

      if (trackedTextIds.has(channel.id)) {
        return false;
      }

      if (targetParentId && channel.parentId !== targetParentId) {
        return false;
      }

      return true;
    });

    for (const orphanChannel of orphanChannels.values()) {
      await orphanChannel.delete('Limpiar chats privados legacy de salas temporales').catch(() => null);
    }
  }
}

async function handleChannelDelete(channel) {
  if (!channel?.guild) {
    return;
  }

  if (channel.type === ChannelType.GuildVoice) {
    const removedRoom = await removeVoiceRoom(channel.guild.id, channel.id);

    if (removedRoom?.textChannelId) {
      const textChannel = channel.guild.channels.cache.get(removedRoom.textChannelId);

      if (textChannel?.type === ChannelType.GuildText) {
        await textChannel.delete('Eliminar chat privado asociado a sala de voz borrada').catch(() => null);
      }
    }

    return;
  }

  if (channel.type !== ChannelType.GuildText) {
    return;
  }

  const rooms = await listVoiceRooms(channel.guild.id);
  const room = rooms.find((entry) => entry.textChannelId === channel.id);

  if (!room) {
    return;
  }

  await updateVoiceRoom(channel.guild.id, room.channelId, (draft) => {
    draft.textChannelId = null;
    draft.panelMessageId = null;
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

async function replyEphemeral(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ...payload, ephemeral: true }).catch(() => null);
    return;
  }

  await interaction.reply({ ...payload, ephemeral: true }).catch(() => null);
}

async function getPanelInteractionContext(interaction, channelId) {
  if (!interaction.inGuild() || !interaction.guild) {
    await replyEphemeral(interaction, { content: 'This only works inside the server.' });
    return null;
  }

  const actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!actor) {
    await replyEphemeral(interaction, { content: 'I could not identify you inside the server.' });
    return null;
  }

  const room = await getVoiceRoom(interaction.guild.id, channelId);
  const voiceChannel = getTrackedVoiceChannel(interaction.guild, channelId);

  if (!room || !voiceChannel) {
    await replyEphemeral(interaction, { content: 'This room no longer exists or is no longer managed by the bot.' });
    return null;
  }

  return {
    actor,
    guild: interaction.guild,
    room,
    voiceChannel,
    textChannel: getTrackedTextChannel(interaction.guild, room),
  };
}

async function sendPanelLog(guild, actor, voiceChannel, title, fields = [], color = 0x3498db) {
  await sendGuildLog(guild, title, [
    {
      name: 'Actor',
      value: `${actor.user.tag}\n<@${actor.id}>`,
      inline: true,
    },
    {
      name: 'Sala',
      value: `${voiceChannel.name} (\`${voiceChannel.id}\`)`,
      inline: true,
    },
    ...fields,
  ], color);
}

async function handleLockAction(interaction, context, locked) {
  if (!canManageRoom(context.actor, context.guild, context.room)) {
    await replyEphemeral(interaction, { content: 'Only the room owner or staff can use this button.' });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  await context.voiceChannel.permissionOverwrites.edit(
    context.guild.roles.everyone,
    { Connect: locked ? false : null },
    { reason: `Panel de sala temporal por ${context.actor.user.tag}` },
  );

  const refreshedRoom = await getVoiceRoom(context.guild.id, context.voiceChannel.id);

  if (refreshedRoom) {
    await ensureVoiceRoomPanel(context.voiceChannel, refreshedRoom);
  }

  await interaction.editReply({
    content: locked ? 'Room locked.' : 'Room unlocked.',
  }).catch(() => null);

  await sendPanelLog(context.guild, context.actor, context.voiceChannel, locked ? 'Sala temporal bloqueada desde panel' : 'Sala temporal desbloqueada desde panel');
  return true;
}

async function handleLimitOpen(interaction, context) {
  if (!canManageRoom(context.actor, context.guild, context.room)) {
    await replyEphemeral(interaction, { content: 'Only the room owner or staff can change the limit.' });
    return true;
  }

  const currentLimit = context.voiceChannel.userLimit || 0;
  const modal = buildVoiceRoomLimitModal(context.room.channelId, currentLimit);
  await interaction.showModal(modal).catch(() => null);
  return true;
}

async function handleLimitSubmit(interaction, context) {
  if (!canManageRoom(context.actor, context.guild, context.room)) {
    await replyEphemeral(interaction, { content: 'Only the room owner or staff can change the limit.' });
    return true;
  }

  const currentLimit = context.voiceChannel.userLimit || 0;
  const rawInput = String(interaction.fields.getTextInputValue(LIMIT_INPUT_CUSTOM_ID) ?? '').trim();

  if (!/^\d{1,2}$/.test(rawInput)) {
    await replyEphemeral(interaction, { content: 'Enter a whole number between **0** and **99**.' });
    return true;
  }

  const rawValue = Number(rawInput);

  if (!Number.isInteger(rawValue) || rawValue < 0 || rawValue > 99) {
    await replyEphemeral(interaction, { content: 'That limit is not valid.' });
    return true;
  }

  const nextLimit = rawValue;

  if (nextLimit === currentLimit) {
    await replyEphemeral(interaction, { content: `The limit is already **${currentLimit}**.` });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  await context.voiceChannel.setUserLimit(nextLimit, `Panel de sala temporal por ${context.actor.user.tag}`);

  const refreshedRoom = await getVoiceRoom(context.guild.id, context.voiceChannel.id);

  if (refreshedRoom) {
    await ensureVoiceRoomPanel(context.voiceChannel, refreshedRoom);
  }

  await interaction.editReply({
    content: `Room limit updated to **${nextLimit}**.`,
  }).catch(() => null);

  await sendPanelLog(context.guild, context.actor, context.voiceChannel, 'Limite de sala temporal actualizado desde panel', [
    { name: 'Antes', value: String(currentLimit), inline: true },
    { name: 'Despues', value: String(nextLimit), inline: true },
  ]);
  return true;
}

async function handleClaimAction(interaction, context) {
  if (context.actor.voice.channelId !== context.voiceChannel.id) {
    await replyEphemeral(interaction, { content: 'You must be inside the room to claim it.' });
    return true;
  }

  if (context.voiceChannel.members.has(context.room.ownerId)) {
    await replyEphemeral(interaction, { content: 'The current owner is still inside the room.' });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  await assignVoiceRoomOwner(
    context.voiceChannel,
    context.room,
    context.actor.id,
    `Claim desde panel por ${context.actor.user.tag}`,
  );

  const refreshedRoom = await getVoiceRoom(context.guild.id, context.voiceChannel.id);

  if (refreshedRoom) {
    await ensureVoiceRoomPanel(context.voiceChannel, refreshedRoom);
  }

  await interaction.editReply({ content: 'Ownership reclaimed successfully.' }).catch(() => null);
  await sendPanelLog(context.guild, context.actor, context.voiceChannel, 'Ownership de sala temporal reclamada desde panel', [
    { name: 'Antes', value: context.room.ownerId ? `<@${context.room.ownerId}>` : 'sin owner', inline: true },
    { name: 'Despues', value: `<@${context.actor.id}>`, inline: true },
  ]);
  return true;
}

async function handleTransferButton(interaction, context) {
  if (!canManageRoom(context.actor, context.guild, context.room)) {
    await replyEphemeral(interaction, { content: 'Only the room owner or staff can use this button.' });
    return true;
  }

  const menu = new UserSelectMenuBuilder()
    .setCustomId(buildPanelCustomId('transfer-select', context.room.channelId))
    .setPlaceholder('Select the new owner')
    .setMinValues(1)
    .setMaxValues(1);

  await replyEphemeral(interaction, {
    content: 'Choose the new owner. They must be connected inside the room.',
    components: [new ActionRowBuilder().addComponents(menu)],
  });
  return true;
}

async function handleTransferSelect(interaction, context) {
  if (!canManageRoom(context.actor, context.guild, context.room)) {
    await replyEphemeral(interaction, { content: 'Only the room owner or staff can transfer it.' });
    return true;
  }

  const userId = interaction.values[0];
  const targetMember = await context.guild.members.fetch(userId).catch(() => null);

  if (!targetMember || targetMember.voice.channelId !== context.voiceChannel.id) {
    await replyEphemeral(interaction, { content: 'The new owner must be connected inside the room.' });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  await assignVoiceRoomOwner(
    context.voiceChannel,
    context.room,
    targetMember.id,
    `Transferencia desde panel por ${context.actor.user.tag}`,
  );

  const refreshedRoom = await getVoiceRoom(context.guild.id, context.voiceChannel.id);

  if (refreshedRoom) {
    await ensureVoiceRoomPanel(context.voiceChannel, refreshedRoom);
  }

  await interaction.editReply({
    content: `Ownership transferred to **${targetMember.user.tag}**.`,
  }).catch(() => null);

  await sendPanelLog(context.guild, context.actor, context.voiceChannel, 'Ownership de sala temporal transferida desde panel', [
    { name: 'Antes', value: `<@${context.room.ownerId}>`, inline: true },
    { name: 'Despues', value: `<@${targetMember.id}>`, inline: true },
  ]);
  return true;
}

export async function handleVoiceRoomInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isUserSelectMenu() && !interaction.isModalSubmit()) {
    return false;
  }

  const parsed = parsePanelCustomId(interaction.customId);

  if (!parsed) {
    return false;
  }

  const context = await getPanelInteractionContext(interaction, parsed.channelId);

  if (!context) {
    return true;
  }

  if (parsed.action === 'lock') {
    return handleLockAction(interaction, context, true);
  }

  if (parsed.action === 'unlock') {
    return handleLockAction(interaction, context, false);
  }

  if (parsed.action === 'limit-open' && interaction.isButton()) {
    return handleLimitOpen(interaction, context);
  }

  if (parsed.action === 'limit-submit' && interaction.isModalSubmit()) {
    return handleLimitSubmit(interaction, context);
  }

  if (parsed.action === 'claim') {
    return handleClaimAction(interaction, context);
  }

  if (parsed.action === 'transfer' && interaction.isButton()) {
    return handleTransferButton(interaction, context);
  }

  if (parsed.action === 'transfer-select' && interaction.isUserSelectMenu()) {
    return handleTransferSelect(interaction, context);
  }

  return false;
}

export function attachVoiceRooms(client) {
  client.once(Events.ClientReady, () => {
    void pruneVoiceRoomState(client).catch((error) => {
      console.error('[voice-rooms:prune]', error);
    });
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    void (async () => {
      await handlePreviousTrackedRoom(oldState);
      await handleCreatorJoin(newState);
      await handleCurrentTrackedRoom(newState);
    })().catch((error) => {
      console.error('[voice-rooms:state]', error);
    });
  });

  client.on('channelDelete', (channel) => {
    void handleChannelDelete(channel).catch((error) => {
      console.error('[voice-rooms:channel-delete]', error);
    });
  });
}
