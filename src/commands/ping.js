import { SlashCommandBuilder } from 'discord.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot is responding.'),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.reply(
      `Pong. Bot latency: ${latency}ms | API latency: ${apiLatency}ms`,
    );
  },
};
