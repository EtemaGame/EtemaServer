import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { sendModLog } from '../lib/logging.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('limpiar')
    .setDescription('Elimina mensajes recientes del canal actual.')
    .addIntegerOption((option) =>
      option
        .setName('cantidad')
        .setDescription('Cantidad de mensajes a eliminar, entre 1 y 100.')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  async execute(interaction) {
    const channel = interaction.channel;
    const cantidad = interaction.options.getInteger('cantidad', true);

    if (!channel || !channel.isTextBased() || !('bulkDelete' in channel)) {
      await interaction.reply({
        content: 'Este canal no permite eliminar mensajes en bloque.',
        ephemeral: true,
      });
      return;
    }

    try {
      const deletedMessages = await channel.bulkDelete(cantidad, true);

      await interaction.reply({
        content: `Se eliminaron ${deletedMessages.size} mensajes recientes.`,
        ephemeral: true,
      });
      await sendModLog(interaction, 'Mensajes eliminados', [
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
        { name: 'Cantidad solicitada', value: String(cantidad), inline: true },
        { name: 'Cantidad eliminada', value: String(deletedMessages.size), inline: true },
      ]);
    } catch (error) {
      console.error('[limpiar]', error);
      await interaction.reply({
        content:
          'No pude eliminar los mensajes. Revisa que el bot tenga permisos y que los mensajes no sean demasiado antiguos.',
        ephemeral: true,
      });
    }
  },
};
