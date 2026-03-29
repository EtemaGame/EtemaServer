import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  ensureAdminAccess,
  ensureBotPermissions,
  getAuditReason,
  getRoleEditError,
  getTargetManageError,
  parseHexColor,
  sendEphemeral,
} from '../lib/admin.js';
import { sendModLog } from '../lib/logging.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('rol')
    .setDescription('Gestiona roles del servidor.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('crear')
        .setDescription('Crea un rol nuevo.')
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nombre del nuevo rol.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('color')
            .setDescription('Color HEX, por ejemplo #ff8800.')
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('visible')
            .setDescription('Si el rol se muestra separado en la lista de miembros.')
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('mencionable')
            .setDescription('Si el rol se puede mencionar.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dar')
        .setDescription('Asigna un rol a un miembro.')
        .addUserOption((option) =>
          option.setName('usuario').setDescription('Miembro que recibira el rol.').setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol que quieres asignar.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('quitar')
        .setDescription('Quita un rol a un miembro.')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Miembro al que se le quitara el rol.')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol que quieres quitar.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('renombrar')
        .setDescription('Cambia el nombre de un rol.')
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol que quieres renombrar.').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('nombre').setDescription('Nuevo nombre del rol.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('color')
        .setDescription('Cambia el color de un rol.')
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol que quieres editar.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('color')
            .setDescription('Color HEX, por ejemplo #00b0f4.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('eliminar')
        .setDescription('Elimina un rol del servidor.')
        .addRoleOption((option) =>
          option.setName('rol').setDescription('Rol que quieres eliminar.').setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('confirmar')
            .setDescription('Debes marcarlo en true para confirmar.')
            .setRequired(true),
        ),
    ),
  async execute(interaction) {
    const context = await ensureAdminAccess(interaction, PermissionFlagsBits.ManageRoles);

    if (!context) {
      return;
    }

    if (!(await ensureBotPermissions(interaction, context, [PermissionFlagsBits.ManageRoles]))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'crear') {
      try {
        const role = await context.guild.roles.create({
          name: interaction.options.getString('nombre', true).trim(),
          color: interaction.options.getString('color')
            ? parseHexColor(interaction.options.getString('color', true))
            : undefined,
          hoist: interaction.options.getBoolean('visible') ?? false,
          mentionable: interaction.options.getBoolean('mencionable') ?? false,
          reason: getAuditReason(interaction, 'crear rol'),
        });

        await sendEphemeral(interaction, `Rol creado correctamente: **${role.name}** (\`${role.id}\`).`);
        await sendModLog(interaction, 'Rol creado', [
          { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
          { name: 'Visible', value: role.hoist ? 'si' : 'no', inline: true },
          { name: 'Mencionable', value: role.mentionable ? 'si' : 'no', inline: true },
        ]);
      } catch (error) {
        await sendEphemeral(interaction, error.message);
      }
      return;
    }

    const role = interaction.options.getRole('rol', true);
    const roleError = getRoleEditError(role, context);

    if (roleError) {
      await sendEphemeral(interaction, roleError);
      return;
    }

    if (subcommand === 'renombrar') {
      const newName = interaction.options.getString('nombre', true).trim();
      await role.edit({
        name: newName,
        reason: getAuditReason(interaction, `renombrar rol a ${newName}`),
      });

      await sendEphemeral(interaction, `Rol actualizado. Nuevo nombre: **${newName}**.`);
      await sendModLog(interaction, 'Rol renombrado', [
        { name: 'Rol', value: `\`${role.id}\``, inline: true },
        { name: 'Nuevo nombre', value: newName, inline: true },
      ]);
      return;
    }

    if (subcommand === 'color') {
      try {
        const newColor = parseHexColor(interaction.options.getString('color', true));
        await role.edit({
          color: newColor,
          reason: getAuditReason(interaction, `cambiar color del rol a ${newColor}`),
        });

        await sendEphemeral(interaction, `Color del rol **${role.name}** cambiado a \`${newColor}\`.`);
        await sendModLog(interaction, 'Color de rol actualizado', [
          { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
          { name: 'Color', value: newColor, inline: true },
        ]);
      } catch (error) {
        await sendEphemeral(interaction, error.message);
      }
      return;
    }

    if (subcommand === 'eliminar') {
      const confirm = interaction.options.getBoolean('confirmar', true);

      if (!confirm) {
        await sendEphemeral(interaction, 'Para eliminar un rol debes usar `confirmar: true`.');
        return;
      }

      const roleName = role.name;
      await role.delete(getAuditReason(interaction, `eliminar rol ${roleName}`));
      await sendEphemeral(interaction, `Rol eliminado: **${roleName}**.`);
      await sendModLog(interaction, 'Rol eliminado', [
        { name: 'Rol', value: `${roleName} (\`${role.id}\`)` },
      ]);
      return;
    }

    const user = interaction.options.getUser('usuario', true);
    const targetMember = await context.guild.members.fetch(user.id).catch(() => null);

    if (!targetMember) {
      await sendEphemeral(interaction, 'No pude encontrar a ese miembro dentro del servidor.');
      return;
    }

    const targetError = getTargetManageError(targetMember, context, 'administrar sus roles');

    if (targetError) {
      await sendEphemeral(interaction, targetError);
      return;
    }

    if (subcommand === 'dar') {
      if (targetMember.roles.cache.has(role.id)) {
        await sendEphemeral(interaction, `**${targetMember.user.tag}** ya tiene el rol **${role.name}**.`);
        return;
      }

      await targetMember.roles.add(role, getAuditReason(interaction, `dar rol ${role.name}`));
      await sendEphemeral(interaction, `Rol **${role.name}** asignado a **${targetMember.user.tag}**.`);
      await sendModLog(interaction, 'Rol asignado', [
        { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
        { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
      ]);
      return;
    }

    if (!targetMember.roles.cache.has(role.id)) {
      await sendEphemeral(interaction, `**${targetMember.user.tag}** no tiene el rol **${role.name}**.`);
      return;
    }

    await targetMember.roles.remove(role, getAuditReason(interaction, `quitar rol ${role.name}`));
    await sendEphemeral(interaction, `Rol **${role.name}** retirado de **${targetMember.user.tag}**.`);
    await sendModLog(interaction, 'Rol retirado', [
      { name: 'Miembro', value: `${targetMember.user.tag}\n<@${targetMember.id}>`, inline: true },
      { name: 'Rol', value: `${role.name} (\`${role.id}\`)`, inline: true },
    ]);
  },
};
