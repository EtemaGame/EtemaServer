import { PermissionFlagsBits } from 'discord.js';

const permissionNames = new Map([
  [PermissionFlagsBits.Administrator, 'Administrator'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  [PermissionFlagsBits.ModerateMembers, 'Moderate Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.ViewAuditLog, 'View Audit Log'],
  [PermissionFlagsBits.ManageGuild, 'Manage Server'],
]);

export async function sendEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

export function getConfiguredOwnerId() {
  return process.env.BOT_OWNER_ID?.trim() || null;
}

export function hasOwnerOverride(interaction) {
  const ownerId = getConfiguredOwnerId();
  return Boolean(ownerId && interaction.user.id === ownerId);
}

export function formatPermissionName(permission) {
  return permissionNames.get(permission) ?? `Permission ${permission.toString()}`;
}

export function formatPermissionList(permissions) {
  return permissions.map((permission) => `\`${formatPermissionName(permission)}\``).join(', ');
}

export function getAuditReason(interaction, action) {
  return `${interaction.user.tag} (${interaction.user.id}) via /${interaction.commandName}: ${action}`.slice(
    0,
    512,
  );
}

export function normalizeChannelName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export function parseHexColor(value) {
  const normalized = value.trim().replace(/^#/, '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('El color debe estar en formato HEX, por ejemplo `#ff8800`.');
  }

  return `#${normalized.toUpperCase()}`;
}

export function overwriteValueFromAction(action) {
  if (action === 'limpiar') {
    return null;
  }

  return action === 'permitir';
}

export async function getGuildContext(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await sendEphemeral(interaction, 'This command only works inside a server.');
    return null;
  }

  const actor = await interaction.guild.members.fetch(interaction.user.id);
  const me = interaction.guild.members.me
    ?? (await interaction.guild.members.fetch(interaction.client.user.id));

  return {
    guild: interaction.guild,
    actor,
    me,
    ownerOverride: hasOwnerOverride(interaction),
  };
}

export async function ensureAdminAccess(interaction, requiredPermission) {
  const context = await getGuildContext(interaction);

  if (!context) {
    return null;
  }

  if (!context.ownerOverride && !context.actor.permissions.has(requiredPermission)) {
    await sendEphemeral(
      interaction,
      `Necesitas el permiso ${formatPermissionName(requiredPermission)} para usar este comando.`,
    );
    return null;
  }

  return context;
}

export async function ensureBotPermissions(interaction, context, permissions) {
  const missing = permissions.filter((permission) => !context.me.permissions.has(permission));

  if (missing.length === 0) {
    return true;
  }

  await sendEphemeral(
    interaction,
    `The bot is missing these permissions: ${formatPermissionList(missing)}.`,
  );
  return false;
}

export function getRoleEditError(role, context) {
  if (role.id === context.guild.id) {
    return 'No puedo editar el rol `@everyone` con este comando.';
  }

  if (role.managed) {
    return 'Ese rol esta gestionado por Discord o por otra integracion y no se puede modificar aqui.';
  }

  if (
    !context.ownerOverride
    && context.actor.id !== context.guild.ownerId
    && role.comparePositionTo(context.actor.roles.highest) >= 0
  ) {
    return 'Ese rol esta al mismo nivel o por encima de tu rol mas alto.';
  }

  if (role.comparePositionTo(context.me.roles.highest) >= 0) {
    return 'Ese rol esta al mismo nivel o por encima del rol mas alto del bot.';
  }

  return null;
}

export function getTargetManageError(targetMember, context, action) {
  if (targetMember.id === context.me.id) {
    return `No voy a ${action} al propio bot.`;
  }

  if (targetMember.id === context.guild.ownerId) {
    return `No puedo ${action} al owner del servidor.`;
  }

  if (
    !context.ownerOverride
    && context.actor.id !== context.guild.ownerId
    && targetMember.roles.highest.comparePositionTo(context.actor.roles.highest) >= 0
  ) {
    return `Ese miembro esta al mismo nivel o por encima de tu rol mas alto, asi que no deberia ${action}.`;
  }

  if (targetMember.roles.highest.comparePositionTo(context.me.roles.highest) >= 0) {
    return `Ese miembro esta al mismo nivel o por encima del rol mas alto del bot, asi que no puedo ${action}.`;
  }

  return null;
}
