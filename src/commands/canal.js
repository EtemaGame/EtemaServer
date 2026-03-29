import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  ensureAdminAccess,
  ensureBotPermissions,
  getAuditReason,
  normalizeChannelName,
  overwriteValueFromAction,
  sendEphemeral,
} from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';

function getChannelName(value) {
  const name = normalizeChannelName(value);

  if (!name) {
    throw new Error('El nombre del canal quedo vacio tras normalizarlo. Usa letras o numeros.');
  }

  return name;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('canal')
    .setDescription('Crea y configura canales del servidor.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crear-texto')
        .setDescription('Crea un canal de texto.')
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nombre del nuevo canal.').setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('categoria')
            .setDescription('Categoria donde crear el canal.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('privado')
            .setDescription('Si es true, ocultara el canal a @everyone.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crear-voz')
        .setDescription('Crea un canal de voz.')
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nombre del nuevo canal.').setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('categoria')
            .setDescription('Categoria donde crear el canal.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('limite')
            .setDescription('Limite de usuarios, entre 0 y 99.')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crear-categoria')
        .setDescription('Crea una categoria.')
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nombre de la categoria.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('renombrar')
        .setDescription('Renombra un canal.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal que quieres renombrar.')
            .addChannelTypes(
              ChannelType.GuildCategory,
              ChannelType.GuildText,
              ChannelType.GuildVoice,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildStageVoice,
            )
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nuevo nombre del canal.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('tema')
        .setDescription('Actualiza el tema de un canal de texto.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal de texto que quieres editar.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('tema').setDescription('Nuevo tema del canal.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bloquear')
        .setDescription('Bloquea el envio de mensajes para @everyone.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal de texto que quieres bloquear.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('desbloquear')
        .setDescription('Vuelve a permitir mensajes para @everyone.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal de texto que quieres desbloquear.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('acceso')
        .setDescription('Configura si un rol puede ver un canal.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal que quieres configurar.')
            .addChannelTypes(
              ChannelType.GuildCategory,
              ChannelType.GuildText,
              ChannelType.GuildVoice,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildStageVoice,
            )
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol al que quieres ajustar el acceso.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Permitir, denegar o limpiar el override.')
            .setRequired(true)
            .addChoices(
              { name: 'Permitir', value: 'permitir' },
              { name: 'Denegar', value: 'denegar' },
              { name: 'Limpiar', value: 'limpiar' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('escribir')
        .setDescription('Configura si un rol puede escribir en un canal de texto.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal de texto que quieres configurar.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol al que quieres ajustar la escritura.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Permitir, denegar o limpiar el override.')
            .setRequired(true)
            .addChoices(
              { name: 'Permitir', value: 'permitir' },
              { name: 'Denegar', value: 'denegar' },
              { name: 'Limpiar', value: 'limpiar' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('eliminar')
        .setDescription('Elimina un canal.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal que quieres eliminar.')
            .addChannelTypes(
              ChannelType.GuildCategory,
              ChannelType.GuildText,
              ChannelType.GuildVoice,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildStageVoice,
            )
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('confirmar')
            .setDescription('Debes marcarlo en true para confirmar.')
            .setRequired(true),
        ),
    ),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageChannels);

    if (!context) {
      return;
    }

    if (!(await ensureBotPermissions(interaction, context, [PermissionFlagsBits.ManageChannels]))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'crear-texto') {
      try {
        const category = interaction.options.getChannel('categoria');
        const privateChannel = interaction.options.getBoolean('privado') ?? false;
        const channel = await context.guild.channels.create({
          name: getChannelName(interaction.options.getString('nombre', true)),
          type: ChannelType.GuildText,
          parent: category?.id,
          permissionOverwrites: privateChannel
            ? [{ id: context.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
            : undefined,
          reason: getAuditReason(interaction, 'crear canal de texto'),
        });

        await sendEphemeral(
          interaction,
          `Canal de texto creado: ${channel.toString()} en **${channel.parent?.name ?? 'Sin categoria'}**.`,
        );
        await sendModLog(interaction, 'Canal de texto creado', [
          { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
          { name: 'Categoria', value: channel.parent?.name ?? 'Sin categoria', inline: true },
          { name: 'Privado', value: privateChannel ? 'si' : 'no', inline: true },
        ]);
      } catch (error) {
        await sendEphemeral(interaction, error.message);
      }
      return;
    }

    if (subcommand === 'crear-voz') {
      try {
        const category = interaction.options.getChannel('categoria');
        const channel = await context.guild.channels.create({
          name: getChannelName(interaction.options.getString('nombre', true)),
          type: ChannelType.GuildVoice,
          parent: category?.id,
          userLimit: interaction.options.getInteger('limite') ?? 0,
          reason: getAuditReason(interaction, 'crear canal de voz'),
        });

        await sendEphemeral(interaction, `Canal de voz creado: **${channel.name}**.`);
        await sendModLog(interaction, 'Canal de voz creado', [
          { name: 'Canal', value: `${channel.name} (\`${channel.id}\`)` },
          { name: 'Categoria', value: channel.parent?.name ?? 'Sin categoria', inline: true },
          { name: 'Limite', value: String(channel.userLimit ?? 0), inline: true },
        ]);
      } catch (error) {
        await sendEphemeral(interaction, error.message);
      }
      return;
    }

    if (subcommand === 'crear-categoria') {
      try {
        const category = await context.guild.channels.create({
          name: getChannelName(interaction.options.getString('nombre', true)),
          type: ChannelType.GuildCategory,
          reason: getAuditReason(interaction, 'crear categoria'),
        });

        await sendEphemeral(interaction, `Categoria creada: **${category.name}**.`);
        await sendModLog(interaction, 'Categoria creada', [
          { name: 'Categoria', value: `${category.name} (\`${category.id}\`)` },
        ]);
      } catch (error) {
        await sendEphemeral(interaction, error.message);
      }
      return;
    }

    const channel = interaction.options.getChannel('canal', true);

    if (subcommand === 'renombrar') {
      const previousName = channel.name;
      const newName = getChannelName(interaction.options.getString('nombre', true));
      await channel.setName(newName, getAuditReason(interaction, `renombrar canal a ${newName}`));
      await sendEphemeral(interaction, `Canal renombrado a **${newName}**.`);
      await sendModLog(interaction, 'Canal renombrado', [
        { name: 'Antes', value: previousName, inline: true },
        { name: 'Despues', value: newName, inline: true },
        { name: 'Canal', value: `\`${channel.id}\`` },
      ]);
      return;
    }

    if (subcommand === 'tema') {
      if (!('setTopic' in channel)) {
        await sendEphemeral(interaction, 'Ese tipo de canal no admite tema.');
        return;
      }

      const topic = interaction.options.getString('tema', true).trim();
      await channel.setTopic(topic, getAuditReason(interaction, 'actualizar tema del canal'));
      await sendEphemeral(interaction, 'Tema del canal actualizado.');
      await sendModLog(interaction, 'Tema de canal actualizado', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Tema', value: topic },
      ]);
      return;
    }

    if (subcommand === 'bloquear') {
      await channel.permissionOverwrites.edit(
        context.guild.roles.everyone,
        { SendMessages: false, AddReactions: false },
        { reason: getAuditReason(interaction, 'bloquear canal para @everyone') },
      );
      await sendEphemeral(interaction, `Canal ${channel.toString()} bloqueado para @everyone.`);
      await sendModLog(interaction, 'Canal bloqueado', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Objetivo', value: '@everyone', inline: true },
      ]);
      return;
    }

    if (subcommand === 'desbloquear') {
      await channel.permissionOverwrites.edit(
        context.guild.roles.everyone,
        { SendMessages: null, AddReactions: null },
        { reason: getAuditReason(interaction, 'desbloquear canal para @everyone') },
      );
      await sendEphemeral(interaction, `Canal ${channel.toString()} desbloqueado para @everyone.`);
      await sendModLog(interaction, 'Canal desbloqueado', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Objetivo', value: '@everyone', inline: true },
      ]);
      return;
    }

    if (subcommand === 'acceso') {
      const role = interaction.options.getRole('rol', true);
      const action = interaction.options.getString('accion', true);
      const value = overwriteValueFromAction(action);

      await channel.permissionOverwrites.edit(
        role,
        { ViewChannel: value },
        { reason: getAuditReason(interaction, `ajustar acceso de ${role.name}`) },
      );

      await sendEphemeral(
        interaction,
        `Acceso de **${role.name}** actualizado a **${action}** en ${channel.toString()}.`,
      );
      await sendModLog(interaction, 'Acceso de canal actualizado', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
        { name: 'Accion', value: action, inline: true },
      ]);
      return;
    }

    if (subcommand === 'escribir') {
      const role = interaction.options.getRole('rol', true);
      const action = interaction.options.getString('accion', true);
      const value = overwriteValueFromAction(action);

      await channel.permissionOverwrites.edit(
        role,
        { SendMessages: value, AddReactions: value },
        { reason: getAuditReason(interaction, `ajustar escritura de ${role.name}`) },
      );

      await sendEphemeral(
        interaction,
        `Permiso de escritura de **${role.name}** actualizado a **${action}** en ${channel.toString()}.`,
      );
      await sendModLog(interaction, 'Permiso de escritura actualizado', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
        { name: 'Accion', value: action, inline: true },
      ]);
      return;
    }

    const confirm = interaction.options.getBoolean('confirmar', true);

    if (!confirm) {
      await sendEphemeral(interaction, 'Para eliminar un canal debes usar `confirmar: true`.');
      return;
    }

    const channelName = channel.name;
    await channel.delete(getAuditReason(interaction, `eliminar canal ${channelName}`));
    await sendEphemeral(interaction, `Canal eliminado: **${channelName}**.`);
    await sendModLog(interaction, 'Canal eliminado', [
      { name: 'Canal', value: `${channelName} (\`${channel.id}\`)` },
    ]);
  },
};
