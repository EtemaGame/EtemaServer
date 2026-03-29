import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  ensureBotPermissions,
  getAuditReason,
  getGuildContext,
  hasOwnerOverride,
  sendEphemeral,
} from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';
import {
  allowVoiceRoomMember,
  assignVoiceRoomOwner,
  getManagedRoomForMember,
  getTrackedTextChannel,
  refreshVoiceRoomPanel,
} from '../lib/voice-rooms.js';
import { getVoiceRoom } from '../lib/voice-room-store.js';

function isRoomOwnerOrStaff(context, room) {
  return context.actor.id === room.ownerId
    || context.actor.id === context.guild.ownerId
    || hasOwnerOverride({ user: context.actor.user })
    || context.actor.permissions.has(PermissionFlagsBits.ManageChannels)
    || context.actor.permissions.has(PermissionFlagsBits.Administrator);
}

function getLockState(channel) {
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
  return everyoneOverwrite?.deny.has(PermissionFlagsBits.Connect) ?? false;
}

async function getRoomCommandContext(interaction, options = {}) {
  const { requireOwnership = true } = options;
  const context = await getGuildContext(interaction);

  if (!context) {
    return null;
  }

  const managed = await getManagedRoomForMember(context.actor);

  if (!managed) {
    await sendEphemeral(
      interaction,
      'You must be connected to a temporary room managed by this bot to use `/room`.',
    );
    return null;
  }

  if (requireOwnership && !isRoomOwnerOrStaff(context, managed.room)) {
    await sendEphemeral(
      interaction,
      'Only the room owner or someone with staff permissions can manage it.',
    );
    return null;
  }

  return {
    ...context,
    room: managed.room,
    channel: managed.channel,
  };
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('room')
    .setDescription('Manage your temporary voice room.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show the current status of your temporary room.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('claim')
        .setDescription('Claim ownership if the current owner is no longer in the room.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('rename')
        .setDescription('Rename your temporary room.')
        .addStringOption((option) =>
          option.setName('name').setDescription('New room name.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('limit')
        .setDescription('Adjust the user limit of the room.')
        .addIntegerOption((option) =>
          option
            .setName('slots')
            .setDescription('Maximum number of users, between 0 and 99.')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('lock')
        .setDescription('Lock the room so not everyone can join.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unlock')
        .setDescription('Open the room back up to normal access.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('allow')
        .setDescription('Allow a specific user into the room.')
        .addUserOption((option) =>
          option.setName('user').setDescription('User you want to allow.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('kick')
        .setDescription('Disconnect a user who is currently in your room.')
        .addUserOption((option) =>
          option.setName('user').setDescription('User you want to disconnect.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('transfer')
        .setDescription('Transfer ownership of the room to someone else inside it.')
        .addUserOption((option) =>
          option.setName('user').setDescription('New room owner.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const roomContext = await getRoomCommandContext(interaction, {
      requireOwnership: subcommand !== 'claim',
    });

    if (!roomContext) {
      return;
    }

    const botPermissions = [PermissionFlagsBits.ManageChannels];

    if (subcommand === 'kick') {
      botPermissions.push(PermissionFlagsBits.MoveMembers);
    }

    if (!(await ensureBotPermissions(interaction, roomContext, botPermissions))) {
      return;
    }

    if (subcommand === 'status') {
      const textChannel = getTrackedTextChannel(roomContext.guild, roomContext.room);

      await sendEphemeral(
        interaction,
        [
          `Room: **${roomContext.channel.name}**`,
          `ID: \`${roomContext.channel.id}\``,
          `Owner: <@${roomContext.room.ownerId}>`,
          `Members: **${roomContext.channel.members.size}**`,
          `Limit: **${roomContext.channel.userLimit || 0}**`,
          `Locked: **${getLockState(roomContext.channel) ? 'yes' : 'no'}**`,
          `Room chat: ${textChannel ? `${textChannel} (legacy)` : `${roomContext.channel} (built in)`}`,
        ].join('\n'),
      );
      return;
    }

    if (subcommand === 'claim') {
      const ownerStillInside = roomContext.channel.members.has(roomContext.room.ownerId);

      if (ownerStillInside) {
        await sendEphemeral(interaction, 'The current owner is still in the room, so you cannot claim it.');
        return;
      }

      const refreshedRoom = await getVoiceRoom(roomContext.guild.id, roomContext.channel.id);

      if (!refreshedRoom) {
        await sendEphemeral(interaction, 'This room is no longer tracked by the bot.');
        return;
      }

      await assignVoiceRoomOwner(
        roomContext.channel,
        refreshedRoom,
        roomContext.actor.id,
        getAuditReason(interaction, `claim manual de sala temporal por ${roomContext.actor.user.tag}`),
      );

      await sendEphemeral(interaction, 'Ownership reclaimed successfully.');
      await sendModLog(interaction, 'Ownership de sala temporal reclamada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Antes', value: roomContext.room.ownerId ? `<@${roomContext.room.ownerId}>` : 'sin owner', inline: true },
        { name: 'Despues', value: `<@${roomContext.actor.id}>`, inline: true },
      ]);
      return;
    }

    if (subcommand === 'rename') {
      const name = interaction.options.getString('name', true).trim().slice(0, 100);

      if (!name) {
        await sendEphemeral(interaction, 'The room name cannot be empty.');
        return;
      }

      const previousName = roomContext.channel.name;
      await roomContext.channel.setName(name, getAuditReason(interaction, 'renombrar sala temporal'));
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, `Room renamed to **${name}**.`);
      await sendModLog(interaction, 'Sala temporal renombrada', [
        { name: 'Antes', value: previousName, inline: true },
        { name: 'Despues', value: name, inline: true },
        { name: 'Canal', value: `\`${roomContext.channel.id}\`` },
      ]);
      return;
    }

    if (subcommand === 'limit') {
      const limit = interaction.options.getInteger('slots', true);
      await roomContext.channel.setUserLimit(limit, getAuditReason(interaction, 'ajustar limite de sala temporal'));
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, `Room limit updated to **${limit}**.`);
      await sendModLog(interaction, 'Limite de sala temporal actualizado', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Limite', value: String(limit), inline: true },
      ]);
      return;
    }

    if (subcommand === 'lock') {
      await roomContext.channel.permissionOverwrites.edit(
        roomContext.guild.roles.everyone,
        { Connect: false },
        { reason: getAuditReason(interaction, 'bloquear sala temporal') },
      );
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, 'Room locked. Only allowed users will be able to join.');
      await sendModLog(interaction, 'Sala temporal bloqueada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'unlock') {
      await roomContext.channel.permissionOverwrites.edit(
        roomContext.guild.roles.everyone,
        { Connect: null },
        { reason: getAuditReason(interaction, 'desbloquear sala temporal') },
      );
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, 'Room unlocked.');
      await sendModLog(interaction, 'Sala temporal desbloqueada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'allow') {
      const user = interaction.options.getUser('user', true);
      const updatedRoom = await allowVoiceRoomMember(roomContext.guild.id, roomContext.channel.id, user.id);

      await roomContext.channel.permissionOverwrites.edit(
        user.id,
        { ViewChannel: true, Connect: true, Speak: true, UseVAD: true },
        { reason: getAuditReason(interaction, `permitir acceso a ${user.tag}`) },
      );

      const textChannel = getTrackedTextChannel(roomContext.guild, updatedRoom ?? roomContext.room);

      if (textChannel) {
        await textChannel.permissionOverwrites.edit(
          user.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
            AddReactions: true,
            UseApplicationCommands: true,
          },
          { reason: getAuditReason(interaction, `permitir chat privado a ${user.tag}`) },
        );
      }

      await refreshVoiceRoomPanel(roomContext.channel);

      await sendEphemeral(interaction, `Access granted to **${user.tag}**.`);
      await sendModLog(interaction, 'Acceso a sala temporal concedido', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Usuario', value: `${user.tag}\n<@${user.id}>` },
      ]);
      return;
    }

    if (subcommand === 'kick') {
      const user = interaction.options.getUser('user', true);
      const targetMember = await roomContext.guild.members.fetch(user.id).catch(() => null);

      if (!targetMember || targetMember.voice.channelId !== roomContext.channel.id) {
        await sendEphemeral(interaction, 'That user is not connected to your room right now.');
        return;
      }

      await targetMember.voice.disconnect(getAuditReason(interaction, `sacar de sala temporal a ${user.tag}`));
      await sendEphemeral(interaction, `Disconnected from the room: **${user.tag}**.`);
      await sendModLog(interaction, 'Usuario sacado de sala temporal', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Usuario', value: `${user.tag}\n<@${user.id}>` },
      ]);
      return;
    }

    const user = interaction.options.getUser('user', true);
    const targetMember = await roomContext.guild.members.fetch(user.id).catch(() => null);

    if (!targetMember || targetMember.voice.channelId !== roomContext.channel.id) {
      await sendEphemeral(interaction, 'The new owner must be connected inside the room.');
      return;
    }

    const refreshedRoom = await getVoiceRoom(roomContext.guild.id, roomContext.channel.id);

    if (!refreshedRoom) {
      await sendEphemeral(interaction, 'This room is no longer tracked by the bot.');
      return;
    }

    await assignVoiceRoomOwner(
      roomContext.channel,
      refreshedRoom,
      targetMember.id,
      getAuditReason(interaction, `transferir sala temporal a ${user.tag}`),
    );
    await refreshVoiceRoomPanel(roomContext.channel);

    await sendEphemeral(interaction, `Ownership transferred to **${user.tag}**.`);
    await sendModLog(interaction, 'Ownership de sala temporal transferida', [
      { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      { name: 'Antes', value: `<@${roomContext.room.ownerId}>`, inline: true },
      { name: 'Despues', value: `<@${targetMember.id}>`, inline: true },
    ]);
  },
};
