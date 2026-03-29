import { SlashCommandBuilder } from 'discord.js';

const formatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export const command = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Show basic information about the current server.'),
  async execute(interaction) {
    const { guild } = interaction;

    if (!guild) {
      await interaction.reply({
        content: 'This command only works inside a server.',
        ephemeral: true,
      });
      return;
    }

    const owner = await guild.fetchOwner().catch(() => null);
    const lines = [
      `Server: **${guild.name}**`,
      `ID: \`${guild.id}\``,
      `Members: **${guild.memberCount}**`,
      `Channels: **${guild.channels.cache.size}**`,
      `Roles: **${guild.roles.cache.size}**`,
      `Created: **${formatter.format(guild.createdAt)}**`,
    ];

    if (owner) {
      lines.push(`Owner: **${owner.user.tag}**`);
    }

    await interaction.reply(lines.join('\n'));
  },
};
