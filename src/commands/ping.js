import { SlashCommandBuilder } from 'discord.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Comprueba si el bot esta respondiendo.'),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.reply(
      `Pong. Latencia del bot: ${latency}ms | Latencia de la API: ${apiLatency}ms`,
    );
  },
};
