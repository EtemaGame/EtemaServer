import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdminAccess, sendEphemeral } from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';
import {
  DEFAULT_WELCOME_TEMPLATE,
  getWelcomeConfig,
  updateWelcomeConfig,
} from '../lib/welcome-config.js';
import {
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
    .setName('bienvenida')
    .setDescription('Configura el mensaje de bienvenida para reemplazar bots externos.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('estado')
        .setDescription('Muestra la configuracion actual de bienvenida.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('activar')
        .setDescription('Activa el mensaje de bienvenida del bot.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('desactivar')
        .setDescription('Desactiva el mensaje de bienvenida del bot.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('canal')
        .setDescription('Fija el canal donde se enviara la bienvenida.')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal de texto o anuncios para la bienvenida.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('canal-auto')
        .setDescription('Vuelve al modo automatico y detecta #welcome o #bienvenida.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('mensaje')
        .setDescription('Cambia la plantilla del mensaje de bienvenida.')
        .addStringOption((option) =>
          option
            .setName('texto')
            .setDescription('Usa {user}, {server} y {memberCount}.')
            .setRequired(true)
            .setMaxLength(1500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('mensaje-reset')
        .setDescription('Restaura la plantilla por defecto.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('probar')
        .setDescription('Envia una prueba al canal de bienvenida.'),
    ),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageGuild);

    if (!context) {
      return;
    }

    const guildId = context.guild.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'estado') {
      const config = await getWelcomeConfig(guildId);
      const resolvedChannel = findWelcomeChannel(context.guild, config);
      const preview = buildWelcomeMessage(config.messageTemplate, {
        userMention: `<@${interaction.user.id}>`,
        serverName: context.guild.name,
        memberCount: context.guild.memberCount,
      });

      await sendEphemeral(
        interaction,
        [
          `Bienvenida: **${config.enabled ? 'activa' : 'desactivada'}**`,
          `Canal configurado: **${formatConfiguredChannel(context.guild, config.channelId)}**`,
          `Canal resuelto: **${resolvedChannel ? resolvedChannel.toString() : 'no encontrado'}**`,
          'Placeholders: `{user}`, `{server}`, `{memberCount}`',
          '',
          'Plantilla actual:',
          config.messageTemplate,
          '',
          'Vista previa:',
          preview,
        ].join('\n'),
      );
      return;
    }

    if (subcommand === 'activar') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.enabled = true;
        return draft;
      });

      await sendEphemeral(interaction, 'Bienvenida activada. Si TidyCord sigue activo, desactivalo para evitar duplicados.');
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'activar bienvenida', inline: true },
      ]);
      return;
    }

    if (subcommand === 'desactivar') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.enabled = false;
        return draft;
      });

      await sendEphemeral(interaction, 'Bienvenida desactivada.');
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'desactivar bienvenida', inline: true },
      ]);
      return;
    }

    if (subcommand === 'canal') {
      const channel = interaction.options.getChannel('canal', true);

      await updateWelcomeConfig(guildId, (draft) => {
        draft.channelId = channel.id;
        return draft;
      });

      await sendEphemeral(interaction, `Canal de bienvenida actualizado a ${channel.toString()}.`);
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'canal bienvenida', inline: true },
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
      ]);
      return;
    }

    if (subcommand === 'canal-auto') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.channelId = null;
        return draft;
      });

      const config = await getWelcomeConfig(guildId);
      const resolvedChannel = findWelcomeChannel(context.guild, config);

      await sendEphemeral(
        interaction,
        resolvedChannel
          ? `Modo automatico activado. Usare ${resolvedChannel.toString()} como canal de bienvenida.`
          : 'Modo automatico activado, pero no encontre un canal tipo `welcome` o `bienvenida`.',
      );
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'canal bienvenida automatico', inline: true },
      ]);
      return;
    }

    if (subcommand === 'mensaje') {
      const text = interaction.options.getString('texto', true).trim();

      await updateWelcomeConfig(guildId, (draft) => {
        draft.messageTemplate = text;
        return draft;
      });

      await sendEphemeral(interaction, 'Plantilla de bienvenida actualizada.');
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'mensaje bienvenida', inline: true },
        { name: 'Plantilla', value: text },
      ]);
      return;
    }

    if (subcommand === 'mensaje-reset') {
      await updateWelcomeConfig(guildId, (draft) => {
        draft.messageTemplate = DEFAULT_WELCOME_TEMPLATE;
        return draft;
      });

      await sendEphemeral(interaction, 'Plantilla de bienvenida restaurada al valor por defecto.');
      await sendModLog(interaction, 'Bienvenida actualizada', [
        { name: 'Cambio', value: 'reset mensaje bienvenida', inline: true },
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
          ? 'No encontre un canal de bienvenida. Usa `/bienvenida canal` o `/bienvenida canal-auto`.'
          : `No pude enviar la prueba: ${result.reason}.`,
      );
      return;
    }

    await sendEphemeral(
      interaction,
      `Prueba enviada correctamente a ${result.channel.toString()}.`,
    );
  },
};
