import {
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import {
  ensureAdminAccess,
  ensureBotPermissions,
  getAuditReason,
  getTargetManageError,
  sendEphemeral,
} from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';

const defaultPermissions = new PermissionsBitField([
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
]);

const permissionBySubcommand = {
  timeout: PermissionFlagsBits.ModerateMembers,
  'quitar-timeout': PermissionFlagsBits.ModerateMembers,
  expulsar: PermissionFlagsBits.KickMembers,
  banear: PermissionFlagsBits.BanMembers,
};

const botPermissionsBySubcommand = {
  timeout: [PermissionFlagsBits.ModerateMembers],
  'quitar-timeout': [PermissionFlagsBits.ModerateMembers],
  expulsar: [PermissionFlagsBits.KickMembers],
  banear: [PermissionFlagsBits.BanMembers],
};

export const command = {
  data: new SlashCommandBuilder()
    .setName('moderar')
    .setDescription('Acciones de moderacion sobre miembros.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(defaultPermissions.bitfield)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('timeout')
        .setDescription('Aplica timeout a un miembro.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Miembro a moderar.').setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('minutos')
            .setDescription('Duracion del timeout, entre 1 y 40320 minutos.')
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('razon').setDescription('Motivo de la accion.').setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('quitar-timeout')
        .setDescription('Quita el timeout de un miembro.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Miembro al que se le quitara el timeout.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('razon').setDescription('Motivo de la accion.').setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('expulsar')
        .setDescription('Expulsa a un miembro del servidor.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Miembro que sera expulsado.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('razon').setDescription('Motivo de la accion.').setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('banear')
        .setDescription('Banea a un miembro del servidor.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Miembro que sera baneado.')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('dias')
            .setDescription('Cuantos dias de mensajes borrar, entre 0 y 7.')
            .setMinValue(0)
            .setMaxValue(7)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('razon').setDescription('Motivo de la accion.').setRequired(false),
        ),
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const context = await ensureAdminAccess(interaction, permissionBySubcommand[subcommand]);

    if (!context) {
      return;
    }

    if (!(await ensureBotPermissions(interaction, context, botPermissionsBySubcommand[subcommand]))) {
      return;
    }

    const user = interaction.options.getUser('usuario', true);
    const targetMember = await context.guild.members.fetch(user.id).catch(() => null);

    if (!targetMember) {
      await sendEphemeral(interaction, 'No pude encontrar a ese miembro dentro del servidor.');
      return;
    }

    const actionLabel = subcommand === 'banear'
      ? 'banear'
      : subcommand === 'expulsar'
        ? 'expulsar'
        : 'moderar';
    const targetError = getTargetManageError(targetMember, context, actionLabel);

    if (targetError) {
      await sendEphemeral(interaction, targetError);
      return;
    }

    const reason = interaction.options.getString('razon')?.trim() || 'Sin razon indicada';

    if (subcommand === 'timeout') {
      const minutes = interaction.options.getInteger('minutos', true);
      await targetMember.timeout(minutes * 60_000, getAuditReason(interaction, reason));
      await sendEphemeral(interaction, `Timeout aplicado a **${targetMember.user.tag}** por **${minutes}** minuto(s).`);
      await sendModLog(interaction, 'Timeout aplicado', [
        { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
        { name: 'Duracion', value: `${minutes} minuto(s)`, inline: true },
        { name: 'Razon', value: reason },
      ]);
      return;
    }

    if (subcommand === 'quitar-timeout') {
      await targetMember.timeout(null, getAuditReason(interaction, reason));
      await sendEphemeral(interaction, `Timeout retirado de **${targetMember.user.tag}**.`);
      await sendModLog(interaction, 'Timeout retirado', [
        { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
        { name: 'Razon', value: reason },
      ]);
      return;
    }

    if (subcommand === 'expulsar') {
      await targetMember.kick(getAuditReason(interaction, reason));
      await sendEphemeral(interaction, `Miembro expulsado: **${targetMember.user.tag}**.`);
      await sendModLog(interaction, 'Miembro expulsado', [
        { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
        { name: 'Razon', value: reason },
      ]);
      return;
    }

    const days = interaction.options.getInteger('dias') ?? 0;
    await context.guild.members.ban(targetMember, {
      deleteMessageSeconds: days * 86_400,
      reason: getAuditReason(interaction, reason),
    });

    await sendEphemeral(interaction, `Miembro baneado: **${targetMember.user.tag}**.`);
    await sendModLog(interaction, 'Miembro baneado', [
      { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
      { name: 'Dias borrados', value: String(days), inline: true },
      { name: 'Razon', value: reason },
    ]);
  },
};
