import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  ensureAdminAccess,
  formatPermissionList,
  getConfiguredOwnerId,
  sendEphemeral,
} from '../lib/admin.js';

const importantPermissions = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ViewAuditLog,
];

export const command = {
  data: new SlashCommandBuilder()
    .setName('diagnostico')
    .setDescription('Muestra si al bot le falta algo para administrar el servidor.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageGuild);

    if (!context) {
      return;
    }

    const missing = importantPermissions.filter(
      (permission) => !context.me.permissions.has(permission),
    );

    const lines = [
      `Bot: **${context.me.user.tag}**`,
      `Servidor: **${context.guild.name}**`,
      `Rol mas alto del bot: **${context.me.roles.highest.name}**`,
      `BOT_OWNER_ID (override): **${getConfiguredOwnerId() ?? 'no configurado'}**`,
    ];

    if (missing.length === 0) {
      lines.push('Permisos importantes: **OK**');
    } else {
      lines.push(`Permisos faltantes: ${formatPermissionList(missing)}`);
    }

    await sendEphemeral(interaction, lines.join('\n'));
  },
};
