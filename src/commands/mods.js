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
    .setDescription('Manage your mod notification roles.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('Show the available mod notification roles and your current subscriptions.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('join')
        .setDescription('Subscribe to a mod notification role.')
        .addStringOption((option) => addRoleChoiceOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('leave')
        .setDescription('Unsubscribe from a mod notification role.')
        .addStringOption((option) => addRoleChoiceOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('panel')
        .setDescription('Post the self-assign panel for mod notification roles.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel where the panel should be posted.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('clean')
            .setDescription('If true, it will delete the bot previous messages in that channel.')
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

      const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;

      if (!targetChannel?.isTextBased() || typeof targetChannel.send !== 'function') {
        await sendEphemeral(interaction, 'Pick a regular text or announcement channel for the panel.');
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
          'I need `View Channel`, `Send Messages`, and `Embed Links` in that channel.',
        );
        return;
      }

      const panelPayload = buildModAlertRolePanel(context.guild);

      if (!panelPayload) {
        await sendEphemeral(interaction, 'No mod notification roles are configured in the blueprint yet.');
        return;
      }

      const clean = interaction.options.getBoolean('clean') ?? false;

      if (clean) {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        const botMessages = messages.filter((m) => m.author.id === context.me.id);
        if (botMessages.size > 0) {
          await targetChannel.bulkDelete(botMessages).catch(() => null);
        }
      }

      await targetChannel.send(panelPayload);
      await sendEphemeral(interaction, `Mod alert panel posted in <#${targetChannel.id}>.`);

      const availableRoles = getAvailableModAlertRoles(context.guild);
      const roleSummary = availableRoles.length > 0
        ? availableRoles.map((entry) => `\`${entry.role.name}\``).join(', ').slice(0, 1024)
        : 'none';

      await sendModLog(interaction, 'Mod alert panel posted', [
        { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true },
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
