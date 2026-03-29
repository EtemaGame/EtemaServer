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
      'Debes estar conectado a una sala temporal gestionada por este bot para usar `/sala`.',
    );
    return null;
  }

  if (requireOwnership && !isRoomOwnerOrStaff(context, managed.room)) {
    await sendEphemeral(
      interaction,
      'Solo el owner de la sala o alguien con permisos de staff puede gestionarla.',
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
    .setName('sala')
    .setDescription('Gestiona tu sala temporal de voz.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('estado')
        .setDescription('Muestra el estado de tu sala temporal actual.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('claim')
        .setDescription('Reclama la ownership si el owner actual ya no esta en la sala.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('renombrar')
        .setDescription('Cambia el nombre de tu sala temporal.')
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nuevo nombre de la sala.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('limite')
        .setDescription('Ajusta el limite de usuarios de la sala.')
        .addIntegerOption((option) =>
          option
            .setName('cantidad')
            .setDescription('Cantidad maxima de usuarios, entre 0 y 99.')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bloquear')
        .setDescription('Cierra la sala para que no entre cualquiera.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('desbloquear')
        .setDescription('Vuelve a abrir la sala al acceso normal.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('permitir')
        .setDescription('Permite el acceso a un usuario concreto.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Usuario al que quieres permitir.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sacar')
        .setDescription('Saca a un usuario conectado de tu sala.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Usuario al que quieres sacar.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('transferir')
        .setDescription('Transfiere la ownership de la sala a otra persona dentro de ella.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Nuevo owner de la sala.').setRequired(true),
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

    if (subcommand === 'sacar') {
      botPermissions.push(PermissionFlagsBits.MoveMembers);
    }

    if (!(await ensureBotPermissions(interaction, roomContext, botPermissions))) {
      return;
    }

    if (subcommand === 'estado') {
      const textChannel = getTrackedTextChannel(roomContext.guild, roomContext.room);

      await sendEphemeral(
        interaction,
        [
          `Sala: **${roomContext.channel.name}**`,
          `ID: \`${roomContext.channel.id}\``,
          `Owner: <@${roomContext.room.ownerId}>`,
          `Miembros: **${roomContext.channel.members.size}**`,
          `Limite: **${roomContext.channel.userLimit || 0}**`,
          `Bloqueada: **${getLockState(roomContext.channel) ? 'si' : 'no'}**`,
          `Chat de sala: ${textChannel ? textChannel.toString() : 'integrado en esta sala'}`,
        ].join('\n'),
      );
      return;
    }

    if (subcommand === 'claim') {
      const ownerStillInside = roomContext.channel.members.has(roomContext.room.ownerId);

      if (ownerStillInside) {
        await sendEphemeral(interaction, 'El owner actual sigue dentro de la sala, asi que no puedes reclamarla.');
        return;
      }

      const refreshedRoom = await getVoiceRoom(roomContext.guild.id, roomContext.channel.id);

      if (!refreshedRoom) {
        await sendEphemeral(interaction, 'La sala ya no aparece como gestionada por el bot.');
        return;
      }

      await assignVoiceRoomOwner(
        roomContext.channel,
        refreshedRoom,
        roomContext.actor.id,
        getAuditReason(interaction, `claim manual de sala temporal por ${roomContext.actor.user.tag}`),
      );

      await sendEphemeral(interaction, 'Ownership reclamada correctamente.');
      await sendModLog(interaction, 'Ownership de sala temporal reclamada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Antes', value: roomContext.room.ownerId ? `<@${roomContext.room.ownerId}>` : 'sin owner', inline: true },
        { name: 'Despues', value: `<@${roomContext.actor.id}>`, inline: true },
      ]);
      return;
    }

    if (subcommand === 'renombrar') {
      const name = interaction.options.getString('nombre', true).trim().slice(0, 100);

      if (!name) {
        await sendEphemeral(interaction, 'El nombre no puede quedar vacio.');
        return;
      }

      const previousName = roomContext.channel.name;
      await roomContext.channel.setName(name, getAuditReason(interaction, 'renombrar sala temporal'));
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, `Sala renombrada a **${name}**.`);
      await sendModLog(interaction, 'Sala temporal renombrada', [
        { name: 'Antes', value: previousName, inline: true },
        { name: 'Despues', value: name, inline: true },
        { name: 'Canal', value: `\`${roomContext.channel.id}\`` },
      ]);
      return;
    }

    if (subcommand === 'limite') {
      const limit = interaction.options.getInteger('cantidad', true);
      await roomContext.channel.setUserLimit(limit, getAuditReason(interaction, 'ajustar limite de sala temporal'));
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, `Limite actualizado a **${limit}**.`);
      await sendModLog(interaction, 'Limite de sala temporal actualizado', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Limite', value: String(limit), inline: true },
      ]);
      return;
    }

    if (subcommand === 'bloquear') {
      await roomContext.channel.permissionOverwrites.edit(
        roomContext.guild.roles.everyone,
        { Connect: false },
        { reason: getAuditReason(interaction, 'bloquear sala temporal') },
      );
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, 'Sala bloqueada. Solo entrara quien ya tenga acceso.');
      await sendModLog(interaction, 'Sala temporal bloqueada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'desbloquear') {
      await roomContext.channel.permissionOverwrites.edit(
        roomContext.guild.roles.everyone,
        { Connect: null },
        { reason: getAuditReason(interaction, 'desbloquear sala temporal') },
      );
      await refreshVoiceRoomPanel(roomContext.channel);
      await sendEphemeral(interaction, 'Sala desbloqueada.');
      await sendModLog(interaction, 'Sala temporal desbloqueada', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'permitir') {
      const user = interaction.options.getUser('usuario', true);
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

      await sendEphemeral(interaction, `Acceso concedido a **${user.tag}**.`);
      await sendModLog(interaction, 'Acceso a sala temporal concedido', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Usuario', value: `${user.tag}\n<@${user.id}>` },
      ]);
      return;
    }

    if (subcommand === 'sacar') {
      const user = interaction.options.getUser('usuario', true);
      const targetMember = await roomContext.guild.members.fetch(user.id).catch(() => null);

      if (!targetMember || targetMember.voice.channelId !== roomContext.channel.id) {
        await sendEphemeral(interaction, 'Ese usuario no esta conectado a tu sala ahora mismo.');
        return;
      }

      await targetMember.voice.disconnect(getAuditReason(interaction, `sacar de sala temporal a ${user.tag}`));
      await sendEphemeral(interaction, `Usuario sacado de la sala: **${user.tag}**.`);
      await sendModLog(interaction, 'Usuario sacado de sala temporal', [
        { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
        { name: 'Usuario', value: `${user.tag}\n<@${user.id}>` },
      ]);
      return;
    }

    const user = interaction.options.getUser('usuario', true);
    const targetMember = await roomContext.guild.members.fetch(user.id).catch(() => null);

    if (!targetMember || targetMember.voice.channelId !== roomContext.channel.id) {
      await sendEphemeral(interaction, 'El nuevo owner debe estar conectado dentro de la sala.');
      return;
    }

    const refreshedRoom = await getVoiceRoom(roomContext.guild.id, roomContext.channel.id);

    if (!refreshedRoom) {
      await sendEphemeral(interaction, 'La sala ya no aparece como gestionada por el bot.');
      return;
    }

      await assignVoiceRoomOwner(
        roomContext.channel,
        refreshedRoom,
        targetMember.id,
        getAuditReason(interaction, `transferir sala temporal a ${user.tag}`),
      );
      await refreshVoiceRoomPanel(roomContext.channel);

      await sendEphemeral(interaction, `Ownership transferida a **${user.tag}**.`);
    await sendModLog(interaction, 'Ownership de sala temporal transferida', [
      { name: 'Canal', value: `${roomContext.channel.name} (\`${roomContext.channel.id}\`)` },
      { name: 'Antes', value: `<@${roomContext.room.ownerId}>`, inline: true },
      { name: 'Despues', value: `<@${targetMember.id}>`, inline: true },
    ]);
  },
};
