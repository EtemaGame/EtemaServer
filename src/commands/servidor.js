import { SlashCommandBuilder } from 'discord.js';

const formatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export const command = {
  data: new SlashCommandBuilder()
    .setName('servidor')
    .setDescription('Muestra informacion basica del servidor actual.'),
  async execute(interaction) {
    const { guild } = interaction;

    if (!guild) {
      await interaction.reply({
        content: 'Este comando solo funciona dentro de un servidor.',
        ephemeral: true,
      });
      return;
    }

    const owner = await guild.fetchOwner().catch(() => null);
    const lines = [
      `Servidor: **${guild.name}**`,
      `ID: \`${guild.id}\``,
      `Miembros: **${guild.memberCount}**`,
      `Canales: **${guild.channels.cache.size}**`,
      `Roles: **${guild.roles.cache.size}**`,
      `Creado: **${formatter.format(guild.createdAt)}**`,
    ];

    if (owner) {
      lines.push(`Owner: **${owner.user.tag}**`);
    }

    await interaction.reply(lines.join('\n'));
  },
};
