import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdminAccess, sendEphemeral } from '../lib/admin.js';
import {
  getAutomodConfig,
  summarizeAutomodConfig,
  updateAutomodConfig,
} from '../lib/automod-config.js';
import { clearAutomodStrikes, getAutomodStrikes } from '../lib/automod-state.js';
import { sendModLog } from '../lib/logging.js';

function uniqueTrimmedWords(words) {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function parseEscalationDurations(input) {
  const tokens = String(input ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error('Debes indicar al menos un numero, por ejemplo `1,5,15,60`.');
  }

  const values = [];

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      throw new Error(`\`${token}\` no es un numero valido.`);
    }

    const minutes = Number(token);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320) {
      throw new Error(`\`${token}\` debe estar entre 1 y 40320 minutos.`);
    }

    if (!values.includes(minutes)) {
      values.push(minutes);
    }
  }

  return values;
}

function formatMentionList(ids, collection, emptyLabel = 'ninguno') {
  if (!ids.length) {
    return emptyLabel;
  }

  return ids
    .map((id) => collection.get(id))
    .filter(Boolean)
    .map((entity) => entity.toString())
    .join(', ') || emptyLabel;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configura la moderacion automatica del servidor.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('estado')
        .setDescription('Muestra la configuracion actual del automod.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('palabra-agregar')
        .setDescription('Agrega una palabra o frase bloqueada.')
        .addStringOption((option) =>
          option.setName('texto').setDescription('Palabra o frase a bloquear.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('palabra-quitar')
        .setDescription('Quita una palabra o frase bloqueada.')
        .addStringOption((option) =>
          option.setName('texto').setDescription('Palabra o frase a quitar.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('links')
        .setDescription('Configura como se manejan los links.')
        .addStringOption((option) =>
          option
            .setName('modo')
            .setDescription('Comportamiento para los links.')
            .setRequired(true)
            .addChoices(
              { name: 'Permitir', value: 'allow' },
              { name: 'Solo staff', value: 'staff' },
              { name: 'Bloquear', value: 'block' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('flood')
        .setDescription('Configura la deteccion de flood o spam repetido.')
        .addBooleanOption((option) =>
          option.setName('activo').setDescription('Activa o desactiva el flood guard.').setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_mensajes')
            .setDescription('Mensajes permitidos dentro de la ventana.')
            .setMinValue(3)
            .setMaxValue(20)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('ventana_segundos')
            .setDescription('Tamano de la ventana para contar mensajes.')
            .setMinValue(3)
            .setMaxValue(60)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('duplicados')
            .setDescription('Cantidad de repeticiones iguales para disparar spam repetido.')
            .setMinValue(2)
            .setMaxValue(10)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Accion principal cuando salta el flood guard.')
            .setRequired(false)
            .addChoices(
              { name: 'Solo log', value: 'log' },
              { name: 'Borrar', value: 'delete' },
              { name: 'Timeout', value: 'timeout' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('timeout_minutos')
            .setDescription('Duracion del timeout si usas esa accion.')
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('join-guard')
        .setDescription('Configura la deteccion de cuentas nuevas al entrar.')
        .addBooleanOption((option) =>
          option.setName('activo').setDescription('Activa o desactiva el join guard.').setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('horas_minimas')
            .setDescription('Edad minima de la cuenta para no marcarla.')
            .setMinValue(1)
            .setMaxValue(720)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Accion para cuentas demasiado nuevas.')
            .setRequired(false)
            .addChoices(
              { name: 'Solo log', value: 'log' },
              { name: 'Timeout', value: 'timeout' },
              { name: 'Expulsar', value: 'kick' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('timeout_minutos')
            .setDescription('Duracion del timeout si usas esa accion.')
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('escalado')
        .setDescription('Configura el timeout progresivo del automod.')
        .addBooleanOption((option) =>
          option.setName('activo').setDescription('Activa o desactiva la escalada.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('duraciones')
            .setDescription('Lista de minutos separada por comas. Ejemplo: 1,5,15,60')
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('reset_horas')
            .setDescription('Tras cuantas horas sin faltas se reinicia la escala.')
            .setMinValue(1)
            .setMaxValue(2160)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('limpiar-faltas')
        .setDescription('Resetea las reincidencias de automod para un usuario.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Usuario al que se le limpiara el historial de faltas.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ver-faltas')
        .setDescription('Muestra las reincidencias activas de automod para un usuario.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Usuario que quieres revisar.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ignorar-canal')
        .setDescription('Agrega o quita un canal de la lista ignorada.')
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Que hacer con el canal.')
            .setRequired(true)
            .addChoices(
              { name: 'Agregar', value: 'add' },
              { name: 'Quitar', value: 'remove' },
            ),
        )
        .addChannelOption((option) =>
          option.setName('canal').setDescription('Canal a ignorar o reactivar.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ignorar-rol')
        .setDescription('Agrega o quita un rol de la lista ignorada.')
        .addStringOption((option) =>
          option
            .setName('accion')
            .setDescription('Que hacer con el rol.')
            .setRequired(true)
            .addChoices(
              { name: 'Agregar', value: 'add' },
              { name: 'Quitar', value: 'remove' },
            ),
        )
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol a ignorar o reactivar.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageGuild);

    if (!context) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = context.guild.id;

    if (subcommand === 'estado') {
      const config = await getAutomodConfig(guildId);
      const lines = [
        summarizeAutomodConfig(config),
        `Palabras: ${config.blockedWords.length ? config.blockedWords.map((word) => `\`${word}\``).join(', ') : 'ninguna'}`,
        `Escalado timeout: ${config.escalation.enabled ? `activo (${config.escalation.timeoutMinutes.join(' -> ')} min, reinicio ${config.escalation.resetHours}h)` : 'desactivado'}`,
        `Canales ignorados: ${formatMentionList(config.ignoredChannelIds, context.guild.channels.cache)}`,
        `Roles ignorados: ${formatMentionList(config.ignoredRoleIds, context.guild.roles.cache)}`,
      ];

      await sendEphemeral(interaction, lines.join('\n'));
      return;
    }

    if (subcommand === 'palabra-agregar') {
      const text = interaction.options.getString('texto', true);
      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.blockedWords = uniqueTrimmedWords([...draft.blockedWords, text]);
        return draft;
      });

      await sendEphemeral(interaction, `Palabra o frase agregada. Total actual: **${config.blockedWords.length}**.`);
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'palabra agregada', inline: true },
        { name: 'Texto', value: text },
      ]);
      return;
    }

    if (subcommand === 'palabra-quitar') {
      const text = interaction.options.getString('texto', true);
      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.blockedWords = draft.blockedWords.filter(
          (word) => word.toLowerCase() !== text.trim().toLowerCase(),
        );
        return draft;
      });

      await sendEphemeral(interaction, `Palabra o frase quitada. Total actual: **${config.blockedWords.length}**.`);
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'palabra quitada', inline: true },
        { name: 'Texto', value: text },
      ]);
      return;
    }

    if (subcommand === 'links') {
      const mode = interaction.options.getString('modo', true);
      await updateAutomodConfig(guildId, (draft) => {
        draft.links.mode = mode;
        return draft;
      });

      await sendEphemeral(interaction, `Modo de links actualizado a **${mode}**.`);
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'links', inline: true },
        { name: 'Modo', value: mode, inline: true },
      ]);
      return;
    }

    if (subcommand === 'flood') {
      const enabled = interaction.options.getBoolean('activo', true);
      const maxMessages = interaction.options.getInteger('max_mensajes');
      const windowSeconds = interaction.options.getInteger('ventana_segundos');
      const duplicateMessages = interaction.options.getInteger('duplicados');
      const action = interaction.options.getString('accion');
      const timeoutMinutes = interaction.options.getInteger('timeout_minutos');

      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.flood.enabled = enabled;

        if (maxMessages !== null) {
          draft.flood.maxMessages = maxMessages;
        }

        if (windowSeconds !== null) {
          draft.flood.windowSeconds = windowSeconds;
        }

        if (duplicateMessages !== null) {
          draft.flood.duplicateMessages = duplicateMessages;
        }

        if (action) {
          draft.flood.action = action;
        }

        if (timeoutMinutes !== null) {
          draft.flood.timeoutMinutes = timeoutMinutes;
        }

        return draft;
      });

      await sendEphemeral(
        interaction,
        [
          `Flood guard: **${config.flood.enabled ? 'activo' : 'desactivado'}**`,
          `Mensajes: **${config.flood.maxMessages}** en **${config.flood.windowSeconds}s**`,
          `Duplicados: **${config.flood.duplicateMessages}**`,
          `Accion: **${config.flood.action}**`,
          `Timeout: **${config.flood.timeoutMinutes}m**`,
        ].join('\n'),
      );
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'flood guard' },
        { name: 'Estado', value: config.flood.enabled ? 'activo' : 'desactivado', inline: true },
        { name: 'Accion', value: config.flood.action, inline: true },
      ]);
      return;
    }

    if (subcommand === 'join-guard') {
      const enabled = interaction.options.getBoolean('activo', true);
      const minAccountAgeHours = interaction.options.getInteger('horas_minimas');
      const action = interaction.options.getString('accion');
      const timeoutMinutes = interaction.options.getInteger('timeout_minutos');

      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.joinGuard.enabled = enabled;

        if (minAccountAgeHours !== null) {
          draft.joinGuard.minAccountAgeHours = minAccountAgeHours;
        }

        if (action) {
          draft.joinGuard.action = action;
        }

        if (timeoutMinutes !== null) {
          draft.joinGuard.timeoutMinutes = timeoutMinutes;
        }

        return draft;
      });

      await sendEphemeral(
        interaction,
        [
          `Join guard: **${config.joinGuard.enabled ? 'activo' : 'desactivado'}**`,
          `Edad minima: **${config.joinGuard.minAccountAgeHours}h**`,
          `Accion: **${config.joinGuard.action}**`,
          `Timeout: **${config.joinGuard.timeoutMinutes}m**`,
        ].join('\n'),
      );
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'join guard' },
        { name: 'Estado', value: config.joinGuard.enabled ? 'activo' : 'desactivado', inline: true },
        { name: 'Accion', value: config.joinGuard.action, inline: true },
      ]);
      return;
    }

    if (subcommand === 'escalado') {
      const enabled = interaction.options.getBoolean('activo', true);
      const durationsInput = interaction.options.getString('duraciones');
      const resetHours = interaction.options.getInteger('reset_horas');

      let parsedDurations = null;

      if (durationsInput) {
        try {
          parsedDurations = parseEscalationDurations(durationsInput);
        } catch (error) {
          await sendEphemeral(interaction, error.message);
          return;
        }
      }

      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.escalation.enabled = enabled;

        if (parsedDurations) {
          draft.escalation.timeoutMinutes = parsedDurations;
        }

        if (resetHours !== null) {
          draft.escalation.resetHours = resetHours;
        }

        return draft;
      });

      await sendEphemeral(
        interaction,
        [
          `Escalado: **${config.escalation.enabled ? 'activo' : 'desactivado'}**`,
          `Duraciones: **${config.escalation.timeoutMinutes.join(' -> ')}** minuto(s)`,
          `Reinicio: **${config.escalation.resetHours}h**`,
        ].join('\n'),
      );
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'escalado timeout' },
        { name: 'Estado', value: config.escalation.enabled ? 'activo' : 'desactivado', inline: true },
        { name: 'Duraciones', value: config.escalation.timeoutMinutes.join(' -> '), inline: true },
        { name: 'Reinicio', value: `${config.escalation.resetHours}h`, inline: true },
      ]);
      return;
    }

    if (subcommand === 'limpiar-faltas') {
      const user = interaction.options.getUser('usuario', true);
      const cleared = await clearAutomodStrikes(guildId, user.id);

      await sendEphemeral(
        interaction,
        cleared.clearedStrikes > 0
          ? `Historial reiniciado para **${user.tag}**. Se limpiaron **${cleared.clearedStrikes}** falta(s) en **${cleared.clearedScopes}** scope(s).`
          : `**${user.tag}** no tenia faltas registradas en el automod.`,
      );
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'limpiar faltas', inline: true },
        { name: 'Usuario', value: `${user.tag}\n<@${user.id}>`, inline: true },
        { name: 'Faltas limpiadas', value: String(cleared.clearedStrikes), inline: true },
      ]);
      return;
    }

    if (subcommand === 'ver-faltas') {
      const user = interaction.options.getUser('usuario', true);
      const config = await getAutomodConfig(guildId);
      const summary = await getAutomodStrikes(guildId, user.id, config.escalation.resetHours);

      if (summary.total === 0) {
        await sendEphemeral(
          interaction,
          `**${user.tag}** no tiene faltas registradas en el automod.`,
        );
        return;
      }

      const lines = [
        `Usuario: **${user.tag}**`,
        `Faltas activas: **${summary.active}**`,
        `Faltas totales guardadas: **${summary.total}**`,
        `Ventana de reinicio: **${summary.resetHours}h**`,
      ];

      if (summary.lastAt) {
        lines.push(`Ultima falta: <t:${Math.floor(new Date(summary.lastAt).getTime() / 1000)}:R>`);
      }

      lines.push('');
      lines.push('Scopes:');

      for (const scope of summary.scopes) {
        lines.push(`- \`${scope.scope}\`: activas **${scope.active}**, totales **${scope.total}**`);
      }

      await sendEphemeral(interaction, lines.join('\n'));
      return;
    }

    if (subcommand === 'ignorar-canal') {
      const action = interaction.options.getString('accion', true);
      const channel = interaction.options.getChannel('canal', true);

      const config = await updateAutomodConfig(guildId, (draft) => {
        draft.ignoredChannelIds = action === 'add'
          ? [...new Set([...draft.ignoredChannelIds, channel.id])]
          : draft.ignoredChannelIds.filter((id) => id !== channel.id);
        return draft;
      });

      await sendEphemeral(
        interaction,
        `Canal ${action === 'add' ? 'agregado a' : 'quitado de'} ignorados. Total: **${config.ignoredChannelIds.length}**.`,
      );
      await sendModLog(interaction, 'Automod actualizado', [
        { name: 'Cambio', value: 'ignorar canal', inline: true },
        { name: 'Accion', value: action, inline: true },
        { name: 'Canal', value: `${channel} (\`${channel.id}\`)` },
      ]);
      return;
    }

    const action = interaction.options.getString('accion', true);
    const role = interaction.options.getRole('rol', true);

    const config = await updateAutomodConfig(guildId, (draft) => {
      draft.ignoredRoleIds = action === 'add'
        ? [...new Set([...draft.ignoredRoleIds, role.id])]
        : draft.ignoredRoleIds.filter((id) => id !== role.id);
      return draft;
    });

    await sendEphemeral(
      interaction,
      `Rol ${action === 'add' ? 'agregado a' : 'quitado de'} ignorados. Total: **${config.ignoredRoleIds.length}**.`,
    );
    await sendModLog(interaction, 'Automod actualizado', [
      { name: 'Cambio', value: 'ignorar rol', inline: true },
      { name: 'Accion', value: action, inline: true },
      { name: 'Rol', value: `${role.name} (\`${role.id}\`)` },
    ]);
  },
};
