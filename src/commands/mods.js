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

      const panelPayload = buildModAlertRolePanel(context.guild);

      if (!panelPayload) {
        await sendEphemeral(interaction, 'No mod alert roles are configured yet, so there is no panel to post.');
        return;
      }

      await targetChannel.send(panelPayload);
      await sendEphemeral(interaction, `Posted the mod alerts panel in <#${targetChannel.id}>.`);

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
