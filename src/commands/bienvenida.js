import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdminAccess, sendEphemeral } from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';
import {
  DEFAULT_WELCOME_TEMPLATE,
  getWelcomeConfig,
  updateWelcomeConfig,
} from '../lib/welcome-config.js';
import {
  buildWelcomeEmbed,
  buildWelcomeMessage,
  findWelcomeChannel,
  sendWelcomeMessage,
} from '../lib/welcome.js';

function formatConfiguredChannel(guild, channelId) {
  if (!channelId) {
    return 'auto';
  }

  return guild.channels.cache.get(channelId)?.toString() ?? `\`${channelId}\` (no encontrado)`;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the welcome message to replace external bots.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show the current welcome message configuration.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enable')
        .setDescription('Enable the bot welcome message.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setDescription('Disable the bot welcome message.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel')
        .setDescription('Set the channel where the welcome message will be sent.')
        .addChannelOption((option) =>
          option
            .setName('target')
            .setDescription('Text or announcement channel for welcome.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel-auto')
        .setDescription('Switch to automatic mode and detect #welcome or #bienvenida.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('message')
        .setDescription('Change the welcome message template.')
        .addStringOption((option) =>
          option
            .setName('template')
            .setDescription('Use {user}, {server}, and {memberCount}.')
            .setRequired(true)
            .setMaxLength(1500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('message-reset')
        .setDescription('Restore the default template.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('test')
        .setDescription('Send a test message to the welcome channel.'),
    ),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageGuild);

    if (!context) {
      return;
    }

    const guildId = context.guild.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
      const config = await getWelcomeConfig(guildId);
      const resolvedChannel = findWelcomeChannel(context.guild, config);
      const content = buildWelcomeMessage(config.messageTemplate, {
        userMention: `<@${interaction.user.id}>`,
        serverName: context.guild.name,
        memberCount: context.guild.memberCount,
      });

      const embed = buildWelcomeEmbed(interaction.member, content);

      await interaction.reply({
        ephemeral: true,
        content: [
          `Welcome: **${config.enabled ? 'Enabled' : 'Disabled'}**`,
          `Configured Channel: **${formatConfiguredChannel(context.guild, config.channelId)}**`,
          `Resolved Channel: **${resolvedChannel ? resolvedChannel.toString() : 'not found'}**`,
          'Placeholders: `{user}`, `{server}`, `{memberCount}`',
          '',
          'Current Template:',
          `\`\`\`\n${config.messageTemplate}\n\`\`\``,
          '',
          'Pro Preview (Staff-only):',
        ].join('\n'),
        embeds: [embed],
      });
      return;
    }

    if (subcommand === 'enable') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.enabled = true;
        return draft;
      });

      await sendEphemeral(interaction, 'Welcome message enabled.');
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'enable welcome', inline: true },
      ]);
      return;
    }

    if (subcommand === 'disable') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.enabled = false;
        return draft;
      });

      await sendEphemeral(interaction, 'Welcome message disabled.');
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'disable welcome', inline: true },
      ]);
      return;
    }

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('target', true);

      await updateWelcomeConfig(guildId, (draft) => {
        draft.channelId = channel.id;
        return draft;
      });

      await sendEphemeral(interaction, `Welcome channel updated to ${channel.toString()}.`);
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'set welcome channel', inline: true },
        { name: 'Channel', value: `${channel} (\`${channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'channel-auto') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.channelId = null;
        return draft;
      });

      const config = await getWelcomeConfig(guildId);
      const resolvedChannel = findWelcomeChannel(context.guild, config);

      await sendEphemeral(
        interaction,
        resolvedChannel
          ? `Automatic mode enabled. I will use ${resolvedChannel.toString()} as the welcome channel.`
          : 'Automatic mode enabled, but I could not find a `welcome` or `bienvenida` channel.',
      );
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'set welcome channel to auto', inline: true },
      ]);
      return;
    }

    if (subcommand === 'message') {
      const text = interaction.options.getString('template', true).trim();

      await updateWelcomeConfig(guildId, (draft) => {
        draft.messageTemplate = text;
        return draft;
      });

      await sendEphemeral(interaction, 'Welcome message template updated.');
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'set welcome message', inline: true },
        { name: 'Template', value: text },
      ]);
      return;
    }

    if (subcommand === 'message-reset') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.messageTemplate = DEFAULT_WELCOME_TEMPLATE;
        return draft;
      });

      await sendEphemeral(interaction, 'Welcome message template restored to default.');
      await sendModLog(interaction, 'Welcome updated', [
        { name: 'Change', value: 'reset welcome message', inline: true },
      ]);
      return;
    }

    const result = await sendWelcomeMessage(context.actor, {
      ignoreEnabled: true,
      prefix: 'Welcome message test:',
    }).catch((error) => ({
      sent: false,
      reason: error.message,
    }));

    if (!result.sent) {
      await sendEphemeral(
        interaction,
        result.reason === 'channel-not-found'
          ? 'No welcome channel found. Use `/welcome channel` or `/welcome channel-auto`.'
          : `I could not send the test message: ${result.reason}.`,
      );
      return;
    }

    await sendEphemeral(
      interaction,
      `Test message sent successfully to ${result.channel.toString()}.`,
    );
  },
};
