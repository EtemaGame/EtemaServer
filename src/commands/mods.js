import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdminAccess, ensureBotPermissions, getGuildContext, sendEphemeral } from '../lib/admin.js';
import {
  addModAlertRole,
  buildModAlertRolePanel,
  getAvailableModAlertRoles,
  modAlertRoleChoices,
  removeModAlertRole,
  sendModAlertRoleList,
} from '../lib/mod-alert-roles.js';
import { sendModLog } from '../lib/logging.js';

function addRoleChoiceOption(option) {
  option
    .setName('mod')
    .setDescription('Mod notification role.')
    .setRequired(true);

  if (modAlertRoleChoices.length > 0) {
    option.addChoices(...modAlertRoleChoices);
  }

  return option;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('mods')
    .setDescription('Gestiona tus roles de aviso para mods.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('Muestra los roles de aviso disponibles y tus suscripciones actuales.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('join')
        .setDescription('Suscríbete a un rol de aviso de mod.')
        .addStringOption((option) => addRoleChoiceOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('leave')
        .setDescription('Quita tu suscripción a un rol de aviso de mod.')
        .addStringOption((option) => addRoleChoiceOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('panel')
        .setDescription('Publica el panel de autoasignación para roles de aviso.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal donde se publicará el panel.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('limpiar')
            .setDescription('Si es true, borrará los mensajes previos del bot en ese canal.')
            .setRequired(false),
        ),
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'panel') {
      const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageRoles);

      if (!context) {
        return;
      }

      if (!(await ensureBotPermissions(interaction, context, [PermissionFlagsBits.ManageRoles]))) {
        return;
      }

      const targetChannel = interaction.options.getChannel('canal') ?? interaction.channel;

      if (!targetChannel?.isTextBased() || typeof targetChannel.send !== 'function') {
        await sendEphemeral(interaction, 'Elige un canal de texto o avisos para el panel.');
        return;
      }

      const targetPermissions = targetChannel.permissionsFor(context.me);

      if (
        !targetPermissions?.has(PermissionFlagsBits.ViewChannel)
        || !targetPermissions.has(PermissionFlagsBits.SendMessages)
        || !targetPermissions.has(PermissionFlagsBits.EmbedLinks)
      ) {
        await sendEphemeral(
          interaction,
          'Necesito permisos de `Ver canal`, `Enviar mensajes` e `Insertar enlaces` en ese canal.',
        );
        return;
      }

      const panelPayload = buildModAlertRolePanel(context.guild);

      if (!panelPayload) {
        await sendEphemeral(interaction, 'No hay roles de aviso configurados en el blueprint todavía.');
        return;
      }

      const clean = interaction.options.getBoolean('limpiar') ?? false;

      if (clean) {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        const botMessages = messages.filter((m) => m.author.id === context.me.id);
        if (botMessages.size > 0) {
          await targetChannel.bulkDelete(botMessages).catch(() => null);
        }
      }

      await targetChannel.send(panelPayload);
      await sendEphemeral(interaction, `Panel de avisos publicado en <#${targetChannel.id}>.`);

      const availableRoles = getAvailableModAlertRoles(context.guild);
      const roleSummary = availableRoles.length > 0
        ? availableRoles.map((entry) => `\`${entry.role.name}\``).join(', ').slice(0, 1024)
        : 'ninguno';

      await sendModLog(interaction, 'Panel de avisos publicado', [
        { name: 'Canal', value: `<#${targetChannel.id}>`, inline: true },
        { name: 'Roles', value: roleSummary },
      ]);
      return;
    }

    const context = await getGuildContext(interaction);

    if (!context) {
      return;
    }

    if (subcommand === 'list') {
      await sendModAlertRoleList(interaction, context);
      return;
    }

    if (!(await ensureBotPermissions(interaction, context, [PermissionFlagsBits.ManageRoles]))) {
      return;
    }

    const roleName = interaction.options.getString('mod', true);

    if (subcommand === 'join') {
      await addModAlertRole(interaction, context, roleName);
      return;
    }

    await removeModAlertRole(interaction, context, roleName);
  },
};
