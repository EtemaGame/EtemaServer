import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { ensureBotPermissions, getAuditReason, getGuildContext, sendEphemeral } from './admin.js';

const MOD_ALERT_ROLE_SELECT_ID = 'mods:toggle-alert-roles';

function normalizeRoleKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function formatRoleLabel(value) {
  const label = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return label
    .split(' ')
    .map((part) => (part === 'Dps' ? 'DPS' : part))
    .join(' ');
}

function truncate(value, maxLength) {
  const text = String(value ?? '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function slugifyChannelName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function getProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function loadCatalogFromBlueprint() {
  try {
    const blueprintPath = path.join(getProjectRoot(), 'server-blueprint.json');
    const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8'));
    const roleNames = Array.isArray(blueprint?.roles?.modRoles) ? blueprint.roles.modRoles : [];
    const channels = Array.isArray(blueprint?.categories)
      ? blueprint.categories.flatMap((category) => category?.channels ?? [])
      : [];

    return roleNames
      .filter((roleName) => typeof roleName === 'string' && roleName.trim())
      .map((roleName) => {
        const linkedTextChannel = channels.find(
          (channel) => channel?.role === roleName && channel?.type === 'text',
        );
        const linkedTutorialForum = channels.find(
          (channel) => channel?.role === roleName && channel?.type === 'forum',
        );
        const linkedChannelSlug = linkedTextChannel?.name
          ? slugifyChannelName(linkedTextChannel.name)
          : null;
        const label = formatRoleLabel(roleName) || roleName;
        const description = linkedChannelSlug
          ? `Recibe avisos de #${linkedChannelSlug}`
          : `Recibe avisos de ${label}`;

        return {
          roleName,
          key: normalizeRoleKey(roleName),
          label,
          description: truncate(description, 100),
          discussionChannelSlug: linkedChannelSlug,
          tutorialForumSlug: linkedTutorialForum?.name
            ? slugifyChannelName(linkedTutorialForum.name)
            : null,
        };
      });
  } catch (error) {
    console.warn(`[mods] No pude cargar server-blueprint.json: ${error.message}`);
    return [];
  }
}

export const modAlertRoleCatalog = loadCatalogFromBlueprint();
export const modAlertRoleChoices = modAlertRoleCatalog.map((entry) => ({
  name: entry.label,
  value: entry.roleName,
}));

function getSelfRoleContextError(context) {
  if (!context.guild || !context.actor || !context.me) {
    return 'This action only works inside a server.';
  }

  if (context.actor.id === context.guild.ownerId) {
    return 'Discord does not let the bot edit the server owner roles.';
  }

  if (context.actor.roles.highest.comparePositionTo(context.me.roles.highest) >= 0) {
    return 'Your highest role is above or equal to the bot highest role, so I cannot update your roles.';
  }

  return null;
}

function getRoleUpdateError(role, context) {
  if (!role) {
    return 'That role is not available right now.';
  }

  if (role.managed) {
    return 'That role is managed by another integration and cannot be self-assigned here.';
  }

  if (role.comparePositionTo(context.me.roles.highest) >= 0) {
    return 'Ese rol está por encima o igual al del bot, no puedo asignarlo.';
  }

  return null;
}

function buildGuildRoleIndex(guild) {
  const roleIndex = new Map();

  for (const role of guild.roles.cache.values()) {
    roleIndex.set(normalizeRoleKey(role.name), role);
  }

  return roleIndex;
}

function findChannelBySlug(guild, slug, allowedTypes) {
  if (!slug) {
    return null;
  }

  return guild.channels.cache.find((channel) => {
    if (allowedTypes && !allowedTypes.includes(channel.type)) {
      return false;
    }

    return slugifyChannelName(channel.name) === slug;
  }) ?? null;
}

function formatLinkedTarget(channel, fallbackSlug, label) {
  if (channel) {
    return `${label}: <#${channel.id}>`;
  }

  if (fallbackSlug) {
    return `${label}: #${fallbackSlug}`;
  }

  return null;
}

function formatRoleDestinations(entry) {
  return [
    formatLinkedTarget(entry.discussionChannel, entry.discussionChannelSlug, 'chat'),
    formatLinkedTarget(entry.tutorialForum, entry.tutorialForumSlug, 'tutorial'),
  ]
    .filter(Boolean)
    .join(' | ');
}

export function getAvailableModAlertRoles(guild) {
  if (!guild) {
    return [];
  }

  const roleIndex = buildGuildRoleIndex(guild);

  return modAlertRoleCatalog
    .map((entry) => {
      const role = roleIndex.get(entry.key) ?? null;

      if (!role) {
        return null;
      }

      return {
        ...entry,
        role,
        discussionChannel: findChannelBySlug(guild, entry.discussionChannelSlug, [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
        ]),
        tutorialForum: findChannelBySlug(guild, entry.tutorialForumSlug, [ChannelType.GuildForum]),
      };
    })
    .filter(Boolean);
}

export function findAvailableModAlertRole(guild, roleName) {
  const targetKey = normalizeRoleKey(roleName);

  return getAvailableModAlertRoles(guild).find((entry) => entry.key === targetKey) ?? null;
}

export function buildModAlertRolePanel(guild) {
  const availableRoles = getAvailableModAlertRoles(guild);

  if (availableRoles.length === 0) {
    return null;
  }

  const descriptionLines = [
    'Usa el menú de abajo para activar o desactivar los roles de aviso de los mods que te interesen.',
    'Si seleccionas un rol que ya tienes, se te quitará. Si seleccionas uno nuevo, se te asignará.',
    '',
    ...availableRoles.map((entry) => {
      const destinations = formatRoleDestinations(entry);
      return destinations ? `🔹 **${entry.label}**: ${destinations}` : `🔹 **${entry.label}**`;
    }),
    '',
    'También puedes usar `/mods list`, `/mods join` y `/mods leave`.',
  ];

  const embed = new EmbedBuilder()
    .setColor(0x00a2ed)
    .setTitle('🔔 Suscripción a Mods')
    .setDescription(descriptionLines.join('\n'))
    .setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(MOD_ALERT_ROLE_SELECT_ID)
    .setPlaceholder('Selecciona uno o varios mods para seguir/dejar de seguir')
    .setMinValues(1)
    .setMaxValues(Math.min(availableRoles.length, 25))
    .addOptions(
      availableRoles.map((entry) => ({
        label: entry.label,
        value: entry.roleName,
        description: entry.description,
      })),
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(selectMenu)],
    allowedMentions: { parse: [] },
  };
}

function buildRoleListMessage(availableRoles, member) {
  if (availableRoles.length === 0) {
    return 'No self-assignable mod alert roles are configured in this server yet.';
  }

  const memberRoleIds = new Set(member.roles.cache.keys());
  const subscribed = availableRoles.filter((entry) => memberRoleIds.has(entry.role.id));
  const availableLines = availableRoles.map((entry) => {
    const marker = memberRoleIds.has(entry.role.id) ? '[x]' : '[ ]';
    const destinations = formatRoleDestinations(entry);
    return destinations
      ? `${marker} ${entry.label} (\`${entry.role.name}\`) -> ${destinations}`
      : `${marker} ${entry.label} (\`${entry.role.name}\`)`;
  });
  const subscribedSummary = subscribed.length > 0
    ? subscribed.map((entry) => `\`${entry.role.name}\``).join(', ')
    : 'none';

  return [
    '**Available mod alert roles**',
    ...availableLines,
    '',
    `**Your current subscriptions:** ${subscribedSummary}`,
    'Use `/mods join` or `/mods leave`, or use the self-assign panel if staff posted one.',
  ].join('\n');
}

function buildToggleSummary({ added, removed, blocked, failed, unavailable }) {
  const lines = [];

  if (added.length > 0) {
    lines.push(`Added: ${added.map((name) => `\`${name}\``).join(', ')}`);
  }

  if (removed.length > 0) {
    lines.push(`Removed: ${removed.map((name) => `\`${name}\``).join(', ')}`);
  }

  if (blocked.length > 0) {
    lines.push(...blocked.map((item) => `Blocked ${item.role}: ${item.reason}`));
  }

  if (failed.length > 0) {
    lines.push(...failed.map((item) => `Failed ${item.role}: ${item.reason}`));
  }

  if (unavailable.length > 0) {
    lines.push(`Unavailable: ${unavailable.map((name) => `\`${name}\``).join(', ')}`);
  }

  if (lines.length === 0) {
    return 'No role changes were applied.';
  }

  return lines.join('\n');
}

export async function sendModAlertRoleList(interaction, context) {
  const availableRoles = getAvailableModAlertRoles(context.guild);

  await interaction.reply({
    content: buildRoleListMessage(availableRoles, context.actor),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

export async function addModAlertRole(interaction, context, roleName) {
  const availableRole = findAvailableModAlertRole(context.guild, roleName);
  const memberError = getSelfRoleContextError(context);

  if (memberError) {
    await sendEphemeral(interaction, memberError);
    return;
  }

  if (!availableRole) {
    await sendEphemeral(interaction, 'That mod alert role is not available in this server.');
    return;
  }

  const roleError = getRoleUpdateError(availableRole.role, context);

  if (roleError) {
    await sendEphemeral(interaction, roleError);
    return;
  }

  if (context.actor.roles.cache.has(availableRole.role.id)) {
    await sendEphemeral(interaction, `You already have \`${availableRole.role.name}\`.`);
    return;
  }

  await context.actor.roles.add(
    availableRole.role,
    getAuditReason(interaction, `self-assign mod alert role ${availableRole.role.name}`),
  );

  await sendEphemeral(
    interaction,
    `Added \`${availableRole.role.name}\`. You will now receive pings for that mod.`,
  );
}

export async function removeModAlertRole(interaction, context, roleName) {
  const availableRole = findAvailableModAlertRole(context.guild, roleName);
  const memberError = getSelfRoleContextError(context);

  if (memberError) {
    await sendEphemeral(interaction, memberError);
    return;
  }

  if (!availableRole) {
    await sendEphemeral(interaction, 'That mod alert role is not available in this server.');
    return;
  }

  const roleError = getRoleUpdateError(availableRole.role, context);

  if (roleError) {
    await sendEphemeral(interaction, roleError);
    return;
  }

  if (!context.actor.roles.cache.has(availableRole.role.id)) {
    await sendEphemeral(interaction, `You do not have \`${availableRole.role.name}\`.`);
    return;
  }

  await context.actor.roles.remove(
    availableRole.role,
    getAuditReason(interaction, `self-remove mod alert role ${availableRole.role.name}`),
  );

  await sendEphemeral(
    interaction,
    `Removed \`${availableRole.role.name}\`. You will no longer receive pings for that mod.`,
  );
}

export async function handleModAlertRoleInteraction(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== MOD_ALERT_ROLE_SELECT_ID) {
    return false;
  }

  const context = await getGuildContext(interaction);

  if (!context) {
    return true;
  }

  if (!(await ensureBotPermissions(interaction, context, [PermissionFlagsBits.ManageRoles]))) {
    return true;
  }

  const memberError = getSelfRoleContextError(context);

  if (memberError) {
    await sendEphemeral(interaction, memberError);
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const availableRoles = getAvailableModAlertRoles(context.guild);
  const availableByKey = new Map(availableRoles.map((entry) => [entry.key, entry]));
  const selectedKeys = [...new Set(interaction.values)];
  const results = {
    added: [],
    removed: [],
    blocked: [],
    failed: [],
    unavailable: [],
  };

  for (const selectedValue of selectedKeys) {
    const key = normalizeRoleKey(selectedValue);
    const entry = availableByKey.get(key);

    if (!entry) {
      results.unavailable.push(selectedValue);
      continue;
    }

    const roleError = getRoleUpdateError(entry.role, context);

    if (roleError) {
      results.blocked.push({ role: entry.role.name, reason: roleError });
      continue;
    }

    try {
      if (context.actor.roles.cache.has(entry.role.id)) {
        await context.actor.roles.remove(
          entry.role,
          getAuditReason(interaction, `toggle off mod alert role ${entry.role.name}`),
        );
        results.removed.push(entry.role.name);
      } else {
        await context.actor.roles.add(
          entry.role,
          getAuditReason(interaction, `toggle on mod alert role ${entry.role.name}`),
        );
        results.added.push(entry.role.name);
      }
    } catch (error) {
      results.failed.push({
        role: entry.role.name,
        reason: error.message || 'Discord rejected the update.',
      });
    }
  }

  await interaction.editReply({
    content: buildToggleSummary(results),
    allowedMentions: { parse: [] },
  });
  return true;
}
